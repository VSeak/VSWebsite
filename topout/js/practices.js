// ---------- Practices: #/practices, #/practice/<id>, #/practice/<id>/edit, #/practice/new ----------
// Practice plans every coach shares, wherever they coach (like Sit Start's Exercises & Drills). A practice is a name,
// a summary, the Areas it works on and timed blocks [{id, title, minutes, notes}], every block field optional. A practice
// on the calendar can link to one (team_events.practice_id).

let practiceSearch = '';
let practiceArea = '';         // the list's Area: filter, an area id or ''
const PRACTICE_MAX_BLOCKS = 40;

const blockMinutes = b => b.blocks.reduce((n, x) => n + (+x.minutes || 0), 0);
const fmtMinutes = n => n < 60 ? `${n} min` : `${Math.floor(n / 60)} h${n % 60 ? ` ${n % 60} min` : ''}`;
const practiceMeta = p => [blockMinutes(p) ? fmtMinutes(blockMinutes(p)) : '',
  p.blocks.length ? `${p.blocks.length} ${p.blocks.length === 1 ? 'block' : 'blocks'}` : 'No blocks yet'].filter(Boolean).join(' · ');
const practiceAreaChips = (p, areas) => byGroup(areas).filter(a => p.area_ids.includes(a.id))
  .map(a => `<span class="chip">${esc(a.name)}</span>`).join('');
const loadAreas = () => sb.from('team_rating_areas').select('id, name, area_group, active').order('position').then(must);

async function practicesPage() {
  const t = ++navToken;
  view(loading);
  const [list, areas] = await Promise.all([
    sb.from('team_practices').select('id, name, summary, area_ids, blocks').order('name').then(must),
    loadAreas(),
  ]);
  if (t !== navToken) return;
  const used = byGroup(areas).map(a => [a, list.filter(p => p.area_ids.includes(a.id)).length]).filter(([, n]) => n);
  if (practiceArea && !used.some(([a]) => a.id === practiceArea)) practiceArea = '';
  const card = p => `<a class="card practice" href="#/practice/${p.id}" data-area="${p.area_ids.join(' ')}"
      data-find="${esc((p.name + ' ' + p.summary).toLowerCase())}">
    <div class="row between"><h2>${esc(p.name)}</h2>${ICON_ARROW}</div>
    <p class="muted small-text">${practiceMeta(p)}</p>
    ${p.summary ? `<p class="practice-sum">${esc(p.summary)}</p>` : ''}
    <span class="chips">${practiceAreaChips(p, areas)}</span></a>`;
  view(`${crumbs([['Home', '#/'], ['Practices']])}
    <div class="page-head"><div><h1 class="big">Practices</h1>
      <p class="muted">Practice plans every coach shares. Open one for the plan, block by block.</p></div>
      <a class="button fill" href="#/practice/new">+ New Practice</a></div>
    ${list.length ? `<div class="row list-tools">
      <input type="search" id="pracSearch" class="search" placeholder="Search practices" value="${esc(practiceSearch)}" aria-label="Search practices">
      ${used.length ? `<label class="inline">Area:<select id="pracArea" class="team-filter"><option value="">All Areas</option>
        ${used.map(([a, n]) => `<option value="${a.id}"${a.id === practiceArea ? ' selected' : ''}>${esc(a.name)} (${n})</option>`).join('')}</select></label>` : ''}
    </div>
    <div class="practices" id="practices">${list.map(card).join('')}</div>
    <p class="muted" id="noMatch" hidden>No practices match.</p>`
    : `<section class="card empty"><h2>No Practices Yet</h2><p class="muted">Add the first practice plan. Every coach will see it.</p></section>`}`);

  const filter = () => {
    const q = practiceSearch.trim().toLowerCase();
    let n = 0;
    app.querySelectorAll('#practices .practice').forEach(p => {
      p.hidden = (!!q && !p.dataset.find.includes(q)) || (!!practiceArea && !p.dataset.area.split(' ').includes(practiceArea));
      n += !p.hidden;
    });
    $('#noMatch').hidden = !!n;
  };
  if (!list.length) return;
  filter();
  $('#pracSearch').addEventListener('input', e => { practiceSearch = e.target.value; filter(); });
  $('#pracArea')?.addEventListener('change', e => { practiceArea = e.target.value; filter(); });
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

  // Each block with how long it takes (no clock times: the user wants lengths only).
  const blocks = p.blocks.map(b => `<li class="block-view"><div class="block-when">${+b.minutes ? `<b>${fmtMinutes(+b.minutes)}</b>` : ''}</div>
    <div class="block-what"><h3>${esc(b.title || 'Block')}</h3>${b.notes ? `<div class="note-body">${para(b.notes)}</div>` : ''}</div></li>`).join('');
  view(`${crumbs([['Home', '#/'], ['Practices', '#/practices'], [p.name]])}
    <div class="page-head"><div><h1 class="big">${esc(p.name)}</h1><p class="muted">${practiceMeta(p)}</p></div>
      <a class="button" href="#/practice/${p.id}/edit">Edit</a></div>
    <div class="practice-layout">
      <section class="card">
        <h2>Plan</h2>
        ${p.blocks.length ? `<ol class="blocks">${blocks}</ol>`
          : `<p class="muted">No blocks yet. <a href="#/practice/${p.id}/edit">Add some</a>.</p>`}
      </section>
      <aside class="side">
        ${p.summary || p.area_ids.length ? `<section class="card"><h2>About</h2>${p.summary ? `<div class="note-body">${para(p.summary)}</div>` : ''}
          ${p.area_ids.length ? `<span class="chips">${practiceAreaChips(p, areas)}</span>` : ''}</section>` : ''}
        ${events.length ? `<section class="card"><h2>On the Calendar</h2>${events.map(e =>
          `<p class="cal-use">${dayBlock(e.event_date)}<span>${fmtDay(e.event_date)}${e.start_time ? ' · ' + fmtTime(e.start_time) : ''}</span></p>`).join('')}</section>` : ''}
        <p class="hint">Added by ${esc(p.author_name || 'staff')}${p.edited_at ? ` · edited ${fmtWhen(p.edited_at)}` : ''}</p>
      </aside>
    </div>`);
}

// Add or edit a practice. Blocks reorder by their grips (wireGrips); the hidden order field makes a reorder, add or
// remove count as an unsaved change.
async function practiceEditor(p, areas) {
  const t = ++navToken;
  if (!areas) { view(loading); areas = await loadAreas(); if (t !== navToken) return; }
  const v = p || { name: '', summary: '', area_ids: [], blocks: [] };
  const blocks = v.blocks.length ? v.blocks : p ? [] : [{ title: 'Warm-Up', minutes: 15 }, { title: '' }];
  const newBlock = (b = {}) => `<div class="block-edit" data-kind="block" data-id="${b.id || crypto.randomUUID()}">
    <div class="block-top">${GRIP}
      <input name="b_title" maxlength="80" value="${esc(b.title || '')}" placeholder="Block, e.g. Warm-Up" aria-label="Block title">
      <label class="mins"><input type="number" name="b_min" min="1" max="600" step="1" inputmode="numeric" value="${b.minutes || ''}"
        aria-label="Minutes" data-range="1 to 600 minutes."> min</label>
      <button type="button" class="small ghost danger" data-remove>Remove</button></div>
    <textarea name="b_notes" rows="2" maxlength="4000" placeholder="What to do, coaching cues (optional)">${esc(b.notes || '')}</textarea></div>`;
  // Areas to pick: the shown ones, plus any hidden one it already has.
  const pickable = areas.filter(a => a.active || v.area_ids.includes(a.id));
  const back = p ? `#/practice/${p.id}` : '#/practices';
  view(`${crumbs([['Home', '#/'], ['Practices', '#/practices'], ...(p ? [[p.name, back], ['Edit']] : [['New Practice']])])}
    <div class="page-head"><h1 class="big">${p ? 'Edit Practice' : 'New Practice'}</h1></div>
    <form class="card practice-form" id="pracForm" data-save>
      <label>Name<input name="name" maxlength="120" required value="${esc(v.name)}" data-need="Name the practice."
        placeholder="E.g. Power Endurance Night" autocomplete="off"></label>
      <label>Summary <span class="muted">(optional)</span><textarea name="summary" rows="2" maxlength="600"
        placeholder="E.g. Short, hard efforts on the 40° wall, then core.">${esc(v.summary)}</textarea></label>
      ${pickable.length ? `<div class="field"><span class="label">Areas <span class="muted">(what it works on, to find it by)</span></span>
        ${areaChips('area', pickable, v.area_ids, 'Areas')}</div>` : ''}
      <div class="row between blocks-head"><h2>Blocks</h2><span class="muted" id="pracTotal"></span></div>
      <p class="hint">Every part of a block is optional. Drag the grip to reorder.</p>
      <div id="blocks">${blocks.map(newBlock).join('')}</div>
      <button type="button" id="addBlock" class="small">+ Add Block</button>
      <input name="order" hidden aria-hidden="true" tabindex="-1">
      <div class="row end form-foot">
        ${p ? '<button type="button" id="delPractice" class="ghost danger push-left">Delete Practice</button>' : ''}
        <a class="button ghost" href="${back}">Cancel</a>
        <button class="primary">${p ? 'Save Practice' : 'Add Practice'}</button></div>
    </form>`);

  const form = $('#pracForm'), box = $('#blocks');
  const rows = () => [...box.querySelectorAll('.block-edit')];
  const order = form.elements.order;
  order.value = order.defaultValue = rows().map(r => r.dataset.id).join();
  const changed = () => {
    order.value = rows().map(r => r.dataset.id).join();
    const n = rows().reduce((s, r) => s + (+r.querySelector('[name="b_min"]').value || 0), 0);
    $('#pracTotal').textContent = n ? 'Total ' + fmtMinutes(n) : '';
    $('#addBlock').hidden = rows().length >= PRACTICE_MAX_BLOCKS;
    markUnsaved();
  };
  changed();
  wireGrips(changed);
  app.oninput = e => { if (e.target.name === 'b_min') changed(); };
  $('#addBlock').onclick = () => {
    box.insertAdjacentHTML('beforeend', newBlock());
    wireGrips(changed);
    changed();
    rows().at(-1).querySelector('[name="b_title"]').focus();
  };
  app.onclick = e => {
    const rm = e.target.closest('[data-remove]');
    if (rm) { rm.closest('.block-edit').remove(); changed(); }
  };
  $('#delPractice')?.addEventListener('click', async () => {
    if (!await confirmDelete(`Delete ${p.name}?`, 'It will be gone for every coach, and calendar practices that use it will no longer link to it.')) return;
    busy(null, async () => { await sb.from('team_practices').delete().eq('id', p.id).then(must); flash('Practice deleted.'); goTo('#/practices'); });
  });
  app.onsubmit = e => {
    e.preventDefault();
    const f = new FormData(form);
    const row = {
      name: f.get('name').trim(), summary: f.get('summary').trim(), area_ids: f.getAll('area'),
      // A block with nothing in it is left out.
      blocks: rows().map(r => ({ id: r.dataset.id, title: r.querySelector('[name="b_title"]').value.trim(),
        minutes: +r.querySelector('[name="b_min"]').value || null, notes: r.querySelector('[name="b_notes"]').value.trim() }))
        .filter(b => b.title || b.minutes || b.notes),
    };
    busy(e.submitter, async () => {
      const saved = p ? await sb.from('team_practices').update(row).eq('id', p.id).select('id').single().then(must)
        : await sb.from('team_practices').insert(row).select('id').single().then(must);
      flash(p ? 'Practice saved.' : 'Practice added.');
      goTo('#/practice/' + saved.id);
    });
  };
}
