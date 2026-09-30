// ---------- Start-up & routing ----------

async function boot() {
  if (!CONFIG.supabaseUrl || !CONFIG.supabaseKey || !window.supabase) {
    authPage('Almost there,', 'one more step.', `<p>This site isn't connected to Supabase yet. Follow <strong>SETUP.md</strong>.</p>`);
    return;
  }
  sb = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, { auth: { flowType: 'implicit' }, global: { fetch: skewFetch } });
  mailer = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
    auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'mailer' },
  });
  sb.auth.onAuthStateChange(event => {
    if (event === 'PASSWORD_RECOVERY') wantsPassword = true;
    if (event === 'SIGNED_OUT' && me) { me = null; setTimeout(route); }
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

// A token refreshed just now can reach the database a moment before its clock catches up ("JWT issued at future").
async function skewFetch(url, opts) {
  for (let i = 1; ; i++) {
    const res = await fetch(url, opts);
    if (res.status !== 401 || i > 3 || !/issued at future/i.test(await res.clone().text())) return res;
    await new Promise(r => setTimeout(r, 1000 * i));
  }
}

// Only Top Out staff get in. A login from Sit Start alone has no team_staff row, so me.roles is empty and every
// table answers with no rows (row-level security); the page shows "No Access" instead.
async function loadMe(user) {
  const row = await sb.from('team_staff').select('id, first_name, name, roles').eq('email', user.email.toLowerCase()).maybeSingle().then(must);
  const roles = row?.roles || [];
  const firstName = row?.first_name || user.user_metadata?.first_name || '';
  me = { user, staffId: row?.id || null, roles, isStaff: !!row, isAdmin: roles.includes('admin'), isCoach: roles.includes('coach'),
    firstName, fullName: row?.name || firstName };
}

const ROLE_LABEL = { admin: 'Admin', coach: 'Coach' };
const rolesText = roles => ['admin', 'coach'].filter(r => roles.includes(r)).map(r => ROLE_LABEL[r]).join(' · ');

// Unsaved edits: a form field on the page that differs from how the page drew it (pages redraw their forms after a save).
const fieldChanged = el => el.type === 'checkbox' || el.type === 'radio' ? el.checked !== el.defaultChecked
  : el.tagName === 'SELECT' ? el.selectedIndex !== Math.max(0, [...el.options].findIndex(o => o.defaultSelected))
  : el.value !== el.defaultValue;
const unsaved = () => [...app.querySelectorAll('form:not([data-nosave]) :is(input, textarea, select)')].some(fieldChanged);

async function okToLeave(signOut = false) {
  if (!unsaved()) return true;
  return !!await ask({ title: signOut ? 'Sign Out Without Saving?' : 'Leave Without Saving?', ok: signOut ? 'Sign Out' : 'Leave', warn: true,
    body: "<p>You have changes on this page that haven't been saved.</p>" });
}
// A card with an unsaved form gets an Unsaved tag and a filled Save button (phones have no hover to hint it).
function markUnsaved() {
  for (const f of app.querySelectorAll('form[data-save]')) {
    const on = [...f.querySelectorAll('input, textarea, select')].some(fieldChanged);
    f.classList.toggle('unsaved', on);
    f.closest('.card')?.classList.toggle('unsaved', on);
  }
}
['input', 'change', 'reset'].forEach(t => app.addEventListener(t, () => requestAnimationFrame(markUnsaved)));

// Goes to another page without the leave check, after a save, add or delete that ends there.
function goTo(hash) {
  app.querySelectorAll('form').forEach(f => f.reset());
  location.hash = hash;
}

async function onHashChange() {
  if (location.hash === currentHash) return;
  if (!await okToLeave()) { history.replaceState(null, '', currentHash); return; }
  currentHash = location.hash;
  route();
}

function setWho() {
  $('.who').hidden = !me;
  $('#whoName').textContent = me ? (me.fullName || me.user.email) : '';
  $('#whoRoles').textContent = me?.isStaff ? rolesText(me.roles) : '';
}

function route() {
  setWho();
  $('#signOut').hidden = !me;
  if (!me) return viewLogin();
  if (wantsPassword) return viewSetPassword();
  if (!me.isStaff) return viewNoAccess();
  const [, page, id, sub] = location.hash.split('/');
  const go = page === 'loc' && id ? locationPage(id, sub)
    : page === 'member' && id ? memberPage(id)
    : me.isAdmin && page === 'staff' ? staffPage()
    : me.isAdmin && page === 'settings' ? settingsPage()
    : homePage();
  Promise.resolve(go).catch(showError);
}

// Swaps the current page for another without adding a history step (or asking about unsaved edits).
function redirect(hash) {
  history.replaceState(null, '', hash);
  currentHash = location.hash;
  route();
}
// Redraws the page (after a save), keeping the scroll.
function redraw() { redrawing = true; route(); }

function showError(e) {
  authPage('Sorry,', 'something went wrong.', `<p>${esc(msgOf(e))}</p><p><a href="#/">Back to the start</a></p>`);
}

$('#signOut').onclick = async () => {
  if (!await okToLeave(true)) return;
  await sb.auth.signOut({ scope: 'local' });   // this device only: the login may be signed in to Sit Start elsewhere
  me = null;
  history.replaceState(null, '', BASE + '#/');
  currentHash = location.hash;
  route();
};

// ---------- Sign-in pages ----------

function authPage(head, sub, card, note = '') {
  view(`<section class="auth"><h1 class="hey">${head}<span> ${sub}</span></h1>
    <div class="card auth-card">${card}</div>${note ? `<p class="hint auth-note">${note}</p>` : ''}</section>`);
}

function viewLogin() {
  authPage('Welcome back,', 'coach.', `
    ${linkError ? `<p class="alert">${esc(linkError)}</p>` : ''}
    <form id="loginForm" class="stack" data-nosave>
      <label>Email<input type="email" name="email" autocomplete="email" required data-need="Enter your email."></label>
      <label>Password<input type="password" name="password" autocomplete="current-password" required data-need="Enter your password."></label>
      <button class="fill">Sign In</button>
    </form>
    <button type="button" id="forgotBtn" class="link">Forgot Password?</button>`,
    'Adult Team staff only. An admin sends you an invite by email.');
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

// Emails a reset link that leads to "Choose a Password". The page always says the same thing, so it never tells
// anyone whether an email has an account.
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

function viewSetPassword() {
  authPage(me.firstName ? `Hey ${esc(me.firstName)},` : 'Welcome,', 'choose a password.', `
    <p>You'll sign in with <strong>${esc(me.user.email)}</strong> and this password from now on. Passwords must be at least 8 characters long.</p>
    <form id="pwForm" class="stack" data-nosave>
      <label>New Password<input type="password" name="pw" minlength="8" autocomplete="new-password" required data-need="Choose a password."></label>
      <label>Confirm Password<input type="password" name="pw2" minlength="8" autocomplete="new-password" required data-need="Enter the same password again."></label>
      <button class="fill">Save Password</button>
    </form>`, 'If you also use Sit Start, this is your password there too: both sites share one sign-in.');
  $('#pwForm').onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (f.get('pw') !== f.get('pw2')) { const el = e.target.elements.pw2; fieldError(el, "The passwords don't match."); el.focus(); return; }
    busy(e.submitter, async () => {
      let { data, error } = await sb.auth.updateUser({ password: f.get('pw'), data: { password_set: true } });
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
  authPage('Hmm,', 'no access here.', `<p>You're signed in as <strong>${esc(me.user.email)}</strong>, but this account isn't on the
    Top Out staff list. If you coach Adult Team, ask an admin to add this email.</p>`);
}

// ---------- Home ----------

const ICON_ARROW = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
const ICON_PIN = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>`;
const COMING_UP = 6;

async function homePage() {
  const t = ++navToken;
  view(loading);
  const [locs, members, events] = await Promise.all([
    sb.from('team_locations').select('id, name').order('position').order('name').then(must),
    sb.from('team_members').select('location_id').is('left_on', null).then(must),
    sb.from('team_events').select('id, location_id, kind, title, event_date, end_date, start_time, end_time')
      .or(`event_date.gte.${today()},end_date.gte.${today()}`).order('event_date').order('start_time', { nullsFirst: true }).limit(40).then(must),
  ]);
  if (t !== navToken) return;
  const count = id => members.filter(m => m.location_id === id).length;
  const locName = id => id ? locs.find(l => l.id === id)?.name || '' : 'All Locations';
  const nextAt = id => events.find(e => e.location_id === id || !e.location_id);
  const card = l => {
    const n = count(l.id), next = nextAt(l.id);
    return `<a class="card loc-card" href="#/loc/${l.id}">
      <div class="loc-top"><span class="loc-pin">${ICON_PIN}</span><h2>${esc(l.name)}</h2>${ICON_ARROW}</div>
      <div class="loc-stats"><span class="big-num${n ? '' : ' zero'}">${n}</span><span class="muted">${n === 1 ? 'team member' : 'team members'}</span></div>
      <p class="loc-next">${next ? `<b>Next:</b> ${esc(next.title)} · ${fmtShort(next.event_date)}` : '<span class="muted">Nothing on the calendar yet</span>'}</p></a>`;
  };
  const up = events.slice(0, COMING_UP);
  const name = me.firstName ? ' ' + esc(me.firstName) : '';
  view(`<h1 class="hey">Welcome${name},<span> let's send it.</span></h1>
    <div class="home-grid">
      <div>
        <div class="row between section-head"><h2 class="eyebrow">Locations</h2>
          ${me.isAdmin ? '<button type="button" id="addLoc" class="small">+ Add Location</button>' : ''}</div>
        ${locs.length ? `<div class="loc-grid">${locs.map(card).join('')}</div>`
          : `<section class="card empty"><h2>No Locations Yet</h2><p class="muted">${me.isAdmin ? 'Add your first location to get started.'
            : "You haven't been added to a location yet. Ask an admin to add you."}</p></section>`}
      </div>
      <aside class="side">
        <section class="needs"><span class="eyebrow">Coming Up</span>
          ${up.length ? up.map(e => eventRow(e, { where: locs.length > 1 ? locName(e.location_id) : "",
            href: `#/loc/${e.location_id || locs[0]?.id}/calendar` })).join('')
            : '<p class="none-up">Nothing coming up. Add competitions, practices and open houses on a location’s calendar.</p>'}
        </section>
        ${me.isAdmin ? `<div class="tiles">
          <a class="card tile" href="#/staff"><div><h2>Staff</h2><p class="muted">Admins and coaches, and where they coach.</p></div>${ICON_ARROW}</a>
          <a class="card tile" href="#/settings"><div><h2>Settings</h2><p class="muted">Locations, circuit colors and rating areas.</p></div>${ICON_ARROW}</a>
        </div>` : ''}
      </aside>
    </div>`);
  $('#addLoc')?.addEventListener('click', addLocation);
}

async function addLocation() {
  const f = await ask({ title: 'Add Location', ok: 'Add Location',
    body: `<label>Name<input name="name" maxlength="60" required data-need="Name the location." placeholder="E.g. Bloomington" autocomplete="off"></label>` });
  if (!f) return;
  await busy(null, async () => {
    const { data: last } = await sb.from('team_locations').select('position').order('position', { ascending: false }).limit(1).maybeSingle();
    const row = await sb.from('team_locations').insert({ name: f.get('name').trim(), position: (last?.position || 0) + 1 }).select('id').single().then(must);
    flash('Location added. Assign coaches to it on the Staff page.');
    goTo('#/loc/' + row.id);
  });
}

// An event as a row: the date block, title, and when (plus the location, on Home).
const KINDS = { competition: 'Competition', practice: 'Practice', open_house: 'Open House', other: 'Other' };
function eventWhen(e) {
  const days = e.end_date && e.end_date !== e.event_date ? `${fmtShort(e.event_date)} – ${fmtShort(e.end_date)}` : fmtDay(e.event_date);
  return e.start_time ? `${days} · ${fmtTime(e.start_time)}${e.end_time ? ' – ' + fmtTime(e.end_time) : ''}` : `${days} · All day`;
}
function eventRow(e, { where = "", href = "" } = {}) {
  const tag = href ? `a href="${href}"` : `button type="button" data-event="${e.id}"`;
  return `<${tag} class="todo">${dayBlock(e.event_date)}
    <span><b>${esc(e.title)}</b><span>${esc(eventWhen(e))}${where ? ' · ' + esc(where) : ''}</span></span>
    <span class="kind k-${e.kind}">${KINDS[e.kind]}</span></${href ? "a" : "button"}>`;
}
