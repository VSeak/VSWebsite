// ---------- Practices: #/practices, #/practice/<id>, #/practice/<id>/edit, #/practice/new ----------
// Practice plans every coach shares, wherever they coach (like Sit Start's Exercises & Drills). A practice is a name,
// a summary, the Areas it works on and timed blocks [{id, title, minutes, notes}], every block field optional. A practice
// on the calendar can link to one (team_events.practice_id).

let practiceSearch = '';
let practiceAreas = [];        // the list's Focus Area pills: area ids picked (a practice shows if it has any of them)
let practiceSort = 'name';     // the list's Sort: a key of PRACTICE_SORTS
const PRACTICE_SORTS = { name: 'Name', recent: 'Recently Used', longest: 'Longest First', shortest: 'Shortest First' };
const PRACTICE_MAX_BLOCKS = 40;

const blockMinutes = b => b.blocks.reduce((n, x) => n + (+x.minutes || 0), 0);
const fmtMinutes = n => n < 60 ? `${n} min` : `${Math.floor(n / 60)} h${n % 60 ? ` ${n % 60} min` : ''}`;
const practiceMeta = p => [blockMinutes(p) ? fmtMinutes(blockMinutes(p)) : '',
  p.blocks.length ? `${p.blocks.length} ${p.blocks.length === 1 ? 'block' : 'blocks'}` : 'No blocks yet'].filter(Boolean).join(' · ');
const practiceAreaChips = (p, areas) => byGroup(areas).filter(a => p.area_ids.includes(a.id))
  .map(a => `<span class="chip">${esc(a.name)}</span>`).join('');
const loadAreas = () => sb.from('team_rating_areas').select('id, name, area_group, active').order('position').then(must);

// Delete, after asking (from the list, the practice or the editor); then() runs once it's gone.
async function deletePractice(p, then) {
  if (!await confirmDelete(`Delete ${p.name}?`, 'It will be gone for every coach, and calendar events that use it will no longer link to it.')) return;
  busy(null, async () => { await sb.from('team_practices').delete().eq('id', p.id).then(must); flash('Practice deleted.'); then(); });
}

async function practicesPage() {
  const t = ++navToken;
  view(loading);
  const [list, areas, uses, locs] = await Promise.all([
    sb.from('team_practices').select('id, name, summary, area_ids, blocks').order('name').then(must),
    loadAreas(),
    sb.from('team_events').select('practice_id, event_date, location_ids').not('practice_id', 'is', null).then(must),
    sb.from('team_locations').select('id, name, short_name, position').order('position').then(must),
  ]);
  if (t !== navToken) return;
  // When and where each was last used and is next on the calendar (only the events this coach can see).
  // Where: the event's locations in Home's order, none for an Every Location event; events on the same day are merged.
  const now = today();
  const useAt = (evs, d) => {
    const ids = evs.filter(e => e.event_date === d).flatMap(e => e.location_ids || []);
    return locs.filter(l => ids.includes(l.id)).map(locShort).join(' + ');
  };
  list.forEach(p => {
    const evs = uses.filter(u => u.practice_id === p.id), ds = evs.map(u => u.event_date);
    p.last = ds.filter(d => d < now).sort().pop() || '';
    p.next = ds.filter(d => d >= now).sort()[0] || '';
    p.lastAt = p.last ? useAt(evs, p.last) : '';
    p.nextAt = p.next ? useAt(evs, p.next) : '';
  });
  const useDate = (d, at) => (d === now ? 'Today' : d.slice(0, 4) === now.slice(0, 4) ? fmtShort(d) : fmtDate(d)) + (at ? ` at ${esc(at)}` : '');
  const useLine = p => [p.last ? `Last used ${useDate(p.last, p.lastAt)}` : 'Not used yet', p.next ? `Next: ${useDate(p.next, p.nextAt)}` : ''].filter(Boolean).join(' · ');
  const used = byGroup(areas).map(a => [a, list.filter(p => p.area_ids.includes(a.id)).length]).filter(([, n]) => n);
  practiceAreas = practiceAreas.filter(id => used.some(([a]) => a.id === id));
  // The name is the link, stretched over the card (.practice-go::after), so Delete can sit inside it.
  const card = p => `<article class="card practice" data-id="${p.id}" data-area="${p.area_ids.join(' ')}" data-find="${esc((p.name + ' ' + p.summary).toLowerCase())}">
    <div class="row between"><h2><a class="practice-go" href="#/practice/${p.id}">${esc(p.name)}</a></h2>${ICON_ARROW}</div>
    <p class="muted small-text">${practiceMeta(p)}</p>
    <p class="muted small-text practice-used">${useLine(p)}</p>
    ${p.summary ? `<p class="practice-sum">${esc(p.summary)}</p>` : ''}
    <div class="row between practice-foot"><span class="chips">${practiceAreaChips(p, areas)}</span>
      <button type="button" class="small ghost danger" data-del="${p.id}">Delete</button></div></article>`;
  view(`${crumbs([['Home', '#/'], ['Practices']])}
    <div class="page-head"><div><h1 class="big">Practices</h1>
      <p class="muted">List of practices to use for team practice. Feel free to create a new practice if it doesn't exist yet!</p></div>
      <a class="button fill" href="#/practice/new">+ New Practice</a></div>
    ${list.length ? `<div class="prac-tools">
      <input type="search" id="pracSearch" class="search" placeholder="Search practices" value="${esc(practiceSearch)}" aria-label="Search practices">
      <select id="pracSort" class="team-filter" aria-label="Sort practices">${Object.entries(PRACTICE_SORTS).map(([k, l]) =>
        `<option value="${k}"${k === practiceSort ? ' selected' : ''}>Sort: ${l}</option>`).join('')}</select>
      ${used.length ? `<div class="chips prac-areas" id="pracAreas" role="group" aria-label="Filter by focus area">
        ${used.map(([a, n]) => `<label class="chip-check"><input type="checkbox" value="${a.id}"${practiceAreas.includes(a.id) ? ' checked' : ''}><span>${esc(a.name)} (${n})</span></label>`).join('')}
        <button type="button" class="small ghost" id="pracClear"${practiceAreas.length ? '' : ' hidden'}>Clear</button></div>` : ''}
    </div>
    <div class="practices" id="practices">${list.map(card).join('')}</div>
    <p class="muted" id="noMatch" hidden>No practices match.</p>`
    : `<section class="card empty"><h2>No Practices Yet</h2><p class="muted">Add the first practice plan. Every coach will see it.</p></section>`}`);

  const filter = () => {
    const q = practiceSearch.trim().toLowerCase();
    let n = 0;
    app.querySelectorAll('#practices .practice').forEach(p => {
      const has = p.dataset.area.split(' ');
      p.hidden = (!!q && !p.dataset.find.includes(q)) || (practiceAreas.length > 0 && !practiceAreas.some(id => has.includes(id)));
      n += !p.hidden;
    });
    $('#noMatch').hidden = !!n;
    if ($('#pracClear')) $('#pracClear').hidden = !practiceAreas.length;
  };
  // Recently Used: last used first, then the ones only coming up, then never used; ties by name.
  const byName = (a, b) => a.name.localeCompare(b.name);
  const sorts = {
    name: byName,
    recent: (a, b) => (b.last || '').localeCompare(a.last || '') || (!a.next - !b.next) || byName(a, b),
    longest: (a, b) => blockMinutes(b) - blockMinutes(a) || byName(a, b),
    shortest: (a, b) => (blockMinutes(a) || Infinity) - (blockMinutes(b) || Infinity) || byName(a, b),
  };
  const sort = () => {
    const box = $('#practices');
    [...list].sort(sorts[practiceSort] || byName).forEach(p => box.append(box.querySelector(`[data-id="${p.id}"]`)));
  };
  if (!list.length) return;
  sort();
  filter();
  $('#pracSearch').addEventListener('input', e => { practiceSearch = e.target.value; filter(); });
  $('#pracSort').addEventListener('change', e => { practiceSort = e.target.value; sort(); });
  $('#pracAreas')?.addEventListener('change', () => {
    practiceAreas = [...app.querySelectorAll('#pracAreas input:checked')].map(i => i.value); filter();
  });
  $('#pracClear')?.addEventListener('click', () => {
    app.querySelectorAll('#pracAreas input').forEach(i => { i.checked = false; }); practiceAreas = []; filter();
  });
  app.onclick = e => {
    const del = e.target.closest('[data-del]');
    if (del) deletePractice(list.find(p => p.id === del.dataset.del), () => redraw());
  };
}

async function practicePage(id, sub) {
  if (id === 'new') return practiceEditor(null);
  const t = ++navToken;
  view(loading);
  const [p, areas, events] = await Promise.all([
    sb.from('team_practices').select('*').eq('id', id).maybeSingle().then(must),
    loadAreas(),
    sb.from('team_events').select('event_date, start_time').eq('practice_id', id).gte('event_date', today()).order('event_date').limit(4).then(must),
  ]);
  if (t !== navToken) return;
  if (!p) return view(`${crumbs([['Home', '#/'], ['Practices', '#/practices']])}<section class="card empty"><h2>Practice Not Found</h2>
    <p class="muted">It may have been deleted.</p></section>`);
  if (sub === 'edit') return practiceEditor(p, areas);

  view(`${crumbs([['Home', '#/'], ['Practices', '#/practices'], [p.name]])}
    <div class="page-head"><div><h1 class="big">${esc(p.name)}</h1><p class="muted">${practiceMeta(p)}</p></div>
      <div class="row"><button type="button" class="ghost danger" id="delPractice">Delete</button><button type="button" id="dupPractice">Duplicate</button><a class="button" href="#/practice/${p.id}/edit">Edit</a></div></div>
    <div class="practice-layout">
      <section class="card">
        <h2>Plan</h2>
        ${p.blocks.length ? `<ol class="blocks">${practiceBlocksHTML(p)}</ol>`
          : `<p class="muted">No blocks yet. <a href="#/practice/${p.id}/edit">Add some</a>.</p>`}
      </section>
      <aside class="side">
        ${p.summary || p.area_ids.length ? `<section class="card"><h2>About</h2>${practiceAboutHTML(p, areas)}</section>` : ''}
        ${events.length ? `<section class="card"><h2>On the Calendar</h2>${events.map(e =>
          `<p class="cal-use">${dayBlock(e.event_date)}<span>${fmtDay(e.event_date)}${e.start_time ? ' · ' + fmtTime(e.start_time) : ''}</span></p>`).join('')}</section>` : ''}
        <p class="hint">${practiceByline(p)}</p>
      </aside>
    </div>`);
  $('#delPractice').onclick = () => deletePractice(p, () => goTo('#/practices'));
  // Duplicate: a copy named "<name> (Copy)", signed by whoever made it, opened in the editor to rename and change.
  $('#dupPractice').onclick = e => busy(e.currentTarget, async () => {
    const copy = await sb.from('team_practices').insert({ name: `${p.name} (Copy)`.slice(0, 120), summary: p.summary, area_ids: p.area_ids,
      blocks: p.blocks.map(b => ({ ...b, id: crypto.randomUUID() })) }).select('id').single().then(must);
    flash('Copy made. Rename it and change what you like.');
    goTo(`#/practice/${copy.id}/edit`);
  });
}

// Each block with how long it takes (no clock times: the user wants lengths only). The page and the pop-up share these.
const practiceBlocksHTML = p => p.blocks.map(b => `<li class="block-view"><div class="block-when">${+b.minutes ? `<b>${fmtMinutes(+b.minutes)}</b>` : ''}</div>
  <div class="block-what"><h3>${esc(b.title || 'Block')}</h3>${b.notes ? `<div class="note-body">${para(b.notes)}</div>` : ''}</div></li>`).join('');
const practiceAboutHTML = (p, areas) => `${p.summary ? `<div class="note-body">${para(p.summary)}</div>` : ''}
  ${p.area_ids.length ? `<span class="chips">${practiceAreaChips(p, areas)}</span>` : ''}`;
const practiceByline = p => `Added by ${esc(p.author_name || 'staff')}${p.edited_at ? ` · edited ${fmtWhen(p.edited_at)}` : ''}`;

// The editor's fields, shared by the editor page and the pop-up. Blocks reorder by their grips (wireGrips); the hidden
// order field makes a reorder, add or remove count as an unsaved change.
function practiceFieldsHTML(p, areas) {
  const v = p || { name: '', summary: '', area_ids: [], blocks: [] };
  const blocks = v.blocks.length ? v.blocks : p ? [] : [{ title: 'Warm-Up', minutes: 15 }, { title: '' }];
  // Areas to pick: the shown ones, plus any hidden one it already has.
  const pickable = areas.filter(a => a.active || v.area_ids.includes(a.id));
  return `<label>Name<input name="name" maxlength="120" required value="${esc(v.name)}" data-need="Name the practice."
      placeholder="E.g. Power Endurance Night" autocomplete="off"></label>
    <label>Summary <span class="muted">(optional)</span><textarea name="summary" rows="2" maxlength="600"
      placeholder="E.g. Short, hard efforts on the 40° wall, then core.">${esc(v.summary)}</textarea></label>
    ${pickable.length ? `<div class="field"><span class="label">Focus Areas <span class="muted">for this practice</span></span>
      ${areaChips('area', pickable, v.area_ids, 'Focus areas')}</div>` : ''}
    <div class="row between blocks-head"><h2>Blocks</h2><span class="muted" data-total></span></div>
    <p class="hint">Every part of a block is optional. Drag the grip to reorder.</p>
    <div data-blocks>${blocks.map(blockEditHTML).join('')}</div>
    <button type="button" class="small" data-add-block>+ Add Block</button>
    <input name="order" hidden aria-hidden="true" tabindex="-1">`;
}
const blockEditHTML = (b = {}) => `<div class="block-edit" data-kind="block" data-id="${b.id || crypto.randomUUID()}">
  <div class="block-top">${GRIP}
    <input name="b_title" maxlength="80" value="${esc(b.title || '')}" placeholder="Block, e.g. Warm-Up" aria-label="Block title">
    <label class="mins"><input type="number" name="b_min" min="1" max="600" step="1" inputmode="numeric" value="${b.minutes || ''}"
      aria-label="Minutes" data-range="1 to 600 minutes."> min</label>
    <button type="button" class="small ghost danger" data-remove>Remove</button></div>
  <textarea name="b_notes" rows="2" maxlength="4000" placeholder="What to do, coaching cues (optional)">${esc(b.notes || '')}</textarea></div>`;

// Add Block, Remove, the total and the grips, inside one form (the editor page's or the pop-up's).
function wirePracticeForm(form) {
  const box = form.querySelector('[data-blocks]'), add = form.querySelector('[data-add-block]'), order = form.elements.order;
  const rows = () => [...box.querySelectorAll('.block-edit')];
  order.value = order.defaultValue = rows().map(r => r.dataset.id).join();
  const changed = () => {
    order.value = rows().map(r => r.dataset.id).join();
    const n = rows().reduce((s, r) => s + (+r.querySelector('[name="b_min"]').value || 0), 0);
    form.querySelector('[data-total]').textContent = n ? 'Total ' + fmtMinutes(n) : '';
    add.hidden = rows().length >= PRACTICE_MAX_BLOCKS;
    markUnsaved();
  };
  changed();
  wireGrips(changed, form);
  form.addEventListener('input', e => { if (e.target.name === 'b_min') changed(); });
  add.onclick = () => {
    box.insertAdjacentHTML('beforeend', blockEditHTML());
    wireGrips(changed, form);
    changed();
    rows().at(-1).querySelector('[name="b_title"]').focus();
  };
  form.addEventListener('click', e => {
    const rm = e.target.closest('[data-remove]');
    if (rm) { rm.closest('.block-edit').remove(); changed(); }
  });
}

// The row to save. A block with nothing in it is left out.
function readPractice(form) {
  const f = new FormData(form);
  return { name: f.get('name').trim(), summary: f.get('summary').trim(), area_ids: f.getAll('area'),
    blocks: [...form.querySelectorAll('.block-edit')].map(r => ({ id: r.dataset.id, title: r.querySelector('[name="b_title"]').value.trim(),
      minutes: +r.querySelector('[name="b_min"]').value || null, notes: r.querySelector('[name="b_notes"]').value.trim() }))
      .filter(b => b.title || b.minutes || b.notes) };
}

// Add or edit a practice on its own page.
async function practiceEditor(p, areas) {
  const t = ++navToken;
  if (!areas) { view(loading); areas = await loadAreas(); if (t !== navToken) return; }
  const back = p ? `#/practice/${p.id}` : '#/practices';
  view(`${crumbs([['Home', '#/'], ['Practices', '#/practices'], ...(p ? [[p.name, back], ['Edit']] : [['New Practice']])])}
    <div class="page-head"><h1 class="big">${p ? 'Edit Practice' : 'New Practice'}</h1></div>
    <form class="card practice-form" id="pracForm" data-save>
      ${practiceFieldsHTML(p, areas)}
      <div class="row end form-foot">
        ${p ? '<button type="button" id="delPractice" class="ghost danger push-left">Delete Practice</button>' : ''}
        <a class="button ghost" href="${back}">Cancel</a>
        <button class="primary">${p ? 'Save Practice' : 'Add Practice'}</button></div>
    </form>`);
  const form = $('#pracForm');
  wirePracticeForm(form);
  $('#delPractice')?.addEventListener('click', () => deletePractice(p, () => goTo('#/practices')));
  form.onsubmit = e => {
    e.preventDefault();
    const row = readPractice(form);
    busy(e.submitter, async () => {
      const saved = p ? await sb.from('team_practices').update(row).eq('id', p.id).select('id').single().then(must)
        : await sb.from('team_practices').insert(row).select('id').single().then(must);
      flash(p ? 'Practice saved.' : 'Practice added.');
      goTo('#/practice/' + saved.id);
    });
  };
}

// ---------- A practice in a pop-up ----------
// Practice Plan on the Summary's Next Practice or on a calendar event opens this, so a coach reads or changes the plan
// without leaving the location (the user asked). Edit swaps in the editor's fields. After a save the page redraws
// (it reads the practice again, so a new name shows) and the pop-up opens again with what was saved.

async function practiceDialog(id) {
  $('#dlg').close();   // the event pop-up it was opened from (ask() has one dialog)
  const got = await busy(null, () => Promise.all([sb.from('team_practices').select('*').eq('id', id).maybeSingle().then(must), loadAreas()]));
  if (!got) return;
  const [p, areas] = got;
  if (!p) return flash('That practice was deleted.', 'error');
  const look = await ask({ title: p.name, ok: 'Edit', cancelLabel: 'Close', wide: true,
    onOpen: form => form.querySelector('[data-close]').addEventListener('click', () => $('#dlg').close()),
    body: `<p class="muted">${practiceMeta(p)}</p>${practiceAboutHTML(p, areas)}
      ${p.blocks.length ? `<ol class="blocks">${practiceBlocksHTML(p)}</ol>` : '<p class="muted">No blocks yet.</p>'}
      <p class="hint">${practiceByline(p)} · <a href="#/practice/${p.id}" data-close>Open Practice Page</a></p>` });
  if (!look) return;
  let form;
  const res = await ask({ title: 'Edit Practice', ok: 'Save Practice', wide: true, extra: { value: 'delete', label: 'Delete' },
    body: `<div class="practice-form in-dialog">${practiceFieldsHTML(p, areas)}</div>`,
    onOpen: f => { form = f; wirePracticeForm(f); } });
  if (!res) return;
  if (res.get('button') === 'delete') return deletePractice(p, () => redraw());
  const row = readPractice(form);
  const saved = await busy(null, async () => {
    await sb.from('team_practices').update(row).eq('id', p.id).then(must);
    flash('Practice saved.');
    redraw();
    return true;
  });
  if (saved) practiceDialog(p.id);
}
