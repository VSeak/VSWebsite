// ---- The same Supabase project as Sit Start (see SETUP.md) ----
const CONFIG = {
  siteName: "Top Out",
  siteSub: "Adult Team",
  supabaseUrl: "https://loxyrqffevvdhwltccxr.supabase.co",
  supabaseKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxveHlycWZmZXZ2ZGh3bHRjY3hyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzNzc5NzAsImV4cCI6MjEwNTk1Mzk3MH0.czgnKpu18kuEghIC3Ixy6jR-AFvBHQVH7rDDqmFF_EI",   // the publishable (or "anon") key. Never the secret key.
  siteUrl: "https://vseak.github.io/vsapps/topout/",   // where emailed sign-in links go, even when sent from localhost. "" = the current address.
};

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const BASE = location.origin + location.pathname;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Notes show **bold** words, new lines and web links (https://… or www.…, opened in a new tab).
const linkify = h => h.replace(/\b(?:https?:\/\/|www\.)(?:[^\s&<]|&amp;)+/gi, m => {
  const url = m.replace(/[.,;:!?)\]*]+$/, ''), rest = m.slice(url.length);
  return `<a href="${/^www\./i.test(url) ? 'https://' : ''}${url}" target="_blank" rel="noopener noreferrer">${url}</a>${rest}`;
});
const para = s => linkify(esc(s).replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')).replace(/\n/g, '<br>');
const must = ({ data, error }) => { if (error) throw error; return data; };
const loading = '<p class="muted">Loading…</p>';

document.title = CONFIG.siteName;
$('.brand-name').textContent = CONFIG.siteName;
$('.brand-sub').textContent = CONFIG.siteSub;
$('.brand').setAttribute('aria-label', `${CONFIG.siteName}, ${CONFIG.siteSub}`);

let sb, mailer;
let me = null;               // {user, staffId, roles, isAdmin, isCoach, firstName, fullName}
let wantsPassword = new URLSearchParams(location.search).has('setpw');
let linkError = null;        // from an expired or used email link
let currentHash = location.hash;
let navToken = 0;            // a page checks it after each await, so a slow page never draws over a newer one

if (location.hash && !location.hash.startsWith('#/')) {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('error_code') === 'otp_expired') linkError = 'That link has expired or was already used. Use Forgot Password below to get a new one.';
  else if (h.get('error_description')) linkError = h.get('error_description');
}

// ---------- Helpers ----------

// A redraw after a save skips the Loading step and keeps the scroll (redrawing, set by redraw()).
let redrawing = false;
function view(html, { keepScroll = false } = {}) {
  if (html === loading && redrawing) return;
  if (redrawing) { keepScroll = true; redrawing = false; }
  app.oninput = app.onchange = app.onclick = app.onsubmit = null;
  app.innerHTML = html;
  markUnsaved();   // Save buttons start greyed out
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
  if (/does not exist|could not find the function|schema cache/i.test(m)) return m + ' (Has topout/supabase/schema.sql been run?)';
  if (/team_member(s|_locations)_location_id_fkey/.test(m)) return 'This location still has team members. Take them off this team or delete them first.';
  if (/team_checkins_circuit_id_fkey/.test(m)) return 'Check-ins use this circuit, so it can’t be deleted. Rename it instead.';
  if (/duplicate key.*name_key/.test(m)) return 'That name is already taken.';
  if (/duplicate key.*team_staff_email/.test(m)) return 'That email is already on the staff list.';
  return m;
}

async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); }
  catch (e) { flash(msgOf(e), 'error'); }
  finally { if (btn) btn.disabled = false; }
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
  // Inside the field's label, so it never becomes its own cell in a two-column row; after a checkbox's label.
  const label = el.closest('label');
  if (label && !label.matches('.check')) label.append(err); else (label || el).after(err);
}
function clearFieldError(el) {
  if (el.getAttribute('aria-invalid') !== 'true') return;
  el.removeAttribute('aria-invalid');
  document.getElementById(el.getAttribute('aria-describedby'))?.remove();
  el.removeAttribute('aria-describedby');
}

// A small red * after the label of every required field (the user asked), and on the legend of a fieldset[data-required]
// (pick at least one). It watches the page, so dialogs, redraws and fields that turn required (Other pronouns) stay right.
function markRequired() {
  const want = new Set();
  for (const el of document.querySelectorAll(':is(input, select, textarea)[required]:not([type="checkbox"], [type="radio"])')) {
    const label = el.closest('label:not(.check)') || document.getElementById(el.getAttribute('aria-labelledby'));
    if (label) want.add(label);
  }
  for (const legend of document.querySelectorAll('fieldset[data-required] > legend')) want.add(legend);
  for (const star of document.querySelectorAll('.req')) if (!want.has(star.parentElement)) star.remove();
  for (const label of want) {
    if (label.querySelector(':scope > .req')) continue;
    const star = Object.assign(document.createElement('span'), { className: 'req', textContent: '*' });
    star.setAttribute('aria-hidden', 'true');   // the field's own required is what screen readers hear
    const text = [...label.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
    if (!text) { label.append(star); continue; }
    const end = text.textContent.trimEnd().length;
    if (end < text.textContent.length) text.splitText(end);
    text.after(star);
  }
}
new MutationObserver(markRequired).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['required'] });
function validityMsg(el) {
  const v = el.validity;
  if (v.valueMissing || v.customError) return el.dataset.need || 'Fill this in.';
  if (v.typeMismatch && el.type === 'email') return 'Enter a full email address, like name@example.com.';
  if (v.rangeUnderflow || v.rangeOverflow) return el.dataset.range || el.validationMessage;
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
  if (!el.matches?.('input, textarea, select')) return;
  if (el.required && el.type !== 'password' && el.tagName !== 'SELECT') el.setCustomValidity(el.value && !el.value.trim() ? 'empty' : '');   // only spaces counts as empty
  clearFieldError(el);
}, true);

// One <dialog>. Returns the form's FormData when confirmed, or null. Settles on submit, not close.
// cancel: false for a notice with just OK. wide: a bigger dialog (the check-in form).
// extra: another button beside OK, e.g. Delete; its value comes back as FormData's 'button'.
// onOpen(form) runs once the dialog is showing (to wire up its fields).
function ask({ title, body = '', ok = 'OK', warn = false, cancel = true, wide = false, extra = null, onOpen = null, okClass = '', cancelLabel = 'Cancel' }) {
  const d = $('#dlg');
  d.className = wide ? 'wide' : '';
  d.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2>${body}
    <div class="row end">${extra ? `<button value="${extra.value}" formnovalidate class="ghost danger push-left">${esc(extra.label)}</button>` : ''}
    ${cancel ? `<button value="cancel" formnovalidate class="ghost">${esc(cancelLabel)}</button>` : ''}
    <button value="ok" class="${okClass || (warn ? 'risky' : 'fill')}">${esc(ok)}</button></div></form>`;
  return new Promise(resolve => {
    const f = d.querySelector('form');
    // Enter in a field means OK. (The browser would press the first button in the form, which is Cancel.)
    f.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.isComposing || !e.target.matches('input:not([type="button"], [type="submit"])')) return;
      e.preventDefault();
      f.requestSubmit(f.querySelector('button[value="ok"]'));
    });
    f.addEventListener('submit', e => {
      const v = e.submitter?.value;
      if (v === 'ok') resolve(new FormData(f));
      else if (extra && v === extra.value) { const fd = new FormData(); fd.set('button', v); resolve(fd); }
      else resolve(null);
    }, { once: true });
    d.addEventListener('cancel', () => resolve(null), { once: true });
    // Closed another way (a link in it); after OK this does nothing. The close event comes late, so one from the dialog
    // before (when a pop-up opens another, like the calendar's Practice Plan) arrives once this one is up: skip it.
    const onClose = () => { if (d.open && f.isConnected) return; d.removeEventListener('close', onClose); resolve(null); };
    d.addEventListener('close', onClose);
    d.showModal();
    onOpen?.(f);
  });
}
const confirmDelete = (title, body) => ask({ title, body: `<p>${body}</p>`, ok: 'Delete', warn: true });

// The full trail from Home, with a Back button to the page one level up.
function crumbs(items) {
  const up = items.filter(([, href]) => href).at(-1)?.[1];
  return `<div class="crumb-bar">${up ? `<a class="back" href="${up}">‹ Back</a>` : ''}
    <nav class="crumbs" aria-label="Breadcrumb">${items.map(([label, href]) =>
    href ? `<a href="${href}">${esc(label)}</a>` : `<span>${esc(label)}</span>`).join('<span>/</span>')}</nav></div>`;
}

const initials = name => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

// ---------- Pronouns (e.g. "she/her", or empty) ----------

const PRONOUNS = ['she/her', 'he/him', 'they/them', 'she/they', 'he/they'];
const pronounsTag = p => p ? ` <span class="pronouns">${esc(p)}</span>` : '';
// required: Not Set can't be saved (team members).
function pronounsField(value = '', required = false) {
  const other = !!value && !PRONOUNS.includes(value);
  return `<label>Pronouns<select name="pronouns" data-pronouns${required ? ' required data-need="Pick their pronouns."' : ''}>
      <option value="">${required ? 'Pick…' : 'Not Set'}</option>
      ${PRONOUNS.map(p => `<option${p === value ? ' selected' : ''}>${p}</option>`).join('')}
      <option value="other"${other ? ' selected' : ''}>Other</option>
    </select></label>
    <label${other ? '' : ' hidden'}>Their Pronouns<input name="pronouns_other" value="${other ? esc(value) : ''}" maxlength="40"
      ${other ? 'required' : ''} data-need="Type the pronouns, or pick one above." placeholder="E.g. ze/hir" autocomplete="off"></label>`;
}
// Sets the field to a value (e.g. filled in from the other app), Other with the box when it isn't a listed one.
function setPronouns(form, value) {
  const sel = form.elements.pronouns, other = !!value && !PRONOUNS.includes(value);
  sel.value = other ? 'other' : value;
  if (other) form.elements.pronouns_other.value = value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}
// Pronouns for a sentence about someone: { obj: 'her', self: 'herself' }. The first set of a pair (she/they) is used;
// a typed one like ze/hir gives hir / hirself; none gives they.
function pronounWords(p) {
  const [a, b] = (p || '').toLowerCase().split('/').map(s => s.trim());
  if (a === 'she') return { obj: 'her', self: 'herself' };
  if (a === 'he') return { obj: 'him', self: 'himself' };
  if (!a || a === 'they' || !b) return { obj: 'them', self: 'themselves' };
  return { obj: esc(b), self: esc(b) + 'self' };
}
function readPronouns(f) {
  if (f.get('pronouns') !== 'other') return f.get('pronouns') || '';
  const typed = f.get('pronouns_other').trim();
  return PRONOUNS.find(p => p === typed.toLowerCase().replace(/\s/g, '')) || typed;
}
document.addEventListener('change', e => {
  if (!e.target.matches('[data-pronouns]')) return;
  const box = e.target.form.elements.pronouns_other, other = e.target.value === 'other';
  box.closest('label').hidden = !other;
  box.required = other;
  if (!other) clearFieldError(box);
  else if (e.isTrusted) box.focus();
});

// ---------- Dates ----------

const day = d => new Date(d + 'T00:00');
const iso = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
const today = () => iso(new Date());
const fmtDate = d => day(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const fmtShort = d => day(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const fmtDay = d => day(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const fmtMonthYear = d => day(d).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const fmtTime = t => t ? new Date('2000-01-01T' + t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
const fmtWhen = t => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
// The date block on an event row: WED over 1.
const dayBlock = d => `<span class="day-block"><small>${day(d).toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()}</small><strong>${day(d).getDate()}</strong></span>`;

// ---------- Grades ----------

const V_GRADES = Array.from({ length: 18 }, (_, i) => i);   // V0 … V17, stored as numbers
const vText = v => v == null ? '' : 'V' + v;
const ROUTE_GRADES = ['5.5', '5.6', '5.7', '5.8', '5.9', ...[10, 11, 12, 13, 14, 15].flatMap(n => ['a', 'b', 'c', 'd'].map(l => `5.${n}${l}`))];
// "V0", "V0–V2", "V11+" for a circuit's range.
const circuitRange = c => c.v_min == null ? '' : c.v_max == null ? `V${c.v_min}+` : c.v_min === c.v_max ? `V${c.v_min}` : `V${c.v_min}–V${c.v_max}`;
// A color dot and the circuit's name. The dot has an edge so white and pale colors still show.
const swatch = color => `<span class="swatch" style="--sw:${esc(color)}"></span>`;
const circuitChip = c => c ? `<span class="chip">${swatch(c.color)}${esc(c.name)}</span>` : '';

// ---------- Sign-in links ----------

// Links go through a second client that never stores a session, so sending one can't touch the sender's.
// The emails are shared with Sit Start: topout: true switches them to Top Out wording. Supabase ignores data for a
// login that already exists (e.g. a Sit Start coach), so team_stamp_sender() writes it there first.
async function sendLink(email, firstName = '') {
  const { error } = await sb.rpc('team_stamp_sender', { p_email: email });
  if (error) return { error };
  const data = { topout: true, staff: true, ...(me.firstName && { sent_by: me.firstName }), ...(firstName && { first_name: firstName }) };
  return mailer.auth.signInWithOtp({ email, options: { shouldCreateUser: true, data, emailRedirectTo: (CONFIG.siteUrl || BASE) + '?setpw=1' } });
}

// ---------- Drag to reorder ----------
// A row with data-kind and data-id starts with GRIP; its siblings of the same kind are the list. Pointer events rather
// than HTML drag and drop, so a finger works as well as a mouse; with the grip focused, the up and down arrow keys
// move the row one place. moved(kind, ids in the new order) runs after a change. Used by Settings and the practice editor.
const GRIP = `<button type="button" class="grip" data-grip title="Drag to reorder" aria-label="Move: drag, or use the up and down arrow keys">
  <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><g fill="currentColor"><circle cx="2" cy="2" r="1.6"/><circle cx="8" cy="2" r="1.6"/>
  <circle cx="2" cy="8" r="1.6"/><circle cx="8" cy="8" r="1.6"/><circle cx="2" cy="14" r="1.6"/><circle cx="8" cy="14" r="1.6"/></g></svg></button>`;
let gripFocus = null;   // a row id whose grip gets focus back after a redraw (set by a page that redraws in moved)
function wireGrips(moved, root = app) {
  const rowsOf = row => [...row.parentElement.querySelectorAll(`:scope > [data-kind="${row.dataset.kind}"][data-id]`)];
  const done = (row, before) => {
    const after = rowsOf(row).map(r => r.dataset.id);
    if (after.join() !== before.join()) moved(row.dataset.kind, after);
  };
  for (const grip of root.querySelectorAll('[data-grip]')) {
    const row = grip.closest('[data-kind][data-id]');
    grip.onpointerdown = e => {
      if (e.button) return;
      e.preventDefault();
      const before = rowsOf(row).map(r => r.dataset.id), stop = new AbortController(), on = { signal: stop.signal };
      row.classList.add('dragging');
      // Listened for on the window: moving the row in the page drops any pointer capture on the grip.
      addEventListener('pointermove', ev => {
        // Put the row before the first other row whose middle is below the pointer, else last.
        const others = rowsOf(row).filter(r => r !== row);
        const next = others.find(r => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
        if (next && row.nextElementSibling !== next) next.before(row);
        if (!next && others.length) others.at(-1).after(row);
        if (ev.clientY < 60) scrollBy(0, -12); else if (ev.clientY > innerHeight - 60) scrollBy(0, 12);
      }, on);
      const end = () => { stop.abort(); row.classList.remove('dragging'); done(row, before); };
      addEventListener('pointerup', end, on);
      addEventListener('pointercancel', end, on);
    };
    grip.onkeydown = e => {
      const dir = { ArrowUp: -1, ArrowDown: 1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      const rows = rowsOf(row), before = rows.map(r => r.dataset.id), other = rows[rows.indexOf(row) + dir];
      if (!other) return;
      // Move the neighbour, not this row, so the grip keeps focus.
      if (dir < 0) row.after(other); else row.before(other);
      done(row, before);
    };
  }
  if (gripFocus) root.querySelector(`[data-id="${gripFocus}"] [data-grip]`)?.focus();
  gripFocus = null;
}
