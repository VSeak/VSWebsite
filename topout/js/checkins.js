// ---------- Check-ins (on the member page) ----------
// A check-in is a snapshot on a day, as often as the coach likes: the hardest circuit color, board grades with the angle,
// outdoor boulder and route grades (all optional) and 1–5 ratings on the admin's rating areas. The newest one shows in
// full with how each value changed since the check-in before; older ones fold into History.

// How to rate an area 1 to 5, shown in the check-in form.
const RATING_GUIDE = [
  "<b>Just starting.</b> New to it; needs a coach's help every time.",
  '<b>Developing.</b> Shows up sometimes, mostly on easier climbs.',
  '<b>Solid.</b> Does it reliably on climbs at their level.',
  '<b>Strong.</b> Holds up on harder climbs and when tired.',
  '<b>A real strength.</b> Stands out on the team; could show others how.',
];

const canChangeCheckin = c => me.isAdmin || c.author_id === me.user.id;

// Each grade: its label, how to read it for display, and a number to compare (higher = harder).
function gradeParts(c, circuits) {
  const circ = circuits.find(x => x.id === c.circuit_id);
  const board = (g, a) => g == null ? null : vText(g) + (a != null ? ` @ ${a}°` : '');
  return [
    { key: 'circuit', label: 'Circuit', show: circ ? `${swatch(circ.color)}${esc(circ.name)}` : null, sub: circ ? circuitRange(circ) : '', rank: circ?.position },
    { key: 'tb2', label: 'Tension Board 2', show: esc(board(c.tb2_grade, c.tb2_angle)), rank: c.tb2_grade },
    { key: 'kilter', label: 'Kilter Board', show: esc(board(c.kilter_grade, c.kilter_angle)), rank: c.kilter_grade },
    { key: 'boulder', label: 'Boulder (Outdoor/Other)', show: c.boulder_grade == null ? null : vText(c.boulder_grade), rank: c.boulder_grade },
    { key: 'route', label: 'Route', show: c.route_grade ? esc(c.route_grade) : null, rank: c.route_grade ? ROUTE_GRADES.indexOf(c.route_grade) : null },
  ].filter(p => p.show);
}
// ↑ or ↓ against the value from the check-in before (the newest older one that has it).
const delta = (now, before) => now == null || before == null || now === before ? ''
  : `<span class="delta ${now > before ? 'up' : 'down'}" title="${now > before ? 'Up' : 'Down'} since the check-in before">${now > before ? '↑' : '↓'}</span>`;

function checkinDetailHTML(c, older, { circuits, areas }) {
  const prevRank = key => { for (const o of older) { const p = gradeParts(o, circuits).find(x => x.key === key); if (p) return p.rank; } return null; };
  const prevRating = id => older.find(o => o.ratings[id] != null)?.ratings[id] ?? null;
  const grades = gradeParts(c, circuits);
  const rated = areas.filter(a => c.ratings[a.id] != null);
  return `${grades.length ? `<div class="grades">${grades.map(p => `<div class="grade"><small>${p.label}</small>
      <b>${p.show}${delta(p.rank, prevRank(p.key))}</b>${p.sub ? `<small>${p.sub}</small>` : ''}</div>`).join('')}</div>` : ''}
    ${rated.length ? `<div class="ratings">${rated.map(a => { const r = c.ratings[a.id]; return `<div class="rating"><span>${esc(a.name)}</span>
      <span class="pips" aria-label="${r} out of 5">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= r ? 'on' : ''}"></i>`).join('')}</span>
      <b>${r}${delta(r, prevRating(a.id))}</b></div>`; }).join('')}</div>` : ''}
    ${!grades.length && !rated.length ? '<p class="muted">No grades or ratings recorded.</p>' : ''}
    ${c.notes ? `<div class="note-body">${para(c.notes)}</div>` : ''}
    <div class="row between wrap check-foot"><span class="hint">By ${esc(c.author_name || 'staff')}${c.edited_at ? ' · edited' : ''}</span>
      ${canChangeCheckin(c) ? `<span class="row"><button type="button" class="small ghost" data-checkin="edit" data-id="${c.id}">Edit</button>
        <button type="button" class="small ghost danger" data-checkin="delete" data-id="${c.id}">Delete</button></span>` : ''}</div>`;
}

function checkinsCardHTML(ctx) {
  const { checkins, circuits } = ctx;
  const [latest, ...older] = checkins;
  const summary = c => {
    const circ = circuits.find(x => x.id === c.circuit_id);
    const bits = gradeParts(c, circuits).filter(p => p.key !== 'circuit').map(p => `${p.key === 'tb2' ? 'TB2' : p.key === 'kilter' ? 'Kilter' : ''} ${p.show}`.trim());
    return `<b>${fmtDate(c.checkin_date)}</b>${circ ? circuitChip(circ) : ''}<span class="muted">${bits.slice(0, 2).join(' · ')}</span>`;
  };
  return `<section class="card checkins-card">
    <div class="row between"><h2>Check-Ins</h2><button type="button" class="fill small" data-checkin="new">+ New Check-In</button></div>
    ${latest ? `<p class="hint">Latest: <strong>${fmtDate(latest.checkin_date)}</strong>. Arrows compare with the check-in before.</p>
      ${checkinDetailHTML(latest, older, ctx)}
      ${older.length ? `<h3>History</h3>${older.map((c, i) => `<details class="history"><summary>${summary(c)}</summary>
        ${checkinDetailHTML(c, older.slice(i + 1), ctx)}</details>`).join('')}` : ''}`
    : `<p class="muted">No check-ins yet. A check-in records their grades and your 1–5 ratings, whenever it suits you: monthly, each season or once a year.</p>`}
  </section>`;
}

async function checkinAction(btn, ctx) {
  const c = ctx.checkins.find(x => x.id === btn.dataset.id);
  if (btn.dataset.checkin === 'delete') {
    if (!await confirmDelete('Delete Check-In?', `The check-in from ${fmtDate(c.checkin_date)} will be gone for good.`)) return;
    return busy(btn, async () => { await sb.from('team_checkins').delete().eq('id', c.id).then(must); flash('Check-in deleted.'); redraw(); });
  }
  checkinForm(c || null, ctx);
}

async function checkinForm(c, { m, checkins, circuits, areas }) {
  // A new check-in starts as a copy of the latest one (grades, ratings and notes), dated today, to change what's new.
  const last = checkins[0];
  const v = c || (last ? { ...last, checkin_date: today() } : { checkin_date: today(), ratings: {}, notes: '' });
  const vOpts = sel => `<option value="">—</option>${V_GRADES.map(g => `<option value="${g}"${g === sel ? ' selected' : ''}>V${g}</option>`).join('')}`;
  const angle = (name, val) => `<label>Angle<input type="number" name="${name}" min="0" max="70" step="5" inputmode="numeric" value="${val ?? ''}"
    placeholder="E.g. 40" data-range="Use an angle from 0° to 70°."></label>`;
  const shownAreas = areas.filter(a => a.active || v.ratings[a.id] != null);
  const f = await ask({ title: c ? 'Edit Check-In' : `Check-In: ${m.first_name}`, ok: c ? 'Save Check-In' : 'Add Check-In', wide: true,
    body: `<label>Date<input type="date" name="checkin_date" required value="${v.checkin_date}" max="${today()}" data-need="Pick the date."
        data-range="A check-in can't be in the future."></label>
      <p class="hint">Record what's useful. Everything below is optional.${!c && last ? ` It starts from the last check-in (${fmtDate(last.checkin_date)}), so change what's new.` : ''}</p>
      <h3>Grades</h3>
      <label>Hardest Circuit<select name="circuit_id"><option value="">—</option>${circuits.map(x =>
        `<option value="${x.id}"${x.id === v.circuit_id ? ' selected' : ''}>${esc(x.name)}${circuitRange(x) ? ` (${circuitRange(x)})` : ''}</option>`).join('')}</select></label>
      <fieldset><legend>Tension Board 2</legend><div class="two"><label>Grade<select name="tb2_grade">${vOpts(v.tb2_grade)}</select></label>${angle('tb2_angle', v.tb2_angle)}</div></fieldset>
      <fieldset><legend>Kilter Board</legend><div class="two"><label>Grade<select name="kilter_grade">${vOpts(v.kilter_grade)}</select></label>${angle('kilter_angle', v.kilter_angle)}</div></fieldset>
      <div class="two"><label>Boulder (Outdoor/Other)<select name="boulder_grade">${vOpts(v.boulder_grade)}</select></label>
        <label>Route<select name="route_grade"><option value="">—</option>${ROUTE_GRADES.map(g => `<option${g === v.route_grade ? ' selected' : ''}>${g}</option>`).join('')}</select></label></div>
      ${shownAreas.length ? `<h3>Ratings</h3>
        <dl class="rate-guide">${RATING_GUIDE.map((g, i) => `<dt>${i + 1}</dt><dd>${g}</dd>`).join('')}</dl>
        ${shownAreas.map(a => `<div class="rate-row"><span>${esc(a.name)}</span><span class="rate-pick" role="radiogroup" aria-label="${esc(a.name)}">
          ${[1, 2, 3, 4, 5].map(i => `<label><input type="radio" name="r_${a.id}" value="${i}"${v.ratings[a.id] === i ? ' checked' : ''}><span>${i}</span></label>`).join('')}</span></div>`).join('')}` : ''}
      <label>Notes<textarea name="notes" rows="3" placeholder="E.g. Moved up a color since spring. Wants to try the Kilter at 45° next.">${esc(v.notes)}</textarea></label>`,
    // Tapping the picked rating again clears it (a radio can't be unticked on its own); pointerdown notes whether it was already picked.
    onOpen: form => {
      let was = null;
      form.addEventListener('pointerdown', e => { const r = e.target.closest('.rate-pick label')?.querySelector('input'); was = r?.checked ? r : null; });
      form.addEventListener('click', e => {
        if (e.target.matches('.rate-pick input') && e.target === was) { e.target.checked = false; e.target.dispatchEvent(new Event('change', { bubbles: true })); }
        if (e.target.matches('.rate-pick input')) was = null;
      });
    } });
  if (!f) return;
  const num = k => f.get(k) === '' || f.get(k) == null ? null : +f.get(k);
  const ratings = {};
  for (const a of shownAreas) if (f.get('r_' + a.id)) ratings[a.id] = +f.get('r_' + a.id);
  // Ratings on areas not shown in the form (none today, but an old check-in could have some) are kept.
  if (c) for (const [k, r] of Object.entries(c.ratings)) if (!shownAreas.some(a => a.id === k)) ratings[k] = r;
  const row = {
    checkin_date: f.get('checkin_date'), circuit_id: f.get('circuit_id') || null,
    tb2_grade: num('tb2_grade'), tb2_angle: num('tb2_grade') == null ? null : num('tb2_angle'),
    kilter_grade: num('kilter_grade'), kilter_angle: num('kilter_grade') == null ? null : num('kilter_angle'),
    boulder_grade: num('boulder_grade'), route_grade: f.get('route_grade') || null, ratings, notes: f.get('notes').trim(),
  };
  await busy(null, async () => {
    if (c) await sb.from('team_checkins').update(row).eq('id', c.id).then(must);
    else await sb.from('team_checkins').insert({ ...row, member_id: m.id }).then(must);
    flash(c ? 'Check-in saved.' : 'Check-in added.');
    redraw();
  });
}
