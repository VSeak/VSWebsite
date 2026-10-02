// ---------- Check-ins (on the member page) ----------
// A check-in is a snapshot on a day, as often as the coach likes: answers to the admin's questions (Proud Of, Want to
// Improve with area tags, …), 1–5 ratings on the rated areas from the member and from the coach, and grades: the
// hardest circuit color, board grades with the angle, outdoor boulder and route grades. All optional. The newest one
// shows in full with how each value changed since the check-in before; older ones fold into History.

// How to rate an area 1 to 5, for an area (or a number) with no description of its own.
const RATING_GUIDE = [
  "<b>Just starting.</b> New to it; needs a coach's help every time.",
  '<b>Developing.</b> Shows up sometimes, mostly on easier climbs.',
  '<b>Solid.</b> Does it reliably on climbs at their level.',
  '<b>Strong.</b> Holds up on harder climbs and when tired.',
  '<b>A real strength.</b> Stands out on the team; could show others how.',
];
const AREA_GROUPS = { physical: 'Physical', skill: 'Skill', mental: 'Mental' };
// What number i (1–5) means for an area: its own line, else the general guide.
const guideFor = (a, i) => a.guide?.[i - 1]?.trim() ? esc(a.guide[i - 1]) : RATING_GUIDE[i - 1];
// Areas in Physical, Skill, Mental order (then the admin's order), for tag chips and the Team Summary.
const byGroup = areas => Object.keys(AREA_GROUPS).flatMap(g => areas.filter(a => a.area_group === g));
// Area chips to tick (checkboxes called `name`), in a row per group. Used for check-in tags and Team Focus.
const areaChips = (name, list, picked, label) => `<div class="tag-pick" role="group" aria-label="${esc(label)}">
  ${Object.entries(AREA_GROUPS).map(([g, gl]) => { const inG = list.filter(a => a.area_group === g); return inG.length ? `<div class="tag-group"><small>${gl}</small>
    ${inG.map(a => `<label class="chip-check"><input type="checkbox" name="${name}" value="${a.id}"${picked.includes(a.id) ? ' checked' : ''}><span>${esc(a.name)}</span></label>`).join('')}</div>` : ''; }).join('')}</div>`;

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
// Answered questions on a check-in: [{ q, text, tags: [area] }].
const answered = (c, questions, areas) => questions.map(q => ({ q, text: (c.answers[q.id] || '').trim(),
  tags: byGroup(areas).filter(a => (c.tags[q.id] || []).includes(a.id)) })).filter(x => x.text || x.tags.length);

function checkinDetailHTML(c, older, { m, circuits, areas, questions }) {
  const prevRank = key => { for (const o of older) { const p = gradeParts(o, circuits).find(x => x.key === key); if (p) return p.rank; } return null; };
  const prevRating = (key, id) => older.find(o => o[key][id] != null)?.[key][id] ?? null;
  const grades = gradeParts(c, circuits);
  const answers = answered(c, questions, areas);
  const rated = areas.filter(a => c.ratings[a.id] != null || c.coach_ratings[a.id] != null);
  const cell = (key, id) => {
    const r = c[key][id];
    return r == null ? '<span class="muted">—</span>' : `<span class="rcell"><span class="pips sm" aria-label="${r} out of 5">${[1, 2, 3, 4, 5].map(i =>
      `<i class="${i <= r ? 'on' : ''}"></i>`).join('')}</span><b>${r}${delta(r, prevRating(key, id))}</b></span>`;
  };
  return `${answers.length ? `<div class="answers">${answers.map(x => `<div class="answer"><small>${esc(x.q.prompt)}</small>
      ${x.text ? `<div>${para(x.text)}</div>` : ''}${x.tags.length ? `<span class="chips">${x.tags.map(a => `<span class="chip">${esc(a.name)}</span>`).join('')}</span>` : ''}</div>`).join('')}</div>` : ''}
    ${grades.length ? `<div class="grades">${grades.map(p => `<div class="grade"><small>${p.label}</small>
      <b>${p.show}${delta(p.rank, prevRank(p.key))}</b>${p.sub ? `<small>${p.sub}</small>` : ''}</div>`).join('')}</div>` : ''}
    ${rated.length ? `<div class="ratings"><span></span><small>${esc(m?.first_name || 'Member')}</small><small>Coach</small>
      ${rated.map(a => `<span>${esc(a.name)}</span>${cell('ratings', a.id)}${cell('coach_ratings', a.id)}`).join('')}</div>` : ''}
    ${!answers.length && !grades.length && !rated.length ? '<p class="muted">No answers, ratings or grades recorded.</p>' : ''}
    ${c.notes ? `<div class="note-body">${para(c.notes)}</div>` : ''}
    <div class="row between wrap check-foot"><span class="hint">Check-in by ${esc(c.author_name || 'staff')}${c.edited_at ? ' · edited' : ''}</span>
      ${canChangeCheckin(c) ? `<span class="row"><button type="button" class="small ghost" data-checkin="edit" data-id="${c.id}">Edit</button>
        <button type="button" class="small ghost danger" data-checkin="delete" data-id="${c.id}">Delete</button></span>` : ''}</div>`;
}

function checkinsCardHTML(ctx) {
  const { checkins, circuits } = ctx;
  const [latest, ...older] = checkins;
  const summary = c => {
    const circ = circuits.find(x => x.id === c.circuit_id);
    const bits = gradeParts(c, circuits).filter(p => p.key !== 'circuit').map(p => `${p.key === 'tb2' ? 'TB2' : p.key === 'kilter' ? 'Kilter' : ''} ${p.show}`.trim());
    return `<b>${fmtDate(c.checkin_date)}</b>${circ ? circuitChip(circ) : ''}<span class="muted">${[...bits.slice(0, 2), c.author_name ? `by ${esc(c.author_name)}` : ''].filter(Boolean).join(' · ')}</span>`;
  };
  return `<section class="card checkins-card">
    <div class="row between"><h2>Check-Ins</h2><button type="button" class="fill small" data-checkin="new">+ New Check-In</button></div>
    ${latest ? `<p class="hint">Latest: <strong>${fmtDate(latest.checkin_date)}</strong>. Arrows compare with the check-in before.</p>
      ${checkinDetailHTML(latest, older, ctx)}
      ${older.length ? `<h3>History</h3>${older.map((c, i) => `<details class="history"><summary>${summary(c)}</summary>
        ${checkinDetailHTML(c, older.slice(i + 1), ctx)}</details>`).join('')}` : ''}`
    : `<p class="muted">No check-ins yet. A check-in records a chat with them (what they're proud of, what they want to improve),
      1–5 ratings from them and from you, and their grades, whenever it suits you: monthly, each season or once a year.</p>`}
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

async function checkinForm(c, { m, goals, checkins, circuits, areas, questions }) {
  // A new check-in starts as a copy of the latest one (grades, both ratings and notes, but not the answers), dated today.
  const last = checkins[0];
  const v = c || (last ? { ...last, checkin_date: today(), answers: {}, tags: {} }
    : { checkin_date: today(), ratings: {}, coach_ratings: {}, answers: {}, tags: {}, notes: '' });
  const vOpts = sel => `<option value="">—</option>${V_GRADES.map(g => `<option value="${g}"${g === sel ? ' selected' : ''}>V${g}</option>`).join('')}`;
  const angle = (name, val) => `<label>Angle<input type="number" name="${name}" min="0" max="70" step="5" inputmode="numeric" value="${val ?? ''}"
    placeholder="E.g. 40" data-range="Use an angle from 0° to 70°."></label>`;
  // Hidden questions and areas still show on a check-in that has them, so nothing is lost by editing it.
  const shownQs = questions.filter(q => q.active || v.answers[q.id] || v.tags[q.id]?.length);
  const tagsOn = q => q.tags || v.tags[q.id]?.length;
  const tagAreas = q => byGroup(areas.filter(a => a.active || (v.tags[q.id] || []).includes(a.id)));
  const shownAreas = areas.filter(a => (a.rated && a.active) || v.ratings[a.id] != null || v.coach_ratings[a.id] != null);
  const tagPick = q => areaChips('t_' + q.id, tagAreas(q), v.tags[q.id] || [], `Focus areas for ${q.prompt}`);
  // The two sets of ratings: the member's own (labeled with their first name) and the coach's.
  const raters = [['ratings', m.first_name, 'r_'], ['coach_ratings', 'Coach', 'c_']];
  const pick = (a, [key, label, prefix]) => `<div class="rate-row"><span>${esc(label)}</span><span class="rate-pick" role="radiogroup" aria-label="${esc(a.name)}: ${esc(label)}">
    ${[1, 2, 3, 4, 5].map(i => `<label><input type="radio" name="${prefix}${a.id}" value="${i}"${v[key][a.id] === i ? ' checked' : ''}><span>${i}</span></label>`).join('')}</span></div>`;
  const pr = pronounWords(m.pronouns);
  // A reminder from their intake and goals, to talk about progress against what they came for (the user asked).
  const cur = goals.filter(g => g.status === 'current');
  const recap = m.intake_wants.trim() || cur.length ? `<div class="intake-recap">
      ${m.intake_wants.trim() ? `<p><b>What ${Cap(pr.subj)} ${pr.plural ? 'Want' : 'Wants'} From Adult Team:</b> ${esc(m.intake_wants)}</p>` : ''}
      ${cur.length ? `<p><b>Current Goals</b></p><ul>${cur.map(g => `<li>${esc(g.body)}</li>`).join('')}</ul>` : ''}</div>` : '';
  const f = await ask({ title: c ? 'Edit Check-In' : `Check-In: ${m.first_name}`, ok: c ? 'Save Check-In' : 'Add Check-In', wide: true,
    body: `<label>Date<input type="date" name="checkin_date" required value="${v.checkin_date}" max="${today()}" data-need="Pick the date."
        data-range="A check-in can't be in the future."></label>
      <p class="hint">Record what's useful. Everything below is optional.${!c && last ? ` Ratings, grades and notes start from the last check-in (${fmtDate(last.checkin_date)}), so change what's new.` : ''}</p>
      ${recap}
      ${shownQs.length ? `<h3 class="sec">Questions</h3>${shownQs.map(q => `<div class="q-block"><label>${esc(q.prompt)}<textarea name="a_${q.id}" rows="2"
        placeholder="${esc(q.hint)}">${esc(v.answers[q.id] || '')}</textarea></label>${tagsOn(q) ? tagPick(q) : ''}</div>`).join('')}` : ''}
      <h3 class="sec">Grades</h3>
      <label>Hardest Circuit<select name="circuit_id"><option value="">—</option>${circuits.map(x =>
        `<option value="${x.id}"${x.id === v.circuit_id ? ' selected' : ''}>${esc(x.name)}${circuitRange(x) ? ` (${circuitRange(x)})` : ''}</option>`).join('')}</select></label>
      <fieldset><legend>Tension Board 2</legend><div class="two"><label>Grade<select name="tb2_grade">${vOpts(v.tb2_grade)}</select></label>${angle('tb2_angle', v.tb2_angle)}</div></fieldset>
      <fieldset><legend>Kilter Board</legend><div class="two"><label>Grade<select name="kilter_grade">${vOpts(v.kilter_grade)}</select></label>${angle('kilter_angle', v.kilter_angle)}</div></fieldset>
      <div class="two"><label>Boulder (Outdoor/Other)<select name="boulder_grade">${vOpts(v.boulder_grade)}</select></label>
        <label>Route<select name="route_grade"><option value="">—</option>${ROUTE_GRADES.map(g => `<option${g === v.route_grade ? ' selected' : ''}>${g}</option>`).join('')}</select></label></div>
      ${shownAreas.length ? `<h3 class="sec">Ratings</h3>
        <p class="hint">${esc(m.first_name)}: how ${esc(m.first_name)} rates ${pr.self} (you tap it for ${pr.obj}).<br>Coach: your rating.</p>
        ${shownAreas.map(a => `<div class="rate-area"><b>${esc(a.name)}</b>
          <ol class="rate-lines">${[1, 2, 3, 4, 5].map(i => `<li><b>${i}</b><span>${guideFor(a, i)}</span></li>`).join('')}</ol>
          ${raters.map(r => pick(a, r)).join('')}</div>`).join('')}` : ''}
      <h3 class="sec">Notes</h3>
      <textarea name="notes" rows="3" aria-label="Notes" placeholder="E.g. Moved up a color since spring. Wants to try the Kilter at 45° next.">${esc(v.notes)}</textarea>`,
    // Tapping the picked rating again clears it (a radio can't be unticked on its own); pointerdown notes whether it was already picked.
    onOpen: form => {
      let was = null;
      form.addEventListener('pointerdown', e => { const r = e.target.closest('.rate-pick label')?.querySelector('input'); was = r?.checked ? r : null; });
      form.addEventListener('click', e => {
        if (!e.target.matches('.rate-pick input')) return;
        if (e.target === was) { e.target.checked = false; e.target.dispatchEvent(new Event('change', { bubbles: true })); }
        was = null;
      });
    } });
  if (!f) return;
  const num = k => f.get(k) === '' || f.get(k) == null ? null : +f.get(k);
  // Ratings, answers and tags on areas or questions not in the form (none today, but an old check-in could have some) are kept.
  const keep = (now, old, shown) => { if (old) for (const [k, x] of Object.entries(old)) if (!shown.some(s => s.id === k)) now[k] = x; return now; };
  const pickAll = (prefix, old) => {
    const out = {};
    for (const a of shownAreas) if (f.get(prefix + a.id)) out[a.id] = +f.get(prefix + a.id);
    return keep(out, old, shownAreas);
  };
  const answers = {}, tags = {};
  for (const q of shownQs) {
    const text = (f.get('a_' + q.id) || '').trim(), t = f.getAll('t_' + q.id);
    if (text) answers[q.id] = text;
    if (t.length) tags[q.id] = t;
  }
  const row = {
    checkin_date: f.get('checkin_date'), circuit_id: f.get('circuit_id') || null,
    tb2_grade: num('tb2_grade'), tb2_angle: num('tb2_grade') == null ? null : num('tb2_angle'),
    kilter_grade: num('kilter_grade'), kilter_angle: num('kilter_grade') == null ? null : num('kilter_angle'),
    boulder_grade: num('boulder_grade'), route_grade: f.get('route_grade') || null,
    ratings: pickAll('r_', c?.ratings), coach_ratings: pickAll('c_', c?.coach_ratings),
    answers: keep(answers, c?.answers, shownQs), tags: keep(tags, c?.tags, shownQs), notes: f.get('notes').trim(),
  };
  await busy(null, async () => {
    if (c) await sb.from('team_checkins').update(row).eq('id', c.id).then(must);
    else await sb.from('team_checkins').insert({ ...row, member_id: m.id }).then(must);
    flash(c ? 'Check-in saved.' : 'Check-in added.');
    redraw();
  });
}
