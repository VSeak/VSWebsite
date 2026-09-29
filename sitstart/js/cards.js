// ---------- Coaches (students.coach_id, history from coaches_of()) ----------

// A coach who comes back has one row in coaches_of(), so they're never both current and past.
const fmtMonth = t => new Date(t).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
const coachSpan = c => c.is_current ? 'Since ' + fmtMonth(c.started_at)
  : c.ended_at ? `${fmtMonth(c.started_at)} – ${fmtMonth(c.ended_at)}` : 'From ' + fmtMonth(c.started_at);
const coachRow = c => `<li class="coach"><span>${esc(c.name)}</span><span class="muted">${coachSpan(c)}</span></li>`;
function coachesHTML(coaches, none) {
  const cur = coaches.find(c => c.is_current), past = coaches.filter(c => !c.is_current);
  return (cur ? `<ul class="list">${coachRow(cur)}</ul>` : none ? `<p class="muted">${none}</p>` : '')
    + (past.length ? `<h3 class="goal-group">Past Coaches</h3><ul class="list">${past.map(coachRow).join('')}</ul>` : '');
}

// ---------- Pages: a long list shows a few items at a time, with Newer and Older buttons ----------

const pageCount = (n, size) => Math.max(1, Math.ceil(n / size));
// The page's items, and the page (1 on up) kept in range, e.g. after a delete empties the last page.
function pageOf(list, page, size) {
  const p = Math.min(Math.max(1, page), pageCount(list.length, size));
  return [list.slice((p - 1) * size, p * size), p];
}
// names: the buttons, for a list that isn't newest first.
const pagerHTML = (page, n, size, names = ['Newer', 'Older']) => n > size ? `<nav class="pager" aria-label="Pages">
  <button type="button" class="small ghost" data-page="${page - 1}"${page > 1 ? '' : ' disabled'}>‹ ${names[0]}</button>
  <span class="muted">Page ${page} of ${pageCount(n, size)}</span>
  <button type="button" class="small ghost" data-page="${page + 1}"${page < pageCount(n, size) ? '' : ' disabled'}>${names[1]} ›</button></nav>` : '';
// go(page) redraws box. The pager stays where it was on screen (under a thumb on a phone) and keeps the focus.
function bindPager(box, go) {
  box.querySelector('.pager')?.addEventListener('click', e => {
    const b = e.target.closest('[data-page]');
    if (!b) return;
    const i = [...b.parentElement.children].indexOf(b), top = b.getBoundingClientRect().top;
    go(+b.dataset.page);
    const pager = box.querySelector('.pager');
    if (!pager) return;
    const nb = pager.children[i];
    window.scrollBy(0, nb.getBoundingClientRect().top - top);
    (nb.disabled ? pager.querySelector('button:not(:disabled)') : nb)?.focus({ preventScroll: true });
  });
}
// A box that shows draw(page) and pages by itself. at: { page }, kept across redraws of the card around it.
function pagedBox(box, at, draw) {
  const go = n => { at.page = n; box.innerHTML = draw(at.page); bindPager(box, go); };
  bindPager(box, go);
}

// ---------- Sessions card: Next Session (students.next_*) and Session History (session_history) ----------
// Coaches and admins set the next session; the student sees it at the top of their page until it ends.
// An ended next session shows as the newest past session straight away (historyOf), and is logged in
// session_history when someone updates or clears it (logEnded). Coaches and admins can add or delete past sessions.

const NEXT_COLS = 'next_date,next_start,next_end,next_location';
const fmtTime = t => new Date('1970-01-01T' + t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const localToday = () => new Date().toLocaleDateString('en-CA');   // YYYY-MM-DD in local time
// Once it has ended it isn't "next" any more: the student stops seeing it and the coach is asked to set a new one.
const nextPassed = s => !s.next_date || new Date(`${s.next_date}T${s.next_end}`) <= new Date();
const nextOverdue = s => !!s.next_date && nextPassed(s);
const nextDay = s => day(s.next_date).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
const nextWhen = s => `${nextDay(s)} · ${fmtTime(s.next_start)} – ${fmtTime(s.next_end)}`;
const hm = t => t ? t.slice(0, 5) : '';
const HISTORY_PAGE = 3;   // past sessions per page

// Past sessions newest first, with an ended next session that isn't logged yet on top.
function historyOf(log, s) {
  const list = [...log];
  if (nextOverdue(s) && !log.some(h => h.session_date === s.next_date && hm(h.start_time) === hm(s.next_start)))
    list.push({ session_date: s.next_date, start_time: s.next_start, end_time: s.next_end, location: s.next_location });
  return list.sort((a, b) => b.session_date.localeCompare(a.session_date) || b.start_time.localeCompare(a.start_time));
}
// Before the next session changes, keep it in the history if it has ended. Logging it twice does nothing.
async function logEnded(id, s, log) {
  if (!nextOverdue(s)) return;
  const rows = await sb.from('session_history').upsert({ student_id: id, session_date: s.next_date, start_time: s.next_start,
    end_time: s.next_end, location: s.next_location }, { onConflict: 'student_id,session_date,start_time', ignoreDuplicates: true })
    .select().then(must);
  log?.push(...rows);
}
const historyItem = (h, right = '') => `<li class="hist"><span><strong>${esc(fmtSessionDay(h.session_date))}</strong>
  <span class="item-sub">${fmtTime(h.start_time)} – ${fmtTime(h.end_time)} · ${esc(h.location)}</span></span>${right}</li>`;
// "12 sessions since Mar 2026".
const historyCount = list => list.length ? `<p class="muted hist-count">${list.length} ${list.length === 1 ? 'session' : 'sessions'} since
  ${day(list.at(-1).session_date).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</p>` : '';

// One page of past sessions. hist = { log, page, notes? }: notes(date) counts Coach Notes from that day,
// for a Notes button, or Add Notes when there are none (the student page only). Every row can be deleted: an ended next session that isn't
// logged yet (no id) is deleted by clearing the next session without logging it.
function historyHTML(s, hist) {
  const list = historyOf(hist.log, s), [shown, page] = pageOf(list, hist.page, HISTORY_PAGE);
  hist.page = page;
  const right = h => {
    const n = hist.notes?.(h.session_date) || 0;
    const btns = (!hist.notes ? '' : n ? `<button type="button" class="small ghost" data-hist-notes="${h.session_date}">Notes (${n})</button>`
      : `<button type="button" class="small ghost" data-hist-add-notes="${h.session_date}">Add Notes</button>`)
      + (hist.readOnly ? '' : `<button type="button" class="small ghost danger" data-hist-del="${h.id || 'next'}">Delete</button>`);
    return `<div class="row">${btns}</div>`;
  };
  return `${historyCount(list)}
    ${shown.length ? `<ul class="list">${shown.map(h => historyItem(h, right(h))).join('')}</ul>` : '<p class="muted">No past sessions yet.</p>'}
    ${pagerHTML(page, list.length, HISTORY_PAGE)}
    <button type="button" class="small" data-hist-add style="margin-top:.6rem">+ Add Past Session</button>`;
}

// edit: false for a coach who isn't theirs: they see the next session, and can only add past sessions.
function sessionsCardHTML(s, edit = true) {
  const p = pro(s.pronouns), ended = !!s.training_ended_at, overdue = edit && !ended && nextOverdue(s);
  if (!edit) return `<section class="card" id="nextCard"><h2>Sessions</h2>
    <p class="hint">Only ${p.their} coach can change the next session. You can add a past session you ran.</p>
    ${ended ? '' : `<h3 class="sub-head">Next Session</h3>
    <p${s.next_date ? '' : ' class="muted"'}>${s.next_date ? `${esc(nextWhen(s))}<br><span class="muted">${esc(s.next_location)}</span>` : 'No next session set.'}</p>`}
    <h3 class="sub-head">Session History</h3>
    <div id="historyBox"></div>
  </section>`;
  return `<section class="card${overdue ? ' overdue' : ''}" id="nextCard">
    <div class="row between"><h2>Sessions</h2>${overdue ? '<span class="tag warn">Needs Update</span>' : ''}</div>
    <p class="hint">${ended ? `Coaching has ended, so there's no next session. ${p.They} can still see ${p.their} past sessions.`
      : `${p.They} ${p.v('see', 'sees')} the next session at the top of ${p.their} page until it ends. Then it moves to Session History, which ${p.they} ${p.v('see', 'sees')} too.`}</p>
    ${ended ? '' : `<h3 class="sub-head">Next Session</h3>
    ${overdue ? `<p class="warn-box" role="status"><strong>This session is over.</strong>
      It ended on ${esc(nextDay(s))} and is now in Session History. Pick the new date and time below.</p>`
      : s.next_date ? '' : '<p class="muted">No next session set yet.</p>'}
    <form id="nextForm" class="stack" data-save>
      <label>Date<input type="date" name="next_date" value="${esc(s.next_date || '')}" min="${localToday()}"
        required data-need="Pick the day." data-low="Pick today or a later day."></label>
      <div class="row">
        <label class="grow" style="min-width:120px">Start Time<input type="time" name="next_start" value="${hm(s.next_start)}" required data-need="Pick a start time."></label>
        <label class="grow" style="min-width:120px">End Time<input type="time" name="next_end" value="${hm(s.next_end)}" required data-need="Pick an end time."></label>
      </div>
      <label>Location<input name="next_location" value="${esc(s.next_location || '')}" maxlength="200" required
        data-need="Say where it is." autocomplete="off" placeholder="e.g. Gym/Wall"></label>
      <div class="row"><button class="primary">Save Session</button>
        ${s.next_date ? '<button type="button" class="ghost danger" data-act="next-clear">Clear</button>' : ''}</div>
    </form>`}
    <h3 class="sub-head">Session History</h3>
    <div id="historyBox"></div>
  </section>`;
}

// The fields for a past session added by hand (in ask()). End Time's min follows Start Time (bindSessions).
const pastSessionFields = () => `<div class="stack">
  <label>Date<input type="date" name="session_date" max="${localToday()}" required data-need="Pick the day." data-high="Pick today or an earlier day."></label>
  <div class="row">
    <label class="grow" style="min-width:120px">Start Time<input type="time" name="start_time" required data-need="Pick a start time."></label>
    <label class="grow" style="min-width:120px">End Time<input type="time" name="end_time" required data-need="Pick an end time." data-low="End after the start time."></label>
  </div>
  <label>Location<input name="location" maxlength="200" required data-need="Say where it was." autocomplete="off" placeholder="e.g. Gym/Wall"></label></div>`;
const addMinute = t => {
  const [h, m] = t.split(':').map(Number), n = Math.min(h * 60 + m + 1, 1439);
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
};

// Saves or clears the next session (redrawing the card), and runs Session History in place.
// hist = { log, page, readOnly?, notes?, showNotes?, addNotes?, changed? }: readOnly (another coach's student) has no
// Delete buttons and no next session form; showNotes(date) opens Coach Notes from that day;
// addNotes(date) starts a Coach Note for that day;
// changed() runs after the next session or the history changes.
function bindSessions(id, s, hist) {
  const box = $('#historyBox');
  const drawHistory = () => {
    box.innerHTML = historyHTML(s, hist);
    bindPager(box, page => { hist.page = page; drawHistory(); });
  };
  hist.redraw = drawHistory;   // e.g. after a Coach Note changes its Notes count
  drawHistory();
  // Changes the next session and redraws the card. keep: log an ended one in the history first.
  const save = (btn, patch, msg, keep = true) => busy(btn, async () => {
    if (keep) await logEnded(id, s, hist.log);
    Object.assign(s, await sb.from('students').update(patch).eq('id', id).select(NEXT_COLS).single().then(must));
    hist.page = 1;
    $('#nextCard').outerHTML = sessionsCardHTML(s, !hist.readOnly);
    bindSessions(id, s, hist);
    hist.changed?.();
    flash(msg);
  });
  const noNext = { next_date: null, next_start: null, next_end: null, next_location: null };
  box.onclick = async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.histNotes) hist.showNotes?.(b.dataset.histNotes);
    else if (b.dataset.histAddNotes) hist.addNotes?.(b.dataset.histAddNotes);
    else if (b.dataset.histDel === 'next') {
      if (await ask({ title: 'Delete This Session?', ok: 'Delete', warn: true,
        body: `<p>${esc(fmtSessionDay(s.next_date))} comes off ${pro(s.pronouns).their} Session History, and the next session is cleared. This can't be undone.</p>` }))
        save(b, noNext, 'Session deleted.', false);
    } else if (b.dataset.histDel) {
      const h = hist.log.find(x => x.id === b.dataset.histDel);
      if (h && await ask({ title: 'Delete This Session?', ok: 'Delete', warn: true,
        body: `<p>${esc(fmtSessionDay(h.session_date))} comes off ${pro(s.pronouns).their} Session History. This can't be undone.</p>` }))
        busy(b, async () => {
          must(await sb.from('session_history').delete().eq('id', h.id));
          hist.log.splice(hist.log.indexOf(h), 1);
          drawHistory();
          hist.changed?.();
          flash('Session deleted.');
        });
    } else if ('histAdd' in b.dataset) {
      const asked = ask({ title: 'Add a Past Session', ok: 'Add Session', body: pastSessionFields() });
      const dlg = $('#dlg'), start = dlg.querySelector('[name="start_time"]'), end = dlg.querySelector('[name="end_time"]');
      start.addEventListener('input', () => { end.min = start.value ? addMinute(start.value) : ''; });
      const f = await asked;
      if (!f) return;
      busy(b, async () => {
        const { data, error } = await sb.from('session_history').insert({ student_id: id, session_date: f.get('session_date'),
          start_time: f.get('start_time'), end_time: f.get('end_time'), location: f.get('location').trim() }).select().single();
        if (error) throw error.code === '23505' ? new Error('That session is already in the history.') : error;
        hist.log.push(data);
        hist.page = Math.ceil((historyOf(hist.log, s).indexOf(data) + 1) / HISTORY_PAGE);   // the page it landed on
        drawHistory();
        hist.changed?.();
        flash('Session added.');
      });
    }
  };

  const form = $('#nextForm');
  if (!form) return;
  form.onsubmit = e => {
    e.preventDefault();
    const f = new FormData(form), start = f.get('next_start'), end = f.get('next_end');
    if (end <= start) return fieldError(form.elements.next_end, 'End after the start time.');
    save(e.submitter, { next_date: f.get('next_date'), next_start: start, next_end: end,
      next_location: f.get('next_location').trim() }, 'Next session saved.');
  };
  form.querySelector('[data-act="next-clear"]')?.addEventListener('click', async e => {
    e.stopPropagation();   // not the page's own data-act handler
    if (await ask({ title: 'Clear the Next Session?', ok: 'Clear', warn: true,
      body: `<p>${pro(s.pronouns).They} won't see a next session until you set one.${nextOverdue(s) ? ' It stays in Session History.' : ''}</p>` }))
      save(e.target, noNext, 'Next session cleared.');
  });
}

// The student's own past sessions, near the bottom of their page, a page at a time. Hidden until they have one.
function studentHistory(log, next) {
  const list = historyOf(log, next || {});
  let page = 1;
  const draw = () => {
    const [shown, p] = pageOf(list, page, HISTORY_PAGE);
    return `<ul class="list">${shown.map(h => historyItem(h)).join('')}</ul>${pagerHTML(p, list.length, HISTORY_PAGE)}`;
  };
  // Headed by the count, big, and when they started: "Your Sessions · Since Aug 2026 · 8". The list is newest first.
  const since = list.length && day(list.at(-1).session_date).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  return {
    html: list.length ? `<section class="card" id="historyCard"><div class="count-head">
      <div><h2>Your Sessions</h2><p class="muted">Since ${since}</p></div><span class="big-num">${list.length}</span></div>
      <div id="myHistory">${draw()}</div></section>` : '',
    bind() {
      const box = $('#myHistory');
      const go = n => { page = n; box.innerHTML = draw(); bindPager(box, go); };
      if (box) bindPager(box, go);
    },
  };
}

// ---------- Coaching Status card (students.training_ended_at: null while they are coached) ----------

// edit: false for a coach who isn't theirs (read only).
// The coach they had when coaching ended: the one whose time as coach ended then (older ends used the browser clock).
const endedCoach = (s, coaches) => s.training_ended_at && coaches.find(c => c.ended_at
  && Math.abs(new Date(c.ended_at) - new Date(s.training_ended_at)) < 5 * 60e3)?.staff_id;
// Resuming gives them back to that coach only if it's you (check_student_coach); otherwise an admin picks one.
function trainingCardHTML(s, coaches, edit = true) {
  const done = s.training_ended_at, p = pro(s.pronouns);
  const back = me.isCoach && !isSelf(s) && endedCoach(s, coaches) === me.staffId;
  return `<section class="card" id="trainingCard" data-fold-start>
    <div class="row between"><h2>Coaching Status</h2><span class="tag ${done ? 'danger' : 'ok'}">${done ? 'Inactive' : 'Active'}</span></div>
    ${!edit ? `<p class="hint">${done ? `Coaching ended ${fmtDay(done)}.` : 'Being coached.'} Only ${p.their} coach can change this.</p>`
    : `<p class="hint">${done ? `Coaching ended ${fmtDay(done)}. ${p.Their} plans, goals and notes are kept, and ${p.they} can still sign in.
        ${back ? `Resuming makes you ${p.their} coach again.` : me.isAdmin ? `After resuming, pick ${p.their} coach.` : `After resuming, an admin picks ${p.their} coach.`}
        Delete ${p.them} only if ${p.they} ${p.v('were', 'was')} added by mistake.`
      : `When ${p.they} ${p.v('stop', 'stops')} being coached, end coaching here. ${p.They} ${p.v('move', 'moves')} to Inactive on the Students list, ${p.their} current plan becomes a past plan and ${p.they} ${p.v('have', 'has')} no coach.`}</p>
    <div class="row"><button type="button" class="${done ? 'primary' : 'ghost'}" data-act="training">${done ? 'Resume Coaching' : 'End Coaching'}</button>
      ${done ? '<button type="button" class="ghost danger" data-act="del-student">Delete Student</button>' : ''}</div>`}
  </section>`;
}

// Ends their coaching (clearing the next session and their coach, after logging it if it has ended) or resumes it,
// then redraw() the page.
function bindTraining(id, s, redraw) {
  $('#trainingCard [data-act="training"]')?.addEventListener('click', async e => {
    e.stopPropagation();   // not the page's own data-act handler
    const done = !s.training_ended_at, btn = e.currentTarget, p = pro(s.pronouns);
    if (done && !await ask({ title: `End Coaching for ${s.first_name}?`, ok: 'End Coaching',
      body: `<p>${p.They} ${p.v('move', 'moves')} to Inactive, ${p.their} current plan becomes a past plan, ${p.their} next session is cleared and ${p.they} no longer ${p.v('have', 'has')} a coach. Plans, goals, notes and past sessions stay, and ${p.they} can still sign in.</p>` })) return;
    busy(btn, async () => {
      if (done) await logEnded(id, s);
      must(await sb.from('students').update(done
        ? { training_ended_at: new Date().toISOString(), next_date: null, next_start: null, next_end: null, next_location: null }
        : { training_ended_at: null }).eq('id', id));
      flash(done ? `Coaching ended for ${s.first_name}.` : `Coaching resumed for ${s.first_name}.`);
      redraw();
    });
  });
}

// What the student sees: a dark card with how soon it is (Today, Tomorrow, In 3 days), gone once it has ended.
const ICON_CLOCK = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
  aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
const ICON_PIN = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>`;
function nextSessionAlert(s) {
  if (!s || nextPassed(s)) return '';
  const d = day(s.next_date), n = Math.round((d - day(localToday())) / 864e5);
  const date = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric',
    ...(d.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) });
  return `<section class="next-card">
    <div class="row between"><span class="eyebrow">Next Session</span><span class="pill">${n <= 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`}</span></div>
    <p class="next-day">${esc(date)}</p>
    <div class="next-meta"><span>${ICON_CLOCK}${fmtTime(s.next_start)} – ${fmtTime(s.next_end)}</span><span>${ICON_PIN}${esc(s.next_location)}</span></div>
  </section>`;
}

// ---------- Goals (current → achieved or archived) ----------

const fmtDay = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
// Current goals oldest first; achieved and archived newest first.
const sortGoals = goals => goals.sort((a, b) =>
  ((b.status === 'current') - (a.status === 'current')) ||
  (a.status === 'current' ? a.created_at.localeCompare(b.created_at) : (b.done_at || '').localeCompare(a.done_at || '')));
const goalItem = (g, sub, right) => `<li class="goal"><div class="goal-text"><p>${para(g.body)}</p>
  ${sub ? `<span class="item-sub">${sub}</span>` : ''}</div>${right}</li>`;

const GOALS_PAGE = 3;   // goals per page, in each group
const goalBtns = (g, ...list) => `<div class="row">${list.map(([act, label, cls]) =>
  `<button type="button" class="small ${cls || 'ghost'}" data-act="${act}" data-goal="${g.id}">${label}</button>`).join('')}</div>`;
// Each group pages by itself. Current goals are oldest first, so their buttons aren't Newer and Older.
// Each group: [the line under a goal, its buttons, pager names].
const GOAL_GROUPS = {
  current: [() => '', g => goalBtns(g, ['goal-achieved', 'Achieved', 'primary'], ['goal-edit', 'Edit'], ['goal-archive', 'Archive']),
    ['Previous', 'Next']],
  achieved: [g => 'Achieved ' + fmtDay(g.done_at), g => goalBtns(g, ['goal-current', 'Undo'], ['goal-archive', 'Archive'])],
  archived: [g => 'Archived ' + fmtDay(g.done_at), g => goalBtns(g, ['goal-current', 'Restore'], ['goal-delete', 'Delete', 'ghost danger'])],
};
// One group's page (at[st].page, kept in range here), with its pager. at.readOnly: no buttons (another coach's student).
function goalGroupHTML(goals, st, at) {
  const list = goals.filter(g => g.status === st), [sub, btns, names] = GOAL_GROUPS[st], [shown, page] = pageOf(list, at[st].page, GOALS_PAGE);
  at[st].page = page;
  return `<ul class="list">${shown.map(g => goalItem(g, sub(g), at.readOnly ? '' : btns(g))).join('')}</ul>${pagerHTML(page, list.length, GOALS_PAGE, names)}`;
}

function coachGoalsHTML(goals, p, at) {
  const n = st => goals.filter(g => g.status === st).length;
  const box = st => `<div data-goals="${st}">${goalGroupHTML(goals, st, at)}</div>`;
  return `<h2>Goals</h2>
    <p class="hint">${p.They} ${p.v('see', 'sees')} current and achieved goals on ${p.their} page. Archived goals are hidden from ${p.them}.</p>
    ${n('current') ? box('current') : '<p class="muted">No current goals.</p>'}
    ${at.readOnly ? '' : `<form id="goalForm" class="row" data-save style="margin-top:.6rem">
      <input name="body" class="grow" maxlength="500" required data-need="Write the goal first." autocomplete="off" placeholder="e.g. Send a V5 by spring">
      <button class="primary">+ Add Goal</button>
    </form>`}
    ${n('achieved') ? `<h3 class="goal-group">Achieved</h3>${box('achieved')}` : ''}
    ${n('archived') ? `<details class="goal-group"${at.archivedOpen ? ' open' : ''}><summary>Archived (${n('archived')})</summary>${box('archived')}</details>` : ''}`;
}

// ---------- Coach Notes (coach_notes: coaches only; a session_date makes it notes from that session) ----------

// Newest first, by the session's day (or the day a general note was written).
const cnoteDay = n => n.session_date || new Date(n.created_at).toLocaleDateString('en-CA');
const sortCoachNotes = list => list.sort((a, b) => cnoteDay(b).localeCompare(cnoteDay(a)) || b.created_at.localeCompare(a.created_at));
const fmtSessionDay = d => day(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const CNOTE_FILTERS = [['all', 'All'], ['session', 'Sessions'], ['general', 'General']];
const CNOTES_PAGE = 3;   // notes per page
const PLANS_PAGE = 3, SNOTES_PAGE = 3;   // Training Plans and Student Notes per page, on a student's page
const cnoteIn = (n, filter) => filter === 'all' || (filter === 'session') === !!n.session_date;
const cnoteDateField = (value = '') => `<label>Session Date<span class="hint field-hint">Leave the date empty for a general note.</span>
    <input type="date" name="session_date" value="${esc(value)}" max="${localToday()}" data-high="Pick today or an earlier day."></label>`;

// edit: the student's coach, who can edit any note; other coaches edit only their own.
// Laid out like the Master Exercise List: the note on the left, its actions on the right, under a Notes / Actions head.
const coachNoteItem = (n, edit) => `<div class="note-wrap goal" id="cnote-${n.id}"><div class="goal-text">
    <strong>${n.session_date ? 'Session on ' + esc(fmtSessionDay(n.session_date)) : 'General Note'}</strong>
    <p>${para(n.body)}</p>
    <div class="note-meta">${esc(n.author_name || 'Coach')} · ${fmtWhen(n.created_at)}${n.edited_at ? ' · Edited ' + fmtWhen(n.edited_at) : ''}</div></div>
    ${edit || n.author_id === me.user.id ? `<div class="row ex-actions"><button type="button" class="small ghost" data-act="cnote-edit" data-cnote="${n.id}">Edit</button>
    <button type="button" class="small ghost danger" data-act="cnote-delete" data-cnote="${n.id}">Delete</button></div>` : ''}</div>`;

// Days of past sessions with no note, newest first: every one newer than the newest session that has a note
// (so older, backfilled sessions stop counting once a newer one is noted). Past sessions come from historyOf:
// Session History plus an ended next session. None once coaching ends, or for another coach's student. log: session_history rows.
function cnoteMissing(notes, s, log) {
  if (s.training_ended_at || !canCoach(s)) return [];
  const noted = new Set(notes.map(n => n.session_date)), days = [...new Set(historyOf(log, s).map(h => h.session_date))];
  const upTo = days.findIndex(d => noted.has(d));
  return upTo < 0 ? days : days.slice(0, upTo);
}

const CNOTE_MISSING_SHOWN = 3;   // missing sessions listed before "and n more"

// at = { filter, page, day?, allMissing? }: which notes show, which page of them (kept in range here), day, the
// missing session the coach picked to write up, and allMissing once they tapped "and n more".
function coachNotesHTML(notes, s, log, at) {
  const p = pro(s.pronouns), list = notes.filter(n => cnoteIn(n, at.filter)), [shown, page] = pageOf(list, at.page, CNOTES_PAGE);
  at.page = page;
  // Missing session notes: the card turns the warn color (renderCoachNotes) and the form starts with the picked
  // (or newest) one's date filled in. It's the field's starting value, so the card isn't marked unsaved until the
  // coach writes something.
  const missing = cnoteMissing(notes, s, log);
  const writeUp = historyOf(log, s).some(h => h.session_date === at.day) ? at.day : missing[0] || '';
  const more = at.allMissing ? 0 : Math.max(0, missing.length - CNOTE_MISSING_SHOWN);
  const pick = missing.length > 1 ? `<span class="row" style="margin-top:.5rem">${missing.slice(0, missing.length - more).map(d =>
    `<button type="button" class="small ghost" data-cnote-day="${d}">${esc(fmtSessionDay(d))}</button>`).join('')}
    ${more ? `<button type="button" class="small ghost" data-cnote-more aria-expanded="false">And ${more} More</button>`
      : at.allMissing && missing.length > CNOTE_MISSING_SHOWN ? '<button type="button" class="small ghost" data-cnote-more aria-expanded="true">Show Fewer</button>' : ''}</span>` : '';
  return `<div class="row between"><h2>Coach Notes</h2>${missing.length ? '<span class="tag warn">Needs Note</span>' : ''}</div>
    <p class="hint">Private to coaches: ${p.they} never ${p.v('see', 'sees')} these. Give a note a session date to keep what came up in that session.</p>
    ${missing.length === 1 ? `<p class="warn-box" role="status"><strong>The session on ${esc(fmtSessionDay(missing[0]))} is over.</strong>
      Note how it went while it's fresh.${writeUp === missing[0] ? ' Its date is filled in below.' : ''}</p>`
    : missing.length ? `<div class="warn-box" role="status"><strong>${missing.length} sessions have no notes yet.</strong>
      Pick one to fill in its date below, then add its note.${pick}</div>` : ''}
    <form id="cnoteForm" class="stack" data-save>
      <label>Notes<textarea name="body" rows="3" maxlength="4000" required data-need="Write notes first."></textarea></label>
      ${cnoteDateField(writeUp)}
      <button class="primary">+ Add Notes</button>
    </form>
    ${notes.length ? `<div class="seg" role="radiogroup" aria-label="Show" style="margin:1.1rem 0 .3rem">${CNOTE_FILTERS.map(([k, label]) =>
      `<label><input type="radio" name="cnote_filter" value="${k}"${k === at.filter ? ' checked' : ''}>${label} (${notes.filter(n => cnoteIn(n, k)).length})</label>`).join('')}</div>` : ''}
    ${shown.length ? '<div class="list-head"><span>Notes</span><span class="ex-actions">Actions</span></div>' : ''}
    ${shown.map(n => coachNoteItem(n, canCoach(s))).join('') ||`<p class="muted">${notes.length ? 'None here yet.' : 'No coach notes yet.'}</p>`}
    ${pagerHTML(page, list.length, CNOTES_PAGE)}`;
}
