// ---------- A location: #/loc/<id> (Summary, summary.js; also #/loc/<id>/summary), #/loc/<id>/calendar and #/loc/<id>/team. Every team member: #/members ----------
// A member is on one team (location) or several (team_member_locations). A coach sees the members of their teams.

let teamTab = 'active';     // Active, Moved or Former members, kept while moving around
let teamSearch = '';
let membersTeam = '';       // the All Members page's team filter: '' (every team), a location id, or 'several'
let lastLoc = null;         // the list last shown (a location id, or 'members'), for the member page's breadcrumbs

async function locationPage(id, sub) {
  const t = ++navToken;
  // Another tab of the location on screen: keep it (with the new tab lit) until this one is ready, instead of Loading.
  const tabs = app.querySelector(`nav.tabs[data-loc="${id}"]`);
  if (tabs) tabs.querySelectorAll('a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === location.hash));
  else view(loading);
  const [loc, coaches] = await Promise.all([
    sb.from('team_locations').select('id, name').eq('id', id).maybeSingle().then(must),
    sb.from('team_staff_locations').select('staff:team_staff(name, email, roles)').eq('location_id', id).then(must),
  ]);
  if (t !== navToken) return;
  if (!loc) return view(`${crumbs([['Home', '#/'], ['Not Found']])}<section class="card"><h2>Location Not Found</h2>
    <p class="muted">It may have been removed, or you aren't assigned to it.</p></section>`);
  lastLoc = loc.id;
  const tab = ['calendar', 'team'].includes(sub) ? sub : 'summary';   // a location opens on its Summary
  const names = coaches.map(c => c.staff).filter(s => s?.roles.includes('coach')).map(s => s.name || s.email).sort();
  const tabLink = (key, label, href) => `<a href="${href}" class="${tab === key ? 'on' : ''}" ${tab === key ? 'aria-current="page"' : ''}>${label}</a>`;
  const head = `${crumbs([['Home', '#/'], [loc.name]])}
    <div class="page-head"><div><h1 class="big">${esc(loc.name)}</h1>
      <p class="muted">${names.length ? `Coaches: ${names.map(esc).join(', ')}` : 'No coaches assigned yet.'}</p></div></div>
    <nav class="tabs" aria-label="Location" data-loc="${id}">${tabLink('summary', 'Summary', `#/loc/${id}`)}${tabLink('calendar', 'Calendar', `#/loc/${id}/calendar`)}
      ${tabLink('team', 'Team', `#/loc/${id}/team`)}</nav>`;
  return tab === 'calendar' ? calendarTab(loc, head, t) : tab === 'summary' ? summaryTab(loc, head, t) : teamTabView(loc, head, t);
}

// A member's team_member_locations rows → m.teams (location ids) and m.inactive ({location id: inactive since}).
// Inactive on a team: still on it (switched locations, say), but under Moved there and not counted.
function inactiveOn(m) {
  m.inactive = Object.fromEntries(m.teams.filter(x => x.inactive_on).map(x => [x.location_id, x.inactive_on]));
  m.teams = m.teams.map(x => x.location_id);
}

// Every member this person can see, each with `teams` (location ids), plus the latest check-in per member and the
// circuits and locations to show them with.
async function loadMembers() {
  const [members, checkins, circuits, locs] = await Promise.all([
    sb.from('team_members').select('id, first_name, name, pronouns, joined_on, left_on, email, intake_why, intake_wants, teams:team_member_locations(location_id, inactive_on)')
      .order('first_name').order('last_name').then(must),
    sb.from('team_checkins').select('member_id, checkin_date, circuit_id').order('checkin_date', { ascending: false }).then(must),
    sb.from('team_circuits').select('id, name, color').then(must),
    sb.from('team_locations').select('id, name').order('position').order('name').then(must),
  ]);
  for (const m of members) inactiveOn(m);
  const latest = {};
  for (const c of checkins) latest[c.member_id] ??= c;   // newest first
  return { members, latest, circuits, locs };
}

// Active / Moved / Former, a search box and the member cards. teamChips(m) adds chips for the teams they're on;
// moved(m) says who goes under Moved (still on Adult Team, inactive here). Former is everyone who left Adult Team.
// Moved and Former show only when someone is in them.
// Two members with the same name get a line telling them apart: when they joined, and their email if there is one.
function membersView(head, list, { latest, circuits, teamChips, moved: isMoved, tools = '', empty }) {
  const named = {};
  for (const m of list) named[m.name.toLowerCase()] = (named[m.name.toLowerCase()] || 0) + 1;
  const tellApart = m => named[m.name.toLowerCase()] < 2 ? ''
    : `<span class="person-sub">${esc([m.joined_on ? `Joined ${fmtMonthYear(m.joined_on)}` : '', m.email || ''].filter(Boolean).join(' · ') || 'Same name as another member')}</span>`;
  const former = list.filter(m => m.left_on), moved = list.filter(m => !m.left_on && isMoved(m)),
    active = list.filter(m => !m.left_on && !isMoved(m));
  const groups = { active, moved, former };
  if (!groups[teamTab]?.length) teamTab = 'active';
  const card = m => {
    const c = latest[m.id], circ = c && circuits.find(x => x.id === c.circuit_id);
    const chips = [
      teamChips(m),
      !m.intake_why.trim() && !m.intake_wants.trim() ? '<span class="chip warn">Needs Intake</span>' : '',
      circ ? circuitChip(circ) : '',
      c ? `<span class="chip">Checked in ${fmtShort(c.checkin_date)}</span>` : '<span class="chip soft">No check-in yet</span>',
      m.left_on ? `<span class="chip soft">Left ${fmtShort(m.left_on)}</span>` : '',
    ].join('');
    return `<a class="person" href="#/member/${m.id}" data-name="${esc(m.name.toLowerCase())}"><span class="ini">${esc(initials(m.name))}</span>
      <span class="person-main"><b>${esc(m.name)}${pronounsTag(m.pronouns)}</b>${tellApart(m)}<span class="chips">${chips}</span></span></a>`;
  };
  const shown = groups[teamTab];
  const seg = (key, label) => key === 'active' || groups[key].length
    ? `<button type="button" data-team="${key}" class="${teamTab === key ? 'on' : ''}">${label} <span class="count">${groups[key].length}</span></button>` : '';
  view(`${head}
    <div class="row between list-tools">
      <div class="seg" role="group" aria-label="Show">${seg('active', 'Active')}${seg('moved', 'Moved')}${seg('former', 'Former')}</div>
      ${tools}
    </div>
    ${list.length > 6 ? `<input type="search" id="teamSearch" class="search" placeholder="Search by name" value="${esc(teamSearch)}" aria-label="Search by name">` : ''}
    <div class="people" id="people">${shown.length ? shown.map(card).join('') : empty}</div>
    <p class="muted" id="noMatch" hidden>No one matches that search.</p>`, { keepScroll: true });

  const filter = () => {
    const q = teamSearch.trim().toLowerCase();
    let n = 0;
    app.querySelectorAll('#people .person').forEach(p => { p.hidden = !!q && !p.dataset.name.includes(q); n += !p.hidden; });
    $('#noMatch').hidden = !q || !!n;
  };
  filter();
  $('#teamSearch')?.addEventListener('input', e => { teamSearch = e.target.value; filter(); });
  app.onclick = e => {
    const b = e.target.closest('[data-team]');
    if (b) { teamTab = b.dataset.team; redraw(); }
  };
}

async function teamTabView(loc, head, t) {
  const { members, latest, circuits, locs } = await loadMembers();
  if (t !== navToken) return;
  // The other teams they're active on (a coach may not see that location's name): Also on X, or Now at X once moved from here.
  const also = m => m.left_on ? '' : (m.inactive[loc.id] ? `<span class="chip soft">Moved ${fmtShort(m.inactive[loc.id])}</span>` : '')
    + m.teams.filter(id => id !== loc.id && !m.inactive[id]).map(id =>
      `<span class="chip soft">${m.inactive[loc.id] ? 'Now at' : 'Also on'} ${esc(locs.find(l => l.id === id)?.name || 'another team')}</span>`).join('');
  membersView(head, members.filter(m => m.teams.includes(loc.id)), { latest, circuits, teamChips: also, moved: m => !!m.inactive[loc.id],
    tools: '<button type="button" id="addMember" class="fill">+ Add Member</button>',
    empty: `<section class="card empty"><h2>No Team Members Yet</h2><p class="muted">Add the first member of the ${esc(loc.name)} team.</p></section>` });
  $('#addMember').onclick = () => addMember(loc);
}

// Every team member, with the teams they're on.
async function membersPage() {
  const t = ++navToken;
  view(loading);
  const { members, latest, circuits, locs } = await loadMembers();
  if (t !== navToken) return;
  lastLoc = 'members';
  if (membersTeam && membersTeam !== 'several' && !locs.some(l => l.id === membersTeam)) membersTeam = '';
  const list = members.filter(m => !membersTeam || (membersTeam === 'several' ? m.teams.length > 1 : m.teams.includes(membersTeam)));
  const teams = m => locs.filter(l => m.teams.includes(l.id)).map(l => m.inactive[l.id]
      ? `<span class="chip soft">${esc(l.name)} (Inactive)</span>` : `<span class="chip strong">${esc(l.name)}</span>`).join('')
    + (m.teams.some(id => !locs.some(l => l.id === id)) ? '<span class="chip soft">Another team</span>' : '');
  // Moved: picked a location, inactive there; all of them, inactive on every team they're on.
  const moved = m => membersTeam && membersTeam !== 'several' ? !!m.inactive[membersTeam] : m.teams.every(id => m.inactive[id]);
  const head = `${crumbs([['Home', '#/'], ['Team Members']])}
    <div class="page-head"><div><h1 class="big">Team Members</h1>
      <p class="muted">Everyone on ${me.isAdmin ? 'a team' : 'your teams'} and which teams they're on.</p></div></div>`;
  membersView(head, list, { latest, circuits, teamChips: teams, moved,
    tools: locs.length > 1 ? `<label class="inline">Location:<select id="membersTeam" class="team-filter">
      <option value="">All Locations</option>${locs.map(l => `<option value="${l.id}"${l.id === membersTeam ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}
      <option value="several"${membersTeam === 'several' ? ' selected' : ''}>On Several Teams</option></select></label>` : '',
    empty: `<section class="card empty"><h2>No Team Members${membersTeam ? ' Here' : ' Yet'}</h2><p class="muted">${membersTeam ? 'Pick another team.'
      : 'Add members from a location’s Team tab.'}</p></section>` });
  $('#membersTeam')?.addEventListener('change', e => { membersTeam = e.target.value; redraw(); });
}

async function addMember(loc) {
  const f = await ask({ title: `Add Member to ${loc.name}`, ok: 'Add Member',
    body: `<div class="two"><label>First Name<input name="first_name" maxlength="60" required data-need="Enter their first name." autocomplete="off"></label>
      <label>Last Name<input name="last_name" maxlength="60" required data-need="Enter their last name." autocomplete="off"></label></div>
      ${pronounsField('', true)}
      <label>Email <span class="muted">(optional, just for contact)</span><input type="email" name="email" autocomplete="off"></label>
      <label>Joined the Team<input type="date" name="joined_on" value="${today()}" required data-need="Pick the day they joined."></label>
      <p class="hint">On another team too? Add it under Details on their page.</p>` });
  if (!f) return;
  if (!await notADuplicate(f.get('first_name').trim(), f.get('last_name').trim(), loc)) return;
  await busy(null, async () => {
    const id = await sb.rpc('team_add_member', {
      p_first: f.get('first_name').trim(), p_last: f.get('last_name').trim(), p_pronouns: readPronouns(f),
      p_email: f.get('email').trim().toLowerCase() || null, p_joined: f.get('joined_on') || null, p_locations: [loc.id],
    }).then(must);
    flash('Member added. Fill in their intake next.');
    goTo('#/member/' + id);
  });
}

// Before adding a member: is someone with this name already here? They may be the same person, who should go on this team
// rather than be added twice. Each match has Add to <location>: team_join_location puts them on it, even when the coach
// doesn't coach their other teams. Members this person can see are links; team_same_name says where the rest are.
async function notADuplicate(first, last, loc) {
  const like = s => s.replace(/[\%_]/g, '\$&');
  const [seen, locs, unseen] = await Promise.all([
    sb.from('team_members').select('id, name, pronouns, joined_on, left_on, teams:team_member_locations(location_id, inactive_on)')
      .ilike('first_name', like(first)).ilike('last_name', like(last)).then(must),
    sb.from('team_locations').select('id, name').then(must),
    sb.rpc('team_same_name', { p_first: first, p_last: last }).then(must),
  ]);
  const same = [
    ...seen.map(m => ({ id: m.id, name: m.name, pronouns: m.pronouns, here: m.teams.some(t => t.location_id === loc.id && !t.inactive_on), link: true,
      where: [m.teams.map(t => { const n = locs.find(l => l.id === t.location_id)?.name; return n && (t.inactive_on ? `${n} (inactive)` : n); }).filter(Boolean).join(', '),
        m.joined_on ? `joined ${fmtMonthYear(m.joined_on)}` : '', m.left_on ? 'left the team' : ''] })),
    ...unseen.map(u => ({ id: u.member_id, name: `${first} ${last}`, pronouns: u.pronouns, here: false,
      where: [u.locations || 'no team', u.left_team ? 'left the team' : ''] })),
  ];
  if (!same.length) return true;
  // Name (pronouns), where they are on the line under it, then the button below (the hint says "below their name").
  const row = m => `<li><span>${m.link ? `<a href="#/member/${m.id}">${esc(m.name)}</a>` : esc(m.name)}${m.pronouns ? ` <span class="muted">(${esc(m.pronouns)})</span>` : ''}</span>
    <span class="muted small-text">${esc(m.where.filter(Boolean).join(' · '))}</span>
    ${m.here ? `<span class="tag">Already on ${esc(loc.name)}</span>`
      : `<button type="button" class="small hover-fill" data-join="${m.id}">Add to ${esc(loc.name)}</button>`}</li>`;
  return !!await ask({ title: 'This Person May Exist on Another Team', ok: 'Add New Person', okClass: 'hover-fill',
    body: `<p>${same.length === 1 ? 'There is already a team member' : `There are already ${same.length} team members`} with this name:</p>
      <ul class="dupes">${same.map(row).join('')}</ul>
      <p class="hint">If it's the same person, click the button below their name to add them to ${esc(loc.name)}. Click the Add New Person button if it's someone new to Adult Team.</p>`,
    onOpen: form => form.addEventListener('click', e => {
      if (e.target.closest('a')) return $('#dlg').close();
      const b = e.target.closest('[data-join]');
      if (!b) return;
      const m = same.find(x => x.id === b.dataset.join);
      $('#dlg').close();
      busy(null, async () => {
        await sb.rpc('team_join_location', { p_member: m.id, p_location: loc.id }).then(must);
        flash(`${m.name} is now on the ${loc.name} team.`);
        goTo('#/member/' + m.id);
      });
    }) });
}
