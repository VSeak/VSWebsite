// ---------- Start-up & routing ----------

async function boot() {
  if (!CONFIG.supabaseUrl || !CONFIG.supabaseKey || !window.supabase) {
    authPage('Almost there,', 'one more step.', `<p>This site isn't connected to Supabase yet. Follow <strong>SETUP.md</strong>, then fill in
      <code>supabaseUrl</code> and <code>supabaseKey</code> in <code>CONFIG</code> at the top of <code>js/core.js</code>.</p>`);
    return;
  }
  sb = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, { auth: { flowType: 'implicit' }, global: { fetch: skewFetch } });
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

// A token refreshed just now (e.g. the page sat open overnight) can reach the database a moment before its clock
// catches up with the sign-in server's, and it answers 401 "JWT issued at future". Wait and try again, up to 3 times.
async function skewFetch(url, opts) {
  for (let i = 1; ; i++) {
    const t0 = performance.now();
    const res = await fetch(url, opts);
    slowCheck(url, opts, performance.now() - t0);
    if (res.status !== 401 || i > 3 || !/issued at future/i.test(await res.clone().text())) return res;
    await new Promise(r => setTimeout(r, 1000 * i));
  }
}

// A call over 4 seconds goes to the error log (logError), by address without the query (it can hold names).
// Not while the page is hidden: a phone pauses a page in the background, which isn't the server being slow.
function slowCheck(url, opts, ms) {
  const path = new URL(String(url)).pathname;
  if (ms > 4000 && !document.hidden && !path.endsWith('/app_errors'))
    logError('slow', `${opts?.method || 'GET'} ${path}`, `${(ms / 1000).toFixed(1)} s`);
}

async function loadMe(user) {
  // All at once, so sign-in waits for two round trips, not five.
  // Staff can be students too (View My Training), so everyone claims their student row, then reads it.
  // The staff row is for the greeting (admins can read every row, so match the email) and the deactivated check.
  const [roles, student, ownStaff] = await Promise.all([
    sb.rpc('my_roles').then(must),
    sb.rpc('claim_student').then(must)
      .then(() => sb.from('students').select('*').eq('user_id', user.id).maybeSingle().then(must)),
    sb.from('staff').select('id, first_name, name, deactivated_at').eq('email', user.email.toLowerCase()).maybeSingle()
      .then(r => r.data),
    // Coaches' own Training Log fields (the standard ones as they come if they can't be read).
    sb.from('log_fields').select('*').then(r => setLogFields(r.data ?? null)),
  ]);
  // Falls back to the first name from their invite.
  const staffRow = roles && ownStaff;
  const firstName = roles ? (staffRow?.first_name || user.user_metadata?.first_name || '') : (student?.first_name || '');
  const fullName = (roles ? staffRow?.name : student?.name) || firstName;
  // A deactivated staff member (staff_deactivated in schema.sql) can still sign in with their password, but gets no
  // roles and can read only their own row. Sign them straight back out (every device) and show "Account Deactivated".
  // Only after a real sign-in, so guessing an email never reveals that the account exists.
  if (!roles && !student && ownStaff?.deactivated_at) {
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
const queueMark = () => { if (!markQueued) { markQueued = true; requestAnimationFrame(() => { markQueued = false; applyFolds(); markUnsaved(); growAll(); }); } };
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
  authPage('Sorry,', 'something went wrong.', `<p>${esc(msgOf(e))}</p><p><a href="#/">Back to the start</a></p>`);
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

// Sign-in and account pages (design A on the canvas's Sign In & Account page): a two-line greeting (head, then sub
// in moss) and one card, with an optional note under the greeting. Side by side on wide screens, stacked on a phone.
function authPage(head, sub, card, note = '') {
  view(`<section class="auth"><h1 class="hey">${head}<span> ${sub}</span></h1>
    <div class="card auth-card">${card}</div>${note ? `<p class="hint auth-note">${note}</p>` : ''}</section>`);
}

function viewLogin() {
  authPage('Welcome back,', "let's climb.", `
    ${linkError ? `<p class="alert">${esc(linkError)}</p>` : ''}
    <form id="loginForm" class="stack">
      <label>Email<input type="email" name="email" autocomplete="email" required data-need="Enter your email."></label>
      <label>Password<input type="password" name="password" autocomplete="current-password" required data-need="Enter your password."></label>
      <button class="fill">Sign In</button>
    </form>
    <button type="button" id="forgotBtn" class="link">Forgot Password?</button>`,
    'No account yet? Your coach sends you an invite by email.');
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
  const f = await ask({ title: 'Reset Password', ok: 'Send Link', fill: true,
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
  authPage(me.firstName ? `Hey ${esc(me.firstName)},` : 'Welcome,', 'choose a password.', `
    <p>You'll sign in with <strong>${esc(me.user.email)}</strong> and this password from now on. Passwords must be at least 8 characters long.</p>
    <form id="pwForm" class="stack">
      <label>New Password<input type="password" name="pw" minlength="8" autocomplete="new-password" required data-need="Choose a password."></label>
      <label>Confirm Password<input type="password" name="pw2" minlength="8" autocomplete="new-password" required data-need="Enter the same password again."></label>
      <button class="fill">Save Password</button>
    </form>`);
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
  authPage('Almost there,', 'no plan linked yet.', `<p>You're signed in as <strong>${esc(me.user.email)}</strong>, but this account
    isn't on the student list. Ask your coach to check which email they have for you.</p>`);
}

// ---------- Staff: home ----------

// One tile per staff page. Add new pages here. stat() is optional and returns the tile's big number.
// roles says who sees the tile (route() checks it too): coaches get the coaching pages, admins the Users page, and
// staff who are also students (role 'student', from me.student) their own training.
const ADMIN_PAGES = [
  { href: '#/students', title: 'Students', roles: ['coach'], blurb: 'Plans, goals, sessions, and invites.',
    stat: async () => {
      const { count, error } = await sb.from('students').select('id', { count: 'exact', head: true })
        .is('training_ended_at', null).eq('coach_id', me.staffId);
      if (error) throw error;
      return count;
    } },
  { href: '#/exercises', title: 'Exercises & Drills', roles: ['coach', 'admin'], blurb: 'What plans pick from, with their usual sets, reps, and rest.',
    stat: async () => {
      const { count, error } = await sb.from('exercises').select('id', { count: 'exact', head: true });
      if (error) throw error;
      return count;
    } },
  { href: '#/users', title: 'Users', roles: ['admin'], blurb: 'Everyone who can sign in.',
    stat: async () => (await sb.rpc('list_users').select('id').then(must)).length },
  { href: '#/me', title: 'View My Training', roles: ['student'], blurb: 'Your own plans and goals.' },
];

const ICON_ARROW = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const ICON_CAL = `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>`;
const COMING_UP = 5;   // upcoming sessions listed on Home
// The date block on a Coming Up row: WED over 1.
const dayBlock = d => `<span class="day-block"><small>${day(d).toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()}</small><strong>${day(d).getDate()}</strong></span>`;

// What needs this person, for the Needs Attention card: coaches get their own active students who haven't been invited
// (Send Invite), whose next session has ended (Update Next Session) or isn't set (Set Next Session), or whose past
// sessions have no Coach Note (Needs Note); admins get active students with no coach (Pick a Coach). Student notes
// never show here: replying is up to the coach. Also returns the coach's upcoming sessions.
async function homeNeeds() {
  // All at once: notes and history filter on the student's coach through the join, so they don't wait for the ids.
  const mineOnly = q => q.eq('student.coach_id', me.staffId).is('student.training_ended_at', null).then(must);
  const [mine, noCoach, notes, log] = await Promise.all([
    me.isCoach ? sb.from('students').select(`id,first_name,name,email,invited_at,user_id,coach_id,training_ended_at,${NEXT_COLS}`)
      .is('training_ended_at', null).eq('coach_id', me.staffId).then(must) : [],
    me.isAdmin ? sb.from('students').select('id,name').is('training_ended_at', null).is('coach_id', null).then(must) : [],
    me.isCoach ? mineOnly(sb.from('coach_notes').select('student_id,session_date,student:students!inner(coach_id,training_ended_at)')) : [],
    me.isCoach ? mineOnly(sb.from('session_history').select('student_id,session_date,start_time,student:students!inner(coach_id,training_ended_at)')) : [],
  ]);
  const items = [];
  for (const s of mine) {
    if (accountStatus(s) === 'Not Invited') items.push({ name: s.name, href: '#/student/' + s.id, sub: 'No invite sent yet', tag: 'Send Invite' });
    if (!s.next_date) items.push({ name: s.name, href: '#/student/' + s.id, sub: 'No next session set', tag: 'Set Next Session' });
    else if (nextOverdue(s)) items.push({ name: s.name, href: '#/student/' + s.id, sub: `Next session ended ${fmtSessionDay(s.next_date)}`, tag: 'Update Next Session' });
    const missing = cnoteMissing(notes.filter(n => n.student_id === s.id), s, log.filter(h => h.student_id === s.id));
    if (missing.length) items.push({ name: s.name, href: '#/student/' + s.id, tag: 'Needs Note',
      sub: missing.length === 1 ? `Session on ${fmtSessionDay(missing[0])}` : `${missing.length} sessions have no notes` });
  }
  for (const s of noCoach) items.push({ name: s.name, href: '#/user/' + s.id, sub: 'Student with no coach', tag: 'Pick a Coach' });
  const upcoming = mine.filter(s => !nextPassed(s))
    .sort((a, b) => (a.next_date + a.next_start).localeCompare(b.next_date + b.next_start)).slice(0, COMING_UP);
  return { items, upcoming, coaching: mine.length };
}

async function adminHome() {
  const t = ++navToken;
  const mine = me.student ? [...me.roles, 'student'] : me.roles;
  const pages = ADMIN_PAGES.filter(p => p.roles.some(r => mine.includes(r)));
  view(loading);
  const { items, upcoming, coaching } = await homeNeeds();
  if (t !== navToken) return;
  const name = me.firstName ? ' ' + esc(me.firstName) : '';
  const n = items.length;
  const todo = i => `<a class="todo" href="${i.href}"><span><b>${esc(i.name)}</b><span>${esc(i.sub)}</span></span><span class="pill warn">${i.tag}</span></a>`;
  const up = s => `<a class="todo" href="#/student/${s.id}">${dayBlock(s.next_date)}<span><b>${esc(s.name)}</b>
    <span>${fmtTime(s.next_start)} – ${fmtTime(s.next_end)} · ${esc(s.next_location)}</span></span></a>`;
  // Nothing to do: a calm card that still shows what's coming up (or, coaching nobody, how to start).
  const clear = me.isCoach ? `<div class="needs-clear"><span class="check">${ICON_CHECK}</span><div><b>Nothing needs attention right now</b>
      <span>${coaching ? 'Every student is invited and has a next session, and every session has a note.' : "You're not coaching anyone at the moment."}</span></div></div>` : '';
  const coming = !me.isCoach ? '' : `<span class="eyebrow">Coming Up</span>${upcoming.length ? upcoming.map(up).join('')
    : `<div class="none-up">${ICON_CAL}<div><b>No sessions coming up</b><span>${coaching ? 'Set a next session on a student’s page.'
      : 'Add a student, or pick up a No Coach student, to get started.'}</span></div>${coaching ? '' : '<a class="fill" href="#/students">+ Add Student</a>'}</div>`}`;
  view(`<h1 class="hey">Welcome${name},<span> ${n ? `${n} ${n === 1 ? 'thing needs' : 'things need'} your attention.` : "you're all caught up."}</span></h1>
    <div class="home-grid">
      ${n || me.isCoach ? `<section class="needs">${n ? `<div class="row between"><span class="eyebrow">Needs Attention</span><span class="pill">${n}</span></div>
        ${items.map(todo).join('')}` : clear + coming}</section>` : ''}
      <div class="tiles">${pages.map((p, i) => `<a class="card tile${p.stat ? '' : ' tile-soft'}" href="${p.href}">
        <div><h2>${esc(p.title)}</h2><p class="muted">${esc(p.blurb)}</p></div>
        ${p.stat ? `<span class="big-num" data-stat="${i}"></span>` : ICON_ARROW}</a>`).join('')}</div>
    </div>`);
  pages.forEach((p, i) => p.stat?.().then(num => {
    const el = t === navToken && app.querySelector(`[data-stat="${i}"]`);
    if (el) { el.textContent = num; el.classList.toggle('zero', !num); }
  }).catch(() => {}));
}
