// ---------- Coach: the Coaching Session card on #/student/<id> (coaching_sessions) and Coach View ----------
// What the coach plans for the student's next session and the notes they take during it. Coaches only: students never
// see it. One open session at a time. It follows the Next Session (csSync) until its own time has passed, and saves by
// itself as the coach types (csChanged: a second after the last change, with a copy kept in this browser until the save
// lands, retried while it fails). It is never submitted by itself: Submit (red, enabled once the session has ended) puts
// its notes into one Coach Note for that day and logs it in Session History (submit_coaching_session), and it becomes a
// past coaching session, read only for good. Coach View is the same session in big type, one exercise at a time.

const CS_SAVE_WAIT = 1000, CS_RETRY = 5000;
const CS_MAX_EX = 20;          // exercises in one coaching session (keeps a submitted session's Coach Note in its limit)
const CS_NOTE_MAX = 30000;     // matches the check on coach_notes.body
const CS_PAST_PAGE = 3;        // past coaching sessions per page
const CS_TIME_COLS = ['session_date', 'start_time', 'end_time', 'location'];

// { s, edit, open, past, plan, library, ctx: { showNotes(date), redraw() }, at: { openEx, past: { page }, pastOpen }, view: { i } }
let cs = null;

const csAt = (c, t) => new Date(`${c.session_date}T${t}`);
const csEnded = c => !!c.session_date && csAt(c, c.end_time) <= new Date();
const csLive = c => !!c.session_date && csAt(c, c.start_time) <= new Date() && !csEnded(c);
const csIsToday = c => c.session_date === localToday();
const csDay = d => day(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
// "48 min left", "1 h 20 min left"
function csLeft(c) {
  const n = Math.max(1, Math.ceil((csAt(c, c.end_time) - new Date()) / 60e3)), h = Math.floor(n / 60);
  return `${h ? `${h} h${n % 60 ? ` ${n % 60} min` : ''}` : `${n} min`} left`;
}
const csTimes = c => `${fmtTime(c.start_time)} – ${fmtTime(c.end_time)}`;
const csBlank = () => ({ id: crypto.randomUUID(), name: '', sets: '', reps: '', rest: '', plan_notes: '', from: '', notes: '' });
const csFirstLine = t => String(t ?? '').replace(/\*\*/g, '').split('\n').find(l => l.trim()) ?? '';

// The student page calls this once its data is in. rows: the student's coaching_sessions. ctx: { plan (the current
// plan or null), showNotes(date) (Coach Notes from that day), redraw() (the whole page) }.
function bindCoachSession(s, rows, ctx) {
  const open = rows.find(r => !r.submitted_at) || null, same = cs?.s.id === s.id;
  const past = rows.filter(r => r.submitted_at)
    .sort((a, b) => b.session_date.localeCompare(a.session_date) || b.start_time.localeCompare(a.start_time));
  // Edits that hadn't saved yet when the page was left or reloaded.
  const kept = open && canCoach(s) && csLocal(open.id);
  if (kept) Object.assign(open, kept);
  for (const r of rows) if (r.submitted_at) csForget(r.id);
  cs = { s, edit: canCoach(s), open, past, plan: ctx.plan, ctx, library: same ? cs.library : null,
    at: same ? cs.at : { openEx: null, past: { page: 1 }, pastOpen: false }, view: same ? cs.view : { i: 0 } };
  if (kept) csChanged();
  renderCoachSession();
  csSync();
}

// ---------- Following the Next Session ----------

// While open and not yet over, the session takes the Next Session's day, times and place (or none, if it was cleared),
// even one set after it happened. Called on load and whenever the Next Session changes. Once its own time has passed it
// keeps its day, for Submit, so setting the following Next Session never moves it.
async function csSync() {
  const c = cs?.open, s = cs?.s;
  if (!c || !cs.edit || csEnded(c)) return;
  const set = !!s.next_date;
  const want = { session_date: set ? s.next_date : null, start_time: set ? s.next_start : null, end_time: set ? s.next_end : null,
    location: set ? s.next_location : null };
  const same = k => k.endsWith('time') ? hm(c[k]) === hm(want[k]) : (c[k] ?? null) === want[k];
  if (CS_TIME_COLS.every(same)) return;
  try {
    Object.assign(c, await sb.from('coaching_sessions').update(want).eq('id', c.id).select(CS_TIME_COLS.join(',')).single().then(must));
  } catch (e) { flash(msgOf(e), 'error'); }
  renderCoachSession();
}
// The Next Session changed (saved or cleared on this page).
function csNextChanged() { if (cs) { renderCoachSession(); csSync(); } }

// ---------- Saving by itself ----------
// A change waits a second for more, then the session's exercises and notes are sent. A copy stays in this browser
// (localStorage) until the save lands, so nothing is lost if the gym's signal drops or the page is closed.

const csSaver = { row: null, timer: 0, busy: null, again: false, failed: false };
const csKey = id => `sitstart.cs.${id}`;
function csLocal(id) { try { return JSON.parse(localStorage.getItem(csKey(id))); } catch { return null; } }
function csForget(id) { try { localStorage.removeItem(csKey(id)); } catch {} }
const csPending = () => !!(csSaver.row || csSaver.busy);

function csChanged() {
  const c = cs.open;
  if (csSaver.row && csSaver.row !== c) csFlush();   // another session's change is still waiting: send it now
  csSaver.row = c;
  try { localStorage.setItem(csKey(c.id), JSON.stringify({ exercises: c.exercises, notes: c.notes })); } catch {}
  clearTimeout(csSaver.timer);
  csSaver.timer = setTimeout(csFlush, CS_SAVE_WAIT);
  csShowSave();
}

// Sends the waiting change now. Resolves when that save is done (or has failed and will be retried).
function csFlush() {
  clearTimeout(csSaver.timer);
  if (csSaver.busy) { csSaver.again = true; return csSaver.busy; }
  const c = csSaver.row;
  if (!c) return Promise.resolve();
  csSaver.row = null;
  csSaver.busy = (async () => {
    try {
      const done = await sb.from('coaching_sessions').update({ exercises: c.exercises, notes: c.notes }).eq('id', c.id).select('id').then(must);
      // Nothing changed: it was submitted or deleted somewhere else (another tab or phone).
      if (!done.length) { csForget(c.id); flash('This coaching session was submitted or deleted somewhere else. Reload the page.', 'error'); return; }
      csSaver.failed = false;
      if (csSaver.row !== c) csForget(c.id);   // no newer change waiting
    } catch {
      csSaver.failed = true;
      csSaver.row ||= c;
      csSaver.timer = setTimeout(csFlush, CS_RETRY);
    }
  })().finally(() => {
    csSaver.busy = null;
    if (csSaver.again) { csSaver.again = false; if (csSaver.row) csFlush(); }
    csShowSave();
  });
  csShowSave();
  return csSaver.busy;
}

const CS_CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
function csShowSave() {
  const html = csSaver.failed ? 'Not saved. Retrying…' : csPending() ? 'Saving…' : `${CS_CHECK}Saved`;
  document.querySelectorAll('[data-cs-saved]').forEach(el => {
    el.innerHTML = html;
    el.classList.toggle('warn', csSaver.failed);
    el.classList.toggle('ing', !csSaver.failed && csPending());
  });
}
// Leaving the page sends a waiting change straight away; closing it asks first while one hasn't landed.
addEventListener('hashchange', () => { if (csSaver.row) csFlush(); });
addEventListener('beforeunload', e => { if (csPending()) { csFlush(); e.preventDefault(); e.returnValue = ''; } });

// ---------- The card ----------

const csHead = (sum = '') => `<div class="row between"><h2>Coaching Session</h2>${sum}</div>`;
const csHint = '<p class="hint">Plan what you\'ll cover, then take notes during the session. Only coaches see this.</p>';

function csPastListHTML(page) {
  const [shown, p] = pageOf(cs.past, page, CS_PAST_PAGE);
  cs.at.past.page = p;
  return `<ul class="list">${shown.map(r => `<li class="hist"><span><strong>${esc(fmtSessionDay(r.session_date))}</strong>
    <span class="item-sub">${csTimes(r)} · ${r.exercises.length} exercise${r.exercises.length === 1 ? '' : 's'}</span></span>
    <button type="button" class="small ghost" data-cs-past="${r.id}">View</button></li>`).join('')}</ul>${pagerHTML(p, cs.past.length, CS_PAST_PAGE)}`;
}
const csPastHTML = () => cs.past.length ? `<details class="other-plans cs-past"${cs.at.pastOpen ? ' open' : ''}>
  <summary>Past Coaching Sessions (${cs.past.length})</summary><div id="csPastBox">${csPastListHTML(cs.at.past.page)}</div></details>` : '';

// An exercise as a row: name, its values, then the first line of the coach's notes (or + Add Note).
function csRowHTML(x, k, n) {
  const sum = exSummary(x), note = csFirstLine(x.notes);
  return `<div class="ex-row" data-ex>${n > 1 ? `<span class="grip" data-k="${k}" title="Drag to Reorder">${GRIP}</span>` : ''}
    <button type="button" class="ex-open" data-cs="open" data-k="${k}"><span class="ex-main">
    <span class="ex-rname">${esc(x.name.trim() || 'Unnamed Exercise')}</span>${sum ? `<span class="ex-val">${esc(sum)}</span>` : ''}
    ${note ? `<span class="ex-rnote cs-rnote">${esc(note)}</span>` : '<span class="ex-rnote cs-add-note">+ Add Note</span>'}</span>${CHEVRON}</button></div>`;
}
const csFromHTML = x => String(x.plan_notes ?? '').trim()
  ? `<p class="cs-from"><strong>${x.from === 'list' ? 'From Exercises &amp; Drills' : 'From the plan'}:</strong> ${para(x.plan_notes)}</p>` : '';
// The open exercise, like the plan editor's: name (the exercise list picker), Sets / Reps/Time / Rest, the plan's notes,
// the coach's notes, Move Up / Move Down (only where it can go) and Remove.
function csExEditHTML(x, k, n) {
  const f = (field, label) => `<label class="ex-${field}">${label}<input data-csx="${field}" value="${esc(x[field])}" placeholder="${label}" autocomplete="off"
    ${field === 'name' ? 'data-combo role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="exMenu" maxlength="200"' : 'maxlength="100"'}></label>`;
  const btn = (act, label) => `<button type="button" class="small" data-cs="${act}" data-k="${k}">${label}</button>`;
  return `<div class="ex-edit" data-ex><div class="ex-top-row"><span class="row">${n > 1 ? `<span class="grip" data-k="${k}" title="Drag to Reorder">${GRIP}</span>` : ''}
      <span class="ex-count">Exercise ${k + 1} of ${n}</span></span><button type="button" class="small fill" data-cs="close">Done</button></div>
    ${f('name', 'Exercise')}
    <div class="ex-three">${f('sets', 'Sets')}${f('reps', 'Reps/Time')}${f('rest', 'Rest')}</div>
    ${csFromHTML(x)}
    <label class="ex-notes">Notes${rich(`<textarea rows="2" data-grow data-csx="notes" maxlength="1000" placeholder="How did the exercise go?">${esc(x.notes)}</textarea>`)}</label>
    <div class="ex-acts"><span class="row">${k > 0 ? btn('up', 'Move Up') : ''}${k < n - 1 ? btn('down', 'Move Down') : ''}</span>
      <button type="button" class="small ghost danger" data-cs="remove" data-k="${k}">Remove</button></div></div>`;
}

// A session's exercises and notes to read: the past session dialog, and another coach's student.
const csReadHTML = r => `${r.exercises.length ? `<div class="ex-cards">${r.exercises.map(x => `<div class="ex-card"><p class="ex-name">${esc(x.name || 'Exercise')}</p>
    <div class="stats">${statHTML('Sets', x.sets)}${statHTML('Reps/Time', x.reps)}${statHTML('Rest', x.rest)}</div>
    ${String(x.notes ?? '').trim() ? `<p class="ex-note">${para(x.notes)}</p>` : ''}</div>`).join('')}</div>` : '<p class="muted">No exercises.</p>'}
  <h3 class="cs-read-h">Session Notes</h3>${r.notes.trim() ? `<p class="prose">${para(r.notes)}</p>` : '<p class="muted">None.</p>'}`;

function csCardHTML() {
  const { s, edit, open: c } = cs, p = pro(s.pronouns);
  if (s.training_ended_at) return csHead() + '<p class="muted">Coaching has ended.</p>' + csPastHTML();
  if (!c) {
    if (!edit) return csHead() + `<p class="muted">No coaching session planned. Only ${p.their} coach plans one.</p>` + csPastHTML();
    const ok = s.next_date && !nextPassed(s);
    return csHead() + csHint + (ok ? `<div class="cs-next"><span class="eyebrow">Next Session</span><p class="cs-next-day">${esc(csDay(s.next_date))}</p>
        <p class="muted">${csTimes({ start_time: s.next_start, end_time: s.next_end })} · ${esc(s.next_location)}</p></div>
        <button type="button" class="fill cs-big" data-cs="new">+ New Coaching Session</button>`
      : `<p class="warn-box">${s.next_date ? 'The next session has ended. Set the next one to plan its coaching session.'
        : 'Set the next session first. The coaching session takes its date and time from it.'}</p>
        <button type="button" class="fill cs-big" data-cs="set-next">Set Next Session</button>`) + csPastHTML();
  }
  const when = c.session_date ? `<div><p class="cs-day">${esc(csDay(c.session_date))}</p><p class="muted cs-meta">${csTimes(c)} · ${esc(c.location)}</p></div>`
    : '<p class="warn-box">The next session was cleared, so this coaching session has no date. Set the next session to schedule it.</p>';
  if (!edit) return `${csHead()}<p class="hint">Planned by ${esc(c.author_name || 'a coach')}. Only ${p.their} coach can change it.</p>
    <div class="cs-when">${when}</div>${csReadHTML(c)}${csPastHTML()}`;
  const n = c.exercises.length, i = c.exercises.findIndex(x => x.id === cs.at.openEx);
  return `${csHead('<span class="cs-saved" data-cs-saved aria-live="polite"></span><span class="fold-sum" id="csFoldSum"></span>')}
    <div class="cs-strip" id="csStrip" hidden></div>
    <div class="cs-when">${when}<span id="csTag"></span>
      ${c.session_date ? '' : '<button type="button" class="fill" data-cs="set-next">Set Next Session</button>'}
      <button type="button" class="fill cs-view-btn" data-cs="view">Coach View</button></div>
    <div class="ex-head"><h3>Exercises</h3>${n ? '<p class="hint">Tap one to add notes</p>' : ''}</div>
    ${n ? `<div class="ex-list cs-list">${c.exercises.map((x, k) => k === i ? csExEditHTML(x, k, n) : csRowHTML(x, k, n)).join('')}</div>`
      : '<p class="muted">No exercises yet. Add some, or copy them from the training plan.</p>'}
    <div class="cs-adds"><button type="button" class="add-ex" data-cs="add">+ Add Exercises</button>
      ${cs.plan ? '<button type="button" class="add-ex" data-cs="copy">Copy From Training Plan</button>' : ''}</div>
    <label class="cs-notes">Session Notes${rich(`<textarea rows="3" data-grow data-css="notes" maxlength="4000" placeholder="Goals for this session, how it went, what to work on next time, and other notes about the session">${esc(c.notes)}</textarea>`)}</label>
    <div class="cs-submit" id="csSubmit"></div>
    <button type="button" class="small ghost danger cs-del" data-cs="delete">Delete This Coaching Session</button>
    ${csPastHTML()}`;
}

// The Submit button and its hint: grayed out until the session has ended, so it can't be pressed by mistake.
function csSubmitHTML(c) {
  const ended = csEnded(c), today = csIsToday(c);
  const hint = !c.session_date ? 'Set the next session first.'
    : ended ? `Ended ${today ? `at ${fmtTime(c.end_time)}` : `on ${csDay(c.session_date)}`}. Submit when your notes are done.`
    : `You can submit once the session ends ${today ? '' : `on ${csDay(c.session_date)} `}at ${fmtTime(c.end_time)}.`;
  return `<button type="button" class="cs-submit-btn" data-cs="submit"${ended ? '' : ' disabled'}>Submit Session</button><p class="hint">${hint}</p>`;
}

// Redraws Submit when the session has just ended (or it isn't drawn yet), and only then, so a redraw never eats a press.
function csSubmitTick(box, c) {
  const b = box?.querySelector('.cs-submit-btn');
  if (box && (!b || b.disabled === csEnded(c))) box.innerHTML = csSubmitHTML(c);
}
// The parts that change with the clock: the Live strip, the day's tag, Submit, and Coach View's clock.
function csTick() {
  const c = cs?.open, card = $('#csCard');
  if (!c || !card || !cs.edit || cs.s.training_ended_at) return;
  const live = csLive(c), ended = csEnded(c), strip = $('#csStrip');
  card.classList.toggle('live', live);
  if (strip) {
    strip.hidden = !live;
    strip.innerHTML = live ? `<span><i class="live-dot"></i><b>Live Now</b> · ${csLeft(c)}</span><span>Ends ${fmtTime(c.end_time)}</span>` : '';
  }
  const n = c.session_date && Math.round((day(c.session_date) - day(localToday())) / 864e5);
  const tag = $('#csTag');
  if (tag) tag.innerHTML = !c.session_date || live ? '' : ended ? '<span class="tag warn">Ended</span>'
    : `<span class="tag">${n <= 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`}</span>`;
  const sum = $('#csFoldSum');
  if (sum) sum.textContent = live ? 'Live now' : c.session_date ? csDay(c.session_date) : 'No date';
  csSubmitTick($('#csSubmit'), c);
  if (cvDlg.open) cvTick();
}
setInterval(csTick, 20e3);

// Draws the card (in place, keeping the page where it is). focusAt: a selector to focus after.
function renderCoachSession(focusAt) {
  const card = $('#csCard');
  if (!card || !cs) return;
  exCtx = CS_EX_CTX;
  if (cs.s.training_ended_at && !cs.past.length) { card.hidden = true; return; }
  card.hidden = false;
  card.innerHTML = csCardHTML();
  csTick();
  csShowSave();
  const box = $('#csPastBox');
  if (box) pagedBox(box, cs.at.past, csPastListHTML);
  card.querySelector('.cs-past')?.addEventListener('toggle', e => { cs.at.pastOpen = e.target.open; });
  if (cs.edit && cs.open) csLibrary().catch(() => {});   // for the name picker; nice to have, so a failure just leaves it out
  if (focusAt) card.querySelector(focusAt)?.focus({ preventScroll: true });
}

async function csLibrary() {
  cs.library ??= await sb.from('exercises').select('*').then(must);
  return cs.library;
}

// The exercise browser and name picker (exercises.js) work on this session while the student page is shown.
const CS_EX_CTX = {
  get library() { return cs?.library ?? []; },
  recent: [],
  used: () => cs?.open?.exercises ?? [],
  here: () => cs?.open?.exercises ?? [],
  label: () => cs?.open?.session_date ? `Coaching Session, ${csDay(cs.open.session_date)}` : 'Coaching Session',
  add: (sid, names) => csAddExercises(names.map(name => {
    const m = cs.library?.find(y => y.name_key === exKey(name));
    return m ? { ...csBlank(), name: m.name, sets: m.sets ?? '', reps: m.reps ?? '', rest: m.rest ?? '', plan_notes: (m.notes ?? '').slice(0, 1000), from: 'list' }
      : { ...csBlank(), name };
  })),
};

// Adds exercises to the end. A new one (not on the list) opens for the coach to fill in. In Coach View, it shows the first added.
function csAddExercises(list) {
  const c = cs.open, room = CS_MAX_EX - c.exercises.length;
  if (!list.length) return;
  if (room <= 0) return flash(`A coaching session can have up to ${CS_MAX_EX} exercises.`, 'error');
  if (list.length > room) flash(`Only the first ${room} were added: a coaching session can have up to ${CS_MAX_EX} exercises.`, 'error');
  const from = c.exercises.length, added = list.slice(0, room);
  c.exercises.push(...added);
  csChanged();
  if (cvDlg.open) { cs.view.i = from; renderCoachView(); return; }
  const blank = added.find(x => !x.sets && !x.reps && !x.rest && !x.plan_notes);
  if (blank) cs.at.openEx = blank.id;
  renderCoachSession();
  const rows = [...$('#csCard .cs-list').children].slice(from);
  rows.forEach(el => el.classList.add('just-added'));
  const el = blank ? rows[added.indexOf(blank)] : rows.at(-1);
  el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (blank) el?.querySelector('[data-csx="sets"]')?.focus({ preventScroll: true });
}

// Typing or picking a listed exercise's name fills in its values (once per name, so the coach's own values stay).
const csFilled = new WeakMap();
function csSetName(x, input) {
  if (!csFilled.has(x)) csFilled.set(x, exKey(x.name));
  x.name = input.value;
  const m = cs.library?.find(y => y.name_key === exKey(x.name));
  if (!m || csFilled.get(x) === m.name_key) return;
  csFilled.set(x, m.name_key);
  Object.assign(x, { sets: m.sets ?? '', reps: m.reps ?? '', rest: m.rest ?? '', plan_notes: (m.notes ?? '').slice(0, 1000), from: 'list' });
  const box = input.closest('.ex-edit');
  for (const f of ['sets', 'reps', 'rest']) box.querySelector(`[data-csx="${f}"]`).value = x[f];
  const old = box.querySelector('.cs-from');
  if (old) old.outerHTML = csFromHTML(x) || '<span hidden class="cs-from"></span>';
  else if (x.plan_notes.trim()) box.querySelector('.ex-three').insertAdjacentHTML('afterend', csFromHTML(x));
}

// Drag an exercise by its grip to reorder (drag.js).
const CS_DRAG = {
  handle: '#csCard .cs-list .grip', item: h => h.closest('[data-ex]'), lists: el => [el.parentNode], items: '[data-ex]', axis: 'y',
  drop(el, list, index) {
    const all = cs.open.exercises, from = +el.querySelector('.grip').dataset.k;
    if (from === index) return;
    all.splice(index, 0, ...all.splice(from, 1));
    csChanged();
    renderCoachSession();
  },
};

// The card's own handlers (the page's data-act handler ignores data-cs).
document.addEventListener('pointerdown', e => { if (e.target.closest?.('#csCard .cs-list .grip')) dragSort(e, CS_DRAG); });
document.addEventListener('input', e => {
  const t = e.target;
  if (!cs?.open || !t.closest?.('#csCard')) return;
  const c = cs.open;
  if (t.dataset.css === 'notes') c.notes = t.value;
  else if (t.dataset.csx) {
    const x = c.exercises.find(y => y.id === cs.at.openEx);
    if (!x) return;
    if (t.dataset.csx === 'name') csSetName(x, t); else x[t.dataset.csx] = t.value;
  } else return;
  csChanged();
});
document.addEventListener('click', async e => {
  const b = e.target.closest?.('#csCard [data-cs], #csCard [data-cs-past]');
  if (!b || !cs) return;
  if (b.dataset.csPast) return csShowPast(b.dataset.csPast);
  const c = cs.open, k = +b.dataset.k, act = b.dataset.cs;
  switch (act) {
    case 'new': return csNew(b);
    case 'set-next': return $('#nextCard [data-next="set"]')?.click();
    case 'view': return openCoachView();
    case 'add': return csOpenAdd(b);
    case 'copy': return csCopy(b);
    case 'delete': return csDelete(b);
    case 'submit': return csSubmit(b);
    case 'open': case 'close': {
      const was = cs.at.openEx;
      cs.at.openEx = act === 'open' ? c.exercises[k].id : null;
      renderCoachSession();
      const at = c.exercises.findIndex(x => x.id === (cs.at.openEx ?? was)), el = $('#csCard .cs-list')?.children[at];
      el?.scrollIntoView({ block: 'nearest' });
      (cs.at.openEx ? el?.querySelector('[data-csx="notes"]') : el?.querySelector('button'))?.focus({ preventScroll: true });
      return;
    }
    case 'up': case 'down': {
      const j = k + (act === 'up' ? -1 : 1), list = c.exercises;
      if (!list[j]) return;
      [list[k], list[j]] = [list[j], list[k]];
      break;
    }
    case 'remove': c.exercises.splice(k, 1); cs.at.openEx = null; break;
    default: return;
  }
  csChanged();
  renderCoachSession();
});

// ---------- New, add, copy, delete ----------

function csNew(btn) {
  const s = cs.s;
  busy(btn, async () => {
    const { data, error } = await sb.from('coaching_sessions').insert({ student_id: s.id, session_date: s.next_date, start_time: s.next_start,
      end_time: s.next_end, location: s.next_location }).select().single();
    if (error) throw error.code === '23505' ? new Error(`${s.first_name} already has an open coaching session. Reload the page to see it.`) : error;
    cs.open = data;
    cs.at.openEx = null;
    renderCoachSession('[data-cs="add"]');
    flash('Coaching session started. It saves as you go.');
  });
}

function csOpenAdd(btn) {
  if (cs.open.exercises.length >= CS_MAX_EX) return flash(`A coaching session can have up to ${CS_MAX_EX} exercises.`, 'error');
  busy(btn, async () => { await csLibrary(); openExBrowser(cs.open.id); });
}

// Copy From Training Plan: pick one of the current plan's sessions (tabs), untick any you'll skip, then add them.
// Copies name, sets, reps and rest; the plan's notes come along to read, not as the coach's notes.
async function csCopy(btn) {
  const plan = cs.plan;
  const sessions = await busy(btn, () => sb.from('sessions').select('id,week,title,exercises').eq('plan_id', plan.id)
    .order('week').order('position').then(must));
  if (!sessions) return;
  const list = sessions.map(x => ({ ...x, exercises: (x.exercises ?? []).filter(y => String(y.name ?? '').trim()) })).filter(x => x.exercises.length);
  if (!list.length) return flash(`${plan.title || 'The training plan'} has no exercises yet.`, 'error');
  const L = planLayout(plan), byWeek = {};
  const label = x => {
    const k = (byWeek[x.week] = (byWeek[x.week] ?? 0) + 1), name = x.title.trim() || `Session ${k}`;
    return L === 'weekly' ? name : `${L === 'blocks' ? 'Block' : 'Week'} ${x.week} · ${name}`;
  };
  const labels = list.map(label);
  const asked = ask({ title: 'Copy From Training Plan', ok: 'Add Exercises', body: `
    <p class="hint">${esc(plan.title || 'Current plan')}. Pick a session, then untick anything you'll skip.</p>
    <input type="hidden" name="group" value="0">
    ${list.length > 1 ? `<div class="tabs cs-copy-tabs" role="tablist">${labels.map((t, g) =>
      `<button type="button" role="tab" data-group="${g}" aria-selected="${g === 0}">${esc(t)}</button>`).join('')}</div>` : ''}
    ${list.map((x, g) => `<div class="cs-picks" data-picks="${g}"${g ? ' hidden' : ''}>${x.exercises.map((y, j) =>
      `<label class="cs-pick"><input type="checkbox" name="ex" value="${g}:${j}" checked><span><b>${esc(y.name)}</b>
        ${exSummary(y) ? `<span>${esc(exSummary(y))}</span>` : ''}</span></label>`).join('')}</div>`).join('')}` });
  const form = $('#dlg form'), okBtn = form.querySelector('button[value="ok"]');
  const count = () => {
    const g = form.elements.group.value, n = form.querySelectorAll(`[data-picks="${g}"] input:checked`).length;
    okBtn.textContent = n ? `Add ${n} Exercise${n === 1 ? '' : 's'}` : 'Add Exercises';
    okBtn.disabled = !n;
  };
  form.addEventListener('click', e => {
    const t = e.target.closest('[data-group]');
    if (!t) return;
    form.elements.group.value = t.dataset.group;
    form.querySelectorAll('[data-group]').forEach(x => x.setAttribute('aria-selected', x === t));
    form.querySelectorAll('[data-picks]').forEach(x => { x.hidden = x.dataset.picks !== t.dataset.group; });
    count();
  });
  form.addEventListener('change', count);
  count();
  const f = await asked;
  if (!f) return;
  const g = f.get('group');
  csAddExercises(f.getAll('ex').filter(v => v.startsWith(g + ':')).map(v => {
    const y = list[+g].exercises[+v.split(':')[1]];
    return { ...csBlank(), name: y.name.trim().slice(0, 200), sets: String(y.sets ?? '').slice(0, 100), reps: String(y.reps ?? '').slice(0, 100),
      rest: String(y.rest ?? '').slice(0, 100), plan_notes: String(y.notes ?? '').slice(0, 1000), from: 'plan' };
  }));
}

async function csDelete(btn) {
  const c = cs.open;
  if (!await ask({ title: 'Delete This Coaching Session?', ok: 'Delete', warn: true,
    body: "<p>Its exercises and notes are deleted, and nothing goes into Coach Notes. This can't be undone.</p>" })) return;
  busy(btn, async () => {
    if (csSaver.row === c) { clearTimeout(csSaver.timer); csSaver.row = null; }
    must(await sb.from('coaching_sessions').delete().eq('id', c.id));
    csForget(c.id);
    cs.open = null;
    renderCoachSession();
    flash('Coaching session deleted.');
  });
}

// ---------- Submit ----------

// The Coach Note it becomes: the time and place, the session notes, then each exercise with its values and notes.
function csNote(c) {
  const ex = c.exercises.filter(x => x.name.trim()).map(x => {
    const sum = exSummary(x);
    return `**${x.name.trim()}**${sum ? ` · ${sum}` : ''}${x.notes.trim() ? `\n${x.notes.trim()}` : ''}`;
  });
  return [`**Coaching Session, ${csTimes(c)} at ${c.location}**`, c.notes.trim(), ...ex].filter(Boolean).join('\n\n');
}

async function csSubmit(btn) {
  const c = cs.open;
  if (!csEnded(c)) return;
  if (!await ask({ title: 'Submit This Session?', ok: 'Submit Session', warn: true,
    body: `<p>This moves ${esc(csDay(c.session_date))} to Past Coaching Sessions and puts all of its notes into one Coach Note for that day.</p>
      <p>You can't edit or reopen it after.</p>` })) return;
  busy(btn, async () => {
    await csFlush();
    if (csPending() || csSaver.failed) throw new Error("The latest notes haven't saved yet. Check your connection, then try again.");
    const note = csNote(c);
    if (note.length > CS_NOTE_MAX) throw new Error('These notes are too long for one Coach Note. Shorten some, then try again.');
    must(await sb.rpc('submit_coaching_session', { p_id: c.id, p_note: note }));
    csForget(c.id);
    if (cvDlg.open) cvDlg.close();
    cs.open = null;
    flash('Submitted. Its notes are in Coach Notes.');
    cs.ctx.redraw();   // Coach Notes, Session History and this card
  });
}

// A past coaching session, read only, with a way to its Coach Note.
async function csShowPast(id) {
  const r = cs.past.find(x => x.id === id);
  if (!r) return;
  let toNote = false;
  const asked = ask({ title: `Coaching Session, ${csDay(r.session_date)}`, cancel: false, ok: 'Close', body: `
    <p class="muted">${csTimes(r)} · ${esc(r.location)}${r.author_name ? ` · ${esc(r.author_name)}` : ''}</p>
    ${csReadHTML(r)}
    <button value="note" formnovalidate class="ghost small cs-to-note">See the Coach Note</button>` });
  $('#dlg .cs-to-note').addEventListener('click', () => { toNote = true; });
  await asked;
  if (toNote) cs.ctx.showNotes(r.session_date);
}

// ---------- Coach View: the open session in big type, one exercise at a time ----------
// Dark, full screen. On a phone: the exercise, its notes and the session notes, with Previous and Next. On a wide
// screen: the exercises listed down the left (tap one to jump), the exercise in the middle, the session notes and
// Submit on the right. It edits the same session, saving as the card does.

const cvDlg = Object.assign(document.createElement('dialog'), { id: 'csView', className: 'cs-view' });
cvDlg.setAttribute('aria-label', 'Coach View');
document.body.append(cvDlg);

function openCoachView() {
  cs.view.i = Math.min(cs.view.i, Math.max(0, cs.open.exercises.length - 1));
  renderCoachView();
  cvDlg.showModal();
  cvDlg.querySelector('.cv-exit').focus();
}

function renderCoachView() {
  const c = cs.open, ex = c.exercises, n = ex.length, i = Math.min(cs.view.i, Math.max(0, n - 1)), x = ex[i];
  cs.view.i = i;
  cvDlg.innerHTML = `<header class="cv-top"><div class="cv-top-l"><button type="button" class="cv-exit" data-cv="exit">‹ Exit Coach View</button>
      <span class="cv-who">${esc(cs.s.name)}${c.session_date ? ` · ${esc(csDay(c.session_date))} · ${csTimes(c)}` : ''}</span></div>
    <div class="cv-top-r"><span class="cs-saved" data-cs-saved aria-live="polite"></span><span class="cv-clock" id="cvClock"></span></div></header>
  <div class="cv-body">
    <nav class="cv-list" aria-label="Exercises"><span class="eyebrow">Exercises${n ? ` · ${i + 1} of ${n}` : ''}</span>
      <ol>${ex.map((y, k) => `<li><button type="button" data-cv-go="${k}" class="${k === i ? 'on' : k < i ? 'done' : ''}"${k === i ? ' aria-current="step"' : ''}>
        <span class="cv-n">${k + 1}</span><span class="cv-li"><b>${esc(y.name.trim() || 'Unnamed Exercise')}</b>${exSummary(y, false) ? `<small>${esc(exSummary(y, false))}</small>` : ''}</span></button></li>`).join('')}</ol>
      <button type="button" class="cv-add" data-cv="add">+ Add Exercises</button></nav>
    <main class="cv-main">${x ? `
      <span class="eyebrow">${esc(cs.s.first_name)} · Exercise ${i + 1} of ${n}</span>
      <div class="cv-bar" aria-hidden="true">${ex.map((_, k) => `<i class="${k < i ? 'done' : k === i ? 'on' : ''}"></i>`).join('')}</div>
      <h2 class="cv-name">${esc(x.name.trim() || 'Unnamed Exercise')}</h2>
      <div class="stats cv-stats">${statHTML('Sets', x.sets)}${statHTML('Reps/Time', x.reps)}${statHTML('Rest', x.rest)}</div>
      ${String(x.plan_notes ?? '').trim() ? `<p class="cv-from">${x.from === 'list' ? 'From Exercises &amp; Drills' : 'From the plan'}: ${para(x.plan_notes)}</p>` : ''}
      <label class="cv-l">Notes<textarea data-cv-f="notes" rows="4" data-grow maxlength="1000" placeholder="How did the exercise go?">${esc(x.notes)}</textarea></label>`
      : `<p class="cv-empty">No exercises yet.</p><button type="button" class="cv-add cv-add-main" data-cv="add">+ Add Exercises</button>`}</main>
    <aside class="cv-side"><label class="cv-l">Session Notes<textarea data-cv-f="session" rows="3" data-grow maxlength="4000">${esc(c.notes)}</textarea></label>
      <div class="cv-submit" id="cvSubmit"></div></aside>
    <div class="cv-nav"><button type="button" data-cv="prev"${i > 0 ? '' : ' disabled'}>‹ Previous</button>
      <button type="button" class="cv-next" data-cv="next"${i < n - 1 ? '' : ' disabled'}>Next ›</button></div>
  </div>`;
  cvTick();
  csShowSave();
}

function cvTick() {
  const c = cs?.open, clock = $('#cvClock'), sub = $('#cvSubmit');
  if (!c || !clock) return;
  clock.innerHTML = !c.session_date ? 'No date yet' : csLive(c) ? `<span class="live-pill"><i class="live-dot"></i>Live</span>${csLeft(c)}`
    : csEnded(c) ? `Ended ${csIsToday(c) ? `at ${fmtTime(c.end_time)}` : `on ${csDay(c.session_date)}`}`
    : `Starts ${csIsToday(c) ? '' : `${csDay(c.session_date)} `}at ${fmtTime(c.start_time)}`;
  csSubmitTick(sub, c);
}

cvDlg.addEventListener('input', e => {
  const t = e.target, c = cs?.open;
  if (!c) return;
  if (t.dataset.cvF === 'session') c.notes = t.value;
  else if (t.dataset.cvF === 'notes' && c.exercises[cs.view.i]) c.exercises[cs.view.i].notes = t.value;
  else return;
  csChanged();
});
cvDlg.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const go = i => { cs.view.i = i; renderCoachView(); cvDlg.querySelector('.cv-body').scrollTop = 0; cvDlg.scrollTop = 0; };
  if (b.dataset.cvGo) return go(+b.dataset.cvGo);
  switch (b.dataset.cv || b.dataset.cs) {
    case 'exit': return cvDlg.close();
    case 'prev': return go(cs.view.i - 1);
    case 'next': return go(cs.view.i + 1);
    case 'add': return csOpenAdd(b);
    case 'submit': return csSubmit(b);
  }
});
// Leaving Coach View (Exit, or Esc) shows the card with what was written.
cvDlg.addEventListener('close', () => { if (cs) renderCoachSession('[data-cs="view"]'); });
