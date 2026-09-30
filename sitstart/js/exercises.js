// ---------- Staff: master exercise list ----------

// Plans copy an exercise's values when it's picked, so editing either one never changes the other.
const EX_PAGE = 10;   // exercises per page on the Master Exercise List
const PUR_PAGE = 5;   // purposes per page in the Purposes card
const EX_TABS = 4;    // purpose tabs shown before "+n More"
const EX_FIELDS = [['sets', 'Sets'], ['reps', 'Reps/Time'], ['rest', 'Rest'], ['notes', 'Notes']];
const EX_EXAMPLES = { name: 'E.g. Campus Board', sets: 'E.g. 3 sets', reps: 'E.g. 10 reps', rest: 'E.g. 5 min',
  notes: 'E.g. Keep your hips close to the wall' };
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
    data-need="Name the exercise." placeholder="${EX_EXAMPLES.name}" autocomplete="off"></label>
  <div class="row">${EX_FIELDS.slice(0, 3).map(([f, l]) =>
    `<label class="grow" style="min-width:90px">${l}<input name="${f}" value="${esc(x[f])}" placeholder="${EX_EXAMPLES[f]}" autocomplete="off"></label>`).join('')}</div>
  <label>Notes${rich(`<textarea name="notes" rows="2" data-grow placeholder="${EX_EXAMPLES.notes}">${esc(x.notes)}</textarea>`)}</label>
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
  <div class="page-head" id="exTop"><h1>Exercises & Drills</h1><button type="button" class="fill only-phone" id="exAddBtn" aria-expanded="false">+ Add Exercises & Drills</button></div>
  <div class="grid2">
    <div class="stack">
      <p class="muted" style="margin:0">Every exercise and drill you can pick in a plan, with the values it fills in. Changing a plan never changes this list.</p>
      <input id="exSearch" class="search" type="search" placeholder="Search by name or purpose" aria-label="Search exercises" autocomplete="off">
      <div class="tabs" id="exPurpose" role="tablist" aria-label="Purpose"></div>
      <div class="ex-cards" id="exList"></div>
      <div id="exPager"></div>
    </div>
    <aside>
      <section class="card" id="exAddCard"><h2>Add Exercises & Drills</h2>
        <p class="hint">Picking an exercise in a training plan fills in these values. Changing them in a plan doesn't change this list.
          New exercises typed into a plan are added here when the plan is saved.</p>
        <form id="exAdd" class="stack" data-save>${exFieldsHTML({}, purNames())}<button class="primary">+ Add Exercises & Drills</button></form>
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
  // first few, "+n More" shows the rest and Show Fewer folds them back.
  function renderPurposeFilter() {
    const used = purNames().filter(usedBy);
    if (!used.includes(purpose)) purpose = '';
    const shown = allPurposes || used.length <= EX_TABS + 1 ? used : used.slice(0, EX_TABS);
    if (purpose && !shown.includes(purpose)) shown.push(purpose);
    const tab = (g, label, n) => `<button type="button" role="tab" data-purpose="${esc(g)}" aria-selected="${g === purpose}">${esc(label)}<span class="count">${n}</span></button>`;
    purposeBox.innerHTML = tab('', 'All', list.length) + shown.map(g => tab(g, g, usedBy(g))).join('')
      + (shown.length < used.length ? `<button type="button" class="more-tabs" data-more>+${used.length - shown.length} More</button>`
        : allPurposes && used.length > EX_TABS + 1 ? '<button type="button" class="more-tabs" data-fewer>Show Fewer</button>' : '');
    purposeBox.hidden = !used.length;
  }
  purposeBox.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if ('more' in b.dataset) allPurposes = true;
    else if ('fewer' in b.dataset) allPurposes = false;
    else { purpose = b.dataset.purpose; page = 1; }
    renderList();
  };
  // On a phone the Add Exercises & Drills card waits behind the button at the top, and opens there.
  $('#exAddBtn').onclick = e => {
    const card = $('#exAddCard'), open = !card.classList.contains('open');
    card.classList.toggle('open', open);
    e.target.setAttribute('aria-expanded', open);
    e.target.textContent = open ? 'Close' : '+ Add Exercises & Drills';
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
    // One with no purpose yet gets the warn edge and a Needs a Purpose tag (added from a plan, for instance).
    $('#exList').innerHTML = items.map(x => `<article class="ex-card lib${x.purposes.length ? '' : ' needs-purpose'}"><div class="ex-top"><p class="ex-name">${esc(x.name)}</p>
        <span class="row ex-btns"><button type="button" class="small" data-act="ex-edit" data-ex="${x.id}">Edit</button>
        <button type="button" class="small ghost danger" data-act="ex-delete" data-ex="${x.id}">Delete</button></span></div>
        <div class="stats">${EX_FIELDS.slice(0, 3).map(([f, l]) =>
          `<div class="stat"><span class="stat-l">${l}</span><span class="stat-v${x[f] ? '' : ' none'}">${x[f] ? esc(x[f]) : '—'}</span></div>`).join('')}</div>
        ${x.notes ? `<p class="ex-note">${para(x.notes)}</p>` : ''}${x.purposes.length ? exPurposeTags(x.purposes)
          : '<span class="ex-purposes"><span class="tag warn">Needs a Purpose</span></span>'}</article>`).join('')
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

// ---------- The exercise browser: + Add Exercises in the plan editor ----------
// Every master exercise, found by search and purpose chips. Under EXB_WIDE it's a sheet (#exSheet): tick as many as
// you like, then Add n Exercises. On a wide screen it's a panel beside the sessions (#exPanel, drawn by renderEditor),
// where each row's + Add adds straight away to the shown session (exb.sid, the last one clicked). Either way the
// exercise's values are copied (addExercises). Typed text that isn't on the list can be added as a new exercise,
// which Save Plan puts on the list (addToMasterList). Used Lately: the exercises most used in this plan and the
// coach's last few plans (draft.recent).
const EXB_WIDE = matchMedia('(min-width: 1000px)');   // matches .plan-work in styles.css
const EXB_RECENT = 5;
const exb = { q: '', purpose: '', picked: new Map(), sid: null };   // picked: key → name, in the order ticked
const EXB_ICON = {
  search: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  tick: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
};
// "5 × 4 tries · Rest 3 min": an exercise's values on one line (rest: say "Rest").
const exSummary = (x, rest = true) => {
  const v = f => String(x[f] ?? '').trim(), sets = v('sets'), reps = v('reps');
  return [sets && reps ? `${sets} × ${reps}` : sets || reps, v('rest') && (rest ? `Rest ${v('rest')}` : v('rest'))].filter(Boolean).join(' · ');
};
const exbHit = (s, q) => { const i = q ? s.toLowerCase().indexOf(q) : -1;
  return i < 0 ? esc(s) : `${esc(s.slice(0, i))}<mark>${esc(s.slice(i, i + q.length))}</mark>${esc(s.slice(i + q.length))}`; };
const exbShellHTML = () => `<div class="exb-search">${EXB_ICON.search}<input type="search" value="${esc(exb.q)}" placeholder="Search by name or purpose" aria-label="Search exercises" autocomplete="off"></div>
  <div class="exb-chips" role="tablist" aria-label="Purposes"></div><div class="exb-list"></div>`;

// The master exercises matching the search (names first, as in #exMenu) and a purpose.
function exbMatches(purpose = exb.purpose) {
  const q = exKey(exb.q);
  const rank = x => !q || x.name_key.startsWith(q) ? 0 : x.name_key.includes(q) ? 1 : (x.purposes ?? []).some(h => exKey(h).includes(q)) ? 2 : 3;
  return draft.library.filter(x => rank(x) < 3 && (!purpose || (x.purposes ?? []).includes(purpose)))
    .sort((a, b) => (rank(a) - rank(b)) || a.name_key.localeCompare(b.name_key));
}

// here: the session's own exercises, left out (they're already in it).
function exbRecent(here) {
  const n = new Map();
  for (const x of [...draft.recent, ...draft.sessions.flatMap(s => s.exercises)]) {
    const k = exKey(x.name);
    if (k) n.set(k, (n.get(k) || 0) + 1);
  }
  return draft.library.filter(x => n.has(x.name_key) && !here.has(x.name_key))
    .sort((a, b) => (n.get(b.name_key) - n.get(a.name_key)) || a.name_key.localeCompare(b.name_key)).slice(0, EXB_RECENT);
}

// All, then the purposes in use among the search's matches, with counts (a picked one stays, even at 0).
function exbChipsHTML() {
  const all = exbMatches(''), n = new Map();
  all.forEach(x => (x.purposes ?? []).forEach(h => n.set(h, (n.get(h) || 0) + 1)));
  if (exb.purpose && !n.has(exb.purpose)) n.set(exb.purpose, 0);
  const chip = (g, label, k) => `<button type="button" role="tab" data-purpose="${esc(g)}" aria-selected="${g === exb.purpose}">${esc(label)}<span class="count">${k}</span></button>`;
  return chip('', 'All', all.length) + [...n].sort((a, b) => a[0].localeCompare(b[0])).map(([g, k]) => chip(g, g, k)).join('');
}

// wide: the panel's rows (+ Add) instead of the sheet's (a tick to press).
function exbListHTML(wide) {
  const s = draft.sessions.find(x => x.id === exb.sid);
  const here = new Set((s?.exercises ?? []).map(x => exKey(x.name)));
  const q = exKey(exb.q), text = exb.q.trim(), list = exbMatches();
  const item = x => {
    const tag = here.has(x.name_key) ? '<span class="tag">In Session</span>' : '', sum = exSummary(x, false);
    const sub = x.purposes?.length ? `<span class="exb-sub">${x.purposes.map(h => exbHit(h, q)).join(' · ')}</span>` : '';
    if (wide) return `<li class="exb-item"><span class="exb-main"><span class="exb-name">${exbHit(x.name, q)}${tag}</span>
      ${sum ? `<span class="exb-val">${esc(sum)}</span>` : ''}${sub}</span><button type="button" class="small" data-add="${esc(x.name_key)}">+ Add</button></li>`;
    const on = exb.picked.has(x.name_key);
    return `<li><button type="button" class="exb-item" data-key="${esc(x.name_key)}" aria-pressed="${on}"><span class="tick">${on ? EXB_ICON.tick : ''}</span>
      <span class="exb-main"><span class="exb-name">${exbHit(x.name, q)}${tag}</span>${sub}</span>${sum ? `<span class="exb-val">${esc(sum)}</span>` : ''}</button></li>`;
  };
  let head;
  if (text) head = `${exb.purpose ? `${esc(exb.purpose)}: ` : ''}Matches for “${esc(text)}” · ${list.length}`;
  else if (exb.purpose) head = `${esc(exb.purpose)} · ${list.length}`;
  else {
    const recent = draft.library.length > 8 ? exbRecent(here) : [];
    head = recent.length ? `Used Lately</h3><ul>${recent.map(item).join('')}</ul><h3 class="exb-grp">All, A to Z` : 'All, A to Z';
  }
  // Not on the list yet: add the typed text as a new exercise.
  const isNew = text && !draft.library.some(x => x.name_key === q), nk = 'new:' + q;
  const sub = 'Not on the list? Adds it here, and to Exercises &amp; Drills when you save.';
  const add = !isNew ? '' : wide
    ? `<li class="exb-item"><span class="exb-main"><span class="exb-name">New Exercise “${esc(text)}”</span><span class="exb-sub">${sub}</span></span><button type="button" class="small" data-new>+ Add</button></li>`
    : `<li><button type="button" class="exb-item exb-new" data-new aria-pressed="${exb.picked.has(nk)}"><span class="${exb.picked.has(nk) ? 'tick' : 'plus'}">${exb.picked.has(nk) ? EXB_ICON.tick : EXB_ICON.plus}</span>
      <span class="exb-main"><span class="exb-name">New Exercise “${esc(text)}”</span><span class="exb-sub">${sub}</span></span></button></li>`;
  const none = list.length ? '' : `<p class="muted exb-none">${draft.library.length ? 'No exercise matches that.' : 'Nothing on your Exercises &amp; Drills list yet. Type a name to add a new one.'}</p>`;
  return `<h3 class="exb-grp">${head}</h3>${none}<ul>${list.map(item).join('')}${add}</ul>`;
}

function exbRender(root, wide) {
  root.querySelector('.exb-chips').innerHTML = exbChipsHTML();
  root.querySelector('.exb-list').innerHTML = exbListHTML(wide);
  if (wide) return;
  const n = exb.picked.size, add = root.querySelector('[data-addpicked]');
  root.querySelector('.exb-count').textContent = n ? `${n} Picked` : '';
  root.querySelector('[data-clear]').disabled = !n;
  add.disabled = !n;
  add.textContent = n ? `Add ${n} Exercise${n === 1 ? '' : 's'}` : 'Add Exercises';
}

const exSheet = Object.assign(document.createElement('dialog'), { id: 'exSheet', className: 'exb-sheet' });
exSheet.setAttribute('aria-labelledby', 'exSheetTitle');
document.body.append(exSheet);

// + Add Exercises: the sheet, or on a wide screen the panel's search.
function openExBrowser(sid) {
  exb.sid = sid;
  const panel = $('#exPanel');
  if (EXB_WIDE.matches && panel) { renderExPanel(); panel.querySelector('input').focus(); return; }
  exb.q = ''; exb.purpose = ''; exb.picked.clear();
  exSheet.innerHTML = `<div class="exb-head"><div><h2 id="exSheetTitle">Add Exercises</h2><p class="hint">To ${esc(sessionLabelOf(sid))} · tick as many as you like</p></div>
    <button type="button" class="exb-close" data-close aria-label="Close">${EXB_ICON.close}</button></div>
    ${exbShellHTML()}
    <div class="exb-foot"><button type="button" class="exb-clear" data-clear>Clear</button><span class="exb-count" aria-live="polite"></span>
      <button type="button" class="exb-add" data-addpicked>Add Exercises</button></div>`;
  exbRender(exSheet, false);
  exSheet.showModal();
}

exSheet.addEventListener('input', e => { exb.q = e.target.value; exbRender(exSheet, false); });
// Its search and picks end with it (the wide-screen panel shares exb).
exSheet.addEventListener('close', () => { exb.q = ''; exb.purpose = ''; exb.picked.clear(); });
exSheet.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset;
  if ('close' in d) return exSheet.close();
  if ('addpicked' in d) { const names = [...exb.picked.values()]; exSheet.close(); return addExercises(exb.sid, names); }
  // Redraws replace the buttons, so the focus goes back to the same one.
  let again = null;
  if (d.purpose != null) { exb.purpose = d.purpose; again = `[data-purpose="${CSS.escape(d.purpose)}"]`; }
  else if (d.key) {
    const x = draft.library.find(y => y.name_key === d.key);
    if (exb.picked.has(d.key)) exb.picked.delete(d.key); else exb.picked.set(d.key, x.name);
    again = `[data-key="${CSS.escape(d.key)}"]`;
  } else if ('new' in d) {
    const k = 'new:' + exKey(exb.q);
    if (exb.picked.has(k)) exb.picked.delete(k); else exb.picked.set(k, exb.q.trim().slice(0, 200));
    again = '[data-new]';
  } else if ('clear' in d) exb.picked.clear();
  else return;
  exbRender(exSheet, false);
  (again && exSheet.querySelector(again))?.focus();
});

// The wide-screen panel, after renderEditor draws it: for the shown session the coach last clicked in (or the first).
function exbTargetId() {
  const shown = [...app.querySelectorAll('.session-edit:not([hidden])')].map(el => el.dataset.session);
  return shown.includes(exb.sid) ? exb.sid : shown[0] ?? null;
}
function renderExPanel() {
  const p = $('#exPanel');
  if (!p) return;
  exb.sid = exbTargetId();
  p.querySelector('.exb-to').textContent = exb.sid ? `Adds to ${sessionLabelOf(exb.sid)}` : 'Add a session first.';
  exbRender(p, true);
}
function exPanelClick(e) {
  const b = e.target.closest('button'), d = b?.dataset;
  if (!b) return;
  if (d.purpose != null) { exb.purpose = d.purpose; renderExPanel(); $(`#exPanel [data-purpose="${CSS.escape(d.purpose)}"]`)?.focus(); }
  else if (d.add) addExercises(exb.sid, [draft.library.find(y => y.name_key === d.add).name]);
  else if ('new' in d) { const t = exb.q.trim().slice(0, 200); exb.q = ''; addExercises(exb.sid, [t]); }
}
