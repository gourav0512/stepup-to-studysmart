const view = $('#view');
let profile = null, current = 'dashboard', timer = null;
const ST = { sem: null, syl: null, open: new Set(), q: '', diff: 'all', pendingOnly: false, day: null, pyqSub: null, pyqTab: 'papers' };
const GOALS = { back_clear: 'Back Clear', safe_score: 'Safe Score', good_marks: 'Good Marks' };
const TYPES = { study: 'Study', revision: 'Revision', pyq_practice: 'PYQ practice' };

const head = (t, s) => `<div class="head"><h1>${t}</h1>${s ? `<p>${s}</p>` : ''}</div>`;
const ring = (p) => `<div class="ring" style="--p:${p}"><span>${p}%</span></div>`;
const bar = (p) => `<div class="bar"><i style="width:${p}%"></i></div>`;
const demoTag = (x) => (x ? '<span class="badge demo" title="Sample data, not official AKTU content">DEMO</span>' : '');
const empty = (emoji, msg, extra = '') => `<div class="empty"><div class="emoji">${emoji}</div><p>${msg}</p>${extra}</div>`;
const rel = (d, today) => { const n = Math.round((Date.parse(d) - Date.parse(today)) / 864e5); return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : fmtDate(d); };
const refreshProfile = async () => { profile = await api('/profile'); };

const pages = { dashboard, academic, goal, syllabus, pyq, plan, progress };

async function boot() {
  const me = await api('/auth/me');
  $('#uname').textContent = me.user.name;
  $('#avatar').textContent = me.user.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  await refreshProfile();
  if (!location.hash) location.hash = !profile.academic ? '#/academic' : !profile.goal ? '#/goal' : '#/dashboard';
  route();
}

async function route(quiet = false) {
  clearInterval(timer);
  let name = location.hash.replace('#/', '') || 'dashboard';
  if (!pages[name]) name = 'dashboard';
  if (name !== 'academic' && !profile.academic) { toast('Please complete Academic Details first.', 'err'); location.hash = '#/academic'; return; }
  if (['dashboard', 'plan', 'progress'].includes(name) && !profile.goal) { toast('Choose a study goal first.', 'err'); location.hash = '#/goal'; return; }
  current = name;
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.r === name));
  closeNav();
  if (!quiet) view.innerHTML = '<div class="loading">Loading…</div>';
  try { await pages[name](); } catch (e) { view.innerHTML = `<div class="card err">${esc(e.message)}</div>`; }
  if (!quiet) window.scrollTo(0, 0);
}
window.addEventListener('hashchange', () => route());

function closeNav() { $('#side').classList.remove('open'); $('.scrim')?.remove(); }
$('#burger').addEventListener('click', () => {
  $('#side').classList.add('open');
  const s = document.createElement('div'); s.className = 'scrim'; s.addEventListener('click', closeNav); document.body.append(s);
});
$('#logout').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }); location.href = '/'; });

/* ---------------- Dashboard ---------------- */
async function dashboard() {
  const d = await api('/dashboard'), a = d.academic, pm = d.dailyTarget;
  const up = d.upcoming.map((t) => taskRow(t, d.today, true)).join('');
  view.innerHTML = head(`Welcome back, ${esc(d.user.name.split(' ')[0])} 👋`,
    `${a.course} ${esc(a.branch)} · Year ${a.year_of_study} · Semester ${a.semester} · Session ${a.academic_year} · Roll ${esc(d.user.roll_no)}`) + `
  <div class="grid g4">
    <div class="card stat grad"><div class="lbl">Days until exam</div><div class="val">${d.daysLeft}</div><div class="small">${fmtDate(a.exam_date)}</div></div>
    <div class="card stat"><div class="lbl">Selected goal</div><div class="val" style="font-size:22px;margin:10px 0 4px">${GOALS[d.goal.goal_type]}</div><a class="small" href="#/goal">Change goal</a></div>
    <div class="card stat"><div class="lbl">Daily study target</div><div class="val">${a.hours_per_day}h</div><div class="small muted">Today: ${pm.doneMinutesToday} of ${pm.plannedMinutesToday} min done</div></div>
    <div class="card row">${ring(d.overall.pct)}<div><div class="lbl muted small">Syllabus completion</div><b>${d.overall.done} / ${d.overall.total} topics</b></div></div>
  </div>
  <div class="grid g2 mt">
    <div class="card"><div class="row between"><h2>Upcoming study tasks</h2><a class="small" href="#/plan">Full plan →</a></div>
      ${d.hasPlan ? (up ? `<div class="list">${up}</div>` : empty('🎉', 'No pending tasks ahead. Great work!')) :
        empty('🗓️', 'You have no study plan yet.', '<a class="btn" href="#/plan" style="display:inline-block;text-decoration:none">Generate my plan</a>')}
    </div>
    <div>
      <div class="card"><h2>Subject-wise progress</h2><div class="list mt">${d.subjects.map((s) => `
        <div class="item"><div class="body"><div class="row between"><span class="t">${esc(s.name)} ${demoTag(s.is_demo)}</span><b>${s.pct}%</b></div>${bar(s.pct)}<div class="small muted" style="margin-top:4px">${s.done} of ${s.total} topics</div></div></div>`).join('') || empty('📚', 'No subjects in scope.')}</div></div>
      <div class="card mt"><h2>Recommended topics</h2><p class="small muted" style="margin:4px 0 0">Ranked by weak flags, historical PYQ frequency and difficulty.</p><div class="list mt">${d.recommended.map((t) => `
        <div class="item"><div class="body"><div class="t">${esc(t.name)}</div><div class="small muted">${esc(t.subject_name)}</div>
        <span class="badge ${t.difficulty}">${t.difficulty}</span> ${t.freq ? `<span class="chip">PYQ ${t.freq}/${t.papers} papers</span>` : ''}${t.weak ? '<span class="chip">⭐ weak</span>' : ''}</div>
        <button class="btn sm ghost" data-done-topic="${t.id}">Mark done</button></div>`).join('') || empty('✅', 'Everything is complete.')}</div></div>
    </div>
  </div>`;
}

function taskRow(t, today, showDate) {
  return `<div class="item"><input type="checkbox" data-task="${t.id}" ${t.status === 'done' ? 'checked' : ''} aria-label="Mark task done">
    <div class="body"><div class="t" style="${t.status === 'done' ? 'text-decoration:line-through;color:var(--muted)' : ''}">${esc(t.title)}</div>
    <div class="small muted">${esc(t.subject_name || '')}${showDate ? ' · ' + rel(t.task_date, today) : ''} · ${t.minutes} min</div></div>
    <span class="badge ${t.task_type}">${TYPES[t.task_type]}</span></div>`;
}

/* ---------------- Academic details ---------------- */
async function academic() {
  const a = profile.academic || {};
  const year = a.year_of_study || 3;
  view.innerHTML = head('Academic Details', 'Your exam date and study hours drive the whole plan.') + `
  <form class="card form" id="acad" novalidate>
    <div><label class="f">University</label><input class="inp" value="AKTU" disabled></div>
    <div><label class="f">Course</label><input class="inp" value="B.Tech" disabled></div>
    <div><label class="f">Branch</label><input class="inp" value="Computer Science Engineering" disabled></div>
    <div><label class="f">Academic year</label><input class="inp" value="2025-26" disabled></div>
    <div><label class="f" for="yr">Year of study</label><select class="inp" id="yr">${[1, 2, 3, 4].map((y) => `<option value="${y}" ${y === year ? 'selected' : ''}>Year ${y}</option>`).join('')}</select></div>
    <div><label class="f" for="sem">Semester</label><select class="inp" id="sem"></select></div>
    <div><label class="f" for="ex">Examination date</label><input class="inp" type="date" id="ex" value="${a.exam_date || ''}" required></div>
    <div><label class="f" for="hr">Available study hours per day: <b id="hrv">${a.hours_per_day || 4}</b></label>
      <input type="range" id="hr" min="0.5" max="12" step="0.5" value="${a.hours_per_day || 4}" style="width:100%;accent-color:#7c3aed"></div>
    <div class="full fieldmsg" id="amsg"></div>
    <div class="full row"><button class="btn" type="submit">Save &amp; continue</button>${profile.goal ? '<span class="small muted">If you change the exam date or hours, regenerate your plan.</span>' : ''}</div>
  </form>`;
  const fillSem = () => {
    const y = +$('#yr').value, keep = a.semester;
    $('#sem').innerHTML = [2 * y - 1, 2 * y].map((s) => `<option value="${s}" ${s === keep ? 'selected' : ''}>Semester ${s}</option>`).join('');
  };
  fillSem();
  const tomorrow = new Date(Date.now() + 864e5); $('#ex').min = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  $('#yr').addEventListener('change', fillSem);
  $('#hr').addEventListener('input', (e) => { $('#hrv').textContent = e.target.value; });
  $('#acad').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/profile', { method: 'PUT', body: { year_of_study: +$('#yr').value, semester: +$('#sem').value, exam_date: $('#ex').value, hours_per_day: +$('#hr').value } });
      await refreshProfile(); ST.sem = null; toast('Academic details saved');
      location.hash = profile.goal ? '#/dashboard' : '#/goal';
    } catch (err) { $('#amsg').textContent = err.message; }
  });
}

/* ---------------- Goal ---------------- */
async function goal() {
  const cur = profile.goal || { goal_type: null, backlog_subject_ids: [] };
  let sel = cur.goal_type, ids = new Set(cur.backlog_subject_ids);
  const subs = (await api(`/subjects?upto=${profile.academic.semester}`)).subjects;
  const opts = [
    ['back_clear', '🧱', 'Backlogs', 'Focus on clearing backlog subjects with essential, frequently asked topics.'],
    ['safe_score', '🛡️', 'Safe Score', 'Aim for roughly 50% by covering achievable, high-coverage topics.'],
    ['good_marks', '🚀', 'Good Marks', 'Aim for roughly 90% with full syllabus coverage, PYQ practice and repeated revision.'],
  ];
  const draw = () => {
    view.innerHTML = head('Choose your study goal', 'Targets are aims for planning, never guarantees of marks.') + `
    <div class="grid g3">${opts.map(([k, e, n, d]) => `<div class="card goal ${sel === k ? 'sel' : ''}" data-goal="${k}" tabindex="0"><div class="emoji">${e}</div><h2 style="margin:8px 0 6px">${n}</h2><p class="muted small" style="margin:0">${d}</p></div>`).join('')}</div>
    ${sel === 'back_clear' ? `<div class="card mt"><h2>Select backlog subjects</h2><p class="small muted">Showing subjects up to semester ${profile.academic.semester}.</p><div class="list mt">${subs.map((s) => `
      <label class="item" style="cursor:pointer"><input type="checkbox" data-bk="${s.id}" ${ids.has(s.id) ? 'checked' : ''}><div class="body"><span class="t">${esc(s.name)}</span> ${demoTag(s.is_demo)}<div class="small muted">${esc(s.code)} · Semester ${s.semester}</div></div></label>`).join('')}</div></div>` : ''}
    <div class="mt row"><button class="btn" id="savegoal">Save goal &amp; build plan</button><span class="fieldmsg" id="gmsg"></span></div>`;
    $$('[data-goal]').forEach((c) => c.addEventListener('click', () => { sel = c.dataset.goal; draw(); }));
    $$('[data-bk]').forEach((c) => c.addEventListener('change', () => { c.checked ? ids.add(+c.dataset.bk) : ids.delete(+c.dataset.bk); }));
    $('#savegoal').addEventListener('click', async () => {
      if (!sel) { $('#gmsg').textContent = 'Pick a goal first.'; return; }
      try {
        await api('/goal', { method: 'PUT', body: { goal_type: sel, backlog_subject_ids: [...ids] } });
        await refreshProfile(); toast('Goal saved'); location.hash = '#/plan';
      } catch (e) { $('#gmsg').textContent = e.message; }
    });
  };
  draw();
}

/* ---------------- Syllabus ---------------- */
async function syllabus() {
  if (!ST.sem) ST.sem = profile.academic.semester;
  ST.syl = await api(`/syllabus?semester=${ST.sem}`);
  drawSyllabus(true);
}
function drawSyllabus(full) {
  const q = ST.q.trim().toLowerCase();
  const match = (t) => (!q || t.name.toLowerCase().includes(q)) && (ST.diff === 'all' || t.difficulty === ST.diff) && (!ST.pendingOnly || !t.completed);
  const filtering = q || ST.diff !== 'all' || ST.pendingOnly;
  const subs = ST.syl.subjects.map((s) => ({ ...s, units: s.units.map((u) => ({ ...u, shown: u.topics.filter(match) })).filter((u) => u.shown.length) })).filter((s) => !filtering || s.units.length);
  const list = subs.map((s) => {
    const pct = s.total ? Math.round((100 * s.done) / s.total) : 0;
    return `<details class="sub" data-sid="${s.id}" ${ST.open.has(s.id) || filtering ? 'open' : ''}>
      <summary><div style="flex:1;min-width:0"><div class="row wrap"><b>${esc(s.name)}</b> ${demoTag(s.is_demo)}<span class="small muted">${esc(s.code)}</span></div>${bar(pct)}</div><div style="text-align:right"><b>${pct}%</b><div class="small muted">${s.done}/${s.total}</div></div></summary>
      ${s.units.map((u) => `<div class="unit"><h3>Unit ${u.unit_no}: ${esc(u.title)}</h3>${u.shown.map((t) => `
        <div class="trow ${t.completed ? 'done' : ''}"><input type="checkbox" data-topic-done="${t.id}" ${t.completed ? 'checked' : ''} aria-label="Completed">
          <span class="tn">${esc(t.name)}</span><span class="badge ${t.difficulty}">${t.difficulty}</span>
          ${t.papers ? `<span class="chip" title="Historical frequency in stored papers, not official weightage">PYQ ${t.freq}/${t.papers}${s.is_demo ? ' DEMO' : ''}</span>` : '<span class="chip">No PYQ data</span>'}
          <button class="star ${t.weak ? 'on' : ''}" data-weak="${t.id}" title="Flag as weak topic" aria-label="Flag as weak">★</button></div>`).join('')}</div>`).join('')}
    </details>`;
  }).join('');
  const semOpts = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option value="${n}" ${n === ST.sem ? 'selected' : ''}>Semester ${n}</option>`).join('');
  if (full) {
    view.innerHTML = head('Subjects & Syllabus', 'Tick topics as you finish them. ★ marks a weak topic and boosts its priority.') + `
    <div class="card flat row wrap" style="margin-bottom:16px"><select class="inp" id="ssem" style="width:150px">${semOpts}</select>
      <input class="inp" id="sq" placeholder="Search topics…" value="${esc(ST.q)}" style="flex:1;min-width:160px">
      <select class="inp" id="sdiff" style="width:140px">${['all', 'easy', 'medium', 'hard'].map((d) => `<option ${d === ST.diff ? 'selected' : ''}>${d}</option>`).join('')}</select>
      <label class="row small"><input type="checkbox" id="spend" ${ST.pendingOnly ? 'checked' : ''}> Pending only</label></div>
    <div id="slist"></div>`;
    $('#ssem').addEventListener('change', (e) => { ST.sem = +e.target.value; ST.open.clear(); syllabus(); });
    $('#sq').addEventListener('input', (e) => { ST.q = e.target.value; drawSyllabus(false); });
    $('#sdiff').addEventListener('change', (e) => { ST.diff = e.target.value; drawSyllabus(false); });
    $('#spend').addEventListener('change', (e) => { ST.pendingOnly = e.target.checked; drawSyllabus(false); });
  }
  $('#slist').innerHTML = list || (ST.syl.subjects.length ? empty('🔍', 'No topics match your filters.') :
    empty('📭', `No syllabus data for semester ${ST.sem} yet. Import the official syllabus PDF from <a href="#/pyq">Previous Year Questions → Import</a>. Nothing is invented.`));
}

/* ---------------- PYQ ---------------- */
async function pyq() {
  const subjects = (await api('/subjects')).subjects;
  if (!subjects.length) { view.innerHTML = head('Previous Year Questions') + empty('📭', 'No subjects yet.'); return; }
  if (!ST.pyqSub || !subjects.find((s) => s.id === ST.pyqSub)) ST.pyqSub = (subjects.find((s) => s.semester === profile.academic.semester) || subjects[0]).id;
  const tabs = [['papers', 'Papers'], ['freq', 'Topic frequency'], ['review', 'Review mappings'], ['import', 'Import']];
  view.innerHTML = head('Previous Year Questions', 'Frequency counts show how often a topic appeared in the stored papers. It is historical and not official AKTU weightage.') + `
  <div class="row wrap" style="margin-bottom:12px"><select class="inp" id="psub" style="max-width:420px">${subjects.map((s) => `<option value="${s.id}" ${s.id === ST.pyqSub ? 'selected' : ''}>Sem ${s.semester} · ${esc(s.name)} (${esc(s.code)})${s.is_demo ? ' · DEMO' : ''}</option>`).join('')}</select></div>
  <div class="tabs">${tabs.map(([k, n]) => `<button class="tab ${ST.pyqTab === k ? 'on' : ''}" data-ptab="${k}">${n}</button>`).join('')}</div><div id="pbody"><div class="loading">Loading…</div></div>`;
  $('#psub').addEventListener('change', (e) => { ST.pyqSub = +e.target.value; pyq(); });
  $$('[data-ptab]').forEach((b) => b.addEventListener('click', () => { ST.pyqTab = b.dataset.ptab; pyq(); }));
  const body = $('#pbody');
  if (ST.pyqTab === 'papers') {
    const { papers } = await api(`/papers?subject_id=${ST.pyqSub}`);
    body.innerHTML = papers.length ? papers.map((p) => `<div class="card mt" style="margin-top:0;margin-bottom:12px"><div class="row wrap between"><div><h2>${p.exam_year} · Semester ${p.semester} ${demoTag(p.is_demo)}</h2>
      <div class="small muted">${p.question_count} extracted questions · status: ${esc(p.verification_status)}${p.source_url ? ` · <a href="${esc(p.source_url)}" target="_blank" rel="noopener">source</a>` : ''}</div></div>
      <div class="row">${p.pdf_url ? `<a class="btn ghost sm" href="${esc(p.pdf_url)}" target="_blank" rel="noopener">Open PDF</a>` : '<span class="small muted">No PDF (demo)</span>'}<button class="btn sm" data-qs="${p.id}">View questions</button></div></div><div id="q${p.id}" class="hide mt"></div></div>`).join('')
      : empty('📭', 'No papers stored for this subject. Use the Import tab to add an official paper PDF.');
  } else if (ST.pyqTab === 'freq') {
    const { subjects: ss } = await api(`/syllabus?subject_id=${ST.pyqSub}`);
    const topics = (ss[0]?.units || []).flatMap((u) => u.topics.map((t) => ({ ...t, unit_no: u.unit_no }))).sort((a, b) => b.freq - a.freq);
    const n = topics[0]?.papers || 0;
    body.innerHTML = `<div class="notice info" style="margin-bottom:12px">Historical frequency across ${n} stored paper(s). This is not official AKTU weightage.</div><div class="card"><table><thead><tr><th>Topic</th><th>Unit</th><th style="width:40%">Appeared in</th></tr></thead><tbody>${topics.map((t) => `<tr><td>${esc(t.name)}</td><td>${t.unit_no}</td><td>${bar(n ? Math.round((100 * t.freq) / n) : 0)}<span class="small muted">${t.freq} of ${n} papers</span></td></tr>`).join('') || '<tr><td colspan=3>No topics.</td></tr>'}</tbody></table></div>`;
  } else if (ST.pyqTab === 'review') {
    const { items, can_manage } = await api('/import/review');
    body.innerHTML = items.length ? `<div class="notice info" style="margin-bottom:12px">These question-to-topic matches were uncertain. Confirm or reject each one. Only confirmed or high-confidence matches count toward frequency.</div><div class="card"><div class="list">${items.map((m) => `<div class="item"><div class="body"><div class="t">${esc(m.text)}</div><div class="small muted">${esc(m.subject_name)} · ${m.exam_year} → <b>${esc(m.topic_name)}</b> (${Math.round(m.confidence * 100)}% match)</div></div>
      ${can_manage ? `<button class="btn sm" data-map="${m.id}" data-st="confirmed">Confirm</button><button class="btn sm ghost" data-map="${m.id}" data-st="rejected">Reject</button>` : ''}</div>`).join('')}</div></div>` : empty('✅', 'Nothing to review.');
  } else {
    importForm(body, (await api('/subjects')).subjects);
  }
}

function importForm(body, subjects) {
  body.innerHTML = `<div class="notice" style="margin-bottom:12px">Import only documents you are allowed to use. Automatic download is limited to official aktu.ac.in https links and respects robots.txt. If it fails, download the PDF yourself and upload it. Imported data starts as <b>unverified</b>. Duplicate files are rejected.</div>
  <form class="card form" id="imp" novalidate>
    <div><label class="f">Document type</label><select class="inp" id="ik"><option value="pyq">Previous year question paper</option><option value="syllabus">Syllabus</option></select></div>
    <div><label class="f">Source</label><select class="inp" id="is"><option value="file">Upload PDF</option><option value="url">AKTU https link</option></select></div>
    <div class="full"><label class="f">Subject</label><select class="inp" id="isub">${subjects.map((s) => `<option value="${s.id}" ${s.id === ST.pyqSub ? 'selected' : ''}>Sem ${s.semester} · ${esc(s.name)}</option>`).join('')}<option value="new" class="syl-only">+ New subject (syllabus only)</option></select></div>
    <div class="hide full form" id="newsub" style="padding:0"><div><label class="f">Subject code</label><input class="inp" id="nc"></div><div><label class="f">Subject name</label><input class="inp" id="nn"></div><div><label class="f">Semester</label><input class="inp" id="nsem" type="number" min="1" max="8"></div></div>
    <div id="yrbox"><label class="f">Exam year</label><input class="inp" id="iy" type="number" min="2000" max="2100" value="${new Date().getFullYear() - 1}"></div>
    <div id="filebox"><label class="f">PDF file</label><input class="inp" id="if" type="file" accept="application/pdf"></div>
    <div id="urlbox" class="hide full"><label class="f">PDF URL</label><input class="inp" id="iu" placeholder="https://aktu.ac.in/…pdf"></div>
    <div class="full row"><button class="btn" type="submit">Import &amp; extract</button><span class="fieldmsg" id="imsg"></span></div>
    <div class="full hide" id="ires"></div>
  </form>`;
  const sync = () => {
    const k = $('#ik').value, src = $('#is').value;
    $('#yrbox').classList.toggle('hide', k !== 'pyq'); $('#filebox').classList.toggle('hide', src !== 'file'); $('#urlbox').classList.toggle('hide', src !== 'url');
    $$('.syl-only').forEach((o) => { o.hidden = k !== 'syllabus'; }); if (k !== 'syllabus' && $('#isub').value === 'new') $('#isub').selectedIndex = 0;
    $('#newsub').classList.toggle('hide', $('#isub').value !== 'new');
  };
  ['ik', 'is', 'isub'].forEach((id) => $('#' + id).addEventListener('change', sync)); sync();
  $('#imp').addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = $('button', e.target); btn.disabled = true; $('#imsg').textContent = '';
    try {
      const f = new FormData(); f.append('kind', $('#ik').value); f.append('exam_year', $('#iy').value);
      if ($('#isub').value === 'new') { f.append('subject_code', $('#nc').value); f.append('subject_name', $('#nn').value); f.append('subject_semester', $('#nsem').value); } else f.append('subject_id', $('#isub').value);
      let res;
      if ($('#is').value === 'file') { if (!$('#if').files[0]) throw new Error('Choose a PDF file.'); f.append('file', $('#if').files[0]); res = await api('/import/upload', { method: 'POST', body: f }); }
      else { const o = Object.fromEntries(f.entries()); o.url = $('#iu').value; res = await api('/import/url', { method: 'POST', body: o }); }
      $('#ires').classList.remove('hide');
      $('#ires').innerHTML = `<div class="notice info"><b>Import complete.</b> ${Object.entries(res).map(([k, v]) => `${esc(k.replace(/_/g, ' '))}: <b>${esc(v)}</b>`).join(' · ')}</div>`;
      toast('Import complete');
    } catch (err) { $('#imsg').textContent = err.message; } finally { btn.disabled = false; }
  });
}

/* ---------------- Study plan ---------------- */
async function plan() {
  const d = await api('/plan');
  if (!d.plan) {
    view.innerHTML = head('Personalized Study Plan', 'A realistic daily schedule built from your goal, exam date, hours and syllabus status.') +
      `<div class="card">${empty('🗓️', `Goal: <b>${GOALS[profile.goal.goal_type]}</b>. Generate a plan to see what to study each day and why.`, '<button class="btn" id="gen">Generate my study plan</button>')}</div>`;
    $('#gen').addEventListener('click', generate); return;
  }
  const s = d.plan.summary;
  const byDay = {}; d.tasks.forEach((t) => (byDay[t.task_date] ||= []).push(t));
  const dates = Object.keys(byDay).sort();
  if (!ST.day || !byDay[ST.day]) ST.day = dates.find((x) => x >= d.today) || dates[dates.length - 1];
  const stale = d.plan.goal_type !== profile.goal.goal_type;
  view.innerHTML = head('Personalized Study Plan', `${GOALS[d.plan.goal_type]} · ${fmtDate(d.plan.start_date)} → exam on ${fmtDate(d.plan.end_date)}`) + `
  ${stale ? `<div class="notice" style="margin-bottom:12px">Your goal changed after this plan was made. Regenerate to apply it.</div>` : ''}
  <div class="grid g4"><div class="card stat"><div class="lbl">Days to exam</div><div class="val">${s.daysLeft}</div></div>
    <div class="card stat"><div class="lbl">Study / revision days</div><div class="val">${s.studyDays} / ${s.revisionDays}</div></div>
    <div class="card stat"><div class="lbl">Topics scheduled</div><div class="val">${s.plannedStudyTopics}</div></div>
    <div class="card stat"><div class="lbl">Daily time</div><div class="val">${Math.round(s.minutesPerDay / 6) / 10}h</div></div></div>
  ${s.notes.map((n) => `<div class="notice info mt">${esc(n)}</div>`).join('')}
  ${s.deferredCount ? `<details class="mt small"><summary>Deferred topics (${s.deferredCount})</summary><p class="muted">${s.deferredTopics.map(esc).join(', ')}${s.deferredCount > 15 ? '…' : ''}</p></details>` : ''}
  <div class="row between mt" style="margin-bottom:10px"><h2>Daily schedule</h2><button class="btn ghost sm" id="gen">Regenerate plan</button></div>
  <div class="days">${dates.map((x) => { const ts = byDay[x], tot = ts.reduce((a, t) => a + t.minutes, 0), dn = ts.filter((t) => t.status === 'done').reduce((a, t) => a + t.minutes, 0);
    const dt = new Date(x + 'T00:00:00'); return `<div class="day ${x === ST.day ? 'on' : ''} ${x === d.today ? 'today' : ''}" data-day="${x}"><small>${dt.toLocaleDateString('en-IN', { weekday: 'short' })}</small><b>${dt.getDate()}</b><small>${dt.toLocaleDateString('en-IN', { month: 'short' })}</small><span class="dot"><i style="width:${Math.round((100 * dn) / tot)}%"></i></span></div>`; }).join('')}</div>
  <div class="card"><div class="row between"><h2>${rel(ST.day, d.today)} · ${fmtDate(ST.day)}</h2><span class="small muted">${byDay[ST.day].reduce((a, t) => a + t.minutes, 0)} min planned</span></div>
    <div class="list mt">${byDay[ST.day].map((t) => `<div class="item"><input type="checkbox" data-task="${t.id}" ${t.status === 'done' ? 'checked' : ''}><div class="body"><div class="t" style="${t.status === 'done' ? 'text-decoration:line-through;color:var(--muted)' : ''}">${esc(t.title)}</div>
      <div class="small muted">${esc(t.subject_name || '')} · ${t.minutes} min · <button class="why" data-why="${t.id}">Why this topic?</button></div><div class="reason hide" id="why${t.id}">${esc(t.reason)}</div></div><span class="badge ${t.task_type}">${TYPES[t.task_type]}</span></div>`).join('')}</div></div>
  <div class="notice mt">${esc(s.disclaimer)}</div>`;
  $('#gen').addEventListener('click', () => { if (confirm('Regenerate the plan? Task checkmarks reset, topic completion is kept.')) generate(); });
}
async function generate() {
  const b = $('#gen'); if (b) b.disabled = true;
  try { await api('/plan/generate', { method: 'POST' }); ST.day = null; toast('Study plan generated'); route(); } catch (e) { toast(e.message, 'err'); if (b) b.disabled = false; }
}

/* ---------------- Progress ---------------- */
async function progress() {
  const p = await api('/progress');
  const dates = p.daily.filter((d) => { const n = Math.round((Date.parse(d.date) - Date.parse(p.today)) / 864e5); return n >= -6 && n <= 7; });
  const mx = Math.max(60, ...dates.map((d) => d.planned));
  const done = p.counts.total ? Math.round((100 * p.counts.done) / p.counts.total) : 0;
  const mini = (ts) => ts.length ? `<div class="list">${ts.map((t) => `<div class="item"><div class="body"><div class="t">${esc(t.title)}</div><div class="small muted">${fmtDate(t.task_date)} · ${t.minutes} min</div></div><span class="badge ${t.task_type}">${TYPES[t.task_type]}</span></div>`).join('')}</div>` : empty('—', 'Nothing here yet.');
  view.innerHTML = head('Progress Tracker', 'Updates automatically as you complete tasks or tick topics.') + `
  <div class="grid g4"><div class="card stat grad"><div class="lbl">Completed tasks</div><div class="val">${p.counts.done}</div></div>
    <div class="card stat"><div class="lbl">Pending tasks</div><div class="val">${p.counts.pending}</div></div>
    <div class="card stat"><div class="lbl">Plan completion</div><div class="val">${done}%</div></div>
    <div class="card stat"><div class="lbl">Time studied</div><div class="val">${Math.round(p.minutesDone / 6) / 10}h</div></div></div>
  <div class="grid g2 mt"><div class="card"><h2>Daily study progress</h2><p class="small muted" style="margin:4px 0 0">Light = planned minutes, purple = completed.</p>
    ${dates.length ? `<div class="chart">${dates.map((d) => `<div class="col"><div class="bars"><i style="height:${Math.round((110 * d.planned) / mx)}px" title="${d.planned} min planned"></i><i class="d" style="height:${Math.round((110 * d.done) / mx)}px" title="${d.done} min done"></i></div><small>${new Date(d.date + 'T00:00:00').getDate()}${d.date === p.today ? '•' : ''}</small></div>`).join('')}</div>` : empty('📅', 'Generate a plan to see daily progress.')}</div>
    <div class="card"><h2>Subject completion</h2><div class="list mt">${p.subjects.map((s) => `<div class="item"><div class="body"><div class="row between"><span class="t">${esc(s.name)}</span><b>${s.pct}%</b></div>${bar(s.pct)}</div></div>`).join('')}</div></div></div>
  <div class="card mt"><h2>Revision status</h2><table><thead><tr><th>Subject</th><th>Topics completed</th><th>Revised</th><th style="width:30%">Revision coverage</th></tr></thead><tbody>${p.subjects.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.done}/${s.total}</td><td>${s.revised}</td><td>${bar(s.done ? Math.round((100 * s.revised) / s.done) : 0)}</td></tr>`).join('')}</tbody></table></div>
  <div class="grid g3 mt"><div class="card"><h2>Pending tasks</h2>${mini(p.pendingTasks)}</div><div class="card"><h2>Completed tasks</h2>${mini(p.completedTasks)}</div>
    <div class="card"><h2>Weak topics</h2>${p.weakTopics.length ? `<div class="list">${p.weakTopics.map((t) => `<div class="item"><div class="body"><div class="t">⭐ ${esc(t.name)}</div><div class="small muted">${esc(t.subject_name)}</div></div></div>`).join('')}</div>` : empty('⭐', 'Flag weak topics on the syllabus page.')}</div></div>`;
  timer = setInterval(() => route(true), 20000);
}

/* ---------------- Global interactions ---------------- */
view.addEventListener('change', async (e) => {
  const el = e.target;
  try {
    if (el.dataset.task) {
      await api(`/tasks/${el.dataset.task}`, { method: 'PATCH', body: { status: el.checked ? 'done' : 'pending' } });
      toast(el.checked ? 'Task completed ✔' : 'Task reopened'); route(true);
    } else if (el.dataset.topicDone) await setTopic(+el.dataset.topicDone, { completed: el.checked });
  } catch (err) { toast(err.message, 'err'); el.checked = !el.checked; }
});
view.addEventListener('click', async (e) => {
  const el = e.target.closest('button,[data-day]'); if (!el) return;
  try {
    if (el.dataset.doneTopic) { await setTopic(+el.dataset.doneTopic, { completed: true }); route(true); }
    else if (el.dataset.weak) { const t = findTopic(+el.dataset.weak); await setTopic(+el.dataset.weak, { weak: !t.weak }); }
    else if (el.dataset.day) { ST.day = el.dataset.day; route(true); }
    else if (el.dataset.why) $('#why' + el.dataset.why).classList.toggle('hide');
    else if (el.dataset.qs) {
      const box = $('#q' + el.dataset.qs); if (!box.classList.contains('hide')) { box.classList.add('hide'); return; }
      const { questions } = await api(`/papers/${el.dataset.qs}/questions`);
      box.innerHTML = `<div class="list">${questions.map((q) => `<div class="item"><b>Q${q.q_no}</b><div class="body">${esc(q.text)}<div>${q.mappings.filter((m) => m.status !== 'rejected').map((m) => `<span class="chip">→ ${esc(m.topic_name)} · ${Math.round(m.confidence * 100)}% · ${m.status.replace('_', ' ')}</span>`).join('') || '<span class="chip">unmapped</span>'}</div></div></div>`).join('')}</div>`;
      box.classList.remove('hide');
    } else if (el.dataset.map) { await api(`/mappings/${el.dataset.map}`, { method: 'PATCH', body: { status: el.dataset.st } }); toast('Mapping ' + el.dataset.st); pyq(); }
  } catch (err) { toast(err.message, 'err'); }
});
view.addEventListener('toggle', (e) => { const sid = +e.target.dataset?.sid; if (sid) e.target.open ? ST.open.add(sid) : ST.open.delete(sid); }, true);

function findTopic(id) { return ST.syl.subjects.flatMap((s) => s.units.flatMap((u) => u.topics)).find((t) => t.id === id); }
async function setTopic(id, body) {
  await api(`/topics/${id}/progress`, { method: 'POST', body });
  if (current === 'syllabus' && ST.syl) {
    const t = findTopic(id); Object.assign(t, { completed: body.completed === undefined ? t.completed : +body.completed, weak: body.weak === undefined ? t.weak : +body.weak });
    ST.syl.subjects.forEach((s) => { s.done = s.units.reduce((a, u) => a + u.topics.filter((x) => x.completed).length, 0); });
    drawSyllabus(false);
  }
  toast(body.weak !== undefined ? (body.weak ? 'Flagged as weak ⭐' : 'Weak flag removed') : body.completed ? 'Topic completed ✔' : 'Topic reopened');
}

boot().catch(() => { location.href = '/'; });
