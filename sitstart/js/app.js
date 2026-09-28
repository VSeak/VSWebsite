// ---------- Start-up & routing ----------

async function boot() {
  if (!CONFIG.supabaseUrl || !CONFIG.supabaseKey || !window.supabase) {
    view(`<section class="card narrow"><h1>Almost There</h1>
      <p>This site isn't connected to Supabase yet. Follow <strong>SETUP.md</strong>, then fill in
      <code>supabaseUrl</code> and <code>supabaseKey</code> near the top of the script in <code>index.html</code>.</p></section>`);
    return;
  }
  sb = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, { auth: { flowType: 'implicit' } });
  mailer = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
    auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'mailer' },
  });
  sb.auth.onAuthStateChange(event => {
    if (event === 'PASSWORD_RECOVERY') wantsPassword = true;
    if (event === 'SIGNED_OUT' && me) { me = null; dirty = false; setTimeout(route); }
  });

  const { data: { session } } = await sb.auth.getSession();   // also reads a link's token from the URL
  if (location.search || !location.hash.startsWith('#/')) history.replaceState(null, '', BASE + '#/');
  currentHash = location.hash;

  if (session) {
    try { await loadMe(session.user); }
    catch (e) { showError(e); return; }
  }
  window.addEventListener('hashchange', onHashChange);
  window.addEventListener('beforeunload', e => { if (unsaved()) { e.preventDefault(); e.returnValue = ''; } });
  route();
}

async function loadMe(user) {
  const roles = await sb.rpc('my_roles').then(must);
  // Staff can be students too (View My Training), so everyone claims their student row.
  await sb.rpc('claim_student').then(must);
  const student = await sb.from('students').select('*').eq('user_id', user.id).maybeSingle().then(must);
  // Staff read their own row for the greeting (admins can read every row, so match the email).
  // Falls back to the first name from their invite.
  const staffRow = roles && (await sb.from('staff').select('id, first_name, name').eq('email', user.email.toLowerCase()).maybeSingle()).data;
  const firstName = roles ? (staffRow?.first_name || user.user_metadata?.first_name || '') : (student?.first_name || '');
  const fullName = (roles ? staffRow?.name : student?.name) || firstName;
  // A deactivated staff member (staff_deactivated in schema.sql) can still sign in with their password, but gets no
  // roles and can read only their own row. Sign them straight back out (every device) and show "Account Deactivated".
  // Only after a real sign-in, so guessing an email never reveals that the account exists.
  if (!roles && !student
      && (await sb.from('staff').select('deactivated_at').eq('email', user.email.toLowerCase()).maybeSingle()).data?.deactivated_at) {
    const { error } = await sb.auth.signOut();
    if (error) await sb.auth.signOut({ scope: 'local' });
    me = null;
    deactivated = true;
    return;
  }
  me = { user, roles: roles || [], isStaff: !!roles, isCoach: !!roles?.includes('coach'), isAdmin: !!roles?.includes('admin'),
    staffId: staffRow?.id || null, student, firstName, fullName };
}

// A coach changes a student (plans, goals, details, next session, replies) only as their current coach, or when
// they have no coach. Never themselves. Other coaches can read, add Coach Notes and log past sessions (can_coach()).
const isSelf = s => !!me.student && s.id === me.student.id || !!s.email && s.email === me.user.email?.toLowerCase();
const canCoach = s => me.isCoach && (!s.coach_id || s.coach_id === me.staffId) && !isSelf(s);

const welcome = () => `Welcome${me.firstName ? ' ' + esc(me.firstName) : ''}!`;

// Unsaved edits: the plan editor's draft (dirty), or a form field changed from how the page drew it.
// Pages redraw their forms after a save, so a changed field is one that hasn't been saved (or added) yet.
const fieldChanged = el => el.type === 'checkbox' || el.type === 'radio' ? el.checked !== el.defaultChecked
  : el.tagName === 'SELECT' ? el.selectedIndex !== Math.max(0, [...el.options].findIndex(o => o.defaultSelected))
  : el.value !== el.defaultValue;
const unsaved = () => dirty || [...app.querySelectorAll('form :is(input, textarea, select)')].some(fieldChanged);

// Asks before unsaved edits are lost. True when there are none or the user says go ahead.
async function okToLeave(signOut = false) {
  if (!unsaved()) return true;
  const ok = await ask({ title: signOut ? 'Sign Out Without Saving?' : 'Leave Without Saving?', ok: signOut ? 'Sign Out' : 'Leave', warn: true,
    body: dirty ? "<p>Your changes to this plan haven't been saved.</p>" : "<p>You have changes on this page that haven't been saved.</p>" });
  if (ok) dirty = false;
  return !!ok;
}

// A page redraw after a save keeps unsaved edits in its other forms (not saved, the form just saved).
// Returns a function that puts them back once the page is drawn again.
function keepEdits(saved) {
  const kept = [...app.querySelectorAll('form[id]')].filter(f => f !== saved).flatMap(f =>
    [...f.querySelectorAll(':is(input, textarea, select)[name]')].filter(fieldChanged).map(el =>
      ({ el, sel: `#${f.id} [name="${el.name}"]${el.type === 'checkbox' ? `[value="${el.value}"]` : ''}` })));
  return () => kept.forEach(({ el, sel }) => {
    const now = app.querySelector(sel);
    if (!now || now.disabled) return;
    if (el.type === 'checkbox') now.checked = el.checked; else now.value = el.value;
    if (now.tagName === 'SELECT') now.dispatchEvent(new Event('change', { bubbles: true }));   // e.g. Other pronouns shows its box
  });
}

// Unsaved marks: a form with data-save marks itself and its card .unsaved while a field differs from how the
// page drew it, including + Add forms (a typed goal is lost too). Runs on every input and after any redraw of the page.
function markUnsaved() {
  for (const f of app.querySelectorAll('form[data-save]')) {
    const on = [...f.querySelectorAll('input, textarea, select')].some(fieldChanged);
    f.classList.toggle('unsaved', on);
    f.closest('.card')?.classList.toggle('unsaved', on);
  }
  placeBar();
}
// Foldable cards: inside an element with data-folds="<page>", each card's heading becomes a button that folds the card
// down to its heading row (the student page, a user's page and the Students list). Which headings are folded is
// remembered per page in this browser (so folding Details on one student folds it on every student). A folded card's forms stay in the page, so the leave check still sees them.
// A card with data-fold-start starts folded (one that is rarely touched) until it is unfolded once.
const foldKey = page => `coaching.folded.${page}`;
// { heading: true (folded) or false (unfolded) }. Older browsers kept a list of the folded headings.
function foldedOn(page) {
  try {
    const v = JSON.parse(localStorage.getItem(foldKey(page)) || '{}');
    return Array.isArray(v) ? Object.fromEntries(v.map(n => [n, true])) : v;
  } catch { return {}; }
}
const foldHead = card => card.querySelector(':scope > h2:first-child, :scope > .row:first-child > h2');
// Remembered by heading, or by data-fold on the card when the heading changes (a count, or "Your" vs "Her").
const foldName = (card, h) => card.dataset.fold || h.textContent.trim();
function applyFolds() {
  for (const box of app.querySelectorAll('[data-folds]')) {
    const folded = foldedOn(box.dataset.folds);
    for (const card of box.querySelectorAll('.card')) {
      const h = foldHead(card);
      if (!h) continue;
      if (!h.querySelector('button.fold')) h.innerHTML = `<button type="button" class="fold">${h.innerHTML}</button>`;
      const on = folded[foldName(card, h)] ?? 'foldStart' in card.dataset;
      card.classList.toggle('folded', on);
      h.querySelector('button.fold').setAttribute('aria-expanded', String(!on));
    }
  }
}
function setFold(card, on) {
  const box = card.closest('[data-folds]'), h = foldHead(card);
  if (!box || !h) return;
  const folded = foldedOn(box.dataset.folds), name = foldName(card, h);
  folded[name] = on;
  try { localStorage.setItem(foldKey(box.dataset.folds), JSON.stringify(folded)); } catch {}
  applyFolds();
  placeBar();
}
// The whole heading is the tap target (the button inside it is for the keyboard).
app.addEventListener('click', e => {
  const h = e.target.closest('[data-folds] .card > h2:first-child, [data-folds] .card > .row:first-child > h2');
  if (h) setFold(h.closest('.card'), !h.closest('.card').classList.contains('folded'));
});

let markQueued = false;
const queueMark = () => { if (!markQueued) { markQueued = true; requestAnimationFrame(() => { markQueued = false; applyFolds(); markUnsaved(); }); } };
new MutationObserver(queueMark).observe(app, { childList: true, subtree: true });
['input', 'change', 'reset'].forEach(t => app.addEventListener(t, queueMark));   // reset: a form cleared after + Add

// The bar at the bottom of the screen names the unsaved cards whose Save buttons are out of view, with Show
// (scrolls to the first) and, for just one card, its Save button. Hidden while typing on a phone, where the
// keyboard already takes the bottom of the screen. data-save="show" (the invite, which sends an email) only gets Show.
const bar = $('#unsavedBar'), touch = matchMedia('(pointer: coarse)');
const submitOf = f => f.querySelector('button:not([type="button"])');
const textFocused = () => !!document.activeElement?.matches('#app :is(textarea, select, input:not([type="checkbox"], [type="radio"]))');
// The keyboard shrinks the visible screen. Android's Back button closes it but leaves the field focused,
// so focus alone isn't enough. fullHeight is the visible height with no field focused.
const vv = window.visualViewport;
let fullHeight = vv?.height ?? 0;
const keyboardUp = () => !vv || vv.height < fullHeight - 120;
vv?.addEventListener('resize', () => { fullHeight = textFocused() ? Math.max(fullHeight, vv.height) : vv.height; placeBar(); });
let barForms = [];
function placeBar() {
  const typing = touch.matches && textFocused() && keyboardUp();
  document.body.classList.toggle('typing', typing);
  barForms = typing ? [] : [...app.querySelectorAll('form.unsaved')].filter(f => {
    const r = (f.closest('.card.folded') || submitOf(f)).getBoundingClientRect();   // a folded card's button is hidden
    return r.bottom < 0 || r.top > innerHeight - 90;
  });
  const names = barForms.map(f => f.closest('.card').querySelector('h2').textContent.trim());
  const text = `Unsaved changes: ${names.join(', ')}`;
  if (bar.firstChild.textContent !== text) bar.firstChild.textContent = text;
  const one = barForms.length === 1 && barForms[0].dataset.save !== 'show' && !submitOf(barForms[0]).disabled;
  const save = bar.querySelector('[data-bar="save"]');
  save.hidden = !one;
  if (one) save.textContent = submitOf(barForms[0]).textContent;
  bar.hidden = !barForms.length;
  document.body.classList.toggle('has-bar', !bar.hidden);
}
bar.addEventListener('click', e => {
  const b = e.target.closest('[data-bar]'), f = barForms[0];
  if (!b || !f) return;
  if (f.closest('.card.folded')) setFold(f.closest('.card'), false);
  if (b.dataset.bar === 'save') f.requestSubmit(submitOf(f));
  else f.closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
['scroll', 'resize'].forEach(t => addEventListener(t, placeBar, { passive: true }));
['focusin', 'focusout'].forEach(t => document.addEventListener(t, () => setTimeout(placeBar)));

// Goes to another page without the leave check, after a save, add or delete that ends there.
function goTo(hash) {
  dirty = false;
  app.querySelectorAll('form').forEach(f => f.reset());
  location.hash = hash;
}

async function onHashChange() {
  if (location.hash === currentHash) return;
  if (!await okToLeave()) { history.replaceState(null, '', currentHash); return; }
  currentHash = location.hash;
  route();
}

// Header: full name · roles (staff) or full name (students). The email stands in only if there's no name.
function setWho() {
  $('.who').hidden = !me;
  $('#whoName').textContent = me ? (me.fullName || me.user.email) : '';
  $('#whoRoles').textContent = me?.isStaff ? rolesText(me.roles) : '';
}

function route() {
  setWho();
  $('#signOut').hidden = !me;
  if (!me) return viewLogin();
  if (wantsPassword || (!me.isStaff && !me.user.user_metadata?.password_set)) return viewSetPassword();
  const [, page, id, sub] = location.hash.split('/');
  // Staff who are also students: #/me is their own student home. Their own plans and student page open as the
  // student sees them (adminPlan, adminStudent), never as a coach.
  const go = me.isStaff
    ? (me.student && page === 'me' ? studentHome()
      : me.student && !me.isCoach && page === 'plan' && id ? studentPlan(id)
      : me.isCoach && page === 'students' ? adminStudents() : me.isCoach && page === 'student' && id ? adminStudent(id)
      : me.isCoach && page === 'plan' && id ? adminPlan(id, sub)
      : (me.isCoach || me.isAdmin) && page === 'exercises' ? adminExercises()
      : me.isAdmin && page === 'users' ? adminUsers() : me.isAdmin && page === 'user' && id ? adminUser(id) : adminHome())
    : !me.student ? viewNoAccess()
    : (page === 'plan' && id ? studentPlan(id) : studentHome());
  Promise.resolve(go).catch(showError);
}

// Swaps the current page for another without adding a history step (or asking about unsaved edits).
function redirect(hash) {
  history.replaceState(null, '', hash);
  currentHash = location.hash;
  route();
}

function showError(e) {
  view(`<section class="card narrow"><h1>Something Went Wrong</h1><p>${esc(msgOf(e))}</p><p><a href="#/">Back to the start</a></p></section>`);
}

$('#signOut').onclick = async () => {
  if (!await okToLeave(true)) return;
  await sb.auth.signOut();
  me = null;
  history.replaceState(null, '', BASE + '#/');
  currentHash = location.hash;
  route();
};

// ---------- Sign-in pages ----------

function viewLogin() {
  view(`<section class="card narrow">
    <h1>Sign In</h1>
    ${linkError ? `<p class="alert">${esc(linkError)}</p>` : ''}
    <form id="loginForm" class="stack">
      <label>Email<input type="email" name="email" autocomplete="email" required data-need="Enter your email."></label>
      <label>Password<input type="password" name="password" autocomplete="current-password" required data-need="Enter your password."></label>
      <button class="primary">Sign In</button>
    </form>
    <p class="hint"><button type="button" id="forgotBtn" class="link">Forgot Password?</button></p>
  </section>`);
  if (deactivated) deactivatedNotice();
  $('#forgotBtn').onclick = e => forgotPassword(e.target);

  $('#loginForm').onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    busy(e.submitter, async () => {
      const { data, error } = await sb.auth.signInWithPassword({ email: f.get('email').trim(), password: f.get('password') });
      if (error) throw error;
      await loadMe(data.user);
      linkError = null;
      route();
    });
  };
}

// Emails a reset link (the Reset Password template) that leads to "Choose a Password".
// Supabase sends nothing for an email with no login but answers the same way, so the
// page always says the same thing: it never tells anyone whether an email has an account.
async function forgotPassword(btn) {
  const typed = $('#loginForm').elements.email.value.trim();
  const f = await ask({ title: 'Reset Password', ok: 'Send Link',
    body: `<p class="muted">Enter the email you sign in with. If it has an account, we'll email you a link to choose a new password.</p>
      <label>Email<input type="email" name="email" value="${esc(typed)}" autocomplete="email" required data-need="Enter your email."></label>` });
  if (!f) return;
  await busy(btn, async () => {
    const { error } = await sb.auth.resetPasswordForEmail(f.get('email').trim(), { redirectTo: (CONFIG.siteUrl || BASE) + '?setpw=1' });
    if (error) throw error;
    await ask({ title: 'Check Your Email', cancel: false,
      body: `<p>If ${esc(f.get('email').trim())} has an account, a link to reset your password is on its way. It can take a few minutes, so check your spam folder too.</p>` });
  });
}

function deactivatedNotice() {
  deactivated = false;
  ask({ title: 'Account Deactivated', cancel: false,
    body: '<p>Your account has been deactivated, so you can\'t sign in. If this is a mistake, contact an admin.</p>' });
}

function viewSetPassword() {
  view(`<section class="card narrow"><h1>Choose a Password</h1>
    <p class="muted">You'll sign in with ${esc(me.user.email)} and this password from now on.<br>Passwords must be at least 8 characters long.</p>
    <form id="pwForm" class="stack">
      <label>New Password<input type="password" name="pw" minlength="8" autocomplete="new-password" required data-need="Choose a password."></label>
      <label>Confirm Password<input type="password" name="pw2" minlength="8" autocomplete="new-password" required data-need="Enter the same password again."></label>      <button class="primary">Save Password</button>
    </form></section>`);
  $('#pwForm').onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (f.get('pw') !== f.get('pw2')) { const el = e.target.elements.pw2; fieldError(el, "The passwords don't match."); el.focus(); return; }
    busy(e.submitter, async () => {
      let { data, error } = await sb.auth.updateUser({ password: f.get('pw'), data: { password_set: true } });
      // Already their password (e.g. used a sign-in link to get back in): that's fine, keep it.
      if (error?.code === 'same_password') ({ data, error } = await sb.auth.updateUser({ data: { password_set: true } }));
      if (error) throw error;
      me.user = data.user;
      wantsPassword = false;
      flash('Password saved.');
      route();
    });
  };
}

function viewNoAccess() {
  view(`<section class="card narrow"><h1>No Plan Linked Yet</h1>
    <p>You're signed in as ${esc(me.user.email)}, but this account isn't on the student list.
    Ask your coach to check which email they have for you.</p></section>`);
}

// ---------- Staff: home ----------

// One tile per staff page. Add new pages here. stat() is optional and returns a short line for the tile.
// roles says who sees the tile (route() checks it too): coaches get the coaching pages, admins the Users page, and
// staff who are also students (role 'student', from me.student) their own training.
const ADMIN_PAGES = [
  { href: '#/students', title: 'Students', roles: ['coach'], blurb: 'Add students, build their plans and goals, and send invites.',
    stat: async () => {
      const { count, error } = await sb.from('students').select('id', { count: 'exact', head: true })
        .is('training_ended_at', null).eq('coach_id', me.staffId);
      if (error) throw error;
      return count === 1 ? 'Coaching 1 student' : `Coaching ${count} students`;
    } },
  { href: '#/exercises', title: 'Master Exercise List', roles: ['coach', 'admin'], blurb: 'The exercises plans pick from, with their usual sets, reps, rest and notes.',
    stat: async () => {
      const { count, error } = await sb.from('exercises').select('id', { count: 'exact', head: true });
      if (error) throw error;
      return count === 1 ? '1 exercise' : `${count} exercises`;
    } },
  { href: '#/users', title: 'Users', roles: ['admin'], blurb: 'See and edit everyone who can sign in: admins, coaches and students.',
    stat: async () => {
      const users = await sb.rpc('list_users').select('id').then(must);
      return users.length === 1 ? '1 user' : `${users.length} users`;
    } },
  { href: '#/me', title: 'View My Training', roles: ['student'], blurb: 'Your own plans, goals and sessions, as your coach shares them with you.' },
];

async function adminHome() {
  const t = ++navToken;
  const mine = me.student ? [...me.roles, 'student'] : me.roles;
  const pages = ADMIN_PAGES.filter(p => p.roles.some(r => mine.includes(r)));
  view(`<h1>${welcome()}</h1>
    <div class="tiles">${pages.map((p, i) => `<a class="card tile" href="${p.href}">
      <h2>${esc(p.title)}</h2><p class="muted">${esc(p.blurb)}</p>
      ${p.stat ? `<p class="tile-stat" data-stat="${i}">&nbsp;</p>` : ''}</a>`).join('')}</div>`);
  pages.forEach((p, i) => p.stat?.().then(text => {
    const el = t === navToken && app.querySelector(`[data-stat="${i}"]`);
    if (el) el.textContent = text;
  }).catch(() => {}));
}
