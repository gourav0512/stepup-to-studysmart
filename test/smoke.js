// End-to-end smoke test: starts the app on a temp DB and exercises the main APIs.
const os = require('os'), path = require('path'), fs = require('fs'), assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ssp-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.NODE_ENV = 'test';
process.env.BCRYPT_ROUNDS = '4';
const app = require('../server');

(async () => {
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const step = (n) => console.log('  ok -', n);
  const iso = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

  assert.equal((await call('GET', '/dashboard')).status, 401); step('protected route rejects anonymous');
  assert.equal((await call('POST', '/auth/register', { name: 'A', roll_no: '1', email: 'x', password: 'a', confirm_password: 'b' })).status, 400); step('signup validation');
  const reg = await call('POST', '/auth/register', { name: 'Test Student', roll_no: '2201330100', email: 'T@Example.com', password: 'Passw0rdX', confirm_password: 'Passw0rdX' });
  assert.equal(reg.status, 201); step('register');
  assert.equal((await call('POST', '/auth/register', { name: 'Test Student', roll_no: '2201330100', email: 't@example.com', password: 'Passw0rdX', confirm_password: 'Passw0rdX' })).status, 409); step('duplicate blocked');
  assert.equal((await call('POST', '/auth/login', { email: 't@example.com', password: 'wrong' })).status, 401);
  assert.equal((await call('POST', '/auth/login', { email: 't@example.com', password: 'Passw0rdX' })).status, 200); step('login');

  assert.equal((await call('PUT', '/profile', { year_of_study: 3, semester: 2, exam_date: iso(30), hours_per_day: 4 })).status, 400); step('semester/year mismatch rejected');
  assert.equal((await call('PUT', '/profile', { year_of_study: 3, semester: 5, exam_date: iso(-1), hours_per_day: 4 })).status, 400); step('past exam date rejected');
  assert.equal((await call('PUT', '/profile', { year_of_study: 3, semester: 5, exam_date: iso(30), hours_per_day: 4 })).status, 200); step('save academic details');

  assert.equal((await call('PUT', '/goal', { goal_type: 'back_clear', backlog_subject_ids: [] })).status, 400); step('back clear needs subjects');
  const subs = (await call('GET', '/subjects?upto=5')).data.subjects;
  const syl = (await call('GET', '/syllabus')).data;
  assert.equal(syl.subjects.length, 3); step('syllabus loads for semester 5 (DEMO)');

  for (const goal of ['safe_score', 'good_marks', 'back_clear']) {
    const body = goal === 'back_clear' ? { goal_type: goal, backlog_subject_ids: [subs[0].id, subs[1].id] } : { goal_type: goal };
    assert.equal((await call('PUT', '/goal', body)).status, 200);
    const g = await call('POST', '/plan/generate');
    assert.equal(g.status, 201, JSON.stringify(g.data));
    const plan = (await call('GET', '/plan')).data;
    assert.ok(plan.tasks.length > 0 && plan.tasks.every((t) => t.reason && t.minutes > 0));
    assert.ok(plan.tasks.every((t) => t.task_date < iso(30)), 'no task on/after exam day');
    const perDay = {}; plan.tasks.forEach((t) => { perDay[t.task_date] = (perDay[t.task_date] || 0) + t.minutes; });
    assert.ok(Object.values(perDay).every((m) => m <= 240), 'daily minutes within available hours');
    assert.ok(plan.plan.summary.disclaimer.includes('not guarantee'));
    step(`${goal}: ${plan.tasks.length} tasks, ${plan.plan.summary.studyDays} study days / ${plan.plan.summary.revisionDays} revision days`);
  }

  await call('PUT', '/goal', { goal_type: 'good_marks' }); await call('POST', '/plan/generate');
  const first = (await call('GET', '/plan')).data.tasks.find((t) => t.task_type === 'study');
  assert.equal((await call('PATCH', `/tasks/${first.id}`, { status: 'done' })).status, 200);
  let syl2 = (await call('GET', '/syllabus')).data.subjects.flatMap((s) => s.units.flatMap((u) => u.topics));
  assert.equal(syl2.find((t) => t.id === first.topic_id).completed, 1); step('completing a task marks the topic complete');
  const other = syl2.find((t) => !t.completed);
  await call('POST', `/topics/${other.id}/progress`, { completed: true });
  const prog = (await call('GET', '/progress')).data;
  assert.ok(prog.counts.done >= 1 && prog.subjects.length === 3); step('progress endpoint updates automatically');
  const dash = (await call('GET', '/dashboard')).data;
  assert.ok(dash.daysLeft === 30 && dash.overall.done >= 2 && dash.upcoming.length && dash.recommended.length); step('dashboard data');

  const papers = (await call('GET', `/papers?subject_id=${subs[0].id}`)).data.papers;
  assert.ok(papers.length === 3 && papers.every((p) => p.is_demo === 1)); step('DEMO papers labelled');
  const dupe = await call('POST', '/import/url', { url: 'http://example.com/a.pdf', kind: 'pyq' });
  assert.equal(dupe.status, 422); step('non-AKTU / non-https URL import refused');
  assert.equal((await call('POST', '/auth/logout')).status, 200);
  assert.equal((await call('GET', '/dashboard')).status, 401); step('logout invalidates session');

  srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\nAll smoke tests passed.');
})().catch((e) => { console.error('\nTEST FAILED:', e); process.exit(1); });
