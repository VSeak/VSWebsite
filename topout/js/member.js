// ---------- A team member: #/member/<id> ----------
// Left: check-ins (checkins.js) and Coach Notes. Right: Intake, Goals, Details.
// Anyone who can see the member's location can change them (RLS: team_can_member); only the writer of a Coach Note
// or check-in (or an admin) edits or deletes it.

const NOTES_SHOWN = 5;    // Coach Notes shown before Show All
let notesAll = false;

async function memberPage(id) {
  const t = ++navToken;
  view(loading);
  const [m, goals, notes, checkins, circuits, areas, questions, locs, exits] = await Promise.all([
    sb.from('team_members').select('*, teams:team_member_locations(location_id, inactive_on)').eq('id', id).maybeSingle().then(must),
    sb.from('team_goals').select('*').eq('member_id', id).order('created_at').then(must),
    sb.from('team_coach_notes').select('*').eq('member_id', id)
      .order('note_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).then(must),
    sb.from('team_checkins').select('*').eq('member_id', id).order('checkin_date', { ascending: false }).order('created_at', { ascending: false }).then(must),
    sb.from('team_circuits').select('*').order('position').then(must),
    sb.from('team_rating_areas').select('*').order('position').then(must),
    sb.from('team_checkin_questions').select('*').order('position').then(must),
    sb.from('team_locations').select('id, name, short_name').order('position').then(must),
    sb.from('team_exits').select('*').eq('member_id', id).order('left_on', { ascending: false }).then(r => r.data || []),   // still works before the migration
  ]);
  if (t !== navToken) return;
  if (!m) return view(`${crumbs([['Home', '#/'], ['Not Found']])}<section class="card"><h2>Member Not Found</h2>
    <p class="muted">They may have been deleted, or they're at a location you aren't assigned to.</p></section>`);
  inactiveOn(m);
  // Breadcrumbs go back to the list they came from: Team Members, or a location they're on (else their first team).
  const mine = locs.filter(l => m.teams.includes(l.id));
  const loc = mine.find(l => l.id === lastLoc) || mine[0];
  m.backTo = loc && lastLoc !== 'members' ? `#/loc/${loc.id}/team` : '#/members';
  // The Exit Intake for this time they left (none yet if they left before there was one); earlier exits are read-only.
  const exit = m.left_on ? exits.find(x => x.left_on === m.left_on) || null : null;
  const ctx = { m, goals, notes, checkins, circuits, areas, questions, locs, exit, pastExits: exits.filter(x => x !== exit) };
  const status = [mine.map(l => m.inactive[l.id] ? `${l.name} (inactive)` : l.name).join(', '), m.joined_on ? `Joined ${fmtMonthYear(m.joined_on)}` : '', m.left_on ? `Left ${fmtDate(m.left_on)}` : '']
    .filter(Boolean).map(esc).join(' · ');
  view(`${crumbs([['Home', '#/'], m.backTo === '#/members' ? ['Team Members', m.backTo] : [loc.name, m.backTo], [m.name]])}
    <div class="page-head"><span class="ini big-ini">${esc(initials(m.name))}</span>
      <div><h1 class="big">${esc(m.name)}${pronounsTag(m.pronouns)}${m.left_on ? ' <span class="tag">Former</span>' : ''}</h1>
      <p class="muted">${status}</p></div></div>
    <div class="member-grid">
      <div class="col">
        ${checkinsCardHTML(ctx)}
        ${coachNotesHTML(ctx)}
      </div>
      <div class="col">
        ${m.left_on ? exitCardHTML(m, ctx.exit) : ''}
        ${intakeHTML(m)}
        ${goalsHTML(goals)}
        ${pastExitsHTML(m, ctx.pastExits)}
        ${detailsHTML(m, locs)}
      </div>
    </div>`, { keepScroll: true });
  bindMember(ctx);
}

// ---------- Intake ----------

const COMPS = { '': 'Not Asked Yet', yes: 'Yes', maybe: 'Maybe', no: 'No' };
// The labels use the member's pronouns: Why She Joined, What They Want.
function intakeHTML(m) {
  const empty = !m.intake_why.trim() && !m.intake_wants.trim(), pr = pronounWords(m.pronouns);
  return `<section class="card${empty ? ' overdue' : ''}">
    <div class="row between"><h2>Intake</h2>${empty ? '<span class="tag warn">Needs Intake</span>' : ''}</div>
    <p class="hint">What ${esc(m.first_name)} wants out of Adult Team, from a chat with ${pr.obj}.${m.intake_updated_at ? ` Updated ${fmtWhen(m.intake_updated_at)}.` : ''}</p>
    <form id="intakeForm" class="stack" data-save>
      <label>Why ${Cap(pr.subj)} Joined<textarea name="intake_why" rows="2" placeholder="E.g. wants climbing friends, got hooked at a comp">${esc(m.intake_why)}</textarea></label>
      <label>What ${Cap(pr.subj)} ${pr.plural ? 'Want' : 'Wants'} From Adult Team<textarea name="intake_wants" rows="3" placeholder="E.g. send V5, learn to read routes, get stronger on slab">${esc(m.intake_wants)}</textarea></label>
      <label>${pr.plural ? 'Are' : 'Is'} ${Cap(pr.subj)} Interested in Competing?<select name="intake_comps">${Object.entries(COMPS).map(([k, v]) =>
        `<option value="${k}"${k === m.intake_comps ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Injuries or Limits<textarea name="intake_injuries" rows="2" placeholder="E.g. left shoulder, avoid big dynos">${esc(m.intake_injuries)}</textarea></label>
      <label>Anything Else<textarea name="intake_other" rows="2">${esc(m.intake_other)}</textarea></label>
      <button class="primary">Save Intake</button>
    </form></section>`;
}

// ---------- Exit Intake (team_exits): why they left, asked at Left the Team; every field optional ----------

// Keys are stored (team_exits.reasons), so add new ones at the end of their spot and don't rename a key.
const EXIT_REASONS = { schedule: 'Schedule or Time', cost: 'Cost', moved: 'Moved Away', injury: 'Injury or Health', life: 'Work or Family',
  interest: 'Lost Interest', level: 'Not the Right Level', fit: "Didn't Feel Like a Fit", elsewhere: 'Another Gym or Program', other: 'Other' };
const COME_BACK = { '': 'Not Asked', yes: 'Yes', maybe: 'Maybe', no: 'No' };
const exitEmpty = x => !x || (!x.reasons.length && !x.details.trim() && !x.better.trim() && !x.come_back);
const readExit = f => ({ reasons: f.getAll('reason'), details: f.get('details').trim(), better: f.get('better').trim(), come_back: f.get('come_back') });
// The fields, in the Left the Team dialog and on a Former member's page.
function exitFieldsHTML(m, x) {
  const pr = pronounWords(m.pronouns), v = x || { reasons: [], details: '', better: '', come_back: '' };
  return `<fieldset><legend>Why ${Cap(pr.subj)} Left</legend>
      <div class="chips">${Object.entries(EXIT_REASONS).map(([k, l]) =>
        `<label class="chip-check"><input type="checkbox" name="reason" value="${k}"${v.reasons.includes(k) ? ' checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div>
      <p class="hint">Pick any that fit.</p></fieldset>
    <label>In ${Cap(pr.pos)} Words<textarea name="details" rows="2" placeholder="E.g. new job, can't make weeknight practices">${esc(v.details)}</textarea></label>
    <label>What Could We Have Done Better?<textarea name="better" rows="2" placeholder="E.g. more beginner-friendly sessions">${esc(v.better)}</textarea></label>
    <label>Would ${Cap(pr.subj)} Come Back?<select name="come_back">${Object.entries(COME_BACK).map(([k, l]) =>
      `<option value="${k}"${k === v.come_back ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`;
}
// Why they joined and what they wanted (their intake), next to why they left: it often explains the leave (the user asked).
// With an exit row, its copy of the intake from when it was made (team_exit_snapshot), so a later Save Intake doesn't change it;
// without one (the Left the Team dialog, or no row yet), the intake as it is now.
function joinedForHTML(m, x) {
  const pr = pronounWords(m.pronouns);
  const why = (x?.joined_why ?? m.intake_why ?? '').trim(), wants = (x?.joined_wants ?? m.intake_wants ?? '').trim();
  if (!why && !wants) return '';
  return `<div class="intake-recap">
    ${why ? `<p><b>Why ${Cap(pr.subj)} Joined:</b> ${esc(why)}</p>` : ''}
    ${wants ? `<p><b>What ${Cap(pr.subj)} Wanted:</b> ${esc(wants)}</p>` : ''}</div>`;
}
function exitCardHTML(m, x) {
  const pr = pronounWords(m.pronouns);
  return `<section class="card">
    <div class="row between"><h2>Exit Intake</h2>${exitEmpty(x) ? '<span class="tag">Not Filled In</span>' : ''}</div>
    <p class="hint">Why ${esc(m.first_name)} left Adult Team, from a chat with ${pr.obj}. Every field is optional.${x?.edited_at ? ` Updated ${fmtWhen(x.edited_at)}.` : ''}</p>
    ${joinedForHTML(m, x)}
    <form id="exitForm" class="stack" data-save>${exitFieldsHTML(m, x)}<button class="primary">Save Exit Intake</button></form></section>`;
}
// One exit, read-only: on the member page (earlier times they left) and on Why Members Left.
function exitSummaryHTML(x, m) {
  const reasons = x.reasons.map(k => `<span class="chip">${esc(EXIT_REASONS[k] || k)}</span>`).join('');
  return `${reasons ? `<div class="chips">${reasons}</div>` : ''}
    ${x.details ? `<p><b>In ${pronounWords(m.pronouns).pos} words:</b> ${esc(x.details)}</p>` : ''}
    ${x.better ? `<p><b>Could do better:</b> ${esc(x.better)}</p>` : ''}
    ${x.come_back ? `<p><b>Would come back:</b> ${COME_BACK[x.come_back]}</p>` : ''}
    ${exitEmpty(x) ? '<p class="muted">No exit intake.</p>' : ''}`;
}
function pastExitsHTML(m, list) {
  if (!list.length) return '';
  return `<section class="card"><details><summary><b>${m.left_on ? 'Earlier Exits' : 'Left Before'} (${list.length})</b></summary>
    ${list.map(x => `<article class="exit"><h3>Left ${fmtDate(x.left_on)}</h3>${exitSummaryHTML(x, m)}</article>`).join('')}</details></section>`;
}

// ---------- Goals ----------

const goalItem = g => `<li class="goal ${g.status}"><span class="goal-body">${para(g.body)}${g.done_at && g.status === 'achieved' ? `<small>Achieved ${fmtDate(g.done_at)}</small>` : ''}</span>
  <span class="goal-acts">${g.status === 'current'
    ? `<button type="button" class="small ghost" data-goal="achieved" data-id="${g.id}">Achieved</button><button type="button" class="small ghost" data-goal="archived" data-id="${g.id}">Archive</button>`
    : `<button type="button" class="small ghost" data-goal="current" data-id="${g.id}">${g.status === 'achieved' ? 'Undo' : 'Restore'}</button>`}
    <button type="button" class="small ghost danger" data-goal="delete" data-id="${g.id}">Delete</button></span></li>`;
function goalsHTML(goals) {
  const cur = goals.filter(g => g.status === 'current'), won = goals.filter(g => g.status === 'achieved'),
    old = goals.filter(g => g.status === 'archived');
  won.sort((a, b) => (b.done_at || '').localeCompare(a.done_at || ''));
  return `<section class="card goals-card"><div class="row between"><h2>Goals</h2>${cur.length ? `<span class="tag">${cur.length} Current</span>` : ''}</div>
    <form id="goalForm" class="row add-row" data-save>
      <input name="body" maxlength="300" required data-need="Type a goal first." placeholder="E.g. Flash a Blue circuit problem" aria-label="New goal" autocomplete="off">
      <button class="primary">+ Add Goal</button></form>
    ${cur.length ? `<ul class="goals">${cur.map(goalItem).join('')}</ul>` : '<p class="muted">No current goals.</p>'}
    ${won.length ? `<h3>Achieved</h3><ul class="goals">${won.map(goalItem).join('')}</ul>` : ''}
    ${old.length ? `<details><summary>Archived (${old.length})</summary><ul class="goals">${old.map(goalItem).join('')}</ul></details>` : ''}
  </section>`;
}

// ---------- Coach Notes ----------

const canChangeNote = n => me.isAdmin || n.author_id === me.user.id;
function coachNotesHTML({ notes }) {
  const shown = notesAll ? notes : notes.slice(0, NOTES_SHOWN);
  return `<section class="card" id="notesCard"><div class="row between"><h2>Coach Notes</h2>${notes.length ? `<span class="tag">${notes.length}</span>` : ''}</div>
    <p class="hint">Private to staff. What you noticed at practice, what to work on next.</p>
    <form id="noteForm" class="stack" data-save>
      <label>Note<textarea name="body" rows="3" required data-need="Type the note first." placeholder="E.g. Great flagging today. Next: trust feet on slab."></textarea></label>
      <div class="row between wrap"><label class="inline">Practice Date<input type="date" name="note_date" value="${today()}"></label>
        <button class="primary">+ Add Note</button></div>
    </form>
    ${shown.map(n => `<article class="note">
      <div class="note-head"><b>${n.note_date ? fmtDate(n.note_date) : 'General'}</b>
        <span class="muted">${esc(n.author_name || 'Staff')}${n.edited_at ? ' · edited' : ''}</span>
        ${canChangeNote(n) ? `<span class="note-acts"><button type="button" class="small ghost" data-note="edit" data-id="${n.id}">Edit</button>
          <button type="button" class="small ghost danger" data-note="delete" data-id="${n.id}">Delete</button></span>` : ''}</div>
      <div class="note-body">${para(n.body)}</div></article>`).join('')}
    ${notes.length > NOTES_SHOWN ? `<button type="button" class="link" id="notesMore">${notesAll ? 'Show Fewer' : `Show All ${notes.length}`}</button>` : ''}
  </section>`;
}

// ---------- Details ----------

function detailsHTML(m, locs) {
  const hidden = m.teams.filter(id => !locs.some(l => l.id === id)).length;   // teams at locations this coach can't see
  return `<section class="card"><h2>Details</h2>
    <form id="detailsForm" class="stack" data-save>
      <div class="two"><label>First Name<input name="first_name" maxlength="60" required value="${esc(m.first_name)}" data-need="Enter their first name."></label>
        <label>Last Name<input name="last_name" maxlength="60" required value="${esc(m.last_name)}" data-need="Enter their last name."></label></div>
      ${pronounsField(m.pronouns, true)}
      <label>Email <span class="muted">(optional)</span><input type="email" name="email" value="${esc(m.email || '')}"></label>
      <label>Joined the Team<input type="date" name="joined_on" value="${m.joined_on || ''}" required data-need="Pick the day they joined."></label>
      <fieldset data-required><legend>Teams</legend>
        ${locs.map(l => { const on = m.teams.includes(l.id), off = m.inactive[l.id];
          return `<div class="team-row"><label class="check"><input type="checkbox" name="team" value="${l.id}"${on ? ' checked' : ''}> ${esc(l.name)}</label>
            <select name="status_${l.id}" aria-label="${esc(l.name)} status"${on ? '' : ' disabled'}><option value="">Active</option>
              <option value="inactive"${off ? ' selected' : ''}>Inactive${off ? ` Since ${fmtShort(off)}` : ''}</option></select></div>`; }).join('')}
        ${hidden ? `<p class="hint">Also on ${hidden === 1 ? 'a team' : hidden + ' teams'} you don't coach.</p>` : ''}
        <p class="hint">Switched locations? Mark the old team Inactive: they stay on it, under Moved there.</p>
      </fieldset>
      <button class="primary">Save Details</button>
    </form>
    <div class="row wrap danger-zone">
      ${m.left_on ? '<button type="button" class="ghost" id="rejoin">Back on Team</button>'
        : `<button type="button" class="ghost" id="leave"${me.isAdmin ? '' : ' disabled'}>Left the Team</button>`}
      <button type="button" class="ghost danger" id="delMember"${me.isAdmin ? '' : ' disabled'}>Delete Member</button>
    </div>
    <p class="hint">Left the Team keeps their history, makes every team Inactive and moves them to Former. Delete is for someone added by mistake.${me.isAdmin ? '' : ' Only an admin can do either.'}</p>
  </section>`;
}

// ---------- Actions ----------

function bindMember(ctx) {
  const { m } = ctx;
  const upd = row => sb.from('team_members').update(row).eq('id', m.id).then(must);

  $('#intakeForm').onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    busy(e.submitter, async () => {
      await upd({ intake_why: f.get('intake_why').trim(), intake_wants: f.get('intake_wants').trim(), intake_comps: f.get('intake_comps'),
        intake_injuries: f.get('intake_injuries').trim(), intake_other: f.get('intake_other').trim(), intake_updated_at: new Date().toISOString() });
      flash('Intake saved.'); e.target.reset(); redraw();
    });
  };
  $('#exitForm')?.addEventListener('submit', e => {
    e.preventDefault();
    const row = readExit(new FormData(e.target));
    busy(e.submitter, async () => {
      if (ctx.exit) await sb.from('team_exits').update(row).eq('id', ctx.exit.id).then(must);
      else await sb.from('team_exits').insert({ member_id: m.id, left_on: m.left_on, ...row }).then(must);
      flash('Exit intake saved.'); e.target.reset(); redraw();
    });
  });
  $('#detailsForm').onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    // Teams: add the newly ticked first, so they can still see the member while taking off the rest.
    const ticked = f.getAll('team'), seen = ctx.locs.map(l => l.id);
    const add = ticked.filter(id => !m.teams.includes(id)), drop = m.teams.filter(id => seen.includes(id) && !ticked.includes(id));
    // Active / Inactive on each team: flip = kept teams whose status changed.
    const off = id => f.get('status_' + id) === 'inactive';
    const flip = ticked.filter(id => m.teams.includes(id) && off(id) !== !!m.inactive[id]);
    if (!ticked.length && m.teams.every(id => seen.includes(id))) {
      const box = e.target.querySelector('[name="team"]');
      fieldError(box, 'Pick at least one team.'); box.focus(); return;
    }
    busy(e.submitter, async () => {
      await upd({ first_name: f.get('first_name').trim(), last_name: f.get('last_name').trim(), pronouns: readPronouns(f),
        email: f.get('email').trim().toLowerCase() || null, joined_on: f.get('joined_on') || null });
      if (add.length) await sb.from('team_member_locations')
        .insert(add.map(location_id => ({ member_id: m.id, location_id, inactive_on: off(location_id) ? today() : null }))).then(must);
      for (const id of flip) await sb.from('team_member_locations').update({ inactive_on: off(id) ? today() : null })
        .eq('member_id', m.id).eq('location_id', id).then(must);
      if (drop.length) await sb.from('team_member_locations').delete().eq('member_id', m.id).in('location_id', drop).then(must);
      flash('Details saved.');
      e.target.reset();
      // Taken off every team they could see here: back to the list.
      if (!ticked.length) goTo('#/members'); else redraw();
    });
  };
  $('#detailsForm').addEventListener('change', e => {
    if (e.target.name !== 'team') return;
    clearFieldError(e.target.form.querySelector('[name="team"]'));
    e.target.form.elements['status_' + e.target.value].disabled = !e.target.checked;
  });
  $('#goalForm').onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    busy(e.submitter, async () => {
      await sb.from('team_goals').insert({ member_id: m.id, body: f.get('body').trim() }).then(must);
      e.target.reset(); redraw();
    });
  };
  $('#noteForm').onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    busy(e.submitter, async () => {
      await sb.from('team_coach_notes').insert({ member_id: m.id, body: f.get('body').trim(), note_date: f.get('note_date') || null }).then(must);
      flash('Note added.'); e.target.reset(); redraw();
    });
  };
  $('#leave')?.addEventListener('click', async e => {
    const pr = pronounWords(m.pronouns);
    const f = await ask({ title: 'Left the Team?', ok: 'Mark as Left', wide: true,
      body: `<p>${esc(m.first_name)} moves to Former and every team ${pr.subj} ${pr.plural ? 'are' : 'is'} on is marked Inactive. ${Cap(pr.pos)} intake, goals, notes and check-ins stay.</p>
        <label>Last Day<input type="date" name="left_on" value="${today()}" required data-need="Pick the day."></label>
        <h3>Exit Intake</h3>
        <p class="hint">Why ${pr.subj} left, if you know. Every field is optional; you can fill it in later on ${pr.pos} page.</p>
        ${joinedForHTML(m)}
        ${exitFieldsHTML(m, null)}` });
    // The database (team_member_left) marks every team inactive, including ones this coach can't see.
    // The exit row is saved even when empty, so the page has one to fill in later.
    if (f) busy(e.target, async () => {
      await upd({ left_on: f.get('left_on') });
      await sb.from('team_exits').insert({ member_id: m.id, left_on: f.get('left_on'), ...readExit(f) }).then(must);
      flash('Moved to Former.'); redraw();
    });
  });
  // Back on Team: their teams stay inactive; the coach picks the one they're coming back to.
  $('#rejoin')?.addEventListener('click', async e => {
    const locs = ctx.locs;
    const f = await ask({ title: 'Back on Team?', ok: 'Back on Team',
      body: `<label>Location<select name="loc" required data-need="Pick a location.">
        ${locs.length === 1 ? '' : '<option value="">Pick a location</option>'}${locs.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></label>
        <p class="hint">Their other teams stay Inactive.</p>` });
    if (f) busy(e.target, async () => {
      await sb.rpc('team_join_location', { p_member: m.id, p_location: f.get('loc') }).then(must);
      await upd({ left_on: null });
      flash(`${m.first_name} is back on the team.`); redraw();
    });
  });
  $('#delMember').onclick = async e => {
    if (!await confirmDelete('Delete Member?', `This deletes ${esc(m.name)} and all their goals, notes and check-ins. It can't be undone.
      If they just left, use Left the Team instead.`)) return;
    busy(e.target, async () => { await sb.from('team_members').delete().eq('id', m.id).then(must); flash('Member deleted.'); goTo(m.backTo); });
  };

  app.onclick = async e => {
    const g = e.target.closest('[data-goal]'), n = e.target.closest('[data-note]'), c = e.target.closest('[data-checkin]');
    if (e.target.closest('#notesMore')) { notesAll = !notesAll; redraw(); return; }
    if (g) {
      const id = g.dataset.id, act = g.dataset.goal;
      if (act === 'delete') {
        if (!await confirmDelete('Delete Goal?', 'It will be gone for good. Archive keeps it out of the way instead.')) return;
        return busy(g, async () => { await sb.from('team_goals').delete().eq('id', id).then(must); redraw(); });
      }
      return busy(g, async () => {
        await sb.from('team_goals').update({ status: act, done_at: null }).eq('id', id).then(must);
        if (act === 'achieved') flash('Goal achieved. Nice!');
        redraw();
      });
    }
    if (n) {
      const note = ctx.notes.find(x => x.id === n.dataset.id);
      if (n.dataset.note === 'delete') {
        if (!await confirmDelete('Delete Note?', 'This Coach Note will be gone for good.')) return;
        return busy(n, async () => { await sb.from('team_coach_notes').delete().eq('id', note.id).then(must); redraw(); });
      }
      const f = await ask({ title: 'Edit Note', ok: 'Save Note', wide: true,
        body: `<label>Note<textarea name="body" rows="6" required data-need="The note can't be empty.">${esc(note.body)}</textarea></label>
          <label>Practice Date <span class="muted">(empty = a general note)</span><input type="date" name="note_date" value="${note.note_date || ''}"></label>` });
      if (f) busy(n, async () => {
        await sb.from('team_coach_notes').update({ body: f.get('body').trim(), note_date: f.get('note_date') || null }).eq('id', note.id).then(must);
        flash('Note saved.'); redraw();
      });
      return;
    }
    if (c) checkinAction(c, ctx);
  };
}
