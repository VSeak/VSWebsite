// ---------- Staff: master exercise list ----------

// Plans copy an exercise's values when it's picked, so editing either one never changes the other.
const EX_PAGE = 10;   // exercises per page on the Master Exercise List
const PUR_PAGE = 5;   // purposes per page in the Purposes card
const EX_TABS = 4;    // purpose tabs shown before "+n More"
const EX_FIELDS = [['sets', 'Sets'], ['reps', 'Reps/Time'], ['rest', 'Rest'], ['notes', 'Notes']];
const exKey = name => String(name ?? '').trim().toLowerCase();   // matches exercises.name_key
const exDupError = e => e.code === '23505' ? new Error('That exercise is already on the list.') : e;
// Purposes say what an exercise is for, so coaches can search by them. They stay on the master list:
// plans don't copy them and students never see them. The ones to pick from are the exercise_purposes
// rows, managed in the Purposes card; renaming or deleting one there changes every exercise (a trigger).
const EX_PURPOSES_MAX = 12;   // matches the check on exercises.purposes
const exPurposeTags = list => list?.length ? `<span class="ex-purposes">${list.map(g => `<span class="tag">${esc(g)}</span>`).join('')}</span>` : '';
const exPicksHTML = (choices, picked = []) => choices.map(g =>
  `<label><input type="checkbox" name="purposes" value="${esc(g)}"${picked.includes(g) ? ' checked' : ''}>${esc(g)}</label>`).join('');
const exFieldsHTML = (x = {}, choices = []) => `<label>Name<input name="name" value="${esc(x.name)}" maxlength="200" required
    data-need="Name the exercise." autocomplete="off"></label>
  <div class="row">${EX_FIELDS.slice(0, 3).map(([f, l]) =>
    `<label class="grow" style="min-width:90px">${l}<input name="${f}" value="${esc(x[f])}" autocomplete="off"></label>`).join('')}</div>
  <label>Notes<textarea name="notes" rows="2">${esc(x.notes)}</textarea></label>
  <fieldset class="picks"><legend>Purpose</legend>
    <span class="hint field-hint">What the exercise is for. This also helps coaches search and filter through exercises. Students don't see these on their training plans. Add more in the Purposes card.</span>
    <div class="pick-row">${exPicksHTML(choices, x.purposes)}</div>
  </fieldset>`;
function exFromForm(f) {
  const purposes = f.getAll('purposes');
  if (purposes.length > EX_PURPOSES_MAX) throw new Error(`Pick at most ${EX_PURPOSES_MAX} purposes.`);
  return { ...Object.fromEntries(['name', ...EX_FIELDS.map(([k]) => k)].map(k => [k, (f.get(k) || '').trim()])), purposes };
}
const purDupError = e => e.code === '23505' ? new Error('That purpose is already on the list.') : e;
const purFieldHTML = (name = '') => `<label>Name<input name="name" value="${esc(name)}" maxlength="40" required
    data-need="Name the purpose." placeholder="E.g. Balance" autocomplete="off"></label>`;

async function adminExercises() {
  const t = ++navToken;
  view(loading);
  let [list, purposes] = await Promise.all([
    sb.from('exercises').select('*').order('name_key').then(must),
    sb.from('exercise_purposes').select('*').order('name_key').then(must)]);
  if (t !== navToken) return;
  const purNames = () => purposes.map(p => p.name);
  const usedBy = name => list.filter(x => x.purposes.includes(name)).length;

  view(`${crumbs([['Home', '#/'], ['Exercises & Drills']])}
  <div class="page-head" id="exTop"><h1>Exercises & Drills</h1><button type="button" class="fill only-phone" id="exAddBtn" aria-expanded="false">+ Add Exercise</button></div>
  <div class="grid2">
    <div class="stack">
      <p class="muted" style="margin:0">Every exercise and drill you can pick in a plan, with the values it fills in. Changing a plan never changes this list.</p>
      <input id="exSearch" class="search" type="search" placeholder="Search by name or purpose" aria-label="Search exercises" autocomplete="off">
      <div class="tabs" id="exPurpose" role="tablist" aria-label="Purpose"></div>
      <div class="ex-cards" id="exList"></div>
      <div id="exPager"></div>
    </div>
    <aside>
      <section class="card" id="exAddCard"><h2>Add Exercise</h2>
        <p class="hint">Picking an exercise in a training plan fills in these values. Changing them in a plan doesn't change this list.
          New exercises typed into a plan are added here when the plan is saved.</p>
        <form id="exAdd" class="stack" data-save>${exFieldsHTML({}, purNames())}<button class="primary">+ Add Exercise</button></form>
      </section>
      <div data-folds="exercises"><section class="card" data-fold="purposes" data-fold-start><h2>Purposes (<span id="purCount"></span>)</h2>
        <p class="hint">The purposes to pick from for an exercise. Renaming or deleting a purpose changes every exercise that has it.</p>
        <form id="purAdd" class="stack" data-save>${purFieldHTML()}<button class="primary">+ Add Purpose</button></form>
        <ul class="list" id="purList"></ul>
        <div id="purPager"></div>
      </section></div>
    </aside>
  </div>`);

  const search = $('#exSearch'), purposeBox = $('#exPurpose');
  let page = 1, purpose = '', allPurposes = false;
  const matches = () => {
    const q = exKey(search.value), g = purpose;
    return list.filter(x => (!g || x.purposes.includes(g)) && (!q || x.name_key.includes(q) || x.purposes.some(h => exKey(h).includes(q))));
  };
  // The purpose tabs: All, then purposes in use with counts (a purpose no exercise has any more drops off). Past the
  // first few, "+n More" shows the rest.
  function renderPurposeFilter() {
    const used = purNames().filter(usedBy);
    if (!used.includes(purpose)) purpose = '';
    const shown = allPurposes || used.length <= EX_TABS + 1 ? used : used.slice(0, EX_TABS);
    if (purpose && !shown.includes(purpose)) shown.push(purpose);
    const tab = (g, label, n) => `<button type="button" role="tab" data-purpose="${esc(g)}" aria-selected="${g === purpose}">${esc(label)}<span class="count">${n}</span></button>`;
    purposeBox.innerHTML = tab('', 'All', list.length) + shown.map(g => tab(g, g, usedBy(g))).join('')
      + (shown.length < used.length ? `<button type="button" class="more-tabs" data-more>+${used.length - shown.length} More</button>` : '');
    purposeBox.hidden = !used.length;
  }
  purposeBox.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if ('more' in b.dataset) allPurposes = true;
    else { purpose = b.dataset.purpose; page = 1; }
    renderList();
  };
  // On a phone the Add Exercise card waits behind the button at the top, and opens there.
  $('#exAddBtn').onclick = e => {
    const card = $('#exAddCard'), open = !card.classList.contains('open');
    card.classList.toggle('open', open);
    e.target.setAttribute('aria-expanded', open);
    e.target.textContent = open ? 'Close' : '+ Add Exercise';
    if (open) { $('#exTop').after(card); card.querySelector('[name="name"]').focus(); }
  };
  let purPage = 1;
  const purPageWith = p => { const i = purposes.indexOf(p); if (i >= 0) purPage = Math.floor(i / PUR_PAGE) + 1; };
  function renderPurposes() {
    const [items, pg] = pageOf(purposes, purPage, PUR_PAGE);
    purPage = pg;
    $('#purCount').textContent = purposes.length;
    $('#purPager').innerHTML = pagerHTML(purPage, purposes.length, PUR_PAGE, ['Previous', 'Next']);
    bindPager($('#purPager'), n => { purPage = n; renderPurposes(); });
    $('#purList').innerHTML = items.map(p => { const n = usedBy(p.name);
      return `<li class="goal"><div class="goal-text"><strong>${esc(p.name)}</strong>
        <span class="item-sub">${n ? `${n} exercise${n === 1 ? '' : 's'}` : 'Not used yet'}</span></div>
        <div class="row ex-actions"><button type="button" class="small ghost" data-act="pur-rename" data-pur="${p.id}">Rename</button>
        <button type="button" class="small ghost danger" data-act="pur-delete" data-pur="${p.id}">Delete</button></div></li>`;
    }).join('') || `<li><p class="muted" style="margin:.6rem 0">No purposes yet. Add your first one.</p></li>`;
  }
  // Redraws the Add form's pills after the purposes change, keeping what's ticked (renamed: old name → new).
  // Ticks are set as properties, not attributes, so a tick the coach made still counts as unsaved.
  function redrawPicks(renamed = {}) {
    const row = $('#exAdd .pick-row');
    const ticked = [...row.querySelectorAll('input:checked')].map(i => renamed[i.value] ?? i.value);
    row.innerHTML = exPicksHTML(purNames());
    row.querySelectorAll('input').forEach(i => { i.checked = ticked.includes(i.value); });
  }
  const sortPurposes = () => purposes.sort((a, b) => a.name_key.localeCompare(b.name_key));
  // Goes to the page that holds x, if the search shows it.
  const pageWith = x => { const i = matches().indexOf(x); if (i >= 0) page = Math.floor(i / EX_PAGE) + 1; };
  function renderList() {
    renderPurposeFilter();
    const shown = matches();
    const [items, p] = pageOf(shown, page, EX_PAGE);
    page = p;
    $('#exPager').innerHTML = pagerHTML(page, shown.length, EX_PAGE, ['Previous', 'Next']);
    bindPager($('#exPager'), n => { page = n; renderList(); });
    // Each one as a card, like the exercise cards students see: the name, three boxes, notes, then its purposes.
    $('#exList').innerHTML = items.map(x => `<article class="ex-card lib"><div class="ex-top"><p class="ex-name">${esc(x.name)}</p>
        <span class="row"><button type="button" class="small" data-act="ex-edit" data-ex="${x.id}">Edit</button>
        <button type="button" class="small ghost danger" data-act="ex-delete" data-ex="${x.id}">Delete</button></span></div>
        <div class="stats">${EX_FIELDS.slice(0, 3).map(([f, l]) =>
          `<div class="stat"><span class="stat-l">${l}</span><span class="stat-v${x[f] ? '' : ' none'}">${x[f] ? esc(x[f]) : '—'}</span></div>`).join('')}</div>
        ${x.notes ? `<p class="ex-note">${para(x.notes)}</p>` : ''}${exPurposeTags(x.purposes)}</article>`).join('')
      || `<p class="muted">${list.length ? 'No exercise matches that search or purpose.' : 'No exercises yet. Add your first one.'}</p>`;
  }
  const sortList = () => list.sort((a, b) => a.name_key.localeCompare(b.name_key));
  renderList();
  renderPurposes();
  search.oninput = () => { page = 1; renderList(); };

  $('#exAdd').onsubmit = e => {
    e.preventDefault();
    const form = new FormData(e.target);
    busy(e.submitter, async () => {
      const { data, error } = await sb.from('exercises').insert(exFromForm(form)).select().single();
      if (error) throw exDupError(error);
      list.push(data); sortList();
      e.target.reset();
      renderPurposes();
      search.value = ''; purpose = '';
      pageWith(data);
      renderList();
      e.target.elements.name.focus();
      flash(`${data.name} added.`);
    });
  };

  $('#purAdd').onsubmit = e => {
    e.preventDefault();
    const name = new FormData(e.target).get('name').trim();
    busy(e.submitter, async () => {
      const { data, error } = await sb.from('exercise_purposes').insert({ name }).select().single();
      if (error) throw purDupError(error);
      purposes.push(data); sortPurposes(); purPageWith(data);
      e.target.reset();
      renderPurposes(); redrawPicks();
      e.target.elements.name.focus();
      flash(`${data.name} added.`);
    });
  };

  // The trigger on exercise_purposes changes the exercises in the database; this mirrors it in the page.
  async function purposeClick(b, p) {
    const n = usedBy(p.name), them = `${n} exercise${n === 1 ? '' : 's'}`;
    if (b.dataset.act === 'pur-rename') {
      const f = await ask({ title: 'Rename Purpose', ok: 'Save Purpose', body: `<div class="stack">${purFieldHTML(p.name)}</div>
        ${n ? `<p class="hint">It changes on the ${them} that ${n === 1 ? 'has' : 'have'} it.</p>` : ''}` });
      if (f) busy(b, async () => {
        const old = p.name;
        const { data, error } = await sb.from('exercise_purposes').update({ name: f.get('name').trim() }).eq('id', p.id).select().single();
        if (error) throw purDupError(error);
        Object.assign(p, data); sortPurposes(); purPageWith(p);
        list.forEach(x => { x.purposes = x.purposes.map(g => g === old ? p.name : g); });
        renderPurposes(); redrawPicks({ [old]: p.name }); renderList();
        flash('Purpose saved.');
      });
    }
    if (b.dataset.act === 'pur-delete' && await ask({ title: `Delete ${p.name}?`, warn: true, ok: 'Delete',
      body: `<p>${n ? `It comes off the ${them} that ${n === 1 ? 'has' : 'have'} it.` : 'No exercise has it yet.'}</p>` }))
      busy(b, async () => {
        must(await sb.from('exercise_purposes').delete().eq('id', p.id));
        purposes = purposes.filter(q => q !== p);
        list.forEach(x => { x.purposes = x.purposes.filter(g => g !== p.name); });
        renderPurposes(); redrawPicks(); renderList();
      });
  }

  app.onclick = async e => {
    const b = e.target.closest('[data-act]');
    const p = b?.dataset.pur && purposes.find(q => q.id === b.dataset.pur);
    if (p) return purposeClick(b, p);
    const x = b && list.find(y => y.id === b.dataset.ex);
    if (!x) return;
    if (b.dataset.act === 'ex-edit') {
      // Any purpose the exercise has that isn't in the list any more still shows, so saving keeps it.
      const choices = [...purNames(), ...x.purposes.filter(g => !purNames().includes(g))];
      const f = await ask({ title: 'Edit Exercise', ok: 'Save Exercise', body: `<div class="stack">${exFieldsHTML(x, choices)}</div>
        <p class="hint">Plans that already use it keep their own values.</p>` });
      if (f) busy(b, async () => {
        const { data, error } = await sb.from('exercises').update(exFromForm(f)).eq('id', x.id).select().single();
        if (error) throw exDupError(error);
        Object.assign(x, data); sortList();
        pageWith(x);
        renderList(); renderPurposes();
        flash('Exercise saved.');
      });
    }
    if (b.dataset.act === 'ex-delete' && await ask({ title: `Delete ${x.name}?`, warn: true, ok: 'Delete',
      body: '<p>It comes off the list. Plans that already use it keep it.</p>' }))
      busy(b, async () => {
        must(await sb.from('exercises').delete().eq('id', x.id));
        list = list.filter(y => y !== x);
        renderList(); renderPurposes();
      });
  };
}

// Adds a plan's exercises that aren't on the master list yet, with the plan's values.
// Existing names are left alone (ignoreDuplicates), so plan edits never change the list.
async function addToMasterList(rows) {
  const known = new Set(draft.library.map(x => x.name_key)), add = new Map();
  for (const x of rows.flatMap(r => r.exercises)) {
    const k = exKey(x.name);
    if (k && !known.has(k) && !add.has(k))
      add.set(k, { name: x.name.trim().slice(0, 200), ...Object.fromEntries(EX_FIELDS.map(([f]) => [f, String(x[f] ?? '').trim()])) });
  }
  if (!add.size) return 0;
  const added = await sb.from('exercises').upsert([...add.values()], { onConflict: 'name_key', ignoreDuplicates: true })
    .select().then(must);
  draft.library.push(...added);
  return added.length;
}

// The exercise name picker: one menu under whichever name field has focus, listing master
// exercises whose name or purpose contains what's typed (names first). Picking one sets the
// field and fires an input event, so the editor's oninput fills in the values as for typing.
const exMenu = Object.assign(document.createElement('ul'), { id: 'exMenu', className: 'combo-menu', role: 'listbox', hidden: true });
exMenu.setAttribute('aria-label', 'Exercises');
document.body.append(exMenu);
let exMenuFor = null, exMatches = [], exActive = -1;

function exMenuOpen(input) {
  const q = exKey(input.value);
  // Names containing the text first (starting with it before that), then exercises with a purpose containing it.
  const rank = x => x.name_key.startsWith(q) ? 0 : x.name_key.includes(q) ? 1 : (x.purposes ?? []).some(h => exKey(h).includes(q)) ? 2 : 3;
  exMatches = (draft?.library ?? []).filter(x => rank(x) < 3)
    .sort((a, b) => (rank(a) - rank(b)) || a.name_key.localeCompare(b.name_key));
  if (!exMatches.length || (exMatches.length === 1 && exMatches[0].name_key === q)) return exMenuClose();
  exMenuFor = input; exActive = -1;
  const hit = s => { const i = s.toLowerCase().indexOf(q);
    return q && i >= 0 ? `${esc(s.slice(0, i))}<mark>${esc(s.slice(i, i + q.length))}</mark>${esc(s.slice(i + q.length))}` : esc(s); };
  exMenu.innerHTML = exMatches.map((x, k) => {
    const sum = [x.sets && x.reps ? `${x.sets} × ${x.reps}` : x.sets || x.reps, x.rest].filter(Boolean).join(' · ');
    const purposes = x.purposes?.length ? `<span class="combo-sub">${x.purposes.map(hit).join(' · ')}</span>` : '';
    return `<li id="exOpt${k}" role="option" data-k="${k}"><span>${hit(x.name)}${purposes}</span>${sum ? `<span class="muted">${esc(sum)}</span>` : ''}</li>`;
  }).join('');
  const r = input.getBoundingClientRect();
  const vw = document.documentElement.clientWidth, w = Math.min(Math.max(r.width, 320), vw - 16);
  Object.assign(exMenu.style, { left: Math.max(8, Math.min(r.left, vw - w - 8)) + scrollX + 'px', top: r.bottom + scrollY + 4 + 'px', width: w + 'px' });
  exMenu.hidden = false; exMenu.scrollTop = 0;
  input.setAttribute('aria-expanded', 'true');
  input.removeAttribute('aria-activedescendant');
}

function exMenuClose() {
  exMenu.hidden = true;
  exMenuFor?.setAttribute('aria-expanded', 'false');
  exMenuFor?.removeAttribute('aria-activedescendant');
  exMenuFor = null;
}

function exMenuMove(k) {
  exActive = (k + exMatches.length) % exMatches.length;
  exMenu.querySelectorAll('li').forEach((li, j) => li.setAttribute('aria-selected', j === exActive));
  const li = exMenu.children[exActive];
  li.scrollIntoView({ block: 'nearest' });
  exMenuFor.setAttribute('aria-activedescendant', li.id);
}

function exMenuPick(k) {
  const input = exMenuFor;
  input.value = exMatches[k].name;
  exMenuClose();
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

document.addEventListener('focusin', e => { if (e.target.matches?.('[data-combo]')) exMenuOpen(e.target); });
document.addEventListener('focusout', e => { if (e.target === exMenuFor) exMenuClose(); });
document.addEventListener('input', e => { if (e.target.matches?.('[data-combo]') && e.isTrusted) exMenuOpen(e.target); });
document.addEventListener('keydown', e => {
  if (!e.target.matches?.('[data-combo]')) return;
  if (e.target !== exMenuFor) { if (e.key === 'ArrowDown') { exMenuOpen(e.target); e.preventDefault(); } return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { exMenuMove(exActive + (e.key === 'ArrowDown' ? 1 : -1)); e.preventDefault(); }
  else if (e.key === 'Enter' && exActive >= 0) { exMenuPick(exActive); e.preventDefault(); }
  else if (e.key === 'Escape') { exMenuClose(); e.preventDefault(); }
  else if (e.key === 'Tab') exMenuClose();
});
exMenu.addEventListener('mousedown', e => e.preventDefault());   // keep focus in the field
exMenu.addEventListener('click', e => { const li = e.target.closest('li'); if (li) exMenuPick(+li.dataset.k); });
addEventListener('resize', () => exMenuFor && exMenuOpen(exMenuFor));
