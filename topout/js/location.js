// ---------- A location: #/loc/<id> (Team), #/loc/<id>/summary (summary.js) and #/loc/<id>/calendar. Every team member: #/members ----------
// A member is on one team (location) or several (team_member_locations). A coach sees the members of their teams.

let teamTab = 'active';     // Active or Former members, kept while moving around
let teamSearch = '';
let membersTeam = '';       // the All Members page's team filter: '' (every team), a location id, or 'several'
let lastLoc = null;         // the list last shown (a location id, or 'members'), for the member page's breadcrumbs

async function locationPage(id, sub) {
  const t = ++navToken;
  view(loading);
  const [loc, coaches, [focus]] = await Promise.all([
    sb.from('team_locations').select('id, name').eq('id', id).maybeSingle().then(must),
    sb.from('team_staff_locations').select('staff:team_staff(name, email, roles)').eq('location_id', id).then(must),
    sb.from('team_focus').select('focus_date, body').eq('location_id', id)
      .order('focus_date', { ascending: false }).order('created_at', { ascending: false }).limit(1).then(must),
  ]);
  if (t !== navToken) return;
  if (!loc) return view(`${crumbs([['Home', '#/'], ['Not Found']])}<section class="card"><h2>Location Not Found</h2>
    <p class="muted">It may have been removed, or you aren't assigned to it.</p></section>`);
  lastLoc = loc.id;
  const tab = ['calendar', 'summary'].includes(sub) ? sub : 'team';
  const names = coaches.map(c => c.staff).filter(s => s?.roles.includes('coach')).map(s => s.name || s.email).sort();
  const tabLink = (key, label, href) => `<a href="${href}" class="${tab === key ? 'on' : ''}" ${tab === key ? 'aria-current="page"' : ''}>${label}</a>`;
  // The current Team Focus (summary.js) shows under the name, except on the Summary tab, which shows it in full.
  const head = `${crumbs([['Home', '#/'], [loc.name]])}
    <div class="page-head"><div><h1 class="big">${esc(loc.name)}</h1>
      <p class="muted">${names.length ? `Coaches: ${names.map(esc).join(', ')}` : 'No coaches assigned yet.'}</p></div></div>
    ${focus && tab !== 'summary' ? `<a class="focus-strip" href="#/loc/${id}/summary"><b>Team Focus</b><span>${esc(firstLine(focus.body))}</span>
      <small>${fmtShort(focus.focus_date)}</small></a>` : ''}
    <nav class="tabs" aria-label="Location">${tabLink('team', 'Team', `#/loc/${id}`)}${tabLink('summary', 'Summary', `#/loc/${id}/summary`)}
      ${tabLink('calendar', 'Calendar', `#/loc/${id}/calendar`)}</nav>`;
  return tab === 'calendar' ? calendarTab(loc, head, t) : tab === 'summary' ? summaryTab(loc, head, t) : teamTabView(loc, head, t);
}

// Every member this person can see, each with `teams` (location ids), plus the latest check-in per member and the
// circuits and locations to show them with.
async function loadMembers() {
  const [members, checkins, circuits, locs] = await Promise.all([
    sb.from('team_members').select('id, first_name, name, pronouns, joined_on, left_on, email, intake_why, intake_wants, teams:team_member_locations(location_id)')
      .order('first_name').order('last_name').then(must),
    sb.from('team_checkins').select('member_id, checkin_date, circuit_id').order('checkin_date', { ascending: false }).then(must),
    sb.from('team_circuits').select('id, name, color').then(must),
    sb.from('team_locations').select('id, name').order('position').order('name').then(must),
  ]);
  for (const m of members) m.teams = m.teams.map(x => x.location_id);
  const latest = {};
  for (const c of checkins) latest[c.member_id] ??= c;   // newest first
  return { members, latest, circuits, locs };
}

// Active / Former, a search box and the member cards. teamChips(m) adds chips for the teams they're on.
// Two members with the same name get a line telling them apart: when they joined, and their email if there is one.
function membersView(head, list, { latest, circuits, teamChips, tools = '', empty }) {
  const named = {};
  for (const m of list) named[m.name.toLowerCase()] = (named[m.name.toLowerCase()] || 0) + 1;
  const tellApart = m => named[m.name.toLowerCase()] < 2 ? ''
    : `<span class="person-sub">${esc([m.joined_on ? `Joined ${fmtMonthYear(m.joined_on)}` : '', m.email || ''].filter(Boolean).join(' · ') || 'Same name as another member')}</span>`;
  const active = list.filter(m => !m.left_on), former = list.filter(m => m.left_on);
  if (teamTab === 'former' && !former.length) teamTab = 'active';
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
  const shown = teamTab === 'former' ? former : active;
  view(`${head}
    <div class="row between list-tools">
      <div class="seg" role="group" aria-label="Show">
        <button type="button" data-team="active" class="${teamTab === 'active' ? 'on' : ''}">Active <span class="count">${active.length}</span></button>
        ${former.length ? `<button type="button" data-team="former" class="${teamTab === 'former' ? 'on' : ''}">Former <span class="count">${former.length}</span></button>` : ''}
      </div>
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
  // Other teams they're on (a coach may not see that location's name).
  const also = m => m.teams.filter(id => id !== loc.id).map(id =>
    `<span class="chip soft">Also ${esc(locs.find(l => l.id === id)?.name || 'another team')}</span>`).join('');
  membersView(head, members.filter(m => m.teams.includes(loc.id)), { latest, circuits, teamChips: also,
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
  const teams = m => locs.filter(l => m.teams.includes(l.id)).map(l => `<span class="chip strong">${esc(l.name)}</span>`).join('')
    + (m.teams.some(id => !locs.some(l => l.id === id)) ? '<span class="chip soft">Another team</span>' : '');
  const head = `${crumbs([['Home', '#/'], ['Team Members']])}
    <div class="page-head"><div><h1 class="big">Team Members</h1>
      <p class="muted">Everyone on ${me.isAdmin ? 'a team' : 'your teams'} and which teams they're on.</p></div></div>`;
  membersView(head, list, { latest, circuits, teamChips: teams,
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
    sb.from('team_members').select('id, name, joined_on, left_on, teams:team_member_locations(location_id)')
      .ilike('first_name', like(first)).ilike('last_name', like(last)).then(must),
    sb.from('team_locations').select('id, name').then(must),
    sb.rpc('team_same_name', { p_first: first, p_last: last }).then(must),
  ]);
  const same = [
    ...seen.map(m => ({ id: m.id, name: m.name, here: m.teams.some(t => t.location_id === loc.id), link: true,
      where: [m.teams.map(t => locs.find(l => l.id === t.location_id)?.name).filter(Boolean).join(', '),
        m.joined_on ? `joined ${fmtMonthYear(m.joined_on)}` : '', m.left_on ? 'left the team' : ''] })),
    ...unseen.map(u => ({ id: u.member_id, name: `${first} ${last}`, here: false,
      where: [u.locations || 'no team', u.left_team ? 'left the team' : ''] })),
  ];
  if (!same.length) return true;
  const row = m => `<li><span>${m.link ? `<a href="#/member/${m.id}">${esc(m.name)}</a>` : esc(m.name)}
      <span class="muted">(${esc(m.where.filter(Boolean).join(', '))})</span></span>
    ${m.here ? `<span class="tag">Already on ${esc(loc.name)}</span>`
      : `<button type="button" class="small" data-join="${m.id}">Add to ${esc(loc.name)}</button>`}</li>`;
  return !!await ask({ title: 'Same Name Already Here', ok: 'Add Anyway',
    body: `<p>${same.length === 1 ? 'There is already a team member' : `There are already ${same.length} team members`} with this name:</p>
      <ul class="dupes">${same.map(row).join('')}</ul>
      <p class="hint">If it's the same person, add them to ${esc(loc.name)} here. Add Anyway if it's someone else.</p>`,
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
