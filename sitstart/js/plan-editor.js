// ---------- Coach: plan editor ----------

const blankEx = () => ({ name: '', sets: '', reps: '', rest: '', notes: '' });
const blankSession = week => ({ id: crypto.randomUUID(), week, title: '', details: '', exercises: [] });
// Your last few plans' exercises, for the browser's Used Lately (exbRecent). Nice to have, so a failure just leaves it out.
const RECENT_PLANS = 10;

// sid: a session to open at, from a student note in a feed (openNotes).
async function adminPlan(id, sid) {
  const t = ++navToken;
  view(loading);
  const [plan, sessions, library, notes, recent] = await Promise.all([
    // With the student's Training Log, for "Last" on each exercise and its History.
    sb.from('plans').select('*, student:students(id,name,first_name,pronouns,email,coach_id,exercise_logs(*))').eq('id', id).maybeSingle().then(must),
    sb.from('sessions').select('*').eq('plan_id', id).order('week').order('position').then(must),
    sb.from('exercises').select('*').then(must),
    planNotes(id),
    sb.from('plans').select('sessions(exercises), student:students!inner(coach_id)').eq('student.coach_id', me.staffId).neq('id', id)
      .order('updated_at', { ascending: false }).limit(RECENT_PLANS)
      .then(r => (r.data ?? []).flatMap(p => p.sessions.flatMap(s => s.exercises ?? []))),
  ]);
  if (t !== navToken) return;
  if (!plan) { location.hash = '#/'; return; }
  // Your own plan: as your students see theirs.
  if (isSelf(plan.student)) return studentPlan(id);
  const edit = canCoach(plan.student);
  notesCtx = { notes, studentName: plan.student.name, coach: edit, canPost: edit };
  dirty = false;
  // Another coach's student: read only.
  if (!edit) {
    const p = pro(plan.student.pronouns);
    view(`${crumbs([['Home', '#/'], ['Students', '#/students'], [plan.student.name, '#/student/' + plan.student.id], [plan.title || 'Untitled Plan']])}
      <p class="alert">You're viewing ${esc(plan.student.name)}'s plan. Only ${p.their} coach can change it or reply to ${p.their} notes.</p>
      ${planReadHTML(plan, sessions)}`);
    window.scrollTo(0, 0);
    openNotes(sid);
    return;
  }

  // library: the master exercise list, for the Exercise picker and browser; recent: exercises from your last plans.
  // tab: the picked session in each week (from a note in a feed: that session's).
  // openEx: the one exercise shown as its full card (the rest are rows); details: sessions showing an empty Details box.
  const from = sid && sessions.find(s => s.id === sid);
  // logs: the student's Training Log, newest first.
  draft = { plan, sessions, library, recent, savedIds: new Set(sessions.map(s => s.id)), preview: false, tab: from ? { [from.week]: sid } : {},
    openEx: null, details: new Set(), logs: sortLogs(plan.student.exercise_logs ?? []) };
  Object.assign(exb, { q: '', purpose: '', sid: from?.id ?? null });
  exCtx = null;   // the browser and name picker work on this draft
  dirty = false;
  renderEditor();
  window.scrollTo(0, 0);
  openNotes(sid);
}

// Straight to one session's notes, opened and scrolled to, with the reply box focused (if they can reply).
function openNotes(sid) {
  showSession(sid);   // its tab, if the week has several sessions
  const box = sid && app.querySelector(`[data-notes="${CSS.escape(sid)}"]`);
  if (!box) return;
  box.open = true;
  const field = box.querySelector('textarea');
  (field || box).scrollIntoView({ block: 'center' });
  field?.focus({ preventScroll: true });
}

function displayOrder() {
  const S = draft.sessions;
  return S.map((_, i) => i).sort((a, b) => (S[a].week - S[b].week) || (a - b));
}

function byWeek(list) {
  const weeks = new Map();
  for (const x of list) {
    if (!weeks.has(x.week)) weeks.set(x.week, []);
    weeks.get(x.week).push(x);
  }
  return [...weeks];
}

function markDirty() {
  dirty = true;
  const el = $('#saveState');
  if (el) { el.textContent = 'Unsaved changes'; el.classList.add('warn'); el.parentElement.classList.add('unsaved'); }
}

// A session's exercises are rows (exRowHTML: name, values, the first line of the notes); tapping one opens it as its
// full card (exEditHTML), one at a time (draft.openEx), and Done closes it. The grip drags either (EX_DRAG) when
// there's more than one.
const GRIP = '<svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor" aria-hidden="true">'
  + [6, 10, 14].map(y => `<circle cx="7" cy="${y}" r="1.6"/><circle cx="13" cy="${y}" r="1.6"/>`).join('') + '</svg>';
const CHEVRON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const DOTS = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
const gripHTML = (s, i, e) => s.exercises.length > 1 ? `<span class="grip" data-s="${i}" data-e="${e}" title="Drag to Reorder">${GRIP}</span>` : '';

function exRowHTML(s, i, e) {
  const x = s.exercises[e], sum = exSummary(x);
  const note = String(x.notes ?? '').replace(/\*\*/g, '').split('\n').find(l => l.trim()) ?? '', last = lastLogOf(x);
  return `<div class="ex-row" data-ex>${gripHTML(s, i, e)}<button type="button" class="ex-open" data-act="open-ex" data-s="${i}" data-e="${e}">
    <span class="ex-main"><span class="ex-rname">${esc(x.name.trim() || 'Unnamed Exercise')}</span>${sum ? `<span class="ex-val">${esc(sum)}</span>` : ''}${
      note ? `<span class="ex-rnote">${esc(note)}</span>` : ''}${
      last ? `<span class="ex-rnote">Last: ${esc(logLine(last))} · ${logDay(last.logged_on)}</span>` : ''}</span>${CHEVRON}</button></div>`;
}
// The student's latest log of this exercise (from any plan), or undefined.
const lastLogOf = x => exKey(x.name) && draft.logs.find(l => l.exercise_key === exKey(x.name));

// The open exercise: its name (the master list picker), Sets / Reps/Time / Rest, notes, then Move Up and Move Down
// (only where there's somewhere to go) and Remove.
function exEditHTML(s, i, e) {
  const f = (field, label, ph = label) => `<label class="ex-${field}">${label}<input data-s="${i}" data-e="${e}" data-f="${field}" placeholder="${ph}"
    ${field === 'name' ? 'data-combo role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="exMenu" maxlength="200" autocomplete="off"' : ''}
    value="${esc(s.exercises[e][field])}"></label>`;
  const n = s.exercises.length, btn = (act, label) => `<button type="button" class="small" data-act="${act}" data-s="${i}" data-e="${e}">${label}</button>`;
  // Notes grow downward as the coach types, and can have new lines and bold words.
  const notes = `<label class="ex-notes">Notes${rich(`<textarea rows="1" data-grow data-s="${i}" data-e="${e}" data-f="notes" placeholder="Notes">${esc(s.exercises[e].notes)}</textarea>`)}</label>`;
  // What the student fills in when they log it (Change: for this plan only), and what they logged last.
  const x = s.exercises[e], last = lastLogOf(x), who = esc(draft.plan.student.first_name || draft.plan.student.name);
  const logBoxes = `<div class="ex-box"><div><span class="eyebrow">Log Fields</span><span class="ex-box-v">${esc(trackNames(trackOf(x)))}</span></div>
      ${btn('ex-track', 'Change')}</div>
    ${last ? `<div class="ex-box logged"><div><span class="eyebrow">${who} ${last.logged_on === todayISO() ? 'Logged Today' : `Last Logged, ${logDay(last.logged_on)}`}</span>
      <span class="ex-box-v">${esc(logLine(last))}</span></div>${btn('ex-hist', 'History')}</div>` : ''}`;
  return `<div class="ex-edit" data-ex><div class="ex-top-row"><span class="row">${gripHTML(s, i, e)}<span class="ex-count">Exercise ${e + 1} of ${n}</span></span>
      <button type="button" class="small fill" data-act="close-ex">Done</button></div>
    ${f('name', 'Exercise', 'Exercise/Purpose')}
    <div class="ex-three">${f('sets', 'Sets')}${f('reps', 'Reps/Time')}${f('rest', 'Rest')}</div>
    ${notes}
    ${logBoxes}
    <div class="ex-acts"><span class="row">${e > 0 ? btn('ex-up', 'Move Up') : ''}${e < n - 1 ? btn('ex-down', 'Move Down') : ''}</span>
      <button type="button" class="small ghost danger" data-act="del-ex" data-s="${i}" data-e="${e}">Remove</button></div></div>`;
}

// One session: shown when its tab is picked (data-session, like the student's view; showSession switches them).
// Its head is Week (Week by Week), Session and a ⋯ menu with Move Earlier / Move Later (only where they can go),
// Duplicate Session and Remove Session. Details shows once it has text (or + Add Details is pressed). A session
// with no exercises says so, with a big + Add Exercises (the browser, openExBrowser).
function sessionEditHTML(s, i, shown, first, last) {
  const item = (act, label, cls = '') => `<button type="button" role="menuitem" class="${cls}" data-act="${act}" data-s="${i}">${label}</button>`;
  const exs = s.exercises;
  return `<article class="card session-edit" data-session="${s.id}"${shown ? '' : ' hidden'}>
    <div class="session-head">
      ${planLayout(draft.plan) !== 'weeks' ? '' : `<label class="wk">Week<input type="number" min="1" data-s="${i}" data-f="week" value="${s.week}"></label>`}
      <label class="grow">Session<input class="session-title" data-s="${i}" data-f="title" value="${esc(s.title)}" placeholder="e.g. Session 1/Mondays/Off the Wall Warm Up"></label>
      <div class="sess-more"><button type="button" class="more-btn" data-act="sess-menu" aria-haspopup="menu" aria-expanded="false" aria-label="Session Options">${DOTS}</button>
        <div class="sess-menu" role="menu" aria-label="Session Options" hidden>${first ? '' : item('up', 'Move Earlier')}${last ? '' : item('down', 'Move Later')}${
          item('dup', 'Duplicate Session')}<div class="sep" role="separator"></div>${item('del-session', 'Remove Session', 'danger')}</div></div>
    </div>
    ${s.details || draft.details.has(s.id) ? `<label>Details<textarea data-s="${i}" data-f="details" rows="2" data-grow
      placeholder="Warm-up, focus, how hard to go…">${esc(s.details)}</textarea></label>`
      : `<button type="button" class="add-details" data-act="add-details" data-s="${i}">+ Add Details</button>`}
    ${exs.length ? `<div class="ex-head"><h3>Exercises</h3><span class="hint">Tap one to change it.</span></div>
      <div class="ex-list">${exs.map((x, e) => x === draft.openEx ? exEditHTML(s, i, e) : exRowHTML(s, i, e)).join('')}</div>
      <button type="button" class="add-ex" data-act="browse" data-s="${i}">+ Add Exercises</button>`
    : `<div class="ex-empty"><h3>No Exercises Yet</h3><p class="muted">Pick from your Exercises &amp; Drills, or type a new one.</p>
      <button type="button" class="fill" data-act="browse" data-s="${i}">+ Add Exercises</button></div>`}
    ${draft.savedIds.has(s.id) ? notesHTML(s.id) : ''}
  </article>`;
}
const sessionLabel = (s, k) => s.title.trim() || `Session ${k + 1}`;
function sessionLabelOf(id) {
  const S = draft.sessions, i = S.findIndex(s => s.id === id);
  return i < 0 ? '' : sessionLabel(S[i], displayOrder().filter(j => S[j].week === S[i].week).indexOf(i));
}
// A week's sessions: a tab each (and + Add Session), then the picked one. draft.tab[week] remembers the pick.
function weekSessionsHTML(w, list) {
  const S = draft.sessions, pick = list.some(({ i }) => S[i].id === draft.tab[w]) ? draft.tab[w] : S[list[0]?.i]?.id;
  return `<div class="tabs" role="tablist" aria-label="Sessions" data-week="${w}">${list.map(({ i }, k) =>
      `<button type="button" role="tab" data-tab="${S[i].id}" data-week="${w}" aria-selected="${S[i].id === pick}">${esc(sessionLabel(S[i], k))}</button>`).join('')}
      <button type="button" class="add-tab" data-act="add-session" data-week="${w}"${list.length ? '' : ' data-first data-need="Add at least one session."'}>+ Add Session</button></div>
    ${list.map(({ i }, k) => sessionEditHTML(S[i], i, S[i].id === pick, k === 0, k === list.length - 1)).join('')}`;
}

function renderEditor() {
  const p = draft.plan;
  const order = displayOrder();
  draft.tab ||= {};
  let body;
  if (draft.preview) {
    body = planReadHTML(p, order.map(i => draft.sessions[i]), { notes: false });
  } else {
    const weeks = byWeek(order.map(i => ({ week: draft.sessions[i].week, i })));
    const first = esc(p.student.name.split(' ')[0]), L = planLayout(p);
    const sessionsHTML = L === 'blocks' ? `${p.blocks.map((b, j) => `<section class="week">
      <div class="week-head"><h2>Block ${j + 1} <span class="muted" data-range="${j + 1}">${blockRange(p.start_date, p.blocks, j + 1)}</span></h2>
        ${p.blocks.length > 1 ? `<button type="button" class="small ghost danger" data-act="del-week" data-week="${j + 1}">Remove Block</button>` : ''}</div>
      <div class="row block-fields"><label class="grow">Block Name<input data-b="${j}" data-bf="name" value="${esc(b.name || '')}" maxlength="60" placeholder="e.g. Strength/Power/Deload"></label>
        <label class="wk">Weeks<input type="number" min="1" max="52" data-b="${j}" data-bf="weeks" value="${esc(b.weeks ?? '')}" required data-need="Between 1 and 52 weeks."></label></div>
      ${weekSessionsHTML(j + 1, weeks.find(([w]) => w === j + 1)?.[1] || [])}
    </section>`).join('')}
    <div class="row" style="margin-top:1.4rem"><button data-act="add-block">+ Add Block</button></div>`
    : L === 'weekly' ? `<section class="week">
      <h2>Every Week <span class="muted">Repeat these sessions each week</span></h2>
      ${weeks.length ? '' : '<p class="muted">No sessions yet. Add the first one.</p>'}
      ${weekSessionsHTML(1, weeks[0]?.[1] || [])}
    </section>` : `
    ${weeks.length ? '' : '<p class="muted">No sessions yet. Add the first week below.</p>'}
    ${weeks.map(([w, list]) => `<section class="week">
      <div class="week-head"><h2>Week ${w} <span class="muted">${weekRange(p.start_date, w)}</span></h2>
        <button type="button" class="small ghost danger" data-act="del-week" data-week="${w}">Remove Week</button></div>
      ${weekSessionsHTML(w, list)}
    </section>`).join('')}
    <div class="row" style="margin-top:1.4rem"><button data-act="add-week" data-first data-need="Add at least one week with a session.">+ Add Week</button></div>`;
    body = `<div class="plan-grid">
    <section class="card plan-details"><h2>Plan Details</h2>
      <div class="stack pd-layout" style="gap:.3rem"><div class="seg" role="radiogroup" aria-label="Plan Layout">
        ${[['weekly', 'Repeat Weekly'], ['weeks', 'Week by Week'], ['blocks', 'Training Blocks']].map(([v, label]) =>
          `<label><input type="radio" name="layout" data-p="layout" value="${v}" ${L === v ? 'checked' : ''}>${label}</label>`).join('')}
      </div>
      <p class="hint" style="margin:0">${{ weekly: `One week of sessions ${first} repeats every week.`,
        weeks: 'A different set of sessions for each week, with dates from the start date.',
        blocks: `Blocks of weeks in order (e.g. strength, then power), each with sessions ${first} repeats every week of the block.` }[L]}</p></div>
      <label>Training Plan Title<input data-p="title" value="${esc(p.title)}" placeholder="e.g. Spring Power Block" required data-need="Give the plan a title."></label>
      <label>Start Date<input type="date" data-p="start_date" value="${esc(p.start_date || '')}" required data-need="Pick the day the plan starts."></label>
      <label class="check" title="Shown first to the student; replaces ${pro(p.student.pronouns).their} other current plan"><input type="checkbox" data-p="active" ${p.active ? 'checked' : ''}> Current Plan</label>
      <label class="pd-overview">Overview<textarea data-p="overview" rows="3" data-grow placeholder="What this plan is for, how to warm up, what to track…">${esc(p.overview)}</textarea></label>
    </section>
    <div class="plan-work"><div class="plan-sessions">${sessionsHTML}</div>
      <aside class="card exb-panel" id="exPanel" aria-labelledby="exPanelTitle"><h2 id="exPanelTitle">Exercises &amp; Drills</h2><p class="hint exb-to"></p>${exbShellHTML()}</aside>
    </div></div>
    <div class="danger-zone"><button class="ghost small" data-act="dup-plan">Duplicate Training Plan</button><button class="ghost small" data-act="copy-plan">Copy to Another Student</button><button class="ghost small danger" data-act="del-plan">Delete Plan</button></div>`;
  }

  const panelTop = $('#exPanel .exb-list')?.scrollTop;   // the panel keeps its place through redraws
  view(`${crumbs([['Home', '#/'], ['Students', '#/students'], [p.student.name, '#/student/' + p.student.id], [p.title || 'Untitled Plan']])}
    <div class="page-head"><div><span class="eyebrow">${p.active ? 'Current Plan' : 'Plan'} · ${esc(p.student.name)}</span>
      <h1>${esc(p.title.trim() || 'Untitled Plan')}</h1></div>
    <div class="savebar${dirty ? ' unsaved' : ''}">
      <span id="saveState" class="${dirty ? 'warn' : 'muted'}">${dirty ? 'Unsaved changes' : 'All changes saved'}</span>
      <div class="row"><button data-act="preview">${draft.preview ? 'Back to Editing' : 'Student View'}</button>
      <button class="primary" data-act="save">Save Plan</button></div>
    </div></div>
    ${body}`, { keepScroll: true });
  renderExPanel();
  if (panelTop) $('#exPanel .exb-list').scrollTop = panelTop;

  // In braces: a handler that returns false cancels the press, and fields stop taking clicks.
  app.onpointerdown = draft.preview ? null : e => { dragSort(e, EX_DRAG) || dragSort(e, TAB_DRAG); };
  app.oninput = e => {
    const t = e.target, d = t.dataset;
    if (t.closest('#exPanel')) { exb.q = t.value; renderExPanel(); return; }   // the panel's search
    if (d.p && t.type !== 'checkbox' && t.type !== 'radio') draft.plan[d.p] = t.value;
    else if (d.b != null) {
      // A block's name or length; a new length moves the dates of it and every later block.
      const B = draft.plan.blocks;
      B[+d.b][d.bf] = t.value;
      if (d.bf === 'weeks') app.querySelectorAll('[data-range]').forEach(el => { el.textContent = blockRange(draft.plan.start_date, B, +el.dataset.range); });
    } else if (d.s != null && d.f !== 'week') {
      const s = draft.sessions[+d.s];
      if (d.e == null) s[d.f] = t.value;
      else if (d.f === 'name') setExName(s.exercises[+d.e], t);
      else s.exercises[+d.e][d.f] = t.value;
    } else return;
    markDirty();
  };
  app.onchange = e => {
    const t = e.target, d = t.dataset;
    if (d.p === 'layout') return setLayout(t.value);
    if (d.p === 'active') { draft.plan.active = t.checked; markDirty(); }
    if (d.p === 'start_date') renderEditor();          // week date ranges
    if (d.f === 'week') {
      const [s] = draft.sessions.splice(+d.s, 1);      // goes to the end of its new week
      s.week = Math.max(1, parseInt(t.value, 10) || 1);
      draft.sessions.push(s);
      markDirty(); renderEditor();
    }
  };
  app.onclick = async e => {
    // A session's tab: showSession (student-view.js) switches it; remember the pick for the next redraw.
    if (e.target.closest('#exPanel')) return exPanelClick(e);
    // The panel adds to the session last clicked in (or picked by its tab).
    const tab = e.target.closest('[data-tab][data-week]'), sess = e.target.closest('.session-edit');
    if (tab || sess) { const id = tab ? tab.dataset.tab : sess.dataset.session; if (id !== exb.sid) { exb.sid = id; renderExPanel(); } }
    if (tab) { draft.tab[tab.dataset.week] = tab.dataset.tab; return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const S = draft.sessions, i = +b.dataset.s, x = +b.dataset.e;
    if (b.dataset.act === 'sess-menu') return toggleSessMenu(b);
    closeSessMenus();
    // Opening and closing an exercise, Details and the browser change what's shown, not the plan.
    switch (b.dataset.act) {
      case 'open-ex': case 'close-ex': {
        const was = draft.openEx;
        draft.openEx = b.dataset.act === 'open-ex' ? S[i].exercises[x] : null;
        renderEditor();
        const at = draft.openEx ?? was, sid = S.find(s => s.exercises.includes(at))?.id, list = sid && app.querySelector(`[data-session="${sid}"] .ex-list`);
        const el = list?.children[S.find(s => s.id === sid).exercises.indexOf(at)];
        el?.scrollIntoView({ block: 'nearest' });
        (draft.openEx ? el : el?.querySelector('button'))?.focus({ preventScroll: true });
        return;
      }
      case 'add-details': {
        draft.details.add(S[i].id);
        renderEditor();
        app.querySelector(`[data-session="${S[i].id}"] [data-f="details"]`)?.focus();
        return;
      }
      case 'browse': return openExBrowser(S[i].id);
      case 'ex-hist': return openLogHistory(exKey(S[i].exercises[x].name), { logs: draft.logs, who: draft.plan.student.name });
      case 'ex-track': {
        const ex = S[i].exercises[x];
        const f = await ask({ title: `Log Fields: ${ex.name.trim() || 'Exercise'}`, ok: 'Save',
          body: trackFieldsHTML(trackOf(ex), 'What students fill in when they log this, in this plan only. Exercises & Drills keeps its own. Notes are always there.') });
        if (!f) return;
        ex.track = f.getAll('track');
        markDirty(); renderEditor();
        return;
      }
    }
    const pick = s => { draft.tab[s.week] = s.id; };   // a new or copied session opens on its tab
    let copied = null;
    switch (b.dataset.act) {
      case 'del-ex': S[i].exercises.splice(x, 1); break;
      case 'ex-up': case 'ex-down': {
        const y = x + (b.dataset.act === 'ex-up' ? -1 : 1), list = S[i].exercises;
        if (!list[y]) return;
        [list[x], list[y]] = [list[y], list[x]]; break;
      }
      case 'add-session': { const s = blankSession(+b.dataset.week); S.push(s); pick(s); break; }
      case 'add-week': { const s = blankSession(Math.max(0, ...S.map(s => s.week)) + 1); S.push(s); pick(s); break; }
      case 'add-block': { draft.plan.blocks.push({ name: '', weeks: 4 }); const s = blankSession(draft.plan.blocks.length); S.push(s); pick(s); break; }
      // The copy is named "<name> (Copy)" and its Session title box is scrolled to and focused.
      case 'dup': {
        const k = displayOrder().filter(j => S[j].week === S[i].week).indexOf(i);
        const s = { ...structuredClone(S[i]), id: crypto.randomUUID(), title: `${sessionLabel(S[i], k)} (Copy)` };
        S.splice(i + 1, 0, s); pick(s); copied = s; break;
      }
      case 'del-session': {
        const n = notesCtx.notes.filter(x => x.session_id === S[i].id).length;
        // Week by Week: a week is only its sessions, so the last one takes the week. A block stays (empty until saved).
        const L = planLayout(draft.plan), lastInWeek = L === 'weeks' && !S.some((x, k) => k !== i && x.week === S[i].week);
        const name = S[i].title.trim() ? `“${esc(S[i].title.trim())}”` : 'This session';
        if (!await ask({ title: lastInWeek ? `Remove Week ${S[i].week}?` : 'Remove This Session?', warn: true, ok: 'Remove',
          body: `<p>${lastInWeek ? `${name} is the only session in week ${S[i].week}, so the week will go too.` : `${name} will be removed${L === 'weekly' ? '' : ` from ${L === 'blocks' ? 'block' : 'week'} ${S[i].week}`}.`}</p>
            ${n ? `<p>It has ${n} note${n > 1 ? 's' : ''}, which will be deleted when you save the plan.</p>` : ''}` })) return;
        S.splice(i, 1); break;
      }
      // A whole week (or block) goes, and later ones move up one so the weeks (and their dates) have no gap.
      case 'del-week': {
        const w = +b.dataset.week, gone = S.filter(s => s.week === w), B = draft.plan.blocks;
        const unit = B ? 'Block' : 'Week', them = B ? 'blocks' : 'weeks', what = B ? blockName(B[w - 1], w) : `Week ${w}`;
        const n = notesCtx.notes.filter(x => gone.some(s => s.id === x.session_id)).length;
        if (!await ask({ title: `Remove ${unit} ${w}?`, warn: true, ok: `Remove ${unit}`,
          body: `<p>${esc(what)}${gone.length ? ` and its ${gone.length === 1 ? 'session' : `${gone.length} sessions`}` : ''} will be removed${w < (B ? B.length : Math.max(...S.map(s => s.week))) ? `, and later ${them} move up one` : ''}.</p>
            ${n ? `<p>${n === 1 ? 'One note' : `${n} notes`} on ${gone.length === 1 ? 'it' : 'them'} will be deleted when you save the plan.</p>` : ''}` })) return;
        B?.splice(w - 1, 1);
        draft.sessions = S.filter(s => s.week !== w);
        draft.sessions.forEach(s => { if (s.week > w) s.week--; });
        draft.tab = Object.fromEntries(Object.entries(draft.tab).filter(([k]) => +k !== w).map(([k, id]) => [+k > w ? +k - 1 : +k, id]));
        break;
      }
      case 'up': case 'down': {
        const order = displayOrder(), j = order[order.indexOf(i) + (b.dataset.act === 'up' ? -1 : 1)];
        if (j == null || S[j].week !== S[i].week) return;
        [S[i], S[j]] = [S[j], S[i]]; break;
      }
      case 'preview': draft.preview = !draft.preview; renderEditor(); window.scrollTo(0, 0); return;
      case 'save': return savePlan(b);
      case 'dup-plan': return duplicatePlan(b);
      case 'copy-plan': return copyPlan(b);
      case 'del-plan': return deletePlan(b);
      default: return;
    }
    markDirty();
    renderEditor();
    if (copied) {
      const t = app.querySelector(`[data-session="${copied.id}"] .session-title`);
      t.scrollIntoView({ behavior: 'smooth', block: 'center' });
      t.focus({ preventScroll: true });
      t.select();
    }
  };
}

// A session's ⋯ menu. A click anywhere else or Escape closes it.
function toggleSessMenu(b) {
  const m = b.nextElementSibling, open = m.hidden;
  closeSessMenus();
  m.hidden = !open;
  b.setAttribute('aria-expanded', open);
  if (open) m.querySelector('button').focus();
}
function closeSessMenus() {
  app.querySelectorAll('.sess-menu:not([hidden])').forEach(m => { m.hidden = true; m.previousElementSibling.setAttribute('aria-expanded', 'false'); });
}
document.addEventListener('click', e => { if (!e.target.closest?.('.sess-more')) closeSessMenus(); });
document.addEventListener('keydown', e => {
  const m = e.key === 'Escape' && app.querySelector('.sess-menu:not([hidden])');
  if (m) { closeSessMenus(); m.previousElementSibling.focus(); }
});

// From the exercise browser: adds exercises by name to the end of a session. A master exercise brings its values
// (filledFrom, so its name's values aren't filled in again); a new one opens, with Sets focused, for the coach to fill in.
function addExercises(sid, names) {
  const s = draft.sessions.find(x => x.id === sid);
  if (!s || !names.length) return;
  const from = s.exercises.length;
  let open = null;
  for (const name of names) {
    const m = draft.library.find(y => y.name_key === exKey(name));
    const x = m ? { name: m.name, ...Object.fromEntries(EX_FIELDS.map(([f]) => [f, m[f] ?? ''])), track: [...(m.track ?? [])] } : { ...blankEx(), name };
    if (m) filledFrom.set(x, m.name_key); else open ||= x;
    s.exercises.push(x);
  }
  if (open) draft.openEx = open;
  markDirty();
  renderEditor();
  const list = [...app.querySelectorAll(`[data-session="${sid}"] .ex-list > [data-ex]`)].slice(from);
  list.forEach(el => el.classList.add('just-added'));
  const el = open ? list[s.exercises.slice(from).indexOf(open)] : list.at(-1);
  el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (open) el?.querySelector('[data-f="sets"]')?.focus({ preventScroll: true });
}

// Drag to reorder (drag.js). An exercise (row or open card) moves by its grip within its own session.
const EX_DRAG = {
  handle: '.ex-list .grip', item: h => h.closest('[data-ex]'), lists: el => [el.parentNode], items: '[data-ex]', axis: 'y',
  drop(el, list, index) {
    const g = el.querySelector('.grip'), all = draft.sessions[+g.dataset.s].exercises, from = +g.dataset.e;
    if (from === index) return;
    all.splice(index, 0, ...all.splice(from, 1));
    markDirty(); renderEditor();
  },
};
// A session moves by its tab (hold it first on a touch screen), within its week or into another week's tabs.
const TAB_DRAG = {
  handle: '.plan-sessions [data-tab]', hold: true, item: h => h, axis: 'x',
  lists: () => [...app.querySelectorAll('.plan-sessions .tabs')], zone: l => l.closest('.week'),
  items: '[data-tab]', end: l => l.querySelector('.add-tab'),
  drop: (el, list, index) => moveSession(el.dataset.tab, +list.dataset.week, index),
};

// Puts a session at index k among the week's sessions, changing its week if it's another one. It stays the picked tab.
function moveSession(id, week, k) {
  const S = draft.sessions, from = S.findIndex(s => s.id === id), s = S[from];
  const inWeek = w => displayOrder().filter(j => S[j].week === w);
  if (s.week === week && inWeek(week).indexOf(from) === k) return;
  S.splice(from, 1);
  const list = inWeek(week);
  S.splice(k < list.length ? list[k] : list.length ? list.at(-1) + 1 : S.length, 0, s);
  s.week = week;
  draft.tab[week] = id;
  markDirty(); renderEditor();
}

// Switching layouts. Repeat Weekly keeps one week (or block): the first one's sessions become week 1, and the
// rest are removed from the draft (for good once the plan is saved). Week by Week and Training Blocks trade
// week n for block n; a block's name and length are kept in the draft in case the coach switches back.
async function setLayout(to) {
  const p = draft.plan, from = planLayout(p), S = draft.sessions;
  if (to === from) return;
  if (to === 'weekly') {
    const first = Math.min(...S.map(s => s.week));
    const later = S.filter(s => s.week !== first);
    if (later.length) {
      const unit = from === 'blocks' ? 'block' : 'week', count = new Set(later.map(s => s.week)).size;
      const n = notesCtx.notes.filter(x => later.some(s => s.id === x.session_id)).length;
      if (!await ask({ title: 'Switch to Repeat Weekly?', warn: true, ok: 'Switch',
        body: `<p>Repeat Weekly keeps only one week. ${from === 'blocks' ? esc(blockName(p.blocks[first - 1], first)) : `Week ${first}`} stays, and ${count === 1 ? `the other ${unit}` : `the other ${count} ${unit}s`}
          (${later.length} session${later.length > 1 ? 's' : ''}) will be removed.</p>
          ${n ? `<p>${n === 1 ? 'One note' : `${n} notes`} on those sessions will be deleted when you save the plan.</p>` : ''}` })) {
        renderEditor(); return;
      }
      draft.sessions = S.filter(s => s.week === first);
    }
    draft.sessions.forEach(s => { s.week = 1; });
  }
  if (from === 'blocks') draft.oldBlocks = p.blocks;
  if (to === 'blocks') {
    // Weeks 1, 2, ... in order with no gaps, then a block for each (one week long from Week by Week, four from Repeat Weekly).
    const ws = [...new Set(S.map(s => s.week))].sort((a, b) => a - b);
    S.forEach(s => { s.week = ws.indexOf(s.week) + 1; });
    draft.tab = {};
    p.blocks = (ws.length ? ws : [1]).map((_, j) => draft.oldBlocks?.[j] || { name: '', weeks: from === 'weeks' ? 1 : 4 });
  } else p.blocks = null;
  p.repeats = to === 'weekly';
  markDirty();
  renderEditor();
}

// Which master exercise each plan exercise's values came from (by name_key). An exercise
// starts as its own name's, so fixing a typo or retyping the name keeps the coach's values.
const filledFrom = new WeakMap();

// Typing or picking a master exercise's name fills in its values; the coach can change them after.
function setExName(x, input) {
  if (!filledFrom.has(x)) filledFrom.set(x, exKey(x.name));
  x.name = input.value;
  const m = draft.library.find(y => y.name_key === exKey(x.name));
  if (!m || filledFrom.get(x) === m.name_key) return;
  filledFrom.set(x, m.name_key);
  const row = input.closest('.ex-edit');
  for (const [f] of EX_FIELDS) row.querySelector(`[data-f="${f}"]`).value = x[f] = m[f];
  x.track = [...(m.track ?? [])];
  const v = row.querySelector('.ex-box-v');
  if (v) v.textContent = trackNames(trackOf(x));
  row.querySelectorAll('textarea').forEach(grow);
}

function sessionRows(planId) {
  return displayOrder().map((i, position) => {
    const s = draft.sessions[i];
    return {
      id: s.id, plan_id: planId, week: s.week, position,
      title: s.title.trim(), details: s.details.trim(),
      exercises: s.exercises.filter(x => Object.values(x).some(v => String(v).trim())),
    };
  });
}

function savePlan(btn) {
  const p = draft.plan, B = p.blocks;
  // Training Blocks: every block needs a length (1 to 52 weeks) and at least one session.
  const okWeeks = b => /^\d+$/.test(String(b.weeks ?? '').trim()) && +b.weeks >= 1 && +b.weeks <= 52;
  const missing = [!p.title.trim() && '[data-p="title"]', !p.start_date && '[data-p="start_date"]',
    ...(B ? B.flatMap((b, j) => [!okWeeks(b) && `[data-b="${j}"][data-bf="weeks"]`,
      !draft.sessions.some(s => s.week === j + 1) && `[data-act="add-session"][data-week="${j + 1}"]`])
      : [!draft.sessions.length && '[data-first]'])].filter(Boolean);
  if (missing.length) {
    if (draft.preview) { draft.preview = false; renderEditor(); }
    const els = missing.map(sel => $(sel));
    els.forEach(el => fieldError(el, el.dataset.need));
    els[0].focus();
    return;
  }
  if (B) p.blocks = B.map(b => ({ name: (b.name || '').trim(), weeks: +b.weeks }));
  return busy(btn, async () => {
    const rows = sessionRows(p.id);
    // The database turns the student's other current plan into a past plan; name it in the message.
    const closed = p.active ? await sb.from('plans').select('title')
      .eq('student_id', p.student.id).eq('active', true).neq('id', p.id).then(must) : [];
    must(await sb.from('plans').update({
      title: p.title.trim(), overview: p.overview.trim(), start_date: p.start_date || null,
      repeats: p.repeats, blocks: p.blocks, active: p.active, updated_at: new Date().toISOString(),
    }).eq('id', p.id));
    if (rows.length) must(await sb.from('sessions').upsert(rows));
    const gone = [...draft.savedIds].filter(id => !rows.some(r => r.id === id));
    if (gone.length) must(await sb.from('sessions').delete().in('id', gone));
    draft.sessions = rows;
    draft.savedIds = new Set(rows.map(r => r.id));
    notesCtx.notes = notesCtx.notes.filter(n => draft.savedIds.has(n.session_id));
    dirty = false;
    renderEditor();
    const msg = closed.length ? `Plan saved. “${closed[0].title}” is now a past plan.` : 'Plan saved.';
    // The plan is saved even if this fails; the next save tries again.
    const added = await addToMasterList(rows).catch(e => { flash(`${msg} Couldn't add new exercises to the master list: ${msgOf(e)}`, 'error'); });
    if (added != null) flash(added ? `${msg} ${added === 1 ? '1 new exercise' : `${added} new exercises`} added to the master list.` : msg);
  });
}

// A copy of the saved plan for the same student: sessions and exercises, not notes. It's current
// only if the student has no current plan (like a new plan), and opens in the editor.
// Unsaved changes (or a plan never saved): say to save first, so a copy has them. True when it's saved.
async function savedFirst() {
  if (!dirty && draft.savedIds.size) return true;
  await ask({ title: 'Save the Plan First', cancel: false,
    body: `<p>${draft.savedIds.size ? 'Save your changes first, so the copy has them.' : 'Save the plan first, then you can make a copy of it.'}</p>` });
  return false;
}

async function duplicatePlan(btn) {
  const p = draft.plan;
  if (!await savedFirst()) return;
  const title = `${p.title.trim()} (Copy)`;
  if (!await ask({ title: 'Duplicate This Plan?', ok: 'Duplicate',
    body: `<p>“${esc(title)}” will be added to ${esc(p.student.name)}'s plans with the same sessions and exercises (not the notes), and opened for you to edit.</p>` })) return;
  busy(btn, async () => {
    const current = p.active || (await sb.from('plans').select('id').eq('student_id', p.student.id).eq('active', true).then(must)).length > 0;
    const copy = must(await sb.from('plans').insert({ student_id: p.student.id, title, overview: p.overview.trim(),
      start_date: p.start_date || null, repeats: p.repeats, blocks: p.blocks, active: !current }).select('id').single());
    const rows = sessionRows(copy.id).map(r => ({ ...r, id: crypto.randomUUID() }));
    if (rows.length) must(await sb.from('sessions').insert(rows));
    flash(`Plan duplicated. You're now editing “${title}”.`);
    goTo('#/plan/' + copy.id);
  });
}

// A copy of the saved plan for another of your active students: sessions and exercises, not the notes or the
// start date (their plan starts when theirs does). Current only if they have no current plan; opens in the editor.
async function copyPlan(btn) {
  const p = draft.plan;
  if (!await savedFirst()) return;
  const all = await sb.from('students').select('id,name,email,coach_id,training_ended_at').is('training_ended_at', null).order('name')
    .then(must).catch(e => { flash(msgOf(e), 'error'); });
  if (!all) return;
  const list = all.filter(s => s.id !== p.student.id && canCoach(s));
  if (!list.length) {
    await ask({ title: 'No Other Students', cancel: false, body: '<p>You have no other active students to copy this plan to.</p>' });
    return;
  }
  const f = await ask({ title: 'Copy to Another Student', ok: 'Copy Plan',
    body: `<p>“${esc(p.title.trim())}” will be added to their plans with the same sessions and exercises (not the notes or the start date), and opened for you to edit.</p>
      <label>Student<select name="to" required data-need="Pick a student."><option value="">Pick a student…</option>
        ${list.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>` });
  const to = f && list.find(s => s.id === f.get('to'));
  if (!to) return;
  busy(btn, async () => {
    const current = (await sb.from('plans').select('id').eq('student_id', to.id).eq('active', true).then(must)).length > 0;
    const copy = must(await sb.from('plans').insert({ student_id: to.id, title: p.title.trim(), overview: p.overview.trim(),
      repeats: p.repeats, blocks: p.blocks, active: !current }).select('id').single());
    const rows = sessionRows(copy.id).map(r => ({ ...r, id: crypto.randomUUID() }));
    if (rows.length) must(await sb.from('sessions').insert(rows));
    flash(`Plan copied to ${to.name}. Pick a start date, then save it.`);
    goTo('#/plan/' + copy.id);
  });
}

async function deletePlan(btn) {
  const p = draft.plan;
  if (!await ask({ title: 'Delete This Plan?', warn: true, ok: 'Delete Plan',
    body: `<p>“${esc(p.title || 'Untitled Plan')}” and all its notes will be deleted for good.</p>` })) return;
  busy(btn, async () => {
    must(await sb.from('plans').delete().eq('id', p.id));
    flash('Plan deleted.');
    goTo('#/student/' + p.student.id);
  });
}
