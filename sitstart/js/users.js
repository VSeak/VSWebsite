// ---------- Admin: users ----------

// Staff roles are separate, and one person can have several (staff.roles in schema.sql).
// To add a role: allow it in the staff.roles check, then add it to ROLE_LABEL, ROLE_PLURAL, ROLE_HINT and STAFF_ROLES.
const ROLE_LABEL = { admin: 'Admin', coach: 'Coach', student: 'Student' };
const ROLE_PLURAL = { admin: 'Admins', coach: 'Coaches', student: 'Students' };
const ROLE_HINT = { admin: 'Sees and edits every user.', coach: 'Manages students, plans and goals.' };
const STAFF_ROLES = ['admin', 'coach'];
// Roles in STAFF_ROLES order (Admin before Coach), anything else after.
const roleRank = r => (i => i < 0 ? STAFF_ROLES.length : i)(STAFF_ROLES.indexOf(r));
const sortRoles = roles => [...roles].sort((a, b) => roleRank(a) - roleRank(b));
const rolesText = roles => sortRoles(roles).map(r => ROLE_LABEL[r] || r).join(' · ');
const userStatus = u => u.deactivated_at ? 'Deactivated' : u.ended_at ? 'Inactive' : u.last_sign_in_at ? 'Active' : u.invited_at ? 'Invited' : 'Not Invited';
// Deactivated staff and inactive students (coaching ended) sort after everyone else.
const gone = u => !!(u.deactivated_at || u.ended_at);
const roleOrder = u => gone(u) ? Object.keys(ROLE_LABEL).length + !!u.deactivated_at : Math.min(...u.roles.map(r => Object.keys(ROLE_LABEL).indexOf(r)));
const isMine = u => u.kind === 'staff' && u.email === me.user.email?.toLowerCase();

async function adminUsers() {
  const t = ++navToken;
  view(loading);
  // list_users() doesn't say whose coaching has ended or who has no coach, so read that from students (admins can).
  const [users, stus] = await Promise.all([sb.rpc('list_users').then(must),
    sb.from('students').select('id,name,coach_id,training_ended_at').then(must)]);
  if (t !== navToken) return;
  const endedAt = new Map(stus.filter(s => s.training_ended_at).map(s => [s.id, s.training_ended_at]));
  users.forEach(u => { if (u.kind === 'student') u.ended_at = endedAt.get(u.id) || null; });
  users.sort((a, b) => (roleOrder(a) - roleOrder(b)) || (a.name || a.email || '').localeCompare(b.name || b.email || ''));
  // Waiting on an Admin: active students with no coach (never had one, or their coach was deactivated or removed).
  const waiting = stus.filter(s => !s.coach_id && !s.training_ended_at).sort((a, b) => a.name.localeCompare(b.name));

  // The role tabs leave out deactivated staff and inactive students, who have their own tabs (shown when there are some).
  const inFilter = (u, r) => !r ? true : r === 'deactivated' ? !!u.deactivated_at : r === 'inactive' ? !!u.ended_at
    : !gone(u) && u.roles.includes(r);
  const count = r => users.filter(u => inFilter(u, r)).length;
  const tabs = [['', 'Everyone'], ...Object.keys(ROLE_LABEL).map(r => [r, ROLE_PLURAL[r]]),
    ...[['inactive', 'Inactive'], ['deactivated', 'Deactivated']].filter(([r]) => count(r))];
  if (!tabs.some(([r]) => r === usersTab)) usersTab = '';
  view(`${crumbs([['Home', '#/'], ['Users']])}
  <div class="page-head"><h1>Users</h1><button type="button" class="fill" id="addUser">+ Add User</button></div>
  <div class="grid2 users-grid">
    <div class="stack">
      <input id="userSearch" class="search" type="search" placeholder="Search by name or email" aria-label="Search by name or email" autocomplete="off">
      <div class="tabs" id="userTabs" role="tablist" aria-label="Show">${tabs.map(([r, label]) =>
        `<button type="button" role="tab" data-tab="${r}">${label}<span class="count">${count(r)}</span></button>`).join('')}</div>
      <div class="people" id="userList"></div>
    </div>
    ${waiting.length ? `<aside><section class="card overdue waiting"><div class="row between"><span class="eyebrow">Waiting on an Admin</span>
      <span class="chip warn-fill">${waiting.length}</span></div>
      ${waiting.map(s => `<div class="wait-row"><span><b>${esc(s.name)}</b><span>Student with no coach</span></span>
        <a class="pick-btn" href="#/user/${s.id}">Pick Coach</a></div>`).join('')}</section></aside>` : ''}
  </div>`);

  const search = $('#userSearch');
  function renderList() {
    const q = search.value.trim().toLowerCase();
    const shown = users.filter(u => inFilter(u, usersTab) &&
      (!q || (u.name || '').toLowerCase().includes(q) || (u.email || '').includes(q)));
    app.querySelectorAll('#userTabs [data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === usersTab));
    $('#userList').innerHTML = shown.map(userCard).join('')
      || `<p class="muted">${users.length ? 'Nobody matches that search.' : 'No users yet.'}</p>`;
  }
  renderList();
  search.oninput = renderList;
  $('#userTabs').onclick = e => {
    const b = e.target.closest('[data-tab]');
    if (b) { usersTab = b.dataset.tab; renderList(); }
  };
  $('#addUser').onclick = e => addUserDialog(e.target);
}

let usersTab = '';   // the Users list's tab, kept while you move around the site
// A user as a card: staff get a green badge and their role chips; students a plain badge; deactivated staff are grayed out.
const userCard = u => {
  const staffRoles = sortRoles(u.roles).filter(r => r !== 'student'), status = userStatus(u);
  const chips = [...staffRoles.map(r => `<span class="chip role">${esc(ROLE_LABEL[r] || r)}</span>`),
    u.roles.includes('student') && '<span class="chip">Student</span>',
    status !== 'Active' && `<span class="chip${status === 'Not Invited' ? ' warn' : gone(u) ? ' bad' : ''}">${status}</span>`].filter(Boolean).join('');
  return `<a class="person${u.deactivated_at ? ' off' : ''}" href="#/user/${u.id}"><span class="ini${u.kind === 'staff' ? '' : ' plain'}">${initials(u.name || u.email)}</span>
    <span class="person-body"><b>${esc(u.name || u.email)}</b>${pronounsTag(u.pronouns)}${isMine(u) ? ' <span class="muted">(you)</span>' : ''}
      <span class="person-sub">${u.email ? esc(u.email) : 'No email yet'}</span><span class="chips">${chips}</span></span></a>`;
};

// Add User, in a dialog: Staff or Student. Student hides (and disables, so they skip validation) the email and roles:
// a student's invite waits for a plan and a goal. Staff need a role: the first box says so until one is ticked.
async function addUserDialog(btn) {
  const asked = ask({ title: 'Add a User', ok: '+ Add and Send Invite', body: `<div class="stack">
    <div class="seg" id="addKind" role="radiogroup" aria-label="Add">
      <label><input type="radio" name="add_kind" value="staff" checked>Staff</label>
      <label><input type="radio" name="add_kind" value="student">Student</label></div>
    <p class="hint" id="addHint" style="margin:0"></p>
    <label>First Name<input name="first_name" required data-need="Enter their first name." autocomplete="off"></label>
    <label>Last Name<input name="last_name" autocomplete="off"></label>
    ${pronounsField()}
    <label data-staff>Email<input type="email" name="email" required data-need="Enter their email to send the invite." autocomplete="off"></label>
    <div data-staff>${rolesFieldset(['coach'])}</div></div>` });
  const dlg = $('#dlg'), ok = dlg.querySelector('button[value="ok"]'), boxes = [...dlg.querySelectorAll('input[name="roles"]')];
  const isStaff = () => dlg.querySelector('input[name="add_kind"]:checked').value === 'staff';
  const needRole = () => boxes[0].setCustomValidity(isStaff() && !boxes.some(b => b.checked) ? 'none' : '');
  boxes[0].dataset.need = 'Pick at least one role.';
  function setKind() {
    const staff = isStaff();
    dlg.querySelectorAll('[data-staff]').forEach(el => {
      el.hidden = !staff;
      el.querySelectorAll('input').forEach(i => { i.disabled = !staff; if (!staff) clearFieldError(i); });
    });
    $('#addHint').textContent = staff ? 'Staff get an email invite to choose a password.'
      : me.isCoach ? "You'll be their coach. Build their plan and add a goal first, then add their email and send the invite from their page."
      : "Pick their coach on their page next. The invite waits until their coach has added a plan and a goal.";
    ok.textContent = staff ? '+ Add and Send Invite' : '+ Add Student';
    needRole();
  }
  setKind();
  $('#addKind').onchange = setKind;
  boxes.forEach(b => b.addEventListener('change', () => { needRole(); if (boxes.some(x => x.checked)) clearFieldError(boxes[0]); }));
  const f = await asked;
  if (!f) return;
  const first_name = f.get('first_name').trim(), last_name = f.get('last_name').trim(), pronouns = readPronouns(f);
  if (f.get('add_kind') === 'student') return busy(btn, async () => {
    // check_student_coach makes an adder with the Coach role their coach, so a coach goes on to build the plan and an
    // admin-only adder picks the coach.
    const data = await sb.from('students').insert({ first_name, last_name, pronouns }).select('id').single().then(must);
    goTo((me.isCoach ? '#/student/' : '#/user/') + data.id);
    flash(me.isCoach ? `${first_name} added. Make ${pro(pronouns).their} plan, then send the invite when it's ready.`
      : `${first_name} added. Pick ${pro(pronouns).their} coach here.`);
  });
  const row = { first_name, last_name, pronouns, email: f.get('email').trim().toLowerCase(), roles: f.getAll('roles') };
  busy(btn, async () => {
    const { data, error } = await sb.from('staff').insert(row).select('id').single();
    if (error) throw error.code === '23505' ? new Error('Someone on the staff already has that email.') : error;
    // Send the invite before opening their page, so it draws once (with Invited) instead of twice.
    const { error: mailError } = await sendLink(row.email, row.first_name, true);
    const invitedAt = !mailError && new Date().toISOString();
    if (invitedAt) must(await sb.from('staff').update({ invited_at: invitedAt }).eq('id', data.id));
    // Student too: signs in with the same login, so the staff invite covers it.
    const stuError = f.get('student') && await addStudentRow(row, invitedAt).then(() => null, err => err);
    goTo('#/user/' + data.id);
    if (mailError) flash(`${row.first_name} added, but the invite didn't send: ${msgOf(mailError)}`, 'error');
    else if (stuError) flash(`${row.first_name} added and invited, but couldn't be made a student: ${msgOf(stuError)}`, 'error');
    else flash(`${row.first_name} added. Invite sent to ${row.email}.`);
  });
}

// Role checkboxes for a staff form. locked roles stay ticked and can't be changed (your own Admin role).
// Student (not a staff role) makes a student row with the same name and email, so they also get View My Training.
// student: their student row's id once they are one (ticked and locked, with a link), or null.
function rolesFieldset(current, locked = [], student = null) {
  return `<fieldset class="roles"><legend>Roles</legend>
    ${STAFF_ROLES.map(r => `<label class="check"><input type="checkbox" name="roles" value="${r}"
      ${current.includes(r) ? 'checked' : ''} ${locked.includes(r) ? 'disabled' : ''}>
      <span><strong>${ROLE_LABEL[r]}</strong> <span class="muted">${ROLE_HINT[r]}</span></span></label>`).join('')}
    <label class="check"><input type="checkbox" name="student"${student ? ' checked disabled' : ''}>
      <span><strong>Student</strong> <span class="muted">${student
        ? `Also coached, with their own plans. <a href="#/user/${student}">Open the student record</a>.`
        : 'Also coached, with their own plans (View My Training).'}</span></span></label>
  </fieldset>`;
}
// Makes a staff member a student too: a student row with the same name, pronouns and email. They claim it the next
// time they open the site. A coach who adds it becomes their coach (check_student_coach), as with any new student.
const addStudentRow = (row, invitedAt) => sb.from('students').insert({ first_name: row.first_name, last_name: row.last_name,
  pronouns: row.pronouns, email: row.email, invited_at: invitedAt || null }).select('id').single().then(must);
// The ticked roles (disabled ones count), or null after showing an error when none are.
function checkedRoles(form) {
  const boxes = [...form.querySelectorAll('input[name="roles"]')];
  const roles = boxes.filter(b => b.checked).map(b => b.value);
  if (roles.length) return roles;
  fieldError(boxes.at(-1), 'Pick at least one role.');
  boxes[0].focus();
  boxes.forEach(b => b.addEventListener('change', () => clearFieldError(boxes.at(-1)), { once: true }));
  return null;
}

// One page for any user: staff (details, roles, account) or a student (details, account).
// again: redraw after a save, without the Loading… step or a jump to the top. It can be the form
// just saved; unsaved edits in the other forms are kept (keepEdits).
async function adminUser(id, again = false) {
  const t = ++navToken;
  const restore = again && keepEdits(again);
  if (!again) view(loading);
  const u = await sb.rpc('list_users').eq('id', id).maybeSingle().then(must);
  if (t !== navToken) return;
  if (!u) { location.hash = '#/users'; return; }
  const staff = u.kind === 'staff', table = staff ? 'staff' : 'students';
  const mine = isMine(u), active = !!u.last_sign_in_at, off = !!u.deactivated_at, p = pro(u.pronouns);
  // Admins can't read plans or goals, so ask the database whether a student is ready for the invite.
  const ready = staff || active || await sb.rpc('student_ready', { p_id: id }).then(must);
  // Students: their row (coach and next session), who could coach them, past coaches and past sessions.
  // Staff: the students they coach. twin: the same person's other record (a staff member who is also a student).
  const twinOf = t => u.email ? sb.from(t).select('id').eq('email', u.email).maybeSingle().then(must) : null;
  const [stu, coachOpts, coaches, log, pupils, twin] = await Promise.all(staff
    ? [null, [], [], [], sb.from('students').select('id,name').eq('coach_id', id).order('name').then(must), twinOf('students')]
    : [sb.from('students').select('first_name,pronouns,email,coach_id,training_ended_at,' + NEXT_COLS).eq('id', id).single().then(must),
       sb.from('staff').select('id,name,email').contains('roles', ['coach']).is('deactivated_at', null).order('first_name').then(must),
       sb.rpc('coaches_of', { p_id: id }).then(must),
       sb.from('session_history').select('*').eq('student_id', id).then(must), [], twinOf('staff')]);
  if (t !== navToken) return;
  const coachId = stu?.coach_id ?? null;
  // Keep their coach in the list even if they've lost the Coach role since. Nobody can coach themselves.
  const cur = coaches.find(c => c.is_current);
  if (coachId && cur && !coachOpts.some(c => c.id === coachId)) coachOpts.push({ id: coachId, name: cur.name });
  if (twin) coachOpts.splice(0, coachOpts.length, ...coachOpts.filter(c => c.id !== twin.id));
  const title = u.name || u.email;
  // The owner's access is theirs alone (protect_owner in schema.sql): other admins can't change their roles or remove them.
  const lockedRoles = u.owner ? (mine ? ['admin'] : STAFF_ROLES) : mine ? ['admin'] : [];
  const rolesHint = u.owner ? (mine ? "You're the owner, so you always keep the Admin role." : `${esc(u.first_name || 'The owner')} is the owner. Only ${p.they} can change ${p.their} roles.`)
    : mine ? "You can't remove your own Admin role. Ask another admin." : '';

  const ended = !!stu?.training_ended_at, pickCoach = !staff && !coachId && !ended;
  const lastIn = u.last_sign_in_at && `Signed in ${fmtDay(u.last_sign_in_at).replace(/, \d{4}$/, '')}`;
  const status = off ? 'Deactivated' : staff ? `Staff${lastIn ? ' · ' + lastIn : ''}` : ended ? 'Student · Inactive' : 'Student · Active';
  const details = `<section class="card" data-fold-start><div class="row between"><h2>Details</h2><span class="fold-sum">Name, pronouns</span></div>
      <p class="hint">Emails greet ${mine ? 'you' : p.them} by first name.${staff ? '' : ` ${twin ? `${p.They} ${p.v('are', 'is')} on the staff too: <a href="#/user/${twin.id}">open the staff record</a>.`
        : `${p.They} can change ${p.their} own pronouns too.`}`}</p>
      <form id="userForm" class="stack" data-save>
        <label>First Name<input name="first_name" value="${esc(u.first_name)}" required data-need="Enter ${mine ? 'your' : p.their} first name."></label>
        <label>Last Name<input name="last_name" value="${esc(u.last_name)}"></label>
        ${pronounsField(u.pronouns, mine ? 'Your' : 'Their')}
        <button class="primary">Save Details</button>
      </form>
    </section>`;
  const coachCard = `<section class="card${pickCoach ? ' overdue' : ''}" id="coachCard"${pickCoach ? '' : ' data-fold-start'}>
      <div class="row between"><h2>${pickCoach ? 'Pick a Coach' : 'Coach'}</h2>${pickCoach ? '<span class="tag warn">Waiting on You</span>'
        : `<span class="fold-sum">${esc(coaches.find(c => c.is_current)?.name || 'None')}</span>`}</div>
      <p class="hint">${pickCoach ? `${esc(u.first_name || title)} has no coach. Until you pick one, any coach can change ${p.their} plans and goals.`
        : `${p.They} ${p.v('see', 'sees')} ${p.their} current coach and past coaches on ${p.their} page.`}</p>
      <form id="coachForm" class="stack" data-save>
        <label>Current Coach<select name="coach_id">
          <option value="">${pickCoach ? 'Pick a coach' : 'No Coach'}</option>
          ${coachOpts.map(c => `<option value="${c.id}"${c.id === coachId ? ' selected' : ''}>${esc(c.name || c.email)}</option>`).join('')}
        </select></label>
        <button class="primary">Save Coach</button>
      </form>
      ${coachesHTML(coaches.filter(c => !c.is_current))}
    </section>`;

  view(`${crumbs([['Home', '#/'], ['Users', '#/users'], [title]])}
  <div class="page-head"><div><span class="eyebrow">${esc(status)}</span><h1>${esc(title)}${pronounsTag(u.pronouns)}</h1>
    <span class="chips">${sortRoles(u.roles).map(r => `<span class="chip${r === 'student' ? '' : ' role'}">${esc(ROLE_LABEL[r] || r)}</span>`).join('')}
      ${pickCoach ? '<span class="chip warn">No Coach</span>' : ''}</span></div></div>
  <div class="grid2 phone-order" data-folds="user">
    <div>
    ${staff ? `<section class="card" id="rolesCard"><h2>Roles</h2>
      <p class="hint">Roles decide what ${mine ? 'you' : p.they} can see and do.</p>
      <form id="rolesForm" class="stack" data-save>
        ${rolesFieldset(u.roles, lockedRoles, twin?.id)}${rolesHint ? `<p class="hint">${rolesHint}</p>` : ''}
        <button class="primary">Save Roles</button>
      </form>
    </section>
    ${u.roles.includes('coach') || pupils.length ? `<section class="card" id="pupilsCard"><div class="row between"><h2>${mine ? 'Your' : p.Their} Students</h2>
      <span class="big-num">${pupils.length}</span></div>
      <p class="hint">To give a student a new coach, open them and pick one.</p>
      ${pupils.length ? `<ul class="list">${pupils.map(p => `<li><a class="item" href="#/user/${p.id}"><strong>${esc(p.name)}</strong><span class="muted">›</span></a></li>`).join('')}</ul>`
        : '<p class="muted">Not coaching anyone right now.</p>'}</section>` : ''}`
    : `${pickCoach ? coachCard : ''}${nextCardHTML(stu)}`}
    </div>
    <aside>
    <div class="card-group">
      ${staff ? '' : `${me.isCoach ? `<a class="card group-link" href="#/student/${u.id}"><span class="row between"><h2>Student Page</h2>
        <span class="muted">Plans, goals, notes ›</span></span></a>` : ''}
        ${historyCardHTML(stu)}${pickCoach ? '' : coachCard}${trainingCardHTML(stu, coaches)}`}
      ${details}
      ${accountCardStart(active || off, u.invited_at, u.first_name || title, p, lastIn || (u.invited_at ? 'Invited' : ''))}
        ${off ? `
        <p class="hint">Reactivate ${p.them} to send ${p.them} a sign-in link.</p>
        <p>${active ? `Signs in as ${esc(u.email)}. Last signed in ${fmtWhen(u.last_sign_in_at)}.` : `${esc(u.email)}, never signed in.`}</p>`
        : active ? `
        <p class="hint">${mine ? "How you sign in. Send yourself a new sign-in link if you're locked out."
          : `How ${p.they} ${p.v('sign', 'signs')} in. Send a new sign-in link if ${p.they}${p.v("'re", "'s")} locked out.`}</p>
        <p>Signs in as ${esc(u.email)}. Last signed in ${fmtWhen(u.last_sign_in_at)}.</p>
        <div class="row"><button data-act="send-link">Send Sign-In Link</button>${staff ? '' : '<button data-act="change-email">Change Email</button>'}</div>` : `
        <form id="inviteForm" class="stack" data-save="show">
          ${u.invited_at ? `<p>Invited ${fmtWhen(u.invited_at)}, but hasn't signed in yet.</p>` : ''}
          <label>Email<input type="email" name="email" value="${esc(u.email || '')}" required data-need="Enter ${p.their} email to send the invite." autocomplete="off"></label>
          <p class="hint">${u.invited_at ? 'Fix the email here if it was wrong, then resend.' : `${p.They}'ll get an email with a link to choose a password.`}</p>
          <div class="row"><button class="primary" id="inviteBtn">${u.invited_at ? 'Resend Invite' : 'Send Invite'}</button></div>
          <p class="hint need" id="inviteNeed" hidden></p>
        </form>`}
      </section>
      ${staff && !mine && !u.owner ? `<section class="card" data-fold-start>
      <div class="row between"><h2>Staff Access</h2><span class="tag ${off ? 'danger' : 'ok'}">${off ? 'Deactivated' : 'On'}</span></div>
      <p class="hint">${off ? `Deactivated ${fmtDay(u.deactivated_at)}. ${p.They} can't sign in. ${p.Their} details and history are kept, so you can reactivate ${p.them}. Delete ${p.them} only if ${p.they} won't be back.`
        : `When ${p.they} ${p.v('leave', 'leaves')}, deactivate ${p.them}. ${p.Their} details and history are kept, so ${p.they} can come back later.`}</p>
      <div class="row">${off ? `<button type="button" class="primary" data-act="reactivate">Reactivate</button>
        <button type="button" class="ghost danger" data-act="del-staff">Delete Staff</button>`
        : '<button type="button" class="ghost" data-act="deactivate">Deactivate</button>'}</div>
    </section>` : ''}
    </div>
    </aside>
  </div>`, { keepScroll: again });
  if (restore) restore();
  if (!staff) bindTraining(id, stu, () => adminUser(id, true));
  if (!staff) bindSessions(id, stu, { log, page: 1 });
  if (!ready) gateInvite(me.isCoach
    ? `Save a training plan and add a goal on <a href="#/student/${u.id}">${p.their} student page</a> before sending the invite.`
    : 'A coach needs to save a training plan and add a goal before the invite can go out.');

  $('#userForm').onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const patch = { first_name: f.get('first_name').trim(), last_name: f.get('last_name').trim(), pronouns: readPronouns(f) };
    busy(e.submitter, async () => {
      must(await sb.from(table).update(patch).eq('id', id));
      if (mine) { await loadMe(me.user); setWho(); }
      flash('Details saved.');
      adminUser(id, e.target);
    });
  };
  // Roles (staff only). Ticking Student makes them a student too, with the same name and email.
  const rolesForm = $('#rolesForm');
  if (rolesForm) rolesForm.onsubmit = e => {
    e.preventDefault();
    const roles = checkedRoles(e.target);
    if (!roles) return;
    const newStudent = !twin && e.target.elements.student.checked;
    busy(e.submitter, async () => {
      must(await sb.from('staff').update({ roles }).eq('id', id));
      if (newStudent) await addStudentRow({ first_name: u.first_name, last_name: u.last_name, pronouns: u.pronouns, email: u.email }, u.invited_at);
      if (mine) { await loadMe(me.user); setWho(); }
      flash(newStudent ? `Roles saved. ${mine ? "You're" : `${u.first_name || title} is`} a student too now.` : 'Roles saved.');
      adminUser(id, e.target);
    });
  };

  const coachForm = $('#coachForm');
  if (coachForm) coachForm.onsubmit = e => {
    e.preventDefault();
    const coach_id = new FormData(e.target).get('coach_id') || null;
    if (coach_id === coachId) return flash('No change to save.');
    busy(e.submitter, async () => {
      must(await sb.from('students').update({ coach_id }).eq('id', id));
      flash(coach_id ? 'Coach saved.' : 'Coach removed.');
      adminUser(id, e.target);
    });
  };

  const inviteForm = $('#inviteForm');
  if (inviteForm) inviteForm.onsubmit = e => {
    e.preventDefault();
    if (!ready) return;
    const email = new FormData(e.target).get('email').trim().toLowerCase();
    busy(e.submitter, async () => {
      // Save the email first: the sign-up gate only lets listed emails create an account.
      if (email !== u.email) {
        const { error } = await sb.from(table).update({ email }).eq('id', id);
        if (error) throw error.code === '23505' ? new Error(`Another ${staff ? 'staff member' : 'student'} already has that email.`) : error;
        // A staff member who is also a student signs in once, so their student record follows.
        if (staff && twin) {
          const { error } = await sb.from('students').update({ email }).eq('id', twin.id);
          if (error) throw error.code === '23505' ? new Error('Another student already has that email.') : error;
        }
      }
      const { error } = await sendLink(email, u.first_name, staff);
      if (error) throw error;
      must(await sb.from(table).update({ invited_at: new Date().toISOString() }).eq('id', id));
      flash(`Invite sent to ${email}.`);
      adminUser(id, e.target);
    });
  };

  app.onclick = async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'send-link') busy(b, async () => {
      const { error } = await sendLink(u.email);
      if (error) throw error;
      flash(`Link sent to ${u.email}.`);
    });
    if (b.dataset.act === 'change-email') {
      const f = await ask({ title: 'Change Email', ok: 'Change Email', body: `<div class="stack">
        <p>${p.They}'ll sign in with the new email from now on. ${p.Their} password stays the same.
          ${p.Their} current email gets a notice saying so, with a note to contact ${p.their} coach or an admin if it's a mistake.</p>
        <label>Email<input type="email" name="email" value="${esc(u.email)}" required data-need="Enter ${p.their} new email." autocomplete="off"></label></div>` });
      const email = f?.get('email').trim().toLowerCase();
      if (email && email !== u.email) busy(b, async () => {
        // The notice goes to the old address, so it has to go before the change, while that address still has a login.
        // prepare_email_change() checks the new email and stamps the notice's wording; no notice, no change.
        const old = await sb.rpc('prepare_email_change', { p_id: id, p_email: email }).then(must);
        const { error } = await mailer.auth.signInWithOtp({ email: old, options: { shouldCreateUser: false } });
        if (error) throw new Error(`The notice to ${old} didn't send, so the email wasn't changed: ${msgOf(error)}`);
        must(await sb.rpc('change_student_email', { p_id: id, p_email: email }));
        flash(`Email changed. ${p.They} ${p.v('sign', 'signs')} in as ${email} now, and a notice went to ${old}.`);
        adminUser(id, true);
      });
    }
    if (b.dataset.act === 'deactivate') {
      const n = pupils.length;
      if (await ask({ title: `Deactivate ${title}?`, ok: 'Deactivate', warn: true,
        body: `<p>${p.They}'ll be signed out and won't be able to sign in${n ? `, and ${p.their} ${n === 1 ? 'student' : `${n} students`} will have no coach until you pick a new one` : ''}.
          ${p.Their} details and history stay, and you can reactivate ${p.them} later.</p>` })) busy(b, async () => {
        must(await sb.from('staff').update({ deactivated_at: new Date().toISOString() }).eq('id', id));
        flash(`${title} deactivated.`);
        adminUser(id, true);
      });
    }
    if (b.dataset.act === 'reactivate') busy(b, async () => {
      must(await sb.from('staff').update({ deactivated_at: null }).eq('id', id));
      flash(`${title} reactivated.${u.roles.includes('coach') ? ` Pick ${p.them} as the coach on any students ${p.they} should have.` : ''}`);
      adminUser(id, true);
    });
    if (b.dataset.act === 'del-staff' || b.dataset.act === 'del-student') {
      const ok = await ask(staff
        ? { title: `Delete ${title}?`, warn: true, ok: 'Delete Staff',
            body: `<p>This deletes ${p.their} staff account and login. Notes ${p.they} wrote stay, with ${p.their} name on them. This can't be undone.</p>
              <p>If ${p.they} might come back, leave ${p.them} deactivated instead.</p>` }
        : { title: `Delete ${title}?`, warn: true, ok: 'Delete Student',
            body: `<p>This deletes the student, all ${p.their} plans, goals and notes, and ${p.their} login. This can't be undone.</p>` });
      if (ok) busy(b, async () => {
        must(await sb.rpc(staff ? 'delete_staff' : 'delete_student', { p_id: id }));
        flash(`${title} deleted.`);
        goTo('#/users');
      });
    }
  };
}
