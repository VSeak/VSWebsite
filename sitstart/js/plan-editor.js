// ---------- Coach: plan editor ----------

const blankEx = () => ({ name: '', sets: '', reps: '', rest: '', notes: '' });
const blankSession = week => ({ id: crypto.randomUUID(), week, title: '', details: '', exercises: [blankEx()] });

// sid: a session to open at, from a student note in a feed (openNotes).
async function adminPlan(id, sid) {
  const t = ++navToken;
  view(loading);
  const [plan, sessions, library] = await Promise.all([
    sb.from('plans').select('*, student:students(id,name,pronouns,email,coach_id)').eq('id', id).maybeSingle().then(must),
    sb.from('sessions').select('*').eq('plan_id', id).order('week').order('position').then(must),
    sb.from('exercises').select('*').then(must),
  ]);
  if (t !== navToken) return;
  if (!plan) { location.hash = '#/'; return; }
  // Your own plan: as your students see theirs.
  if (isSelf(plan.student)) return studentPlan(id);
  const notes = sessions.length
    ? await sb.from('notes').select('*').in('session_id', sessions.map(s => s.id)).order('created_at').then(must) : [];
  if (t !== navToken) return;
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

  // library: the master exercise list, for the Exercise picker.
  draft = { plan, sessions, library, savedIds: new Set(sessions.map(s => s.id)), preview: false };
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

function sessionEditHTML(s, i) {
  const f = (field, label, e, ph = label) => `<input data-s="${i}"${e != null ? ` data-e="${e}"` : ''} data-f="${field}" placeholder="${ph}" aria-label="${label}"
    ${field === 'name' && e != null ? 'data-combo role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="exMenu" maxlength="200" autocomplete="off"' : ''}
    value="${esc(e != null ? s.exercises[e][field] : s[field])}">`;
  return `<article class="card session-edit">
    <div class="row">
      ${draft.plan.repeats ? '' : `<label class="wk">Week<input type="number" min="1" data-s="${i}" data-f="week" value="${s.week}"></label>`}
      <label class="grow">Session<input data-s="${i}" data-f="title" value="${esc(s.title)}" placeholder="e.g. Session 1/Mondays/Off the Wall Warm Up"></label>
    </div>
    <label style="margin-top:.6rem">Details<textarea data-s="${i}" data-f="details" rows="2"
      placeholder="Warm-up, focus, how hard to go…">${esc(s.details)}</textarea></label>
    ${s.exercises.length ? '<div class="ex-head"><span>Exercise</span><span>Sets</span><span>Reps/Time</span><span>Rest</span><span>Notes</span><span></span></div>' : ''}
    ${s.exercises.map((_, e) => `<div class="ex-row">${f('name', 'Exercise', e, 'Exercise/Purpose')}${f('sets', 'Sets', e)}${f('reps', 'Reps/Time', e)}${f('rest', 'Rest', e)}${f('notes', 'Notes', e)}
      <button class="icon ghost" data-act="del-ex" data-s="${i}" data-e="${e}" title="Remove exercise" aria-label="Remove exercise">×</button></div>`).join('')}
    <div class="row between" style="margin-top:.7rem">
      <button class="ghost small" data-act="add-ex" data-s="${i}">+ Add Exercise</button>
      <div class="row">
        <button class="icon ghost" data-act="up" data-s="${i}" title="Move up" aria-label="Move up">↑</button>
        <button class="icon ghost" data-act="down" data-s="${i}" title="Move down" aria-label="Move down">↓</button>
        <button class="ghost small" data-act="dup" data-s="${i}">Duplicate</button>
        <button class="ghost small danger" data-act="del-session" data-s="${i}">Remove</button>
      </div>
    </div>
    ${draft.savedIds.has(s.id) ? notesHTML(s.id) : ''}
  </article>`;
}

function renderEditor() {
  const p = draft.plan;
  const order = displayOrder();
  let body;
  if (draft.preview) {
    body = planReadHTML(p, order.map(i => draft.sessions[i]), { notes: false });
  } else {
    const weeks = byWeek(order.map(i => ({ week: draft.sessions[i].week, i })));
    const sessionsHTML = p.repeats ? `<section class="week">
      <h2>Every Week <span class="muted">Repeat these sessions each week</span></h2>
      ${weeks.length ? '' : '<p class="muted">No sessions yet. Add the first one below.</p>'}
      ${order.map(i => sessionEditHTML(draft.sessions[i], i)).join('')}
      <button class="ghost" style="margin-top:.8rem" data-act="add-session" data-week="1" data-first data-need="Add at least one session.">+ Add Session</button>
    </section>` : `
    ${weeks.length ? '' : '<p class="muted" style="margin-top:1rem">No sessions yet. Add the first week below.</p>'}
    ${weeks.map(([w, list]) => `<section class="week">
      <h2>Week ${w} <span class="muted">${weekRange(p.start_date, w)}</span></h2>
      ${list.map(({ i }) => sessionEditHTML(draft.sessions[i], i)).join('')}
      <button class="ghost" style="margin-top:.8rem" data-act="add-session" data-week="${w}">+ Add Session to Week ${w}</button>
    </section>`).join('')}
    <div class="row" style="margin-top:1.4rem"><button data-act="add-week" data-first data-need="Add at least one week with a session.">+ Add Week</button></div>`;
    body = `<section class="card stack">
      <div class="stack" style="gap:.3rem"><div class="seg" role="radiogroup" aria-label="Plan Layout">
        <label><input type="radio" name="layout" data-p="repeats" value="1" ${p.repeats ? 'checked' : ''}>Repeat Weekly</label>
        <label><input type="radio" name="layout" data-p="repeats" value="0" ${p.repeats ? '' : 'checked'}>Week by Week</label>
      </div>
      <p class="hint" style="margin:0">${p.repeats ? 'One week of sessions the student repeats every week.' : 'A different set of sessions for each week, with dates from the start date.'}</p></div>
      <label>Training Plan Title<input data-p="title" value="${esc(p.title)}" placeholder="e.g. Spring Power Block" required data-need="Give the plan a title."></label>
      <div class="row">
        <div><label>Start Date<input type="date" data-p="start_date" value="${esc(p.start_date || '')}" required data-need="Pick the day the plan starts."></label></div>
        <label class="check" style="margin-top:1.2rem"><input type="checkbox" data-p="active" ${p.active ? 'checked' : ''}> Current Plan (shown first to the student; replaces ${pro(p.student.pronouns).their} other current plan)</label>
      </div>
      <label>Overview<textarea data-p="overview" rows="3" placeholder="What this plan is for, how to warm up, what to track…">${esc(p.overview)}</textarea></label>
    </section>
    ${sessionsHTML}
    <div class="danger-zone"><button class="ghost small" data-act="dup-plan">Duplicate Training Plan</button><button class="ghost small danger" data-act="del-plan">Delete Plan</button></div>`;
  }

  view(`${crumbs([['Home', '#/'], ['Students', '#/students'], [p.student.name, '#/student/' + p.student.id], [p.title || 'Untitled Plan']])}
    <div class="card savebar${dirty ? ' unsaved' : ''}">
      <span id="saveState" class="${dirty ? 'warn' : 'muted'}">${dirty ? 'Unsaved changes' : 'All changes saved'}</span>
      <div class="row"><button data-act="preview">${draft.preview ? 'Back to Editing' : 'Student View'}</button>
      <button class="primary" data-act="save">Save Plan</button></div>
    </div>
    ${body}`, { keepScroll: true });

  app.oninput = e => {
    const t = e.target, d = t.dataset;
    if (d.p && t.type !== 'checkbox' && t.type !== 'radio') draft.plan[d.p] = t.value;
    else if (d.s != null && d.f !== 'week') {
      const s = draft.sessions[+d.s];
      if (d.e == null) s[d.f] = t.value;
      else if (d.f === 'name') setExName(s.exercises[+d.e], t);
      else s.exercises[+d.e][d.f] = t.value;
    } else return;
    markDirty();
  };
  app.onchange = e => {
    const t = e.target, d = t.dataset;
    if (d.p === 'repeats') return setRepeats(t.value === '1');
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
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const S = draft.sessions, i = +b.dataset.s;
    switch (b.dataset.act) {
      case 'add-ex': S[i].exercises.push(blankEx()); break;
      case 'del-ex': S[i].exercises.splice(+b.dataset.e, 1); break;
      case 'add-session': S.push(blankSession(+b.dataset.week)); break;
      case 'add-week': S.push(blankSession(Math.max(0, ...S.map(s => s.week)) + 1)); break;
      case 'dup': S.splice(i + 1, 0, { ...structuredClone(S[i]), id: crypto.randomUUID() }); break;
      case 'del-session': {
        const n = notesCtx.notes.filter(x => x.session_id === S[i].id).length;
        const lastInWeek = !draft.plan.repeats && !S.some((x, k) => k !== i && x.week === S[i].week);
        const name = S[i].title.trim() ? `“${esc(S[i].title.trim())}”` : 'This session';
        if (!await ask({ title: lastInWeek ? `Remove Week ${S[i].week}?` : 'Remove This Session?', warn: true, ok: 'Remove',
          body: `<p>${lastInWeek ? `${name} is the only session in week ${S[i].week}, so the week will go too.` : `${name} will be removed${draft.plan.repeats ? '' : ` from week ${S[i].week}`}.`}</p>
            ${n ? `<p>It has ${n} note${n > 1 ? 's' : ''}, which will be deleted when you save the plan.</p>` : ''}` })) return;
        S.splice(i, 1); break;
      }
      case 'up': case 'down': {
        const order = displayOrder(), j = order[order.indexOf(i) + (b.dataset.act === 'up' ? -1 : 1)];
        if (j == null || S[j].week !== S[i].week) return;
        [S[i], S[j]] = [S[j], S[i]]; break;
      }
      case 'preview': draft.preview = !draft.preview; renderEditor(); window.scrollTo(0, 0); return;
      case 'save': return savePlan(b);
      case 'dup-plan': return duplicatePlan(b);
      case 'del-plan': return deletePlan(b);
      default: return;
    }
    markDirty();
    renderEditor();
  };
}

// Repeat Weekly keeps one week: the first week's sessions become week 1, and any later
// weeks are removed from the draft (for good once the plan is saved).
async function setRepeats(on) {
  const S = draft.sessions;
  if (on) {
    const first = Math.min(...S.map(s => s.week));
    const later = S.filter(s => s.week !== first);
    if (later.length) {
      const weeks = new Set(later.map(s => s.week)).size;
      const n = notesCtx.notes.filter(x => later.some(s => s.id === x.session_id)).length;
      if (!await ask({ title: 'Switch to Repeat Weekly?', warn: true, ok: 'Switch',
        body: `<p>Repeat Weekly keeps only one week. Week ${first} stays, and ${weeks === 1 ? 'the other week' : `the other ${weeks} weeks`}
          (${later.length} session${later.length > 1 ? 's' : ''}) will be removed.</p>
          ${n ? `<p>${n === 1 ? 'One note' : `${n} notes`} on those sessions will be deleted when you save the plan.</p>` : ''}` })) {
        renderEditor(); return;
      }
      draft.sessions = S.filter(s => s.week === first);
    }
    draft.sessions.forEach(s => { s.week = 1; });
  }
  draft.plan.repeats = on;
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
  const row = input.closest('.ex-row');
  for (const [f] of EX_FIELDS) row.querySelector(`[data-f="${f}"]`).value = x[f] = m[f];
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
  const p = draft.plan;
  const missing = [!p.title.trim() && '[data-p="title"]', !p.start_date && '[data-p="start_date"]',
    !draft.sessions.length && '[data-first]'].filter(Boolean);
  if (missing.length) {
    if (draft.preview) { draft.preview = false; renderEditor(); }
    const els = missing.map(sel => $(sel));
    els.forEach(el => fieldError(el, el.dataset.need));
    els[0].focus();
    return;
  }
  return busy(btn, async () => {
    const rows = sessionRows(p.id);
    // The database turns the student's other current plan into a past plan; name it in the message.
    const closed = p.active ? await sb.from('plans').select('title')
      .eq('student_id', p.student.id).eq('active', true).neq('id', p.id).then(must) : [];
    must(await sb.from('plans').update({
      title: p.title.trim(), overview: p.overview.trim(), start_date: p.start_date || null,
      repeats: p.repeats, active: p.active, updated_at: new Date().toISOString(),
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
async function duplicatePlan(btn) {
  const p = draft.plan;
  if (dirty || !draft.savedIds.size) {
    await ask({ title: 'Save the Plan First', cancel: false,
      body: `<p>${draft.savedIds.size ? 'Save your changes first, so the copy has them.' : 'Save the plan first, then you can make a copy of it.'}</p>` });
    return;
  }
  const title = `${p.title.trim()} (Copy)`;
  if (!await ask({ title: 'Duplicate This Plan?', ok: 'Duplicate',
    body: `<p>“${esc(title)}” will be added to ${esc(p.student.name)}'s plans with the same sessions and exercises (not the notes), and opened for you to edit.</p>` })) return;
  busy(btn, async () => {
    const current = p.active || (await sb.from('plans').select('id').eq('student_id', p.student.id).eq('active', true).then(must)).length > 0;
    const copy = must(await sb.from('plans').insert({ student_id: p.student.id, title, overview: p.overview.trim(),
      start_date: p.start_date || null, repeats: p.repeats, active: !current }).select('id').single());
    const rows = sessionRows(copy.id).map(r => ({ ...r, id: crypto.randomUUID() }));
    if (rows.length) must(await sb.from('sessions').insert(rows));
    flash(`Plan duplicated. You're now editing “${title}”.`);
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
