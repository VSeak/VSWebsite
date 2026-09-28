// ---------- Staff: master exercise list ----------

// Plans copy an exercise's values when it's picked, so editing either one never changes the other.
const EX_PAGE = 10;   // exercises per page on the Master Exercise List
const EX_FIELDS = [['sets', 'Sets'], ['reps', 'Reps / Time'], ['rest', 'Rest'], ['notes', 'Notes']];
const exKey = name => String(name ?? '').trim().toLowerCase();   // matches exercises.name_key
const exDupError = e => e.code === '23505' ? new Error('That exercise is already on the list.') : e;
// Purposes say what an exercise is for, so coaches can search by them. They stay on the master list:
// plans don't copy them and students never see them.
const EX_PURPOSES = ['Mobility', 'Injury Prevention', 'Strength Training', 'Finger Strength', 'Power', 'Core',
  'Endurance', 'Technique', 'Warm-Up', 'Recovery'];
const EX_PURPOSES_MAX = 12;   // matches the check on exercises.purposes
// The purposes to pick from: the usual ones, then any others already on the list.
const exPurposeChoices = list => [...EX_PURPOSES, ...[...new Set(list.flatMap(x => x.purposes))]
  .filter(g => !EX_PURPOSES.some(d => exKey(d) === exKey(g))).sort((a, b) => a.localeCompare(b))];
const exPurposeTags = list => list?.length ? `<span class="ex-purposes">${list.map(g => `<span class="tag">${esc(g)}</span>`).join('')}</span>` : '';
const exFieldsHTML = (x = {}, choices = EX_PURPOSES) => `<label>Name<input name="name" value="${esc(x.name)}" maxlength="200" required
    data-need="Name the exercise." autocomplete="off"></label>
  <div class="row">${EX_FIELDS.slice(0, 3).map(([f, l]) =>
    `<label class="grow" style="min-width:90px">${l}<input name="${f}" value="${esc(x[f])}" autocomplete="off"></label>`).join('')}</div>
  <label>Notes<textarea name="notes" rows="2">${esc(x.notes)}</textarea></label>
  <fieldset class="picks"><legend>Purpose</legend>
    <span class="hint field-hint">What it's for, to help coaches search. Students don't see these.</span>
    <div class="pick-row">${choices.map(g => `<label><input type="checkbox" name="purposes" value="${esc(g)}"${x.purposes?.includes(g) ? ' checked' : ''}>${esc(g)}</label>`).join('')}</div>
    <label>Other Purposes<input name="purposes_new" maxlength="200" placeholder="E.g. Balance, Flexibility" autocomplete="off"></label>
  </fieldset>`;
// Other Purposes is split on commas. A typed purpose that matches one to pick (ignoring case) uses that spelling.
function exPurposesFromForm(f, choices) {
  const typed = (f.get('purposes_new') || '').split(',').map(g => g.trim().slice(0, 40)).filter(Boolean)
    .map(g => choices.find(c => exKey(c) === exKey(g)) || g.charAt(0).toUpperCase() + g.slice(1));
  const picked = [];
  for (const g of [...f.getAll('purposes'), ...typed]) if (!picked.some(h => exKey(h) === exKey(g))) picked.push(g);
  if (picked.length > EX_PURPOSES_MAX) throw new Error(`Pick at most ${EX_PURPOSES_MAX} purposes.`);
  return picked;
}
const exFromForm = (f, choices = EX_PURPOSES) => ({
  ...Object.fromEntries(['name', ...EX_FIELDS.map(([k]) => k)].map(k => [k, (f.get(k) || '').trim()])),
  purposes: exPurposesFromForm(f, choices) });

async function adminExercises() {
  const t = ++navToken;
  view(loading);
  let list = await sb.from('exercises').select('*').order('name_key').then(must);
  if (t !== navToken) return;

  view(`${crumbs([['Home', '#/'], ['Master Exercise List']])}
  <h1>Master Exercise List</h1>
  <div class="grid2">
    <section class="card"><h2>All Exercises (<span id="exCount"></span>)</h2>
      <p class="hint">Every exercise you can pick in a training plan, with the values it fills in. Search by name or purpose, or filter by purpose. Edit or delete them here.</p>
      <div class="row">
        <input id="exSearch" class="grow" type="search" placeholder="Search exercises" aria-label="Search exercises" autocomplete="off">
        <select id="exPurpose" aria-label="Purpose" style="width:auto"></select>
      </div>
      <div class="list-head" id="exHead"><span>Exercise</span><span class="ex-actions">Action</span></div>
      <ul class="list" id="exList"></ul>
      <div id="exPager"></div>
    </section>
    <aside>
      <section class="card"><h2>Add Exercise</h2>
        <p class="hint">Picking an exercise in a training plan fills in these values. Changing them in a plan doesn't change this list.
          New exercises typed into a plan are added here when the plan is saved.</p>
        <form id="exAdd" class="stack" data-save>${exFieldsHTML({}, exPurposeChoices(list))}<button class="primary">+ Add Exercise</button></form>
      </section>
    </aside>
  </div>`);

  const search = $('#exSearch'), purposeSel = $('#exPurpose');
  let page = 1;
  const matches = () => {
    const q = exKey(search.value), g = purposeSel.value;
    return list.filter(x => (!g || x.purposes.includes(g)) && (!q || x.name_key.includes(q) || x.purposes.some(h => exKey(h).includes(q))));
  };
  // The purpose filter lists purposes in use, with counts. A purpose no exercise has any more drops off.
  function renderPurposeFilter() {
    const used = exPurposeChoices(list).filter(g => list.some(x => x.purposes.includes(g)));
    if (!used.includes(purposeSel.value)) purposeSel.value = '';
    const was = purposeSel.value;
    purposeSel.innerHTML = `<option value="">All Purposes</option>` + used.map(g =>
      `<option value="${esc(g)}">${esc(g)} (${list.filter(x => x.purposes.includes(g)).length})</option>`).join('');
    purposeSel.value = was;
    purposeSel.hidden = !used.length;
  }
  // The Add form's purposes to pick grow as new ones are typed. Only redrawn right after an add (the form is empty then).
  const drawAddForm = () => { $('#exAdd').innerHTML = `${exFieldsHTML({}, exPurposeChoices(list))}<button class="primary">+ Add Exercise</button>`; };
  // Goes to the page that holds x, if the search shows it.
  const pageWith = x => { const i = matches().indexOf(x); if (i >= 0) page = Math.floor(i / EX_PAGE) + 1; };
  function renderList() {
    renderPurposeFilter();
    const shown = matches();
    const [items, p] = pageOf(shown, page, EX_PAGE);
    page = p;
    $('#exCount').textContent = list.length;
    $('#exHead').hidden = !shown.length;
    $('#exPager').innerHTML = pagerHTML(page, shown.length, EX_PAGE, ['Previous', 'Next']);
    bindPager($('#exPager'), n => { page = n; renderList(); });
    $('#exList').innerHTML = items.map(x => {
      const sub = EX_FIELDS.slice(0, 3).filter(([f]) => x[f]).map(([f, l]) => `${l}: ${esc(x[f])}`).join(' · ');
      return `<li class="goal"><div class="goal-text"><strong>${esc(x.name)}</strong>
        ${sub ? `<span class="item-sub">${sub}</span>` : ''}${x.notes ? `<span class="item-sub">Notes: ${para(x.notes)}</span>` : ''}${exPurposeTags(x.purposes)}</div>
        <div class="row ex-actions"><button type="button" class="small ghost" data-act="ex-edit" data-ex="${x.id}">Edit</button>
        <button type="button" class="small ghost danger" data-act="ex-delete" data-ex="${x.id}">Delete</button></div></li>`;
    }).join('') || `<li><p class="muted" style="margin:.6rem 0">${list.length ? 'No exercise matches that search or purpose.' : 'No exercises yet. Add your first one.'}</p></li>`;
  }
  const sortList = () => list.sort((a, b) => a.name_key.localeCompare(b.name_key));
  renderList();
  search.oninput = purposeSel.onchange = () => { page = 1; renderList(); };

  $('#exAdd').onsubmit = e => {
    e.preventDefault();
    const form = new FormData(e.target);
    busy(e.submitter, async () => {
      const { data, error } = await sb.from('exercises').insert(exFromForm(form, exPurposeChoices(list))).select().single();
      if (error) throw exDupError(error);
      list.push(data); sortList();
      drawAddForm();
      search.value = ''; purposeSel.value = '';
      pageWith(data);
      renderList();
      e.target.elements.name.focus();
      flash(`${data.name} added.`);
    });
  };

  app.onclick = async e => {
    const b = e.target.closest('[data-act]');
    const x = b && list.find(y => y.id === b.dataset.ex);
    if (!x) return;
    if (b.dataset.act === 'ex-edit') {
      const f = await ask({ title: 'Edit Exercise', ok: 'Save Exercise', body: `<div class="stack">${exFieldsHTML(x, exPurposeChoices(list))}</div>
        <p class="hint">Plans that already use it keep their own values.</p>` });
      if (f) busy(b, async () => {
        const { data, error } = await sb.from('exercises').update(exFromForm(f, exPurposeChoices(list))).eq('id', x.id).select().single();
        if (error) throw exDupError(error);
        Object.assign(x, data); sortList();
        pageWith(x);
        renderList();
        flash('Exercise saved.');
      });
    }
    if (b.dataset.act === 'ex-delete' && await ask({ title: `Delete ${x.name}?`, warn: true, ok: 'Delete',
      body: '<p>It comes off the list. Plans that already use it keep it.</p>' }))
      busy(b, async () => {
        must(await sb.from('exercises').delete().eq('id', x.id));
        list = list.filter(y => y !== x);
        renderList();
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
// exercises that contain what's typed (names starting with it first). Picking one sets the
// field and fires an input event, so the editor's oninput fills in the values as for typing.
const exMenu = Object.assign(document.createElement('ul'), { id: 'exMenu', className: 'combo-menu', role: 'listbox', hidden: true });
exMenu.setAttribute('aria-label', 'Exercises');
document.body.append(exMenu);
let exMenuFor = null, exMatches = [], exActive = -1;

function exMenuOpen(input) {
  const q = exKey(input.value);
  exMatches = (draft?.library ?? []).filter(x => x.name_key.includes(q))
    .sort((a, b) => (b.name_key.startsWith(q) - a.name_key.startsWith(q)) || a.name_key.localeCompare(b.name_key));
  if (!exMatches.length || (exMatches.length === 1 && exMatches[0].name_key === q)) return exMenuClose();
  exMenuFor = input; exActive = -1;
  const hit = s => { const i = s.toLowerCase().indexOf(q);
    return q && i >= 0 ? `${esc(s.slice(0, i))}<mark>${esc(s.slice(i, i + q.length))}</mark>${esc(s.slice(i + q.length))}` : esc(s); };
  exMenu.innerHTML = exMatches.map((x, k) => {
    const sum = [x.sets && x.reps ? `${x.sets} × ${x.reps}` : x.sets || x.reps, x.rest].filter(Boolean).join(' · ');
    return `<li id="exOpt${k}" role="option" data-k="${k}"><span>${hit(x.name)}</span>${sum ? `<span class="muted">${esc(sum)}</span>` : ''}</li>`;
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
