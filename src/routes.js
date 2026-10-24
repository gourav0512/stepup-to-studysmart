const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('./db');
const { createSession, destroySession, requireAuth, limiter, canManage } = require('./auth');
const { buildPlan } = require('./planner');
const importer = require('./importer');

const r = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: (+process.env.MAX_UPLOAD_MB || 15) * 1024 * 1024 } });
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const GOAL_TYPES = ['back_clear', 'safe_score', 'good_marks'];

// ---------- helpers ----------
const TOPIC_SQL = `SELECT t.id, t.name, t.difficulty, t.subject_id, u.unit_no, u.title AS unit_title,
  s.name AS subject_name, s.code AS subject_code, s.is_demo,
  COALESCE(p.completed,0) AS completed, COALESCE(p.weak,0) AS weak, COALESCE(p.revised,0) AS revised,
  (SELECT COUNT(DISTINCT q.paper_id) FROM topic_question_mapping m JOIN extracted_questions q ON q.id=m.question_id
     WHERE m.topic_id=t.id AND m.status IN ('auto','confirmed')) AS freq,
  (SELECT COUNT(*) FROM question_papers qp WHERE qp.subject_id=t.subject_id) AS papers
  FROM topics t JOIN syllabus_units u ON u.id=t.unit_id JOIN subjects s ON s.id=t.subject_id
  LEFT JOIN progress p ON p.topic_id=t.id AND p.user_id=?`;

function getTopics(userId, where = '', params = []) {
  return db.prepare(`${TOPIC_SQL} ${where} ORDER BY s.code, u.unit_no, t.id`).all(userId, ...params);
}
const getAcademic = (uid) => db.prepare('SELECT * FROM academic_details WHERE user_id=?').get(uid);
function getGoal(uid) {
  const g = db.prepare('SELECT * FROM study_goals WHERE user_id=?').get(uid);
  return g ? { goal_type: g.goal_type, backlog_subject_ids: JSON.parse(g.backlog_subject_ids) } : null;
}
function scopeSubjectIds(uid) {
  const a = getAcademic(uid), g = getGoal(uid);
  if (!a) return [];
  if (g && g.goal_type === 'back_clear') return g.backlog_subject_ids;
  return db.prepare('SELECT id FROM subjects WHERE semester=?').all(a.semester).map((s) => s.id);
}
function scopeTopics(uid) {
  const ids = scopeSubjectIds(uid);
  if (!ids.length) return [];
  return getTopics(uid, `WHERE s.id IN (${ids.map(() => '?').join(',')})`, ids);
}
function subjectStats(topics) {
  const m = new Map();
  for (const t of topics) {
    const s = m.get(t.subject_id) || { id: t.subject_id, code: t.subject_code, name: t.subject_name, is_demo: t.is_demo, done: 0, total: 0 };
    s.total++; s.done += t.completed ? 1 : 0; m.set(t.subject_id, s);
  }
  return [...m.values()].map((s) => ({ ...s, pct: s.total ? Math.round((100 * s.done) / s.total) : 0 }));
}

// ---------- auth ----------
r.post('/auth/register', limiter(), wrap(async (req, res) => {
  const { name, roll_no, email, password, confirm_password } = req.body || {};
  const n = String(name || '').trim(), roll = String(roll_no || '').trim(), mail = String(email || '').trim().toLowerCase();
  if (n.length < 2 || n.length > 80) return bad(res, 'Enter your full name (2-80 characters).');
  if (!/^[A-Za-z0-9]{5,20}$/.test(roll)) return bad(res, 'Roll number must be 5-20 letters/digits.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail) || mail.length > 120) return bad(res, 'Enter a valid email address.');
  if (typeof password !== 'string' || password.length < 8 || password.length > 72 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return bad(res, 'Password must be 8-72 characters with at least one letter and one number.');
  if (password !== confirm_password) return bad(res, 'Passwords do not match.');
  if (db.prepare('SELECT 1 FROM users WHERE email=? OR roll_no=?').get(mail, roll)) return bad(res, 'An account with this email or roll number already exists.', 409);
  const hash = await bcrypt.hash(password, +process.env.BCRYPT_ROUNDS || 12);
  const id = db.prepare('INSERT INTO users(name,roll_no,email,password_hash) VALUES (?,?,?,?)').run(n, roll, mail, hash).lastInsertRowid;
  createSession(res, id);
  res.status(201).json({ user: { id, name: n, roll_no: roll, email: mail } });
}));

r.post('/auth/login', limiter(), wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').trim().toLowerCase());
  const ok = u && typeof password === 'string' && await bcrypt.compare(password, u.password_hash);
  if (!ok) return bad(res, 'Incorrect email or password.', 401);
  createSession(res, u.id);
  res.json({ user: { id: u.id, name: u.name, roll_no: u.roll_no, email: u.email } });
}));

r.post('/auth/logout', (req, res) => { destroySession(req, res); res.json({ ok: true }); });
r.get('/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));
r.get('/health', (req, res) => res.json({ ok: true }));

r.use(requireAuth);

// ---------- profile ----------
r.get('/profile', (req, res) => res.json({ user: req.user, academic: getAcademic(req.user.id) || null, goal: getGoal(req.user.id) }));

r.put('/profile', (req, res) => {
  const b = req.body || {};
  const year = +b.year_of_study, sem = +b.semester, hours = +b.hours_per_day;
  if (!Number.isInteger(year) || year < 1 || year > 4) return bad(res, 'Year of study must be 1-4.');
  if (!Number.isInteger(sem) || sem < 1 || sem > 8) return bad(res, 'Semester must be 1-8.');
  if (sem !== year * 2 - 1 && sem !== year * 2) return bad(res, `Year ${year} students are in semester ${year * 2 - 1} or ${year * 2}.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.exam_date || '') || isNaN(Date.parse(b.exam_date))) return bad(res, 'Enter a valid examination date.');
  if (dayDiff(today(), b.exam_date) < 1) return bad(res, 'Examination date must be in the future.');
  if (!(hours >= 0.5 && hours <= 16)) return bad(res, 'Study hours per day must be between 0.5 and 16.');
  db.prepare(`INSERT INTO academic_details(user_id,year_of_study,semester,exam_date,hours_per_day) VALUES (?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET year_of_study=excluded.year_of_study, semester=excluded.semester,
    exam_date=excluded.exam_date, hours_per_day=excluded.hours_per_day, updated_at=datetime('now')`)
    .run(req.user.id, year, sem, b.exam_date, hours);
  res.json({ academic: getAcademic(req.user.id) });
});

// ---------- goal ----------
r.get('/subjects', (req, res) => {
  const upto = +req.query.upto || 8;
  res.json({ subjects: db.prepare('SELECT id,code,name,semester,is_demo,verification_status FROM subjects WHERE semester<=? ORDER BY semester,code').all(upto) });
});

r.put('/goal', (req, res) => {
  const { goal_type, backlog_subject_ids } = req.body || {};
  if (!GOAL_TYPES.includes(goal_type)) return bad(res, 'Choose a valid goal.');
  let ids = [];
  if (goal_type === 'back_clear') {
    ids = [...new Set((Array.isArray(backlog_subject_ids) ? backlog_subject_ids : []).map(Number).filter(Number.isInteger))];
    if (!ids.length) return bad(res, 'Select at least one backlog subject.');
    const found = db.prepare(`SELECT COUNT(*) c FROM subjects WHERE id IN (${ids.map(() => '?').join(',')})`).get(...ids).c;
    if (found !== ids.length) return bad(res, 'One or more selected subjects do not exist.');
  }
  db.prepare(`INSERT INTO study_goals(user_id,goal_type,backlog_subject_ids) VALUES (?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET goal_type=excluded.goal_type, backlog_subject_ids=excluded.backlog_subject_ids, updated_at=datetime('now')`)
    .run(req.user.id, goal_type, JSON.stringify(ids));
  res.json({ goal: getGoal(req.user.id) });
});

// ---------- syllabus ----------
r.get('/syllabus', (req, res) => {
  const a = getAcademic(req.user.id);
  const sem = +req.query.semester || (a && a.semester);
  const sid = +req.query.subject_id;
  const topics = sid ? getTopics(req.user.id, 'WHERE s.id=?', [sid]) : getTopics(req.user.id, 'WHERE s.semester=?', [sem]);
  const subs = new Map();
  for (const t of topics) {
    if (!subs.has(t.subject_id)) subs.set(t.subject_id, { id: t.subject_id, code: t.subject_code, name: t.subject_name, is_demo: t.is_demo, papers: t.papers, units: new Map() });
    const s = subs.get(t.subject_id);
    if (!s.units.has(t.unit_no)) s.units.set(t.unit_no, { unit_no: t.unit_no, title: t.unit_title, topics: [] });
    s.units.get(t.unit_no).topics.push(t);
  }
  const out = [...subs.values()].map((s) => {
    const units = [...s.units.values()];
    const all = units.flatMap((u) => u.topics);
    return { ...s, units, total: all.length, done: all.filter((t) => t.completed).length };
  });
  res.json({ semester: sem, subjects: out });
});

r.post('/topics/:id/progress', (req, res) => {
  const tid = +req.params.id;
  const t = db.prepare('SELECT id FROM topics WHERE id=?').get(tid);
  if (!t) return bad(res, 'Topic not found.', 404);
  const cur = db.prepare('SELECT * FROM progress WHERE user_id=? AND topic_id=?').get(req.user.id, tid) || { completed: 0, weak: 0, revised: 0 };
  const completed = req.body.completed === undefined ? cur.completed : (req.body.completed ? 1 : 0);
  const weak = req.body.weak === undefined ? cur.weak : (req.body.weak ? 1 : 0);
  db.transaction(() => {
    db.prepare(`INSERT INTO progress(user_id,topic_id,completed,weak,revised) VALUES (?,?,?,?,?)
      ON CONFLICT(user_id,topic_id) DO UPDATE SET completed=excluded.completed, weak=excluded.weak, revised=excluded.revised, updated_at=datetime('now')`)
      .run(req.user.id, tid, completed, weak, completed ? cur.revised : 0);
    // Automatic progress sync: study tasks for this topic follow the topic status.
    db.prepare(`UPDATE study_tasks SET status=?, completed_at=? WHERE user_id=? AND topic_id=? AND task_type='study'`)
      .run(completed ? 'done' : 'pending', completed ? new Date().toISOString() : null, req.user.id, tid);
  })();
  res.json({ topic_id: tid, completed, weak });
});

// ---------- PYQ ----------
r.get('/papers', (req, res) => {
  const sid = +req.query.subject_id;
  const rows = db.prepare(`SELECT p.*, s.name AS subject_name, s.code AS subject_code,
    (SELECT COUNT(*) FROM extracted_questions q WHERE q.paper_id=p.id) AS question_count
    FROM question_papers p JOIN subjects s ON s.id=p.subject_id ${sid ? 'WHERE p.subject_id=?' : ''} ORDER BY p.exam_year DESC, p.id DESC`).all(...(sid ? [sid] : []));
  res.json({ papers: rows });
});

r.get('/papers/:id/questions', (req, res) => {
  const qs = db.prepare('SELECT * FROM extracted_questions WHERE paper_id=? ORDER BY q_no').all(+req.params.id);
  const maps = db.prepare(`SELECT m.id, m.question_id, m.confidence, m.status, t.id AS topic_id, t.name AS topic_name
    FROM topic_question_mapping m JOIN topics t ON t.id=m.topic_id JOIN extracted_questions q ON q.id=m.question_id WHERE q.paper_id=?`).all(+req.params.id);
  res.json({ questions: qs.map((q) => ({ ...q, mappings: maps.filter((m) => m.question_id === q.id) })) });
});

r.get('/import/review', (req, res) => {
  const rows = db.prepare(`SELECT m.id, m.confidence, q.text, t.name AS topic_name, s.name AS subject_name, p.exam_year
    FROM topic_question_mapping m JOIN extracted_questions q ON q.id=m.question_id JOIN topics t ON t.id=m.topic_id
    JOIN question_papers p ON p.id=q.paper_id JOIN subjects s ON s.id=p.subject_id
    WHERE m.status='needs_review' ORDER BY m.confidence DESC LIMIT 100`).all();
  res.json({ items: rows, can_manage: canManage(req) });
});

r.patch('/mappings/:id', (req, res) => {
  if (!canManage(req)) return bad(res, 'Only administrators can review mappings.', 403);
  const { status } = req.body || {};
  if (!['confirmed', 'rejected'].includes(status)) return bad(res, 'Status must be confirmed or rejected.');
  const ch = db.prepare('UPDATE topic_question_mapping SET status=? WHERE id=?').run(status, +req.params.id).changes;
  if (!ch) return bad(res, 'Mapping not found.', 404);
  res.json({ ok: true });
});

// ---------- import ----------
r.post('/import/upload', upload.single('file'), wrap(async (req, res) => {
  if (!canManage(req)) return bad(res, 'Only administrators can import documents.', 403);
  if (!req.file) return bad(res, 'Attach a PDF file.');
  res.status(201).json(await runImport(req.body, req.file.buffer, null));
}));

r.post('/import/url', wrap(async (req, res) => {
  if (!canManage(req)) return bad(res, 'Only administrators can import documents.', 403);
  const dl = await importer.download(String((req.body || {}).url || ''));
  res.status(201).json(await runImport(req.body, dl.buffer, dl.sourceUrl));
}));

function runImport(b, buffer, sourceUrl) {
  const kind = b.kind;
  if (!['pyq', 'syllabus'].includes(kind)) throw new importer.ImportError('Choose import type: pyq or syllabus.');
  const year = +b.exam_year;
  if (kind === 'pyq' && !(year >= 2000 && year <= 2100)) throw new importer.ImportError('Enter a valid exam year.');
  return importer.importPdf({
    buffer, kind, sourceUrl, year,
    subjectId: b.subject_id ? +b.subject_id : null,
    newSubject: b.subject_code ? { code: b.subject_code, name: b.subject_name, semester: +b.subject_semester } : null,
  });
}

// ---------- plan ----------
r.post('/plan/generate', (req, res) => {
  const uid = req.user.id, a = getAcademic(uid), g = getGoal(uid);
  if (!a) return bad(res, 'Complete Academic Details first.');
  if (!g) return bad(res, 'Choose a study goal first.');
  const daysLeft = dayDiff(today(), a.exam_date);
  if (daysLeft < 1) return bad(res, 'Your examination date has passed. Update Academic Details.');
  const topics = scopeTopics(uid);
  if (!topics.length) return bad(res, 'No syllabus topics found for your semester/subjects. Import the syllabus first (PYQ page > Import).');
  const { tasks, summary } = buildPlan({ topics, goal: g.goal_type, daysLeft, minutesPerDay: Math.round(a.hours_per_day * 60), today: today() });
  db.transaction(() => {
    db.prepare('DELETE FROM study_plans WHERE user_id=?').run(uid);
    const pid = db.prepare('INSERT INTO study_plans(user_id,goal_type,start_date,end_date,summary) VALUES (?,?,?,?,?)')
      .run(uid, g.goal_type, today(), a.exam_date, JSON.stringify(summary)).lastInsertRowid;
    const ins = db.prepare(`INSERT INTO study_tasks(plan_id,user_id,task_date,subject_id,topic_id,task_type,title,minutes,reason) VALUES (?,?,?,?,?,?,?,?,?)`);
    for (const t of tasks) ins.run(pid, uid, t.task_date, t.subject_id, t.topic_id, t.task_type, t.title, t.minutes, t.reason);
  })();
  res.status(201).json({ summary, task_count: tasks.length });
});

const TASK_SQL = `SELECT k.*, s.name AS subject_name FROM study_tasks k LEFT JOIN subjects s ON s.id=k.subject_id`;
r.get('/plan', (req, res) => {
  const plan = db.prepare('SELECT * FROM study_plans WHERE user_id=?').get(req.user.id);
  if (!plan) return res.json({ plan: null, tasks: [], today: today() });
  res.json({ plan: { ...plan, summary: JSON.parse(plan.summary) }, today: today(),
    tasks: db.prepare(`${TASK_SQL} WHERE k.plan_id=? ORDER BY k.task_date, k.id`).all(plan.id) });
});

r.patch('/tasks/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM study_tasks WHERE id=? AND user_id=?').get(+req.params.id, req.user.id);
  if (!task) return bad(res, 'Task not found.', 404);
  const done = (req.body || {}).status === 'done';
  if (!['done', 'pending'].includes((req.body || {}).status)) return bad(res, 'Status must be done or pending.');
  db.transaction(() => {
    db.prepare('UPDATE study_tasks SET status=?, completed_at=? WHERE id=?').run(done ? 'done' : 'pending', done ? new Date().toISOString() : null, task.id);
    if (task.topic_id) {
      db.prepare('INSERT OR IGNORE INTO progress(user_id,topic_id) VALUES (?,?)').run(req.user.id, task.topic_id);
      if (task.task_type === 'study') db.prepare('UPDATE progress SET completed=?, updated_at=datetime(\'now\') WHERE user_id=? AND topic_id=?').run(done ? 1 : 0, req.user.id, task.topic_id);
      if (task.task_type === 'revision') db.prepare('UPDATE progress SET revised=?, updated_at=datetime(\'now\') WHERE user_id=? AND topic_id=?').run(done ? 1 : 0, req.user.id, task.topic_id);
    }
  })();
  res.json({ ok: true });
});

// ---------- dashboard & progress ----------
r.get('/dashboard', (req, res) => {
  const uid = req.user.id, a = getAcademic(uid), g = getGoal(uid);
  if (!a || !g) return bad(res, 'Complete Academic Details and choose a goal first.');
  const topics = scopeTopics(uid), t0 = today();
  const done = topics.filter((t) => t.completed).length;
  const upcoming = db.prepare(`${TASK_SQL} WHERE k.user_id=? AND k.status='pending' AND k.task_date>=? ORDER BY k.task_date, k.id LIMIT 8`).all(uid, t0);
  const todayMin = db.prepare(`SELECT COALESCE(SUM(minutes),0) m, COALESCE(SUM(CASE WHEN status='done' THEN minutes END),0) d FROM study_tasks WHERE user_id=? AND task_date=?`).get(uid, t0);
  const recommended = topics.filter((t) => !t.completed)
    .map((t) => ({ ...t, s: t.freq * 3 + t.weak * 4 + (t.difficulty === 'hard' ? 1 : 0) }))
    .sort((x, y) => y.s - x.s || x.id - y.id).slice(0, 6);
  res.json({
    user: req.user, academic: a, goal: g, today: t0, daysLeft: dayDiff(t0, a.exam_date),
    dailyTarget: { hours: a.hours_per_day, plannedMinutesToday: todayMin.m, doneMinutesToday: todayMin.d },
    overall: { done, total: topics.length, pct: topics.length ? Math.round((100 * done) / topics.length) : 0 },
    subjects: subjectStats(topics), upcoming, recommended,
    hasPlan: !!db.prepare('SELECT 1 FROM study_plans WHERE user_id=?').get(uid),
  });
});

r.get('/progress', (req, res) => {
  const uid = req.user.id, topics = scopeTopics(uid);
  const tasks = db.prepare(`${TASK_SQL} WHERE k.user_id=? ORDER BY k.task_date, k.id`).all(uid);
  const dm = new Map();
  for (const t of tasks) {
    const d = dm.get(t.task_date) || { date: t.task_date, planned: 0, done: 0 };
    d.planned += t.minutes; if (t.status === 'done') d.done += t.minutes; dm.set(t.task_date, d);
  }
  const stats = subjectStats(topics).map((s) => {
    const own = topics.filter((t) => t.subject_id === s.id && t.completed);
    return { ...s, revised: own.filter((t) => t.revised).length };
  });
  res.json({
    today: today(),
    counts: { done: tasks.filter((t) => t.status === 'done').length, pending: tasks.filter((t) => t.status === 'pending').length, total: tasks.length },
    minutesDone: tasks.filter((t) => t.status === 'done').reduce((s, t) => s + t.minutes, 0),
    subjects: stats, daily: [...dm.values()],
    completedTasks: tasks.filter((t) => t.status === 'done').slice(-8).reverse(),
    pendingTasks: tasks.filter((t) => t.status === 'pending').slice(0, 8),
    weakTopics: topics.filter((t) => t.weak && !t.completed).slice(0, 8).map((t) => ({ id: t.id, name: t.name, subject_name: t.subject_name })),
  });
});

module.exports = r;
