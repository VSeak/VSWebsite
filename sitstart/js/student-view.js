// ---------- Plans as the student sees them ----------

// Also the coach's Student View preview and read-only plan. A week with more than one session shows tabs, one session at a time.
function planReadHTML(plan, sessions, { notes = true, log = false } = {}) {
  const weeks = byWeek(sessions);
  return `<div class="plan-read"><header class="plan-head">
      <p class="eyebrow">${planStatus(plan)} Plan · ${layoutName(plan)}</p>
      <h1>${esc(plan.title || 'Untitled Plan')}</h1>
      ${plan.start_date ? `<p class="muted plan-start">${fmtStart(plan.start_date)}</p>` : ''}
      ${plan.overview ? `<div class="prose">${para(plan.overview)}</div>` : ''}
    </header>
    ${!weeks.length ? '<p class="muted">No sessions in this plan yet.</p>'
    : plan.blocks ? weeks.map(([k, list]) => weekHTML(blockHeadHTML(plan, k), list, notes, log)).join('')
    : plan.repeats ? weekHTML('', sessions, notes, log)
    : weeks.map(([w, list]) => weekHTML(`<h2>Week ${w} <span class="muted">${weekRange(plan.start_date, w)}</span></h2>`, list, notes, log)).join('')}
  </div>`;
}

// A training block's heading: its name, Now while today is in it, then how long it runs and its dates.
function blockHeadHTML(plan, k) {
  const b = plan.blocks[k - 1], range = blockRange(plan.start_date, plan.blocks, k);
  return `<h2>${esc(blockName(b, k))}${blockNow(plan.start_date, plan.blocks) === k ? ' <span class="tag ok">Now</span>' : ''}
    <span class="muted">${blockLength(b)}${range ? ` · ${range}` : ''}</span></h2>`;
}

// log: the student's own current plan, so each exercise card has Log and History (training-log.js).
const weekHTML = (head, list, notes, log) => `<section class="week">${head}
  ${list.length > 1 ? `<div class="tabs" role="tablist">${list.map((s, i) => `<button type="button" role="tab" data-tab="${s.id}"
    aria-selected="${i === 0}">${esc(s.title || `Session ${i + 1}`)}</button>`).join('')}</div>` : ''}
  ${list.map((s, i) => sessionReadHTML(s, notes, i > 0, log)).join('')}</section>`;

function sessionReadHTML(s, withNotes, hide, log) {
  const ex = (s.exercises || []).filter(x => Object.values(x).some(v => String(v).trim()));
  return `<article class="card session" data-session="${s.id}"${hide ? ' hidden' : ''}>
    <h3>${esc(s.title || 'Session')}</h3>
    ${s.details ? `<p class="prose">${para(s.details)}</p>` : ''}
    ${ex.length ? `<div class="ex-cards">${ex.map(x => exCardHTML(x, s.id, log)).join('')}</div>` : ''}
    ${withNotes ? notesHTML(s.id) : ''}
  </article>`;
}

// One exercise: its name, then Sets, Reps/Time and Rest in three equal boxes ("—" when empty), then its notes,
// then (log) what was logged last and Log / History.
const statHTML = (label, v) => {
  v = String(v ?? '').trim();
  return `<div class="stat"><span class="stat-l">${label}</span><span class="stat-v${v ? '' : ' none'}">${v ? esc(v) : '—'}</span></div>`;
};
const exCardHTML = (x, sid, log) => `<div class="ex-card"><p class="ex-name">${esc(x.name || 'Exercise')}</p>
  <div class="stats">${statHTML('Sets', x.sets)}${statHTML('Reps/Time', x.reps)}${statHTML('Rest', x.rest)}</div>
  ${String(x.notes ?? '').trim() ? `<p class="ex-note">${para(x.notes)}</p>` : ''}${log ? logAreaHTML(x, sid) : ''}</div>`;

// Session tabs: show that session and hide the rest of its week. openNotes uses it to reach a hidden session.
function showSession(sid) {
  const art = sid && app.querySelector(`[data-session="${CSS.escape(sid)}"]`), week = art?.closest('.week');
  if (!week) return;
  week.querySelectorAll('[data-session]').forEach(a => { a.hidden = a !== art; });
  week.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === sid));
}
app.addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (b) showSession(b.dataset.tab);
});

async function studentHome() {
  const t = ++navToken;
  view(loading);
  // Coaches can read every student's plans and goals, so ask for this student's (and not archived goals) by name.
  const [plans, goals, coaches, next, log, logs] = await Promise.all([
    sb.from('plans').select('id,title,active,start_date').eq('student_id', me.student.id)
      .order('active', { ascending: false }).order('created_at', { ascending: false }).then(must),
    sb.from('goals').select('*').eq('student_id', me.student.id).neq('status', 'archived').then(must).then(sortGoals),
    sb.rpc('coaches_of', { p_id: me.student.id }).then(must),
    sb.from('students').select(NEXT_COLS).eq('id', me.student.id).maybeSingle().then(must),
    sb.from('session_history').select('*').eq('student_id', me.student.id).then(must),
    myLogs(),
  ]);
  if (t !== navToken) return;
  const current = plans.find(p => p.active);   // at most one (one_current_plan)
  const history = studentHistory(log, next);
  if (current) return studentPlan(current.id, plans, goals, coaches, next, history, logs);
  logCtx = { logs, sessions: [], canLog: false };

  // No current plan, so any plans here are past ones.
  view(`${myTop()}${stuGrid(plans.length ? pastPlansHTML(plans)
    : "<section class=\"card past-plans\"><p>Your coach hasn't shared a plan with you yet. Check back soon.</p></section>",
    { next, goals, history, coaches })}`);
  history.bind();
  bindMyLogCard();
  bindMyDetails();
}
// The signed-in student's Training Log, newest first.
const myLogs = () => sb.from('exercise_logs').select('*').eq('student_id', me.student.id)
  .order('logged_on', { ascending: false }).order('created_at', { ascending: false }).then(must);

// The top of a student's home page: the greeting, or for staff who are also students, My Training under Home.
const myTop = () => me.isStaff ? `${crumbs([['Home', '#/'], ['My Training']])}<h1>My Training</h1>`
  : `<h1 class="hey">Hey ${me.firstName ? esc(me.firstName) : 'there'},<span> let's climb.</span></h1>`;

// The student home: the plan beside the next session, goals and the rest. On a phone it is one column,
// in the order set in styles.css (next session, goals, plan, past plans, then the rest).
const stuGrid = (main, { next, goals, history, coaches }) => `<div class="stu-grid"><div class="stu-main">${main}</div>
  <aside class="stu-side">${nextSessionAlert(next)}${goalHTML(goals)}${myLogCardHTML()}${achievedHTML(goals)}${history.html}${yourCoachHTML(coaches)}${myDetailsHTML()}</aside></div>`;
const pastPlansHTML = plans => plans.length ? `<section class="card past-plans"><h2>Past Plans</h2>
  <p class="hint">Your past plans, kept so you can look back.</p><ul class="list">${planLinks(plans)}</ul></section>` : '';

// Students change only their own pronouns (update_my_pronouns() in schema.sql), at the bottom of their home page.
// Their name stays the coach's to change, so the coach always knows who they are.
// Staff who are also students don't get it: their pronouns are on their staff details.
const myDetailsHTML = () => me.isStaff ? '' : `<section class="card" id="myDetails"><h2>Your Pronouns</h2>
  <p class="hint">Your coach sees these next to your name. To change your name, ask your coach.</p>
  <form id="myForm" class="stack" data-save>
    ${pronounsField(me.student.pronouns, 'Your')}
    <button class="primary">Save Pronouns</button>
  </form></section>`;
function bindMyDetails() {
  if (!$('#myForm')) return;
  $('#myForm').onsubmit = e => {
    e.preventDefault();
    busy(e.submitter, async () => {
      must(await sb.rpc('update_my_pronouns', { p_pronouns: readPronouns(new FormData(e.target)) }));
      await loadMe(me.user);
      $('#myDetails').outerHTML = myDetailsHTML();
      bindMyDetails();
      flash('Pronouns saved.');
    });
  };
}

const GOAL_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">
  <circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>`;
function goalHTML(goals) {
  const cur = goals.filter(g => g.status === 'current');
  if (!cur.length) return '';
  if (cur.length === 1) return `<section class="goal-card"><span class="eyebrow">Your Goal</span><p class="goal-one">${esc(cur[0].body)}</p></section>`;
  return `<section class="goal-card many"><div class="row between"><span class="eyebrow">Your Goals</span><span class="goal-count">${cur.length}</span></div>
    <ul class="goal-list">${cur.map(g => `<li>${GOAL_ICON}<span>${esc(g.body)}</span></li>`).join('')}</ul></section>`;
}
function achievedHTML(goals) {
  const won = goals.filter(g => g.status === 'achieved');
  return won.length ? `<section class="card achieved"><h2>Goals Achieved</h2>
    <p class="hint">Every goal you've sent so far! This is what all the training is for, so be proud of yourself and climb on!</p>
    ${won.map(g => `<div class="won"><strong>${esc(g.body)}</strong><span class="muted">${fmtDay(g.done_at)}</span></div>`).join('')}</section>` : '';
}
// Hidden until they have had a coach.
const yourCoachHTML = coaches => coaches.length ? `<section class="card your-coach"><h2>Your Coach</h2>
  <p class="hint">Your current coach, and any past coaches.</p>
  ${coachesHTML(coaches, "You don't have a coach right now.")}</section>` : '';
const planLinks = plans => plans.map(p => `<li><a class="item" href="#/plan/${p.id}"><strong>${esc(p.title || 'Untitled Plan')}</strong>
  ${planTag(p)}</a></li>`).join('');

// allPlans (and the rest) when it is the student's current plan on their home page; without them, one plan on its own page.
// logs: the student's Training Log (fetched here when not passed). Only the current plan has Log buttons.
async function studentPlan(id, allPlans, goals, coaches, next, history, logs) {
  const t = ++navToken;
  view(loading);
  const [plan, sessions, notes, logList] = await Promise.all([
    sb.from('plans').select('*').eq('id', id).maybeSingle().then(must),
    sb.from('sessions').select('*').eq('plan_id', id).order('week').order('position').then(must),
    planNotes(id),
    logs ?? myLogs(),
  ]);
  if (t !== navToken) return;
  const home = me.isStaff ? '#/me' : '#/';
  if (!plan) { authPage('Sorry,', 'plan not found.', `<p>It may have been deleted, or the link is wrong.</p><p><a href="${home}">Back to your plans</a></p>`); return; }
  notesCtx = { notes, studentName: me.student.name, coach: false, canPost: true };
  logCtx = { logs: logList, sessions, canLog: plan.active };
  if (!allPlans) {
    view(`${crumbs([['Home', '#/'], ...(me.isStaff ? [['My Training', '#/me']] : []), [plan.title || 'Untitled Plan']])}
      ${planReadHTML(plan, sessions, { log: plan.active })}`);
    return;
  }
  view(`${myTop()}${stuGrid(planReadHTML(plan, sessions, { log: plan.active }) + pastPlansHTML(allPlans.filter(p => p.id !== id)),
    { next, goals, history, coaches })}`);
  history.bind();
  bindMyLogCard();
  bindMyDetails();
}
