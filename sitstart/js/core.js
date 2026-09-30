// ---- Fill these in from Supabase (see SETUP.md) ----
const CONFIG = {
  siteName: "Sit Start",
  supabaseUrl: "https://loxyrqffevvdhwltccxr.supabase.co",   // e.g. https://abcd1234.supabase.co
  supabaseKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxveHlycWZmZXZ2ZGh3bHRjY3hyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzNzc5NzAsImV4cCI6MjEwNTk1Mzk3MH0.czgnKpu18kuEghIC3Ixy6jR-AFvBHQVH7rDDqmFF_EI",   // the publishable (or "anon") key. Never the secret key.
  siteUrl: "https://vseak.github.io/vsapps/sitstart/",   // where emailed sign-in links go, even when sent from localhost. Leave "" to use the current address.
};

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const BASE = location.origin + location.pathname;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Notes can have **bold** words (para() shows them bold), new lines, and web links (https://… or www.…),
// which open in a new tab. links=false leaves them as text, for a note that's already inside a link.
// Runs on the escaped text: a link ends at a space, a tag, or an escaped quote/bracket (& other than &amp;),
// and drops punctuation that ends a sentence.
const linkify = h => h.replace(/\b(?:https?:\/\/|www\.)(?:[^\s&<]|&amp;)+/gi, m => {
  const url = m.replace(/[.,;:!?)\]*]+$/, ''), rest = m.slice(url.length);
  return `<a href="${/^www\./i.test(url) ? 'https://' : ''}${url}" target="_blank" rel="noopener noreferrer">${url}</a>${rest}`;
});
const para = (s, links = true) => {
  const h = esc(s).replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
  return (links ? linkify(h) : h).replace(/\n/g, '<br>');
};
// A textarea with a Bold button in its corner (Ctrl+B does the same): wraps the picked words in **, or unwraps them.
const rich = textarea => `<div class="rich">${textarea}<button type="button" class="rich-b" data-bold title="Bold (Ctrl+B)" aria-label="Bold"><b>B</b></button></div>`;
function toggleBold(t) {
  const a = t.selectionStart, z = t.selectionEnd, v = t.value;
  if (a >= 2 && v.slice(a - 2, a) === '**' && v.slice(z, z + 2) === '**') t.setRangeText(v.slice(a, z), a - 2, z + 2, 'select');
  else { t.setRangeText(`**${v.slice(a, z)}**`, a, z); t.setSelectionRange(a + 2, z + 2); }
  t.focus();
  t.dispatchEvent(new Event('input', { bubbles: true }));
}
document.addEventListener('mousedown', e => { if (e.target.closest('[data-bold]')) e.preventDefault(); });   // keeps the picked words
document.addEventListener('click', e => { const b = e.target.closest('[data-bold]'); if (b) toggleBold(b.parentElement.querySelector('textarea')); });
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b' && e.target.matches?.('.rich textarea')) { e.preventDefault(); toggleBold(e.target); }
});
// A textarea with data-grow grows downward to fit its text: CSS field-sizing where the browser has it,
// otherwise here, on typing, on focus and after a redraw (growAll, from queueMark). Hidden ones wait until shown.
const growable = CSS.supports('field-sizing', 'content');
function grow(t) { if (growable || !t.offsetParent) return; t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; }
const growAll = () => document.querySelectorAll('textarea[data-grow]').forEach(grow);
['input', 'focusin'].forEach(k => document.addEventListener(k, e => { if (e.target.matches?.('textarea[data-grow]')) grow(e.target); }));
document.addEventListener('click', e => { if (e.target.closest('[data-tab]')) requestAnimationFrame(growAll); });   // a session tab shows its fields
const must = ({ data, error }) => { if (error) throw error; return data; };
const loading = '<p class="muted">Loading…</p>';

document.title = CONFIG.siteName;
$('.brand-name').textContent = CONFIG.siteName;
$('.brand').setAttribute('aria-label', CONFIG.siteName);

let sb, mailer;
let me = null;               // {user, roles, isStaff, isCoach, isAdmin, student}. roles: staff roles, e.g. ['admin', 'coach']; [] for a student
let wantsPassword = new URLSearchParams(location.search).has('setpw');
let linkError = null;        // from an expired or used email link
let deactivated = false;     // a deactivated staff member tried to sign in: the sign-in page tells them (deactivatedNotice)
let dirty = false;           // unsaved plan edits
let draft = null;            // plan open in the editor
let notesCtx = { notes: [], studentName: '' };
let currentHash = location.hash;
let navToken = 0;

if (location.hash && !location.hash.startsWith('#/')) {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('error_code') === 'otp_expired') linkError = 'That link has expired or was already used. Use Forgot Password below to get a new one.';
  else if (h.get('error_description')) linkError = h.get('error_description');
}

// ---------- Helpers ----------

function view(html, { keepScroll = false } = {}) {
  app.oninput = app.onchange = app.onclick = app.onpointerdown = null;
  $('#exMenu')?.setAttribute('hidden', '');   // its field is about to go
  app.innerHTML = html;
  if (!keepScroll) window.scrollTo(0, 0);
}

let flashTimer;
function flash(msg, kind = 'ok') {
  const f = $('#flash');
  f.textContent = msg; f.className = kind; f.hidden = false;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { f.hidden = true; }, kind === 'error' ? 7000 : 3500);
}

function msgOf(e) {
  const m = e?.message || String(e);
  if (/invalid login credentials/i.test(m)) return "That email and password don't match. Forgot your password? Tap Forgot Password below.";
  if (/failed to fetch/i.test(m)) return "Couldn't reach the server. Check your connection and try again.";
  if (/does not exist|could not find the function/i.test(m)) return m + ' (Has supabase/schema.sql been run?)';
  return m;
}

async function busy(btn, fn) {
  btn.disabled = true;
  try { return await fn(); }
  catch (e) { flash(msgOf(e), 'error'); }
  finally { btn.disabled = false; }
}

// Field errors: a red field with a message under it, instead of the browser's pop-up.
// Each required field says what to do in data-need. Typing in the field clears it.
function fieldError(el, msg) {
  clearFieldError(el);
  el.setAttribute('aria-invalid', 'true');
  const err = document.createElement('span');
  err.className = 'field-error';
  err.id = 'err-' + Math.random().toString(36).slice(2);
  err.textContent = msg;
  el.setAttribute('aria-describedby', err.id);
  const label = el.closest('label'), row = el.parentElement.closest('.row');
  (label || row || el).after(err);
}
function clearFieldError(el) {
  if (el.getAttribute('aria-invalid') !== 'true') return;
  el.removeAttribute('aria-invalid');
  document.getElementById(el.getAttribute('aria-describedby'))?.remove();
  el.removeAttribute('aria-describedby');
}
function validityMsg(el) {
  const v = el.validity;
  if (v.valueMissing || v.customError) return el.dataset.need || 'Fill this in.';
  if (v.typeMismatch && el.type === 'email') return 'Enter a full email address, like name@example.com.';
  if (v.rangeUnderflow && el.dataset.low) return el.dataset.low;
  if (v.rangeOverflow && el.dataset.high) return el.dataset.high;
  if (v.tooShort) return `Use at least ${el.minLength} characters.`;
  return el.validationMessage;
}
let focusedError = false;
document.addEventListener('invalid', e => {
  e.preventDefault();
  fieldError(e.target, validityMsg(e.target));
  if (!focusedError) { focusedError = true; e.target.focus(); setTimeout(() => { focusedError = false; }); }
}, true);
document.addEventListener('input', e => {
  const el = e.target;
  if (!el.matches?.('input, textarea')) return;
  // Only spaces counts as empty.
  if (el.required && el.type !== 'password') el.setCustomValidity(el.value && !el.value.trim() ? 'empty' : '');
  clearFieldError(el);
}, true);

// Returns the form's FormData when confirmed, or null. Settles on submit, not close.
// cancel: false for a notice with just the OK button.
// fill: the OK button is always filled (Reset Password on the sign-in page, which has no unsaved-form cue).
function ask({ title, body = '', ok = 'OK', warn = false, cancel = true, fill = false }) {
  const d = $('#dlg');
  d.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2>${body}
    <div class="row end">${cancel ? '<button value="cancel" formnovalidate class="ghost">Cancel</button>' : ''}
    <button value="ok" class="${fill ? 'fill' : 'primary'}${warn ? ' danger' : ''}">${esc(ok)}</button></div></form>`;
  return new Promise(resolve => {
    const f = d.querySelector('form');
    f.addEventListener('submit', e => resolve(e.submitter?.value === 'ok' ? new FormData(f) : null), { once: true });
    d.addEventListener('cancel', () => resolve(null), { once: true });
    d.showModal();
  });
}

// The full trail from Home, with a Back button to the page one level up (the last crumb with a link).
// Both change the hash, so unsaved edits still get the leave check in onHashChange.
function crumbs(items) {
  const up = items.filter(([, href]) => href).at(-1)?.[1];
  return `<div class="crumb-bar">${up ? `<a class="back" href="${up}">‹ Back</a>` : ''}
    <nav class="crumbs" aria-label="Breadcrumb">${items.map(([label, href]) =>
    href ? `<a href="${href}">${esc(label)}</a>` : `<span>${esc(label)}</span>`).join('<span>/</span>')}</nav></div>`;
}

// Student invites wait until the coach has saved a plan and added a goal (student_ready() in schema.sql).
// need is what's missing, as a sentence of HTML; empty means the invite can go.
function gateInvite(need) {
  const btn = $('#inviteBtn'), hint = $('#inviteNeed');
  if (!btn) return;
  btn.disabled = !!need;
  btn.toggleAttribute('data-blocked', !!need);
  hint.hidden = !need;
  hint.innerHTML = need || '';
}

// The Account card's opening (heading and, before the invite has gone, the warn color and box). The caller closes it.
// It starts folded once they have signed in; until then it holds the invite.
// sum: the short line beside the heading, e.g. "Signed in Sep 28", shown while the card is folded.
function accountCardStart(signedIn, invitedAt, name, p, sum = '') {
  const warn = !signedIn && !invitedAt;
  return `<section class="card${warn ? ' overdue' : ''}"${signedIn ? ' data-fold-start' : ''}>
    <div class="row between"><h2>Account</h2>${warn ? '<span class="tag warn">Not Invited</span>' : `<span class="fold-sum">${esc(sum)}</span>`}</div>
    ${warn ? `<p class="warn-box" role="status"><strong>${esc(name)} hasn't been invited yet.</strong>
      ${p.They} can't sign in until you send the invite.</p>` : ''}`;
}

// ---------- Pronouns (staff.pronouns, students.pronouns: e.g. "she/her", or empty) ----------

const PRONOUNS = ['she/her', 'he/him', 'they/them', 'she/they', 'he/they'];
// Words for text about someone, from the first of their pronouns (she/they → she). Anything else,
// or none given, uses they/them. v(plural, singular) picks the verb: `${p.They} ${p.v('see', 'sees')}`.
const PRONOUN_WORDS = {
  she: { they: 'she', them: 'her', their: 'her', plural: false },
  he: { they: 'he', them: 'him', their: 'his', plural: false },
};
function pro(pronouns) {
  const w = PRONOUN_WORDS[(pronouns || '').split('/')[0].trim().toLowerCase()] || { they: 'they', them: 'them', their: 'their', plural: true };
  const cap = s => s[0].toUpperCase() + s.slice(1);
  return { ...w, They: cap(w.they), Their: cap(w.their), v: (plural, singular) => w.plural ? plural : singular };
}
// Shown after a name, smaller and grayed.
const pronounsTag = p => p ? ` <span class="pronouns">${esc(p)}</span>` : '';
// A pick of the common ones, or Other with a box to type them. readPronouns() gets the value back.
function pronounsField(value = '', whose = 'Their') {
  const other = !!value && !PRONOUNS.includes(value);
  return `<label>Pronouns<select name="pronouns" data-pronouns>
      <option value="">Not Set</option>
      ${PRONOUNS.map(p => `<option${p === value ? ' selected' : ''}>${p}</option>`).join('')}
      <option value="other"${other ? ' selected' : ''}>Other</option>
    </select></label>
    <label${other ? '' : ' hidden'}>${whose} Pronouns<input name="pronouns_other" value="${other ? esc(value) : ''}" maxlength="40"
      ${other ? 'required' : ''} data-need="Type the pronouns, or pick one above." placeholder="e.g. ze/hir" autocomplete="off"></label>`;
}
function readPronouns(f) {
  if (f.get('pronouns') !== 'other') return f.get('pronouns') || '';
  const typed = f.get('pronouns_other').trim();
  return PRONOUNS.find(p => p === typed.toLowerCase().replace(/\s/g, '')) || typed;
}
// Other shows the box to type them in (and makes it required).
document.addEventListener('change', e => {
  if (!e.target.matches('[data-pronouns]')) return;
  const box = e.target.form.elements.pronouns_other, other = e.target.value === 'other';
  box.closest('label').hidden = !other;
  box.required = other;
  if (!other) clearFieldError(box);
  else if (e.isTrusted) box.focus();
});

const day = d => new Date(d + 'T00:00');
const fmtDate = d => day(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
// A plan's tag: Current, Past, or Inactive for a plan that isn't current and has no start date.
const planStatus = p => p.active ? 'Current' : p.start_date ? 'Past' : 'Inactive';
const planTag = p => `<span class="tag${p.active ? ' ok' : ''}">${planStatus(p)}</span>`;
// "Started Sep 1, 2026" once the day has come (today included), "Starts on Oct 3, 2026" before.
const fmtStart = d => (day(d) <= new Date() ? 'Started ' : 'Starts on ') + fmtDate(d);
const fmtWhen = t => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function weekRange(start, w) {
  if (!start) return '';
  const a = day(start); a.setDate(a.getDate() + 7 * (w - 1));
  const b = new Date(a); b.setDate(b.getDate() + 6);
  const f = x => x.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${f(a)} – ${f(b)}`;
}

// Sign-in links (only ever sent by the coach: invites and new sign-in links) go through a separate
// client that never stores a session, so sending one can't touch the coach's.
// firstName (from the coach's invite) is saved on a new login, and the Confirm
// signup email shows it as {{ .Data.first_name }}.
// staff: true marks a coach or admin invite, so the emails use their staff wording ({{ if .Data.staff }}).
// Emails sign off with the sender's first name ({{ .Data.sent_by }}). A new login gets it from data; Supabase ignores
// data for a login that already exists, so stamp_sender() writes it there first (from the sender's own staff row).
async function sendLink(email, firstName = '', staff = false) {
  const { error } = await sb.rpc('stamp_sender', { p_email: email });
  if (error) return { error };
  const data = { ...(me.firstName && { sent_by: me.firstName }), ...(firstName && { first_name: firstName }), ...(staff && { staff: true }) };
  return mailer.auth.signInWithOtp({ email, options: { shouldCreateUser: true, data, emailRedirectTo: (CONFIG.siteUrl || BASE) + '?setpw=1' } });
}
