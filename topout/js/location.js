// ---------- A location: #/loc/<id> (Team) and #/loc/<id>/calendar ----------

let teamTab = 'active';     // Active or Former members, kept while moving around
let teamSearch = '';

async function locationPage(id, sub) {
  const t = ++navToken;
  view(loading);
  const [loc, coaches] = await Promise.all([
    sb.from('team_locations').select('id, name').eq('id', id).maybeSingle().then(must),
    sb.from('team_staff_locations').select('staff:team_staff(name, email, roles)').eq('location_id', id).then(must),
  ]);
  if (t !== navToken) return;
  if (!loc) return view(`${crumbs([['Home', '#/'], ['Not Found']])}<section class="card"><h2>Location Not Found</h2>
    <p class="muted">It may have been removed, or you aren't assigned to it.</p></section>`);
  const cal = sub === 'calendar';
  const names = coaches.map(c => c.staff).filter(s => s?.roles.includes('coach')).map(s => s.name || s.email).sort();
  const head = `${crumbs([['Home', '#/'], [loc.name]])}
    <div class="page-head"><div><h1 class="big">${esc(loc.name)}</h1>
      <p class="muted">${names.length ? `Coaches: ${names.map(esc).join(', ')}` : 'No coaches assigned yet.'}</p></div></div>
    <nav class="tabs" aria-label="Location">
      <a href="#/loc/${id}" class="${cal ? '' : 'on'}" ${cal ? '' : 'aria-current="page"'}>Team</a>
      <a href="#/loc/${id}/calendar" class="${cal ? 'on' : ''}" ${cal ? 'aria-current="page"' : ''}>Calendar</a></nav>`;
  return cal ? calendarTab(loc, head, t) : teamTabView(loc, head, t);
}

async function teamTabView(loc, head, t) {
  const [members, checkins, circuits] = await Promise.all([
    sb.from('team_members').select('id, first_name, name, pronouns, joined_on, left_on, intake_why, intake_wants')
      .eq('location_id', loc.id).order('first_name').order('last_name').then(must),
    sb.from('team_checkins').select('member_id, checkin_date, circuit_id, member:team_members!inner(location_id)')
      .eq('member.location_id', loc.id).order('checkin_date', { ascending: false }).then(must),
    sb.from('team_circuits').select('id, name, color').then(must),
  ]);
  if (t !== navToken) return;
  const latest = {};
  for (const c of checkins) latest[c.member_id] ??= c;   // newest first
  const active = members.filter(m => !m.left_on), former = members.filter(m => m.left_on);
  if (teamTab === 'former' && !former.length) teamTab = 'active';

  const card = m => {
    const c = latest[m.id], circ = c && circuits.find(x => x.id === c.circuit_id);
    const chips = [
      !m.intake_why.trim() && !m.intake_wants.trim() ? '<span class="chip warn">Needs Intake</span>' : '',
      circ ? circuitChip(circ) : '',
      c ? `<span class="chip">Checked in ${fmtShort(c.checkin_date)}</span>` : '<span class="chip soft">No check-in yet</span>',
      m.left_on ? `<span class="chip soft">Left ${fmtShort(m.left_on)}</span>` : '',
    ].join('');
    return `<a class="person" href="#/member/${m.id}" data-name="${esc(m.name.toLowerCase())}"><span class="ini">${esc(initials(m.name))}</span>
      <span class="person-main"><b>${esc(m.name)}${pronounsTag(m.pronouns)}</b><span class="chips">${chips}</span></span></a>`;
  };
  const list = teamTab === 'former' ? former : active;
  view(`${head}
    <div class="row between list-tools">
      <div class="seg" role="group" aria-label="Show">
        <button type="button" data-team="active" class="${teamTab === 'active' ? 'on' : ''}">Active <span class="count">${active.length}</span></button>
        ${former.length ? `<button type="button" data-team="former" class="${teamTab === 'former' ? 'on' : ''}">Former <span class="count">${former.length}</span></button>` : ''}
      </div>
      <button type="button" id="addMember" class="fill">+ Add Member</button>
    </div>
    ${members.length > 6 ? `<input type="search" id="teamSearch" class="search" placeholder="Search by name" value="${esc(teamSearch)}" aria-label="Search by name">` : ''}
    <div class="people" id="people">${list.length ? list.map(card).join('')
      : `<section class="card empty"><h2>No Team Members Yet</h2><p class="muted">Add the first member of the ${esc(loc.name)} team.</p></section>`}</div>
    <p class="muted" id="noMatch" hidden>No one matches that search.</p>`, { keepScroll: true });

  const filter = () => {
    const q = teamSearch.trim().toLowerCase();
    let shown = 0;
    app.querySelectorAll('#people .person').forEach(p => { p.hidden = !!q && !p.dataset.name.includes(q); shown += !p.hidden; });
    $('#noMatch').hidden = !q || !!shown;
  };
  filter();
  $('#teamSearch')?.addEventListener('input', e => { teamSearch = e.target.value; filter(); });
  app.onclick = e => {
    const b = e.target.closest('[data-team]');
    if (b) { teamTab = b.dataset.team; route(); }
  };
  $('#addMember').onclick = () => addMember(loc);
}

async function addMember(loc) {
  const f = await ask({ title: `Add Member to ${loc.name}`, ok: 'Add Member',
    body: `<div class="two"><label>First Name<input name="first_name" maxlength="60" required data-need="Enter their first name." autocomplete="off"></label>
      <label>Last Name<input name="last_name" maxlength="60" autocomplete="off"></label></div>
      ${pronounsField()}
      <label>Email <span class="muted">(optional, just for contact)</span><input type="email" name="email" autocomplete="off"></label>
      <label>Joined the Team<input type="date" name="joined_on" value="${today()}"></label>` });
  if (!f) return;
  await busy(null, async () => {
    const row = await sb.from('team_members').insert({
      location_id: loc.id, first_name: f.get('first_name').trim(), last_name: f.get('last_name').trim(), pronouns: readPronouns(f),
      email: f.get('email').trim().toLowerCase() || null, joined_on: f.get('joined_on') || null,
    }).select('id').single().then(must);
    flash('Member added. Fill in their intake next.');
    goTo('#/member/' + row.id);
  });
}
