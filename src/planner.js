// Study plan generation algorithm (pure function: no DB access, easy to test).
const STUDY_MIN = { easy: 45, medium: 75, hard: 105 };
const REVISE_MIN = { easy: 20, medium: 30, hard: 40 };
const DIFF_W = { easy: 1, medium: 2, hard: 3 };
const GOALS = {
  back_clear: { label: 'Back Clear', revRatio: 0.2, coverage: 0.7, pyqEvery: 2 },
  safe_score: { label: 'Safe Score', revRatio: 0.2, coverage: 0.6, pyqEvery: 2 },
  good_marks: { label: 'Good Marks', revRatio: 0.3, coverage: 1.0, pyqEvery: 1 },
};
const DISCLAIMER = 'This plan is a study aid based on your inputs and historical PYQ frequency. It is not official AKTU weightage and does not guarantee any marks.';

const addDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);

function score(t, goal) {
  let s = t.freq * 3 + (t.weak ? 4 : 0);
  if (goal === 'safe_score') s += t.difficulty === 'easy' ? 3 : t.difficulty === 'medium' ? 2 : 0.5;
  else if (goal === 'back_clear') s += t.difficulty === 'hard' ? 0.5 : 2;
  else s += DIFF_W[t.difficulty] * 0.8;
  return s;
}

function studyReason(t, goal) {
  const p = [];
  if (t.freq > 0) p.push(`appeared in ${t.freq} of ${t.papers} stored PYQ paper(s) (historical frequency, not official weightage)`);
  else p.push('no PYQ history stored for this topic, so it is placed by difficulty and syllabus order');
  if (t.weak) p.push('you flagged it as a weak topic');
  if (t.difficulty === 'hard') p.push('it is a hard topic, so it gets extra time');
  if (t.difficulty === 'easy') p.push('it is quick to cover');
  const g = {
    back_clear: 'Back Clear mode puts essential, frequently asked topics of your backlog subjects first.',
    safe_score: 'Safe Score mode prioritises achievable, high-coverage topics to reach a comfortable pass.',
    good_marks: 'Good Marks mode covers the full syllabus, then repeats revision and PYQ practice.',
  }[goal];
  return `Prioritised because ${p.join('; ')}. ${g}`;
}

function buildPlan({ topics, goal, daysLeft, minutesPerDay, today }) {
  const cfg = GOALS[goal];
  if (!cfg) throw new Error('Unknown goal');
  const total = topics.length;
  const doneCount = topics.filter((t) => t.completed).length;
  let pending = topics.filter((t) => !t.completed)
    .map((t) => ({ ...t, score: score(t, goal) }))
    .sort((a, b) => b.score - a.score || a.unit_no - b.unit_no || a.id - b.id);

  let deferred = [];
  if (cfg.coverage < 1) {
    const need = Math.max(0, Math.ceil(total * cfg.coverage) - doneCount);
    deferred = pending.slice(need);
    pending = pending.slice(0, need);
  }

  const revDays = daysLeft <= 1 ? 0 : daysLeft === 2 ? 1 : Math.max(1, Math.round(daysLeft * cfg.revRatio));
  const studyDays = daysLeft - revDays;
  const tasks = [];
  const scheduled = new Set();

  // ---- Study phase ----
  const queue = pending.map((t) => ({ t, rem: STUDY_MIN[t.difficulty], started: false }));
  let day = 0, left = minutesPerDay;
  while (queue.length && day < studyDays) {
    if (left < 20) { day++; left = minutesPerDay; continue; }
    const q = queue[0];
    const use = Math.min(left, q.rem);
    const suffix = q.started ? ' (continued)' : (q.rem > use ? ' (part 1)' : '');
    tasks.push({
      task_date: addDays(today, day), subject_id: q.t.subject_id, topic_id: q.t.id, task_type: 'study',
      title: `Study: ${q.t.name}${suffix}`, minutes: use, reason: studyReason(q.t, goal), subject_name: q.t.subject_name,
    });
    q.rem -= use; left -= use; q.started = true;
    if (q.rem <= 0) { queue.shift(); scheduled.add(q.t.id); }
  }
  const unscheduled = queue.map((q) => q.t);
  // Revision starts right after the last study day (no idle gap), but never later than the reserved revision window.
  const studyEnd = queue.length ? studyDays : (left < minutesPerDay ? day + 1 : day);
  const revStart = Math.min(studyDays, studyEnd);

  // ---- Revision + PYQ phase ----
  const revTopics = topics.filter((t) => t.completed || scheduled.has(t.id))
    .sort((a, b) => (b.weak - a.weak) || (b.freq - a.freq) || a.id - b.id);
  const pyqSubjects = [...new Map(topics.filter((t) => t.papers > 0).map((t) => [t.subject_id, t.subject_name])).entries()];
  let ptr = 0, pyqPtr = 0;
  for (let d = revStart; d < daysLeft; d++) {
    let rem = minutesPerDay;
    const date = addDays(today, d);
    const idx = d - revStart;
    if (pyqSubjects.length && idx % cfg.pyqEvery === 0 && rem >= 45) {
      const [sid, sname] = pyqSubjects[pyqPtr++ % pyqSubjects.length];
      tasks.push({
        task_date: date, subject_id: sid, topic_id: null, task_type: 'pyq_practice',
        title: `PYQ practice: ${sname}`, minutes: 45, subject_name: sname,
        reason: 'Solving stored previous-year papers under time limits shows which topics still need work. Frequency data is historical, not official weightage.',
      });
      rem -= 45;
    }
    const used = new Set();
    let guard = 0;
    while (revTopics.length && guard++ < revTopics.length) {
      const t = revTopics[ptr % revTopics.length]; ptr++;
      const m = REVISE_MIN[t.difficulty];
      if (used.has(t.id) || rem < m) continue;
      used.add(t.id); rem -= m;
      tasks.push({
        task_date: date, subject_id: t.subject_id, topic_id: t.id, task_type: 'revision',
        title: `Revise: ${t.name}`, minutes: m, subject_name: t.subject_name,
        reason: t.weak ? 'Revised early and often because you flagged it as weak.'
          : (goal === 'good_marks' ? 'Good Marks mode repeats revision cycles for retention.' : 'Final revision of a topic you have studied or completed.'),
      });
    }
  }

  const summary = {
    goal, label: cfg.label, daysLeft, studyDays: revStart, revisionDays: daysLeft - revStart, minutesPerDay,
    totalTopics: total, alreadyCompleted: doneCount,
    plannedStudyTopics: scheduled.size,
    unscheduledTopics: unscheduled.slice(0, 15).map((t) => t.name),
    unscheduledCount: unscheduled.length,
    deferredCount: deferred.length,
    deferredTopics: deferred.slice(0, 15).map((t) => t.name),
    notes: [],
    disclaimer: DISCLAIMER,
  };
  if (unscheduled.length) summary.notes.push(`${unscheduled.length} topic(s) did not fit in the available time. Increase daily hours or pick a lighter goal.`);
  if (deferred.length) summary.notes.push(`${cfg.label} mode intentionally defers ${deferred.length} lower-priority topic(s). Their syllabus status is unchanged.`);
  if (daysLeft - revStart === 0) summary.notes.push('Very few days left, so no separate revision phase was created.');
  return { tasks, summary };
}

module.exports = { buildPlan, GOALS, DISCLAIMER };
