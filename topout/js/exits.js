// ---------- Why Members Left: #/exits ----------
// Every Exit Intake (team_exits) for the members you can see: how often each reason comes up, would they come back,
// then each exit. A Location: filter and Left Since. Someone who came back after leaving shows Back on Team. Admins can
// delete an exit (the user asked; the "admins: delete" policy); the member's Left the Team date stays.

let exitsLoc = '';      // a location id or ''
let exitsSince = '';    // a date or '' (all time)

async function exitsPage() {
  const t = ++navToken;
  view(loading);
  const [exits, locs] = await Promise.all([
    sb.from('team_exits').select('*, member:team_members(id, name, pronouns, left_on, intake_why, intake_wants, teams:team_member_locations(location_id))')
      .order('left_on', { ascending: false }).then(must),
    sb.from('team_locations').select('id, name, short_name').order('position').then(must),
  ]);
  if (t !== navToken) return;
  if (exitsLoc && !locs.some(l => l.id === exitsLoc)) exitsLoc = '';
  const list = exits.filter(x => x.member && (!exitsLoc || x.member.teams.some(tm => tm.location_id === exitsLoc))
    && (!exitsSince || x.left_on >= exitsSince));
  const n = list.length;
  const bar = k => `<span class="tcount"><span class="tbar"><i style="width:${n ? Math.round(k / n * 100) : 0}%"></i></span><b>${k}</b></span>`;
  const reasons = Object.entries(EXIT_REASONS).map(([k, l]) => [l, list.filter(x => x.reasons.includes(k)).length]).filter(([, k]) => k)
    .sort((a, b) => b[1] - a[1]);
  const none = list.filter(x => !x.reasons.length).length;
  const back = Object.entries(COME_BACK).filter(([k]) => k).map(([k, l]) => [l, list.filter(x => x.come_back === k).length]);
  const where = m => locs.filter(l => m.teams.some(tm => tm.location_id === l.id)).map(locShort).join(', ');
  const row = x => `<article class="exit">
    <div class="row between wrap"><h3><a href="#/member/${x.member.id}">${esc(x.member.name)}</a>${pronounsTag(x.member.pronouns)}</h3>
      <span class="muted small-text">Left ${fmtDate(x.left_on)}${where(x.member) ? ` · ${esc(where(x.member))}` : ''}</span></div>
    ${x.member.left_on !== x.left_on ? `<span class="tag">${x.member.left_on ? 'Left Again Later' : 'Back on Team'}</span>` : ''}
    ${joinedForHTML(x.member, x)}
    ${exitSummaryHTML(x, x.member)}
    ${me.isAdmin ? `<div class="row end"><button type="button" class="small ghost danger" data-del-exit="${x.id}">Delete Exit Intake</button></div>` : ''}</article>`;

  view(`${crumbs([['Home', '#/'], ['Why Members Left']])}
    <div class="page-head"><div><h1 class="big">Why Members Left</h1>
      <p class="muted">From the exit intake asked at Left the Team${me.isAdmin ? '' : ', for members on your teams'}.</p></div></div>
    <div class="row list-tools">
      ${locs.length > 1 ? `<label class="inline">Location:<select id="exitsLoc" class="team-filter"><option value="">All Locations</option>
        ${locs.map(l => `<option value="${l.id}"${l.id === exitsLoc ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>` : ''}
      <label class="inline">Left Since:<input type="date" id="exitsSince" value="${exitsSince}"></label>
      ${exitsSince ? '<button type="button" class="small ghost" id="exitsAll">All Time</button>' : ''}
    </div>
    ${n ? `<div class="member-grid">
      <div class="col"><section class="card"><h2>${n} ${n === 1 ? 'Exit' : 'Exits'}</h2>${list.map(row).join('')}</section></div>
      <div class="col"><section class="card"><h2>Reasons</h2>
        <p class="hint">How many exits picked each one. One exit can pick several.</p>
        <ul class="tally">${reasons.map(([l, k]) => `<li><span>${esc(l)}</span>${bar(k)}</li>`).join('')}
          ${none ? `<li><span class="muted">No Reason Picked</span>${bar(none)}</li>` : ''}</ul></section>
        <section class="card"><h2>Would They Come Back?</h2>
          <ul class="tally">${back.map(([l, k]) => `<li><span>${l}</span>${bar(k)}</li>`).join('')}
            <li><span class="muted">Not Asked</span>${bar(n - back.reduce((s, [, k]) => s + k, 0))}</li></ul></section></div>
    </div>`
    : `<section class="card empty"><h2>No Exits${exits.length ? ' Match' : ' Yet'}</h2><p class="muted">${exits.length
      ? 'Pick another location or an earlier date.' : 'When someone is marked as Left the Team, why they left shows here.'}</p></section>`}`);

  $('#exitsLoc')?.addEventListener('change', e => { exitsLoc = e.target.value; redraw(); });
  $('#exitsSince').addEventListener('change', e => { exitsSince = e.target.value; redraw(); });
  $('#exitsAll')?.addEventListener('click', () => { exitsSince = ''; redraw(); });
  app.onclick = async e => {
    const del = e.target.closest('[data-del-exit]');
    if (!del) return;
    const x = exits.find(r => r.id === del.dataset.delExit);
    if (!await confirmDelete(`Delete ${esc(x.member.name)}’s Exit Intake from ${fmtDate(x.left_on)}?`, 'Why they left comes off this page and their member page. Their Left the Team date stays. This can’t be undone.')) return;
    busy(del, async () => { await sb.from('team_exits').delete().eq('id', x.id).then(must); flash('Deleted.'); redraw(); });
  };
}
