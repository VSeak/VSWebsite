// ---------- Training Log (exercise_logs): students log an exercise from their current plan, one summary line a day ----------
// Logs are keyed by the exercise's name (exKey), so an exercise's history follows it from plan to plan. Only the
// student adds or changes their logs; coaches read them on the student page and in the plan editor.

// What an exercise asks for when it's logged: exercises.track (the default), copied into a plan's exercise as "track",
// which the coach can change per plan. Notes are always there. Steppers come first in the sheet, then the picks.
const LOG_FIELDS = {
  weight: { label: 'Added Weight', kind: 'weight' },
  time: { label: 'Time', kind: 'step', step: 1, min: 0, max: 3600, start: 10, sub: 'seconds' },
  sets: { label: 'Sets Done', kind: 'step', step: 1, min: 0, max: 99, start: 1 },
  reps: { label: 'Reps', kind: 'step', step: 1, min: 0, max: 999, start: 1 },
  grade: { label: 'Grade', kind: 'grade' },
  attempts: { label: 'Attempts', kind: 'step', step: 1, min: 0, max: 99, start: 1 },
  edge: { label: 'Edge', kind: 'pick', opts: [10, 15, 18, 20, 25], other: true },
  grip: { label: 'Grip', kind: 'pick', opts: ['Half Crimp', 'Open Hand', 'Full Crimp', '3 Finger Drag'] },
  sent: { label: 'Sent', kind: 'pick', opts: ['Sent', 'Not Yet'] },
};
const LOG_BUILT_IN = Object.keys(LOG_FIELDS);
// Built-in steppers, custom numbers, built-in picks, then custom picks: the order of the sheet and the coach's ticks.
const LOG_KEYS = [...LOG_BUILT_IN];
// Coaches' own fields (log_fields rows, loaded at sign-in by loadMe and changed in the Log Fields card): a number
// with an optional unit, or a pick. Values are kept under the row's key, so renaming keeps the history.
let logFieldRows = [];
function setLogFields(rows) {
  logFieldRows = rows.sort((a, b) => a.label_key.localeCompare(b.label_key));
  for (const k of Object.keys(LOG_FIELDS)) if (LOG_FIELDS[k].custom) delete LOG_FIELDS[k];
  for (const r of rows) LOG_FIELDS[r.key] = r.kind === 'pick' ? { label: r.label, kind: 'pick', opts: r.opts, custom: true }
    : { label: r.label, kind: 'step', step: 1, min: 0, max: 99999, start: 1, sub: r.unit, unit: r.unit, dec: true, custom: true };
  const all = Object.keys(LOG_FIELDS), pick = k => LOG_FIELDS[k].kind === 'pick';
  LOG_KEYS.splice(0, LOG_KEYS.length, ...all.filter(k => !pick(k) && !LOG_FIELDS[k].custom), ...all.filter(k => !pick(k) && LOG_FIELDS[k].custom),
    ...all.filter(k => pick(k) && !LOG_FIELDS[k].custom), ...all.filter(k => pick(k) && LOG_FIELDS[k].custom));
}
// A custom number on its own: "12 moves", or "Holds 12" with no unit.
const customNum = (F, n) => F.unit ? `${n} ${F.unit}` : `${F.label} ${n}`;
// Quick picks for the coach (Exercises & Drills, and per plan).
const LOG_PRESETS = [['Hangs', ['weight', 'edge', 'time', 'grip', 'sets']], ['Strength', ['sets', 'reps', 'weight']],
  ['Timed', ['time', 'sets']], ['Climbing', ['grade', 'attempts', 'sent']]];
const GRADES = ['VB', ...Array.from({ length: 18 }, (_, i) => 'V' + i)];
const LOG_PAGE = 3;   // logs (or days, or exercises) per page
const trackOf = x => LOG_KEYS.filter(k => (x?.track ?? []).includes(k));
const trackNames = list => list.length ? list.map(k => LOG_FIELDS[k].label).join(' · ') : 'Notes only';

// Weight: lb unless the student picked kg (kept on this device). Steps are 5 lb or 2.5 kg.
const KG = 2.20462;
function logUnit() { try { return localStorage.getItem('sitstart.unit') === 'kg' ? 'kg' : 'lb'; } catch { return 'lb'; } }
function setLogUnit(u) { try { localStorage.setItem('sitstart.unit', u); } catch {} }
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.').replace('−', '-')); return Number.isFinite(n) ? n : null; };
const round = (n, step) => Math.round(n / step) * step;
const signed = n => n > 0 ? `+${+n.toFixed(2)}` : n < 0 ? `−${+Math.abs(n).toFixed(2)}` : '0';
const fmtWeight = (w, unit) => w === 0 ? 'Bodyweight' : `${signed(w)} ${unit || 'lb'}`;
const inLb = v => v.weight == null ? null : v.unit === 'kg' ? v.weight * KG : v.weight;

// One log's values on a line: "4 × 5 · +25 lb", "+40 lb · 20 mm · 10s · Half Crimp", "V5 · 4 tries · Sent".
function logSummary(v = {}) {
  const has = k => v[k] != null && v[k] !== '';
  const both = has('sets') && has('reps');
  return [both && `${v.sets} × ${v.reps}`, has('weight') && fmtWeight(v.weight, v.unit), has('edge') && `${v.edge} mm`,
    has('time') && `${v.time}s`, has('grade') && v.grade, has('attempts') && `${v.attempts} ${v.attempts === 1 ? 'try' : 'tries'}`,
    has('grip') && v.grip, has('sent') && (v.sent ? 'Sent' : 'Not Yet'),
    !both && has('sets') && `${v.sets} set${v.sets === 1 ? '' : 's'}`, !both && has('reps') && `${v.reps} reps`,
    ...LOG_KEYS.filter(k => LOG_FIELDS[k].custom && has(k)).map(k => LOG_FIELDS[k].kind === 'pick' ? String(v[k]) : customNum(LOG_FIELDS[k], v[k]))]
    .filter(Boolean).join(' · ');
}
// A log with no values (a notes-only exercise) shows its note, first line, instead.
const noteLine = s => { const t = String(s ?? '').replace(/\*\*/g, '').split('\n').find(l => l.trim())?.trim() ?? ''; return t.length > 80 ? t.slice(0, 79) + '…' : t; };
const logLine = l => logSummary(l.vals) || noteLine(l.notes) || 'Logged';

// Dates: logged_on is the student's local day.
function todayISO() { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); }
function logDay(d, long = false) {
  const t = todayISO(), y = new Date(day(t) - 864e5), yd = new Date(y - y.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const full = () => day(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (d === t) return long ? `Today · ${full()}` : 'Today';
  if (d === yd) return long ? `Yesterday · ${full()}` : 'Yesterday';
  return day(d).toLocaleDateString(undefined, { ...(long && { weekday: 'short' }), month: 'short', day: 'numeric',
    ...(d.slice(0, 4) !== t.slice(0, 4) && { year: 'numeric' }) });
}

// logs: newest first. The ones for an exercise, and the latest one per exercise.
const logsOf = (logs, key) => logs.filter(l => l.exercise_key === key);
function latestPerExercise(logs) {
  const seen = new Map();
  for (const l of logs) if (!seen.has(l.exercise_key)) seen.set(l.exercise_key, l);
  return [...seen.values()];
}
const sortLogs = logs => logs.sort((a, b) => b.logged_on.localeCompare(a.logged_on) || b.created_at.localeCompare(a.created_at));

// The trend: the first number the logs have, of weight (in the latest log's unit), grade, time, reps or sets.
// list: newest first. Returns { key, label, val(l), show(n) } or null.
function logMetric(list) {
  const unit = list.find(l => l.vals.weight != null)?.vals.unit || 'lb';
  const M = {
    weight: { label: 'Added weight', val: l => { const w = inLb(l.vals); return w == null ? null : unit === 'kg' ? w / KG : w; },
      show: n => fmtWeight(+n.toFixed(1), unit) },
    grade: { label: 'Grade', val: l => { const i = GRADES.indexOf(l.vals.grade); return i < 0 ? null : i; }, show: n => GRADES[Math.round(n)] },
    time: { label: 'Time', val: l => l.vals.time ?? null, show: n => `${n}s` },
    reps: { label: 'Reps', val: l => l.vals.reps ?? null, show: n => `${n} reps` },
    sets: { label: 'Sets', val: l => l.vals.sets ?? null, show: n => `${n} sets` },
  };
  for (const k of LOG_KEYS) if (LOG_FIELDS[k].custom && LOG_FIELDS[k].kind === 'step')
    M[k] = { label: LOG_FIELDS[k].label, val: l => typeof l.vals[k] === 'number' ? l.vals[k] : null, show: n => customNum(LOG_FIELDS[k], n) };
  for (const key of Object.keys(M)) if (list.some(l => M[key].val(l) != null)) return { key, ...M[key] };
  return null;
}
// The best log by the metric (the newest one on a tie), or null.
function bestLog(list, m = logMetric(list)) {
  let best = null;
  for (const l of list) { const v = m?.val(l); if (v != null && (best == null || v > m.val(best))) best = l; }
  return best;
}
// The logs on the newest log's edge (all of them when it has none): weights on different edges don't compare.
const sameEdge = list => list[0]?.vals.edge == null ? list : list.filter(l => l.vals.edge === list[0].vals.edge);
// A New Best: the newest log beats every earlier one (on the same edge).
function isNewBest(list) {
  list = sameEdge(list);
  const m = logMetric(list), v = m && m.val(list[0]);
  return list.length > 1 && v != null && list.slice(1).every(l => m.val(l) == null || v > m.val(l)) && list.slice(1).some(l => m.val(l) != null);
}

// A line of the metric over time, oldest on the left. w×h in the viewBox; it stretches to fit.
function sparkSVG(list, m, { w = 320, h = 70, cls = 'spark', label = '' } = {}) {
  const pts = list.map(l => m.val(l)).filter(v => v != null).slice(0, 20).reverse();
  if (pts.length < 2) return '';
  const lo = Math.min(...pts), hi = Math.max(...pts), pad = 5;
  const xy = pts.map((v, i) => `${(pad + i * (w - 2 * pad) / (pts.length - 1)).toFixed(1)},${(hi === lo ? h / 2 : h - pad - (v - lo) * (h - 2 * pad) / (hi - lo)).toFixed(1)}`);
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">
    <polyline points="${xy.join(' ')}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}
// "Up 30 lb since Aug 27" (or Down, or Same as).
function trendText(list, m) {
  const pts = list.filter(l => m.val(l) != null), a = pts.at(-1), b = pts[0];
  if (!a || a === b) return '';
  const d = m.val(b) - m.val(a), since = `since ${logDay(a.logged_on)}`;
  if (!d) return `Same as ${logDay(a.logged_on)}`;
  const amt = m.key === 'weight' ? `${+Math.abs(d).toFixed(1)} ${list.find(l => l.vals.unit)?.vals.unit || 'lb'}`
    : m.key === 'grade' ? `${Math.abs(d)} grade${Math.abs(d) === 1 ? '' : 's'}` : m.key === 'time' ? `${Math.abs(d)}s`
    : LOG_FIELDS[m.key]?.custom ? `${+Math.abs(d).toFixed(2)}${LOG_FIELDS[m.key].unit ? ` ${LOG_FIELDS[m.key].unit}` : ''}` : `${Math.abs(d)} ${m.key}`;
  return `${d > 0 ? 'Up' : 'Down'} ${amt} ${since}`;
}

// ---------- On the student's plan: each exercise card's log area ----------
// log: { logs, canLog }, set when a student views their own current plan (studentPlan); null elsewhere (the coach's
// Student View, past plans). The areas redraw in place after a save (redrawLogs).
let logCtx = null;
function logAreaHTML(x, sid) {
  const key = exKey(x.name);
  if (!key) return '';
  return `<div class="log-area" data-log-area="${esc(key)}" data-sid="${sid}">${logAreaInner(key, sid)}</div>`;
}
function logAreaInner(key, sid) {
  const list = logsOf(logCtx.logs, key), last = list[0], today = last?.logged_on === todayISO() ? last : null;
  return `${today ? `<div class="log-done"><div><span class="log-t">Logged Today</span><span class="log-s">${esc(logLine(today))}</span></div>
      <button type="button" class="small" data-log="${esc(key)}" data-sid="${sid}">Edit</button></div>`
    : `<p class="log-last">${last ? `Last time, ${logDay(last.logged_on)}: ${esc(logLine(last))}` : 'Not logged yet'}</p>`}
    <div class="log-btns">${today ? '' : `<button type="button" class="fill" data-log="${esc(key)}" data-sid="${sid}">Log</button>`}${
      list.length ? `<button type="button" data-log-hist="${esc(key)}">History (${list.length})</button>` : ''}</div>`;
}
function redrawLogs() {
  app.querySelectorAll('[data-log-area]').forEach(a => { a.innerHTML = logAreaInner(a.dataset.logArea, a.dataset.sid); });
  const card = $('#logCard');
  if (card) { card.outerHTML = myLogCardHTML(); bindMyLogCard(); }
}
// The session holding the plan's exercise named key (session sid if it has it, else the first that does), and that exercise.
function planExercise(sessions, key, sid) {
  const find = s => (s.exercises ?? []).find(x => exKey(x.name) === key);
  const s = sessions.find(s => s.id === sid && find(s)) ?? sessions.find(find);
  return s ? [s, find(s)] : [];
}

app.addEventListener('click', e => {
  const b = e.target.closest('[data-log], [data-log-hist]');
  if (!b || !logCtx) return;
  if (b.dataset.log != null) openLogSheet(b.dataset.log, b.dataset.sid);
  else openLogHistory(b.dataset.logHist, { logs: logCtx.logs, mine: true });
});

// ---------- The Log sheet (design B): steppers for numbers, chips for picks, notes, Save Log ----------
const logSheet = Object.assign(document.createElement('dialog'), { id: 'logSheet', className: 'exb-sheet log-sheet' });
logSheet.setAttribute('aria-labelledby', 'logSheetTitle');
document.body.append(logSheet);
let ls = null;   // { key, sid, x, fields, vals, notes, editing, last }

// date: the day being logged (today, or an earlier day picked in the Day field). Starts at that day's log (editing
// it), else the values of the last log before it, else what the plan says (sets, reps, a time like "10s").
function openLogSheet(key, sid, date = todayISO()) {
  const [s, x] = planExercise(logCtx.sessions, key, sid);
  if (!x || !logCtx.canLog) return;
  sid = s.id;
  const all = logsOf(logCtx.logs, key), list = all.filter(l => l.logged_on <= date);
  const today = list[0]?.logged_on === date ? list[0] : null, last = today ? list[1] : list[0];
  const isToday = date === todayISO(), onDay = isToday ? 'today' : `on ${logDay(date)}`;
  const fields = trackOf(x), from = today ?? last, unit = logUnit();
  const vals = {};
  for (const k of fields) if (from?.vals[k] != null) vals[k] = from.vals[k];
  if (vals.weight != null && (from.vals.unit || 'lb') !== unit) vals.weight = round(unit === 'kg' ? vals.weight / KG : vals.weight * KG, unit === 'kg' ? 2.5 : 5);
  if (!from) {
    const int = s => /^\s*\d+\s*$/.test(s ?? '') ? parseInt(s, 10) : null, secs = /^\s*(\d+)\s*(s|sec|secs|seconds)\b/i.exec(x.reps ?? '');
    if (fields.includes('sets') && int(x.sets) != null) vals.sets = int(x.sets);
    if (fields.includes('reps') && int(x.reps) != null) vals.reps = int(x.reps);
    if (fields.includes('time') && secs) vals.time = +secs[1];
  }
  ls = { key, sid, x, fields, vals, unit, date, notes: today?.notes ?? '', editing: today, last, before: list.filter(l => l !== today) };
  logSheet.innerHTML = `<div class="exb-head"><div><h2 id="logSheetTitle">Log ${esc(x.name.trim())}</h2>
      <p class="hint">${today ? `Logged ${onDay}. Change what you need.` : last ? `Starts at last time's numbers (${logDay(last.logged_on)}). Tap what changed.` : 'Not logged yet.'}</p></div>
    <button type="button" class="exb-close" data-close aria-label="Close">${EXB_ICON.close}</button></div>
    <div class="log-body"><div class="log-step log-date"><div class="log-lab"><b id="lf-date">Day</b><span class="hint">${isToday ? 'Today. Pick an earlier day for a past session.' : logDay(date, true)}</span></div>
        <input type="date" data-date aria-labelledby="lf-date" value="${date}" max="${todayISO()}" required></div>
      ${fields.map(logFieldHTML).join('')}
      <label class="log-notes">Notes<textarea data-lf="notes" rows="2" data-grow maxlength="2000" placeholder="How did it feel?">${esc(ls.notes)}</textarea></label>
      ${today ? '<button type="button" class="small ghost danger log-del" data-del>Delete Log</button>' : ''}</div>
    <div class="exb-foot"><span class="log-diff" aria-live="polite"></span><button type="button" class="exb-add" data-save>Save Log</button></div>`;
  logDiff();
  if (!logSheet.open) { logSheet.showModal(); logSheet.querySelector('.log-body').scrollTop = 0; }
}
// Picking another day redraws the sheet for it (its log, if it has one). Never a day after today.
logSheet.addEventListener('change', e => {
  if (!('date' in e.target.dataset)) return;
  const d = e.target.value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > todayISO()) { e.target.value = ls.date; return; }
  if (d === ls.date) return;
  openLogSheet(ls.key, ls.sid, d);
  logSheet.querySelector('[data-date]').focus();
});

function logFieldHTML(k) {
  const F = LOG_FIELDS[k], id = 'lf-' + k;
  if (F.kind === 'pick') {
    const v = ls.vals[k], opts = F.opts, isOther = k === 'edge' && v != null && !opts.includes(v);
    const val = o => k === 'sent' ? o === 'Sent' : o, on = o => k === 'sent' ? v === (o === 'Sent') : v === o;
    return `<fieldset class="log-pick" data-pick="${k}" data-field="${k}"><legend>${esc(F.label)}</legend><div class="log-chips">${opts.map(o =>
      `<button type="button" data-chip="${esc(JSON.stringify(val(o)))}" aria-pressed="${on(o)}">${esc(k === 'edge' ? `${o} mm` : o)}</button>`).join('')}${
      F.other ? `<button type="button" data-chip="other" aria-pressed="${isOther || ls.otherEdge === true}">Other</button>` : ''}</div>${
      F.other && (isOther || ls.otherEdge) ? `<label class="log-other">Edge in mm<input data-lf="edge" inputmode="decimal" value="${isOther ? v : ''}" autocomplete="off"></label>` : ''}</fieldset>`;
  }
  const sub = k === 'weight' ? `${ls.unit} · <button type="button" class="link" data-unit>Switch to ${ls.unit === 'lb' ? 'kg' : 'lb'}</button>`
    : k === 'sets' && /^\s*\d+\s*$/.test(ls.x.sets ?? '') ? `Plan says ${ls.x.sets.trim()}` : esc(F.sub ?? '');
  const v = ls.vals[k];
  return `<div class="log-step" data-field="${k}"><div class="log-lab"><b id="${id}">${esc(F.label)}</b>${sub ? `<span class="hint">${sub}</span>` : ''}</div>
    <div class="log-sp"><button type="button" data-step="-1" data-f="${k}" aria-label="Less ${esc(F.label.toLowerCase())}">−</button>
      <input data-lf="${k}" aria-labelledby="${id}" ${F.kind === 'grade' ? 'readonly' : `inputmode="${k === 'weight' || F.dec ? 'decimal' : 'numeric'}"`}
        value="${v == null ? '' : k === 'weight' ? signed(v) : esc(v)}" placeholder="—" autocomplete="off">
      <button type="button" data-step="1" data-f="${k}" aria-label="More ${esc(F.label.toLowerCase())}">+</button></div></div>`;
}

// Steppers: weight by 5 lb (2.5 kg) and can go below zero (an assisted hang); grade along GRADES.
function stepLog(k, dir) {
  const F = LOG_FIELDS[k], v = ls.vals[k];
  if (F.kind === 'grade') {
    const i = GRADES.indexOf(v);
    ls.vals[k] = GRADES[i < 0 ? 1 : Math.min(GRADES.length - 1, Math.max(0, i + dir))];
  } else if (F.kind === 'weight') {
    const st = ls.unit === 'kg' ? 2.5 : 5;
    ls.vals[k] = v == null ? (dir > 0 ? st : 0) : Math.max(-500, Math.min(1000, round(v, st) + dir * st));
  } else ls.vals[k] = v == null ? F.start : Math.max(F.min, Math.min(F.max, v + dir * F.step));
  const input = logSheet.querySelector(`input[data-lf="${k}"]`);
  input.value = k === 'weight' ? signed(ls.vals[k]) : ls.vals[k];
  logDiff();
}
// "+5 lb on last time" for weight (or time) while there's a last time to compare with: the last log on the same
// edge when an edge is picked (weights on different edges don't compare).
function logDiff() {
  const el = logSheet.querySelector('.log-diff'), e = ls.vals.edge;
  const last = (e != null ? ls.before.find(l => l.vals.edge === e) : ls.before[0])?.vals;
  let t = '';
  if (last && ls.vals.weight != null && last.weight != null) {
    const prev = (last.unit || 'lb') === ls.unit ? last.weight : ls.unit === 'kg' ? last.weight / KG : last.weight * KG, d = +(ls.vals.weight - prev).toFixed(1);
    t = d ? `${signed(d)} ${ls.unit} on last time` : 'Same weight as last time';
  } else if (last && ls.vals.time != null && last.time != null) {
    const d = ls.vals.time - last.time;
    t = d ? `${signed(d)}s on last time` : 'Same time as last time';
  }
  el.textContent = t;
}

logSheet.addEventListener('input', e => {
  const k = e.target.dataset.lf;
  if (!k) return;
  if (k === 'notes') ls.notes = e.target.value;
  else {
    const n = num(e.target.value);
    ls.vals[k] = n == null ? null : k === 'weight' ? n : Math.max(0, k === 'edge' || LOG_FIELDS[k]?.dec ? n : Math.round(n));
    logDiff();
  }
});
logSheet.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset;
  if ('close' in d) return logSheet.close();
  if (d.step) return stepLog(d.f, +d.step);
  if ('unit' in d) {
    const to = ls.unit === 'lb' ? 'kg' : 'lb';
    if (ls.vals.weight != null) ls.vals.weight = round(to === 'kg' ? ls.vals.weight / KG : ls.vals.weight * KG, to === 'kg' ? 2.5 : 5);
    ls.unit = to; setLogUnit(to);
    redrawField('weight');
    logSheet.querySelector('[data-unit]')?.focus();
    return logDiff();
  }
  if (d.chip) {
    const k = b.closest('[data-pick]').dataset.pick;
    if (d.chip === 'other') { ls.otherEdge = !(ls.otherEdge || (ls.vals.edge != null && !LOG_FIELDS.edge.opts.includes(ls.vals.edge)));
      if (!ls.otherEdge) ls.vals.edge = null; }
    else { const v = JSON.parse(d.chip); ls.vals[k] = ls.vals[k] === v ? null : v; if (k === 'edge') ls.otherEdge = false; }
    redrawField(k);
    logDiff();
    const again = logSheet.querySelector(`[data-pick="${k}"] [data-chip="${CSS.escape(d.chip)}"]`);
    if (k === 'edge' && ls.otherEdge) logSheet.querySelector('.log-other input')?.focus(); else again?.focus();
    return;
  }
  if ('del' in d) {
    const whose = ls.date === todayISO() ? "Today's log" : `The log from ${logDay(ls.date)}`;
    if (!await ask({ title: 'Delete This Log?', warn: true, ok: 'Delete', body: `<p>${whose} for ${esc(ls.x.name.trim())} will be deleted.</p>` })) return;
    return busy(b, async () => {
      must(await sb.from('exercise_logs').delete().eq('id', ls.editing.id));
      logCtx.logs = logCtx.logs.filter(l => l !== ls.editing);
      logSheet.close(); redrawLogs(); flash('Log deleted.');
    });
  }
  if ('save' in d) saveLog(b);
});
const redrawField = k => { logSheet.querySelector(`[data-field="${k}"]`).outerHTML = logFieldHTML(k); };

function saveLog(btn) {
  const vals = {};
  for (const k of ls.fields) if (ls.vals[k] != null && ls.vals[k] !== '') vals[k] = ls.vals[k];
  if (vals.weight != null) vals.unit = ls.unit;
  const notes = ls.notes.trim();
  if (!Object.keys(vals).length && !notes) { flash(ls.fields.length ? 'Fill in at least one value, or a note.' : 'Write a note to log it.', 'error'); return; }
  return busy(btn, async () => {
    const row = { student_id: me.student.id, session_id: ls.sid, exercise_key: ls.key, exercise_name: ls.x.name.trim().slice(0, 200),
      logged_on: ls.date, vals, notes };
    const saved = await sb.from('exercise_logs').upsert(row, { onConflict: 'student_id,exercise_key,logged_on' }).select().single().then(must);
    logCtx.logs = sortLogs([saved, ...logCtx.logs.filter(l => l.id !== saved.id)]);
    const mine = logsOf(logCtx.logs, ls.key), wasBest = mine[0] === saved && isNewBest(mine);
    logSheet.close();
    redrawLogs();
    const when = ls.date === todayISO() ? '' : ` for ${logDay(ls.date)}`;
    flash(wasBest ? `Logged${when}. That's a new best!` : `Logged${when}.`);
  });
}

// ---------- History: one exercise's logs, with the best and a trend line ----------
// opts: { logs, mine (the student: Edit on today's), who (a coach's view: the student's name) }.
const logHist = Object.assign(document.createElement('dialog'), { id: 'logHist', className: 'exb-sheet log-sheet' });
logHist.setAttribute('aria-labelledby', 'logHistTitle');
document.body.append(logHist);
let lh = null;   // { key, opts, edge, page }

function openLogHistory(key, opts) {
  lh = { key, opts, edge: null, page: 1 };
  // Hangs on several edges: start on the edge used most lately, so the trend compares like with like.
  const edges = logsOf(opts.logs, key).map(l => l.vals.edge).filter(v => v != null);
  if (new Set(edges).size > 1) lh.edge = edges[0];
  drawLogHistory();
  logHist.showModal();
}
function drawLogHistory() {
  const all = logsOf(lh.opts.logs, lh.key);
  if (!all.length) return logHist.close();
  const list = lh.edge == null ? all : all.filter(l => l.vals.edge === lh.edge);
  const m = logMetric(list), best = m && bestLog(list, m), name = all[0].exercise_name;
  const edgeCounts = new Map();
  all.forEach(l => { if (l.vals.edge != null) edgeCounts.set(l.vals.edge, (edgeCounts.get(l.vals.edge) || 0) + 1); });
  const chips = edgeCounts.size > 1 ? `<div class="log-chips hist-chips" role="tablist" aria-label="Edge">${[...edgeCounts].sort((a, b) => b[1] - a[1]).map(([e, n]) =>
    `<button type="button" role="tab" data-edge="${e}" aria-selected="${lh.edge === e}">${e} mm<span class="count">${n}</span></button>`).join('')}
    <button type="button" role="tab" data-edge="all" aria-selected="${lh.edge == null}">All<span class="count">${all.length}</span></button></div>` : '';
  const on = lh.edge != null ? ` on ${lh.edge} mm` : '';
  const spark = m ? sparkSVG(list, m, { label: `${m.label}${on}, ${trendText(list, m) || 'over time'}` }) : '';
  const bestCard = best ? `<div class="hist-best"><div class="row between"><span class="eyebrow">${lh.opts.who ? 'Best' : 'Your Best'}${on}</span>
      <span class="tag best">${logDay(best.logged_on)}</span></div>
    <p class="hist-big">${esc(logLine(best))}</p>${spark}${spark ? `<p class="hist-cap">${esc(trendText(list, m))}</p>` : ''}</div>` : '';
  const [shown, page] = pageOf(list, lh.page, LOG_PAGE);
  const canEdit = lh.opts.mine && logCtx?.canLog && planExercise(logCtx.sessions, lh.key).length > 0;   // only for an exercise in the current plan
  lh.page = page;
  logHist.innerHTML = `<div class="exb-head"><div><span class="eyebrow">${lh.opts.who ? `${esc(lh.opts.who)} · ` : ''}History</span>
      <h2 id="logHistTitle">${esc(name)}</h2><p class="hint">${all.length} log${all.length === 1 ? '' : 's'} since ${logDay(all.at(-1).logged_on)}</p></div>
    <button type="button" class="exb-close" data-close aria-label="Close">${EXB_ICON.close}</button></div>
    <div class="log-body">${bestCard}${chips}
      <ul class="hist-list">${shown.map(l => `<li><div><span class="hist-d">${logDay(l.logged_on, true)}</span>
        <span class="hist-s">${esc(logLine(l))}${l === best && list.length > 1 ? ' <span class="tag best">Best</span>' : ''}</span>
        ${l.notes && logSummary(l.vals) ? `<span class="hist-n">${para(l.notes)}</span>` : ''}</div>${
        canEdit ? `<button type="button" class="small" data-edit="${l.logged_on}">Edit</button>` : ''}</li>`).join('')}</ul>
      <div class="hist-pager">${pagerHTML(page, list.length, LOG_PAGE)}</div></div>`;
  bindPager(logHist.querySelector('.hist-pager'), n => { lh.page = n; drawLogHistory(); });
}
logHist.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if ('close' in b.dataset) return logHist.close();
  if (b.dataset.edge) { lh.edge = b.dataset.edge === 'all' ? null : +b.dataset.edge; lh.page = 1; drawLogHistory(); logHist.querySelector(`[data-edge="${b.dataset.edge}"]`)?.focus(); }
  if ('edit' in b.dataset) {
    const l = logsOf(logCtx.logs, lh.key).find(l => l.logged_on === b.dataset.edit);
    logHist.close();
    if (l) openLogSheet(lh.key, l.session_id, l.logged_on);
  }
});

// ---------- The student's home: Training Log card (latest per exercise) ----------
const myLogCardHTML = () => {
  if (!logCtx?.logs.length) return '<section id="logCard" hidden></section>';
  return `<section class="card log-card" id="logCard"><div class="row between"><div><h2>Training Log</h2>
    <p class="hint">Your latest for each exercise. Tap one for its history.</p></div><span class="big-count">${logCtx.logs.length}</span></div>
    <div id="logCardBox">${logRowsHTML(logCtx.logs, logCtx.page ?? 1)}</div></section>`;
};
function bindMyLogCard() {
  const box = $('#logCardBox');
  if (box) pagedBox(box, { page: logCtx.page ?? 1 }, p => { logCtx.page = p; return logRowsHTML(logCtx.logs, p); });
}
// One row per exercise, newest first: name (New Best), the latest line and day; spark: a small trend beside it.
function logRowsHTML(logs, page, spark = false) {
  const latest = latestPerExercise(logs), [shown, p] = pageOf(latest, page, LOG_PAGE);
  return `<ul class="log-rows">${shown.map(l => {
    const all = logsOf(logs, l.exercise_key), list = sameEdge(all), m = spark && logMetric(list), n = all.length;
    const on = list !== all && l.vals.edge != null ? ` on ${l.vals.edge} mm` : '';
    return `<li><button type="button" class="log-row" data-hist="${esc(l.exercise_key)}"><span class="log-main">
      <span class="log-name">${esc(l.exercise_name)}${isNewBest(list) ? ' <span class="tag best">New Best</span>' : ''}</span>
      <span class="log-sub">${esc(logLine(l))} · ${logDay(l.logged_on)}</span>${spark ? `<span class="log-sub">${n} log${n === 1 ? '' : 's'}${
        m && trendText(list, m) ? ` · ${esc(trendText(list, m).replace(/^Up/, 'up').replace(/^Down/, 'down').replace(/^Same/, 'same').replace(' since', `${on} since`))}` : ''}</span>` : ''}</span>
      ${m ? sparkSVG(list, m, { w: 84, h: 34, cls: 'spark-sm', label: trendText(list, m) }) : ''}${CHEVRON}</button></li>`;
  }).join('')}</ul>${pagerHTML(p, latest.length, LOG_PAGE)}`;
}
// Rows open the history (the student's own, or on the coach's page the student's).
document.addEventListener('click', e => {
  const b = e.target.closest('[data-hist]');
  if (!b) return;
  const card = b.closest('[data-log-who]');
  if (card) openLogHistory(b.dataset.hist, { logs: coachLogs.logs, who: card.dataset.logWho });
  else if (logCtx) openLogHistory(b.dataset.hist, { logs: logCtx.logs, mine: true });
});

// ---------- The coach's student page: Training Log card (Recent by day, or By Exercise with trends) ----------
let coachLogs = { logs: [], view: 'recent', page: 1 };
function coachLogCardHTML(s, logs) {
  coachLogs = { logs, view: coachLogs.view, page: 1 };
  return `<section class="card log-card" id="logCard" data-log-who="${esc(s.name)}"><h2>Training Log</h2>
    <p class="hint">What ${esc(s.first_name)} logged from ${pro(s.pronouns).their} plans. Only ${pro(s.pronouns).they} can add or change logs.</p>
    ${logs.length ? `<div class="seg log-seg" role="radiogroup" aria-label="Show">
      <label><input type="radio" name="logView" value="recent"${coachLogs.view === 'recent' ? ' checked' : ''}>Recent</label>
      <label><input type="radio" name="logView" value="exercise"${coachLogs.view === 'exercise' ? ' checked' : ''}>By Exercise</label></div>
      <div id="coachLogBox">${coachLogBoxHTML()}</div>` : `<p class="muted">Nothing logged yet. ${esc(s.first_name)} logs from the exercise cards in ${pro(s.pronouns).their} current plan.</p>`}</section>`;
}
function coachLogBoxHTML() {
  const { logs, page } = coachLogs;
  if (coachLogs.view === 'exercise') return logRowsHTML(logs, page, true);
  // Recent: a few days a page, each day's logs under it.
  const days = [...new Set(logs.map(l => l.logged_on))], [shown, p] = pageOf(days, page, LOG_PAGE);
  return shown.map(d => `<h3 class="log-day">${logDay(d, true)}</h3><ul class="log-rows">${logs.filter(l => l.logged_on === d).map(l => {
    const list = logsOf(logs, l.exercise_key);
    return `<li><button type="button" class="log-row" data-hist="${esc(l.exercise_key)}"><span class="log-main">
      <span class="log-name">${esc(l.exercise_name)}${list[0] === l && isNewBest(list) ? ' <span class="tag best">New Best</span>' : ''}</span>
      <span class="log-sub">${esc(logLine(l))}</span>${l.notes && logSummary(l.vals) ? `<span class="log-note">${para(l.notes)}</span>` : ''}</span>${CHEVRON}</button></li>`;
  }).join('')}</ul>`).join('') + pagerHTML(p, days.length, LOG_PAGE);
}
function bindCoachLogCard() {
  const card = $('#logCard[data-log-who]'), box = $('#coachLogBox');
  if (!box) return;
  const go = n => { coachLogs.page = n; box.innerHTML = coachLogBoxHTML(); bindPager(box, go); };
  bindPager(box, go);
  card.querySelector('.log-seg').addEventListener('change', e => { coachLogs.view = e.target.value; go(1); });
}
