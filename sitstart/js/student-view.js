// ---------- Plans as the student sees them ----------

function planReadHTML(plan, sessions, { notes = true } = {}) {
  const weeks = byWeek(sessions);
  return `<header class="plan-head">
      <div class="row"><h1>${esc(plan.title || 'Untitled Plan')}</h1>${plan.active ? '' : `<span class="tag">${planStatus(plan)} Plan</span>`}</div>
      ${plan.start_date ? `<p class="muted">${fmtStart(plan.start_date)}</p>` : ''}
      ${plan.overview ? `<div class="card prose">${para(plan.overview)}</div>` : ''}
    </header>
    ${!weeks.length ? '<p class="muted">No sessions in this plan yet.</p>'
    : plan.repeats ? `<section class="week">
      <h2>Every Week <span class="muted">Repeat these sessions each week</span></h2>
      ${sessions.map(s => sessionReadHTML(s, notes)).join('')}</section>`
    : weeks.map(([w, list]) => `<section class="week">
      <h2>Week ${w} <span class="muted">${weekRange(plan.start_date, w)}</span></h2>
      ${list.map(s => sessionReadHTML(s, notes)).join('')}</section>`).join('')}`;
}

function sessionReadHTML(s, withNotes) {
  const ex = (s.exercises || []).filter(x => Object.values(x).some(v => String(v).trim()));
  return `<article class="card session">
    <h3>${esc(s.title || 'Session')}</h3>
    ${s.details ? `<p class="prose">${para(s.details)}</p>` : ''}
    ${ex.length ? `<table class="ex"><thead><tr><th>Exercise</th><th>Sets</th><th>Reps / Time</th><th>Rest</th><th>Notes</th></tr></thead>
      <tbody>${ex.map(x => `<tr><td>${esc(x.name)}</td><td data-l="Sets">${esc(x.sets)}</td><td data-l="Reps / Time">${esc(x.reps)}</td>
      <td data-l="Rest">${esc(x.rest)}</td><td data-l="Notes">${esc(x.notes)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${withNotes ? notesHTML(s.id) : ''}
  </article>`;
}

async function studentHome() {
  const t = ++navToken;
  view(loading);
  // Coaches can read every student's plans and goals, so ask for this student's (and not archived goals) by name.
  const [plans, goals, coaches, next, log] = await Promise.all([
    sb.from('plans').select('id,title,active,start_date').eq('student_id', me.student.id)
      .order('active', { ascending: false }).order('created_at', { ascending: false }).then(must),
    sb.from('goals').select('*').eq('student_id', me.student.id).neq('status', 'archived').then(must).then(sortGoals),
    sb.rpc('coaches_of', { p_id: me.student.id }).then(must),
    sb.from('students').select(NEXT_COLS).eq('id', me.student.id).maybeSingle().then(must),
    sb.from('session_history').select('*').eq('student_id', me.student.id).then(must),
  ]);
  if (t !== navToken) return;
  const current = plans.find(p => p.active);   // at most one (one_current_plan)
  const history = studentHistory(log, next);
  if (current) return studentPlan(current.id, plans, goals, coaches, next, history);

  // No current plan, so any plans here are past ones.
  view(`${myTop()}${nextSessionAlert(next)}${goalHTML(goals)}
    ${plans.length ? `<section class="card"><h2>Past Plans</h2>
      <p class="hint">Your past plans, kept so you can look back.</p><ul class="list">${planLinks(plans)}</ul></section>`
      : "<section class=\"card\"><p>Your coach hasn't shared a plan with you yet. Check back soon.</p></section>"}
    ${achievedHTML(goals)}${history.html}${yourCoachHTML(coaches)}${myDetailsHTML()}`);
  history.bind();
  bindMyDetails();
}

// The top of a student's home page: the greeting, or for staff who are also students, My Training under Home.
const myTop = () => me.isStaff ? `${crumbs([['Home', '#/'], ['My Training']])}<h1>My Training</h1>` : `<h1>${welcome()}</h1>`;

// Students change only their own pronouns (update_my_pronouns() in schema.sql), at the bottom of their home page.
// Their name stays the coach's to change, so the coach always knows who they are.
// Staff who are also students don't get it: their pronouns are on their staff details.
const myDetailsHTML = () => me.isStaff ? '' : `<section class="card" id="myDetails" style="margin-top:2rem"><h2>Your Pronouns</h2>
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

function goalHTML(goals) {
  const cur = goals.filter(g => g.status === 'current');
  if (!cur.length) return '';
  if (cur.length === 1) return `<p class="alert"><strong>Your goal:</strong> ${esc(cur[0].body)}</p>`;
  return `<div class="alert"><strong>Your goals:</strong><ul>${cur.map(g => `<li>${esc(g.body)}</li>`).join('')}</ul></div>`;
}
function achievedHTML(goals) {
  const won = goals.filter(g => g.status === 'achieved');
  return won.length ? `<section class="card" style="margin-top:2rem"><h2>Goals Achieved</h2>
    <p class="hint">Every goal you've sent so far! This is what all the training is for, so be proud of yourself and climb on!</p><ul class="list">${won.map(g =>
    goalItem(g, fmtDay(g.done_at), '<span class="tag ok">Achieved</span>')).join('')}</ul></section>` : '';
}
// Hidden until they have had a coach.
const yourCoachHTML = coaches => coaches.length ? `<section class="card" style="margin-top:2rem"><h2>Your Coach</h2>
  <p class="hint">Your current coach, and any past coaches.</p>
  ${coachesHTML(coaches, "You don't have a coach right now.")}</section>` : '';
const planLinks = plans => plans.map(p => `<li><a class="item" href="#/plan/${p.id}"><strong>${esc(p.title || 'Untitled Plan')}</strong>
  ${planTag(p)}</a></li>`).join('');

async function studentPlan(id, allPlans, goals, coaches, next, history) {
  const t = ++navToken;
  view(loading);
  const [plan, sessions] = await Promise.all([
    sb.from('plans').select('*').eq('id', id).maybeSingle().then(must),
    sb.from('sessions').select('*').eq('plan_id', id).order('week').order('position').then(must),
  ]);
  if (t !== navToken) return;
  const home = me.isStaff ? '#/me' : '#/';
  if (!plan) { view(`<section class="card narrow"><h1>Plan Not Found</h1><p><a href="${home}">Back to your plans</a></p></section>`); return; }
  const notes = sessions.length
    ? await sb.from('notes').select('*').in('session_id', sessions.map(s => s.id)).order('created_at').then(must) : [];
  if (t !== navToken) return;
  notesCtx = { notes, studentName: me.student.name, coach: false, canPost: true };
  const others = allPlans?.filter(p => p.id !== id) || [];
  view(`${allPlans ? myTop() : crumbs([['Home', '#/'], ...(me.isStaff ? [['My Training', '#/me']] : []), [plan.title || 'Untitled Plan']])}
    ${nextSessionAlert(next)}
    ${goals ? goalHTML(goals) : ''}
    ${allPlans && plan.active ? '<h2 class="section-label">Current Plan</h2>' : ''}
    ${planReadHTML(plan, sessions)}
    ${others.length ? `<section class="card" style="margin-top:2rem"><h2>Past Plans</h2>
      <p class="hint">Your past plans, kept so you can look back.</p><ul class="list">${planLinks(others)}</ul></section>` : ''}
    ${goals ? achievedHTML(goals) : ''}
    ${history ? history.html : ''}
    ${coaches ? yourCoachHTML(coaches) : ''}
    ${allPlans ? myDetailsHTML() : ''}`);
  history?.bind();
  if (allPlans) bindMyDetails();
}
