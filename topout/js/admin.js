// ---------- Admin: #/staff and #/settings ----------

// ---------- Staff ----------
// Everyone on team_staff (team_staff_list() adds their last sign-in and locations). Adding someone sends the invite.
// A coach sees only the locations ticked for them; admins see every location.

const staffStatus = s => s.last_sign_in_at ? 'Active' : s.invited_at ? 'Invited' : 'Not Invited';

async function staffPage() {
  const t = ++navToken;
  view(loading);
  const [staff, locs] = await Promise.all([
    sb.rpc('team_staff_list').then(must),
    sb.from('team_locations').select('id, name').order('position').then(must),
  ]);
  if (t !== navToken) return;
  const locName = id => locs.find(l => l.id === id)?.name;
  const card = s => {
    const st = staffStatus(s);
    const where = s.roles.includes('admin') ? ['Every Location'] : s.location_ids.map(locName).filter(Boolean);
    return `<button type="button" class="person" data-staff="${s.id}"><span class="ini">${esc(initials(s.name || s.email))}</span>
      <span class="person-main"><b>${esc(s.name || s.email)}${pronounsTag(s.pronouns)}${s.owner ? ' <span class="tag">Owner</span>' : ''}</b>
        <span class="muted small-text">${esc(s.email)}</span>
        <span class="chips">${s.roles.map(r => `<span class="chip strong">${ROLE_LABEL[r]}</span>`).join('')}
          ${where.length ? where.map(w => `<span class="chip">${esc(w)}</span>`).join('') : '<span class="chip warn">No Location</span>'}
          ${st === 'Active' ? '' : `<span class="chip ${st === 'Not Invited' ? 'warn' : 'soft'}">${st}</span>`}</span></span></button>`;
  };
  view(`${crumbs([['Home', '#/'], ['Staff']])}
    <div class="page-head"><h1 class="big">Staff</h1><button type="button" id="addStaff" class="fill">+ Add Staff</button></div>
    <p class="hint">Admins see every location and manage staff and settings. Coaches see the locations ticked for them.
      Sign-in is shared with Sit Start, but being on this list is what opens Top Out.</p>
    <div class="people">${staff.map(card).join('')}</div>`, { keepScroll: true });
  $('#addStaff').onclick = () => staffForm(null, locs);
  app.onclick = e => {
    const b = e.target.closest('[data-staff]');
    if (b) staffForm(staff.find(s => s.id === b.dataset.staff), locs);
  };
}

async function staffForm(s, locs) {
  const self = s && s.email === me.user.email.toLowerCase();
  const roles = s?.roles || ['coach'], at = s?.location_ids || [];
  const lockAdmin = s?.owner;   // the owner always keeps Admin
  const st = s && staffStatus(s);
  const f = await ask({ title: s ? (s.name || s.email) : 'Add Staff', ok: s ? 'Save' : 'Add & Send Invite', wide: true,
    extra: s && !self && !s.owner ? { value: 'remove', label: 'Remove' } : null,
    body: `${s ? `<p class="muted">${esc(s.email)} · ${st}</p>`
        : `<label>Email<input type="email" name="email" required data-need="Enter their email." autocomplete="off"></label>
          <p class="hint" id="lookHint" role="status" hidden></p>`}
      <div class="two"><label>First Name<input name="first_name" maxlength="60" required value="${esc(s?.first_name || '')}" data-need="Enter their first name." autocomplete="off"></label>
        <label>Last Name<input name="last_name" maxlength="60" value="${esc(s?.last_name || '')}" autocomplete="off"></label></div>
      ${pronounsField(s?.pronouns || '')}
      <fieldset><legend>Roles</legend>
        <label class="check"><input type="checkbox" name="role" value="coach"${roles.includes('coach') ? ' checked' : ''}> Coach <span class="muted">— members, notes, check-ins and the calendar at their locations</span></label>
        <label class="check"><input type="checkbox" name="role" value="admin"${roles.includes('admin') ? ' checked' : ''}${lockAdmin ? ' disabled' : ''}> Admin <span class="muted">— every location, staff and settings</span></label>
        ${self ? '<p class="hint">You can’t take Admin off yourself.</p>' : ''}
      </fieldset>
      <fieldset><legend>Coaches At</legend>
        ${locs.map(l => `<label class="check"><input type="checkbox" name="loc" value="${l.id}"${at.includes(l.id) ? ' checked' : ''}> ${esc(l.name)}</label>`).join('')}
        <p class="hint">Admins see every location anyway. Tick where they coach so they show on the location page.</p>
      </fieldset>
      ${s && st !== 'Active' ? '<label class="check"><input type="checkbox" name="resend"> Send the Invite Again</label>' : ''}
      ${s && st === 'Active' ? '<label class="check"><input type="checkbox" name="resend"> Email a Sign-In Link <span class="muted">(e.g. they forgot their password)</span></label>' : ''}`,
    onOpen: form => {
      const boxes = [...form.querySelectorAll('[name="role"]')];
      if (self) boxes.find(b => b.value === 'admin').disabled = true;
      const need = () => { const none = !boxes.some(b => b.checked); boxes[0].setCustomValidity(none ? 'Pick at least one role.' : ''); boxes[0].dataset.need = 'Pick at least one role.'; };
      boxes.forEach(b => b.addEventListener('change', need)); need();
      if (!s) watchLookup(form);
    } });
  if (!f) return;
  if (f.get('button') === 'remove') {
    if (!await confirmDelete('Remove From Staff?', `${esc(s.name || s.email)} won't be able to open Top Out anymore. Their notes and check-ins
      stay, signed with their name. Their login stays too, in case they use Sit Start.`)) return;
    return busy(null, async () => { await sb.from('team_staff').delete().eq('id', s.id).then(must); flash('Removed from staff.'); redraw(); });
  }
  // Disabled boxes (a locked Admin) don't submit, so add those back.
  let newRoles = f.getAll('role');
  if ((lockAdmin || self) && roles.includes('admin') && !newRoles.includes('admin')) newRoles.push('admin');
  newRoles = ['admin', 'coach'].filter(r => newRoles.includes(r));
  const newLocs = f.getAll('loc');
  const row = { first_name: f.get('first_name').trim(), last_name: f.get('last_name').trim(), pronouns: readPronouns(f), roles: newRoles };
  await busy(null, async () => {
    let id = s?.id, email = s?.email;
    if (s) await sb.from('team_staff').update(row).eq('id', id).then(must);
    else {
      email = f.get('email').trim().toLowerCase();
      id = (await sb.from('team_staff').insert({ ...row, email }).select('id').single().then(must)).id;
    }
    // Locations: add the newly ticked, remove the unticked.
    const add = newLocs.filter(l => !at.includes(l)), drop = at.filter(l => !newLocs.includes(l));
    if (add.length) await sb.from('team_staff_locations').insert(add.map(location_id => ({ staff_id: id, location_id }))).then(must);
    if (drop.length) await sb.from('team_staff_locations').delete().eq('staff_id', id).in('location_id', drop).then(must);
    // Already has a password (e.g. from Sit Start): no invite, they sign in with it. invited_at still marks access as given.
    const look = s ? null : await staffLookup(email).catch(() => null);
    if (look?.has_password) {
      await sb.from('team_staff').update({ invited_at: new Date().toISOString() }).eq('id', id).then(must);
      flash(`Added. ${row.first_name} already has a password, so no invite was needed: they can sign in to Top Out with it now.`);
    } else if (!s || f.get('resend')) {
      const { error } = await sendLink(email, row.first_name);
      if (error) { flash(`Saved, but the email didn't send: ${msgOf(error)}`, 'error'); redraw(); return; }
      if (!s || !s.last_sign_in_at) await sb.from('team_staff').update({ invited_at: new Date().toISOString() }).eq('id', id).then(must);
      flash(s ? `Link sent to ${email}.` : `Added. The invite is on its way to ${email}.`);
    } else flash('Saved.');
    if (self) await loadMe(me.user);
    redraw();
  });
}

// ---------- Settings ----------
// Locations, circuit colors (easiest first) and rating areas. Each row saves on its own.

async function settingsPage() {
  const t = ++navToken;
  view(loading);
  const [locs, members, circuits, areas, used] = await Promise.all([
    sb.from('team_locations').select('*').order('position').order('name').then(must),
    sb.from('team_members').select('location_id').then(must),
    sb.from('team_circuits').select('*').order('position').then(must),
    sb.from('team_rating_areas').select('*').order('position').then(must),
    sb.from('team_checkins').select('circuit_id, ratings').then(must),
  ]);
  if (t !== navToken) return;
  const nMembers = id => members.filter(m => m.location_id === id).length;
  const circUsed = id => used.some(c => c.circuit_id === id);
  const areaUsed = id => used.some(c => c.ratings[id] != null);
  const moveBtns = (kind, i, n, id) => `<span class="row tight">
    <button type="button" class="small ghost" data-move="${kind}" data-id="${id}" data-dir="-1"${i ? '' : ' disabled'} aria-label="Move up">↑</button>
    <button type="button" class="small ghost" data-move="${kind}" data-id="${id}" data-dir="1"${i < n - 1 ? '' : ' disabled'} aria-label="Move down">↓</button></span>`;

  view(`${crumbs([['Home', '#/'], ['Settings']])}
    <div class="page-head"><h1 class="big">Settings</h1></div>
    <div class="settings-grid">
      <section class="card"><h2>Locations</h2>
        <p class="hint">The cards on Home, in this order. A location with members can't be deleted: move or delete them first.</p>
        ${locs.map((l, i) => `<form class="set-row" data-kind="loc" data-id="${l.id}" data-save>
          <input name="name" maxlength="60" required value="${esc(l.name)}" aria-label="Location name" data-need="Name the location.">
          <span class="muted small-text">${nMembers(l.id)} ${nMembers(l.id) === 1 ? "member" : "members"}</span>
          ${moveBtns('loc', i, locs.length, l.id)}
          <button class="small primary">Save</button>
          ${nMembers(l.id) ? '' : `<button type="button" class="small ghost danger" data-del="loc" data-id="${l.id}">Delete</button>`}</form>`).join('')}
        <form class="row add-row" data-kind="loc" data-save><input name="name" maxlength="60" required placeholder="New location" aria-label="New location" data-need="Name the location.">
          <button class="primary">+ Add</button></form>
      </section>

      <section class="card"><h2>Circuit Colors</h2>
        <p class="hint">Easiest first. The V range helps compare progress. Leave the top empty for an open-ended range, like V11+.
          A color used by a check-in can be renamed but not deleted.</p>
        ${circuits.map((c, i) => `<form class="set-row circuit-row" data-kind="circuit" data-id="${c.id}" data-save>
          <input type="color" name="color" value="${esc(c.color)}" aria-label="Color">
          <input name="name" maxlength="30" required value="${esc(c.name)}" aria-label="Name" data-need="Name the color.">
          <span class="vrange">V<input type="number" name="v_min" min="0" max="17" value="${c.v_min ?? ''}" aria-label="Lowest V grade">–V<input type="number" name="v_max" min="0" max="17" value="${c.v_max ?? ''}" aria-label="Highest V grade"></span>
          ${moveBtns('circuit', i, circuits.length, c.id)}
          <button class="small primary">Save</button>
          ${circUsed(c.id) ? '' : `<button type="button" class="small ghost danger" data-del="circuit" data-id="${c.id}">Delete</button>`}</form>`).join('')}
        <form class="row add-row" data-kind="circuit" data-save><input type="color" name="color" value="#888888" aria-label="Color">
          <input name="name" maxlength="30" required placeholder="New color" aria-label="New color" data-need="Name the color."><button class="primary">+ Add</button></form>
      </section>

      <section class="card"><h2>Rating Areas</h2>
        <p class="hint">What coaches rate 1–5 on a check-in. Hide one to leave it off new check-ins but keep old ratings.</p>
        ${areas.map((a, i) => `<form class="set-row" data-kind="area" data-id="${a.id}" data-save>
          <input name="name" maxlength="40" required value="${esc(a.name)}" aria-label="Name" data-need="Name the area.">
          <label class="check"><input type="checkbox" name="active"${a.active ? ' checked' : ''}> Shown</label>
          ${moveBtns('area', i, areas.length, a.id)}
          <button class="small primary">Save</button>
          ${areaUsed(a.id) ? '' : `<button type="button" class="small ghost danger" data-del="area" data-id="${a.id}">Delete</button>`}</form>`).join('')}
        <form class="row add-row" data-kind="area" data-save><input name="name" maxlength="40" required placeholder="New rating area" aria-label="New rating area" data-need="Name the area.">
          <button class="primary">+ Add</button></form>
      </section>
    </div>`, { keepScroll: true });

  const TABLE = { loc: 'team_locations', circuit: 'team_circuits', area: 'team_rating_areas' };
  const LIST = { loc: locs, circuit: circuits, area: areas };
  app.onsubmit = e => {
    e.preventDefault();
    const form = e.target, kind = form.dataset.kind, id = form.dataset.id, f = new FormData(form);
    const row = { name: f.get('name').trim() };
    if (kind === 'circuit') {
      row.color = f.get('color');
      if (id) {
        row.v_min = f.get('v_min') === '' ? null : +f.get('v_min');
        row.v_max = f.get('v_max') === '' ? null : +f.get('v_max');
        if (row.v_min == null && row.v_max != null) return fieldError(form.elements.v_min, 'Add the lowest grade too.');
        if (row.v_max != null && row.v_max < row.v_min) return fieldError(form.elements.v_max, 'The top can’t be below the bottom.');
      }
    }
    if (kind === 'area' && id) row.active = !!f.get('active');
    busy(e.submitter, async () => {
      if (id) await sb.from(TABLE[kind]).update(row).eq('id', id).then(must);
      else await sb.from(TABLE[kind]).insert({ ...row, position: Math.max(0, ...LIST[kind].map(x => x.position)) + 1 }).then(must);
      flash(id ? 'Saved.' : 'Added.');
      form.reset(); redraw();
    });
  };
  app.onclick = async e => {
    const mv = e.target.closest('[data-move]'), del = e.target.closest('[data-del]');
    if (mv) {
      const list = LIST[mv.dataset.move], i = list.findIndex(x => x.id === mv.dataset.id), j = i + +mv.dataset.dir;
      // Renumber the whole list in its new order (positions may have gaps or ties).
      const order = list.map(x => x.id);
      [order[i], order[j]] = [order[j], order[i]];
      return busy(mv, async () => {
        await Promise.all(order.map((id, k) => sb.from(TABLE[mv.dataset.move]).update({ position: k + 1 }).eq('id', id).then(must)));
        redraw();
      });
    }
    if (del) {
      const item = LIST[del.dataset.del].find(x => x.id === del.dataset.id);
      if (!await confirmDelete(`Delete ${item.name}?`, 'It will be gone for good.')) return;
      busy(del, async () => { await sb.from(TABLE[del.dataset.del]).delete().eq('id', item.id).then(must); flash('Deleted.'); redraw(); });
    }
  };
}

// ---------- Someone the other app already knows ----------
// Add Staff looks the email up (team_staff_lookup, admins only): Sit Start's name and pronouns fill in any empty
// fields, and a login that already has a password is added with no invite (the OK button says so).
const staffLookup = email => sb.rpc('team_staff_lookup', { p_email: email }).then(must).then(r => r[0] || null);
function watchLookup(form) {
  const els = form.elements, hint = $('#lookHint'), ok = form.querySelector('button[value="ok"]');
  let asked = '';
  els.email.addEventListener('change', async () => {
    const email = els.email.value.trim().toLowerCase();
    if (email === asked) return;
    asked = email;
    const look = email && els.email.validity.valid ? await staffLookup(email).catch(() => null) : null;
    if (email !== asked) return;   // typed again meanwhile
    const known = !!look?.first_name;
    if (known) {
      if (!els.first_name.value.trim()) els.first_name.value = look.first_name;
      if (!els.last_name.value.trim()) els.last_name.value = look.last_name;
      if (!els.pronouns.value && look.pronouns) setPronouns(form, look.pronouns);
      clearFieldError(els.first_name);
    }
    ok.textContent = look?.has_password ? 'Add Staff' : 'Add & Send Invite';
    hint.hidden = !known && !look?.has_password;
    hint.textContent = [known ? 'Already in Sit Start, so their name and pronouns are filled in.' : '',
      look?.has_password ? 'They already have a password, so there’s no invite: they can sign in to Top Out with it as soon as you add them.' : ''].join(' ').trim();
  });
}
