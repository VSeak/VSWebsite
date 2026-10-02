// ---------- A location's Team Summary: #/loc/<id>/summary ----------
// What the coach used to build in a spreadsheet: each active member's latest check-in (since a date, if one is picked),
// the team's average member and coach rating per area, how many tagged each area (Want to Improve), and every answer, by
// question or by member. Team Focus is what the coaches decide from it: dated and signed, with earlier ones kept.
// Copy Summary (text for an email or a message) and Copy Table (tab-separated: pastes into a spreadsheet as cells) are
// for coaches who aren't on the app yet.

let sumSince = '';          // '' = each member's latest check-in, whenever it was
let sumBy = 'question';     // answers grouped by 'question' or by 'member'

const avgText = x => x ? x.avg.toFixed(1) : '—';
const firstLine = s => { const l = s.trim().split('\n')[0].replace(/\*\*/g, ''); return l.length > 90 ? l.slice(0, 88).trimEnd() + '…' : l; };

// Per area: the average member and coach rating (with how many rated it) and, for each question with tags, how many tagged it.
function teamStats(rows, areas, questions) {
  const tagQs = questions.filter(q => q.tags || rows.some(r => r.c.tags[q.id]?.length));
  const avg = (key, id) => {
    const v = rows.map(r => r.c[key][id]).filter(x => x != null);
    return v.length ? { avg: v.reduce((a, b) => a + b, 0) / v.length, n: v.length } : null;
  };
  const list = byGroup(areas).map(a => ({ a, them: avg('ratings', a.id), coach: avg('coach_ratings', a.id),
    tagged: tagQs.map(q => rows.filter(r => (r.c.tags[q.id] || []).includes(a.id)).length) }))
    .filter(x => (x.a.active && (x.a.rated || tagQs.length)) || x.them || x.coach || x.tagged.some(Boolean));
  for (const x of list) x.gap = x.them && x.coach && Math.abs(x.them.avg - x.coach.avg) >= 1;
  const wanted = tagQs.length ? list.filter(x => x.tagged[0]).sort((p, q) => q.tagged[0] - p.tagged[0]).slice(0, 3) : [];
  const score = x => (x.coach || x.them)?.avg;
  const lowest = list.filter(x => score(x) != null).sort((p, q) => score(p) - score(q)).slice(0, 3);
  return { tagQs, list, wanted, lowest };
}

async function summaryTab(loc, head, t) {
  const [onTeam, areas, questions, focus, [next]] = await Promise.all([
    sb.from('team_member_locations').select('member:team_members(id, name, first_name, left_on)').eq('location_id', loc.id).is('inactive_on', null).then(must),
    sb.from('team_rating_areas').select('*').order('position').then(must),
    sb.from('team_checkin_questions').select('*').order('position').then(must),
    sb.from('team_focus').select('*').eq('location_id', loc.id).order('focus_date', { ascending: false }).order('created_at', { ascending: false }).then(must),
    // The next Practice here (not other kinds of event), for the Next Practice card.
    sb.from('team_events').select('*').eq('kind', 'practice').or(`location_ids.is.null,location_ids.cs.{${loc.id}}`)
      .gte('event_date', today()).order('event_date').order('start_time', { nullsFirst: true }).limit(1).then(must),
  ]);
  const members = onTeam.map(x => x.member).filter(m => m && !m.left_on).sort((a, b) => a.name.localeCompare(b.name));
  const plan = next?.practice_id ? await sb.from('team_practices').select('id, name').eq('id', next.practice_id).maybeSingle().then(r => r.data) : null;
  const checkins = members.length ? await sb.from('team_checkins').select('*').in('member_id', members.map(m => m.id))
    .order('checkin_date', { ascending: false }).order('created_at', { ascending: false }).then(must) : [];
  if (t !== navToken) return;
  const latest = {};
  for (const c of checkins) if (!sumSince || c.checkin_date >= sumSince) latest[c.member_id] ??= c;
  const rows = members.filter(m => latest[m.id]).map(m => ({ m, c: latest[m.id] }));
  const missing = members.filter(m => !latest[m.id]);
  const s = teamStats(rows, areas, questions);
  const ctx = { loc, members, rows, areas, questions, focus, s };
  const link = m => `<a href="#/member/${m.id}">${esc(m.name)}</a>`;

  view(`${head}
    <div class="row between list-tools">
      <span class="row wrap"><label class="inline">Check-Ins Since:<input type="date" id="sumSince" value="${sumSince}" max="${today()}"></label>
        ${sumSince ? '<button type="button" class="small ghost" id="sumAll">Show Latest</button>' : ''}</span>
      <span class="row wrap"><button type="button" class="small" id="copySum">Copy Summary</button>
        <button type="button" class="small" id="copyTable">Copy Table</button></span>
    </div>
    <p class="hint">Each active member's latest check-in${sumSince ? ` since ${fmtDate(sumSince)}` : ''}: ${rows.length} of ${members.length} members.
      ${missing.length ? `No check-in${sumSince ? ' since then' : ' yet'}: ${missing.map(link).join(', ')}.` : ''}</p>
    <div class="member-grid">
      <div class="col">${focusCardHTML(ctx)}${areaCardHTML(ctx)}</div>
      <div class="col">${nextPracticeHTML(next, plan, loc)}${answersCardHTML(ctx)}</div>
    </div>`, { keepScroll: true });

  $('#sumSince').addEventListener('change', e => { sumSince = e.target.value; redraw(); });
  $('#sumAll')?.addEventListener('click', () => { sumSince = ''; redraw(); });
  $('#copySum').onclick = () => copyText(summaryText(ctx), 'Summary copied. Paste it into an email or a message.');
  $('#copyTable').onclick = () => copyText(summaryTable(ctx), 'Table copied. Paste it into a spreadsheet.');
  app.onclick = e => {
    const by = e.target.closest('[data-by]'), fb = e.target.closest('[data-focus]');
    const pl = e.target.closest('[data-plan]');
    if (pl) practiceDialog(pl.dataset.plan);
    if (e.target.closest('[data-cal-open]')) calOpen = { id: next.id, date: next.event_date };   // the calendar opens on it
    if (by) { sumBy = by.dataset.by; redraw(); }
    if (fb) focusForm(focus.find(f => f.id === fb.dataset.focus) || null, ctx);
  };
}

// ---------- Team Focus ----------

function focusCardHTML({ focus, areas }) {
  const [now, ...earlier] = focus;
  const chips = f => { const list = byGroup(areas).filter(a => f.area_ids.includes(a.id));
    return list.length ? `<span class="chips">${list.map(a => `<span class="chip strong">${esc(a.name)}</span>`).join('')}</span>` : ''; };
  const body = f => `<div class="note-body">${para(f.body)}</div>${chips(f)}
    <div class="row between wrap check-foot"><span class="hint">${fmtDate(f.focus_date)} · by ${esc(f.author_name || 'staff')}${f.edited_at ? ' · edited' : ''}</span>
      <button type="button" class="small ghost" data-focus="${f.id}">Edit</button></div>`;
  return `<section class="card focus-card">
    <div class="row between"><h2>Team Focus</h2><button type="button" class="fill small" data-focus="new">+ New Focus</button></div>
    ${now ? body(now) : `<p class="muted">No team focus yet. After check-ins, write what the team will work on, from what members said and the
      areas below. Every coach here sees it.</p>`}
    ${earlier.length ? `<h3>Earlier</h3>${earlier.map(f => `<details class="history"><summary><b>${fmtDate(f.focus_date)}</b>
      <span class="muted">${esc(firstLine(f.body))}</span></summary>${body(f)}</details>`).join('')}` : ''}
  </section>`;
}

async function focusForm(f, { loc, areas, focus, s }) {
  const picked = f?.area_ids || [];
  const list = byGroup(areas.filter(a => a.active || picked.includes(a.id)));
  const wanted = s.wanted.map(x => `${x.a.name} (${x.tagged[0]})`).join(', ');
  const res = await ask({ title: f ? 'Edit Team Focus' : 'New Team Focus', ok: f ? 'Save' : 'Add Focus', wide: true,
    extra: f ? { value: 'delete', label: 'Delete' } : null,
    body: `<label>Date<input type="date" name="focus_date" required value="${f?.focus_date || today()}" data-need="Pick the date."></label>
      <label>What the Team Works On<textarea name="body" rows="4" required data-need="Write what the team will work on."
        placeholder="E.g. Footwork drills to start every practice; a comp-style night each month before Boulderfest.">${esc(f?.body || '')}</textarea></label>
      <fieldset><legend>Focus Areas</legend>${areaChips('area', list, picked, 'Focus areas')}</fieldset>
      <p class="hint">${wanted ? `Most wanted in check-ins: ${esc(wanted)}. ` : ''}Every coach at ${esc(loc.name)} sees this on the Summary tab.</p>` });
  if (!res) return;
  if (res.get('button') === 'delete') {
    if (!await confirmDelete('Delete Team Focus?', `The focus from ${fmtDate(f.focus_date)} will be gone for good.`)) return;
    return busy(null, async () => { await sb.from('team_focus').delete().eq('id', f.id).then(must); flash('Team focus deleted.'); redraw(); });
  }
  const row = { focus_date: res.get('focus_date'), body: res.get('body').trim(), area_ids: res.getAll('area') };
  await busy(null, async () => {
    if (f) await sb.from('team_focus').update(row).eq('id', f.id).then(must);
    else await sb.from('team_focus').insert({ ...row, location_id: loc.id }).then(must);
    flash(f ? 'Team focus saved.' : 'Team focus added.');
    redraw();
  });
}

// ---------- Next Practice ----------

// What the event pop-up on the Calendar shows, for the next Practice here, less its type and location (the page says
// those; the user asked). Practice Plan opens the plan in a pop-up (practices.js); Open in Calendar opens the event's.
function nextPracticeHTML(e, plan, loc) {
  if (!e) return `<section class="card"><h2>Next Practice</h2><p class="muted">No practice on the calendar yet.</p>
    <a class="button small" href="#/loc/${loc.id}/calendar">Open Calendar</a></section>`;
  return `<section class="card next-practice"><h2>Next Practice</h2>
    <h3>${esc(e.title)}${e.series_id ? ' <span class="chip soft">Repeats Weekly</span>' : ''}</h3>
    <p class="next-when"><strong>${esc(eventWhen(e))}</strong>${e.place ? `<br>${esc(e.place)}` : ''}</p>
    ${e.notes ? `<div class="note-body">${para(e.notes)}</div>` : ''}
    <div class="row wrap next-actions">${plan ? `<button type="button" class="small" data-plan="${plan.id}">Practice Plan: ${esc(plan.name)}</button>` : ''}
      <a class="button small" href="#/loc/${loc.id}/calendar" data-cal-open>Open in Calendar</a></div>
  </section>`;
}

// ---------- By Area ----------

function areaCardHTML({ rows, s }) {
  const { tagQs, list, wanted, lowest } = s;
  if (!rows.length) return `<section class="card"><h2>By Area</h2><p class="muted">No check-ins to sum up${sumSince ? ' since that date' : ' yet'}.</p></section>`;
  const val = x => x ? `<span class="avg"><b>${avgText(x)}</b><small>${x.n}</small></span>` : '<span class="muted">—</span>';
  const count = k => `<span class="tcount"><span class="tbar"><i style="width:${Math.round(k / rows.length * 100)}%"></i></span><b>${k}</b></span>`;
  const glance = [
    wanted.length ? `<li><b>Most wanted (${esc(tagQs[0].prompt)}):</b> ${wanted.map(x => `${esc(x.a.name)} (${x.tagged[0]})`).join(', ')}</li>` : '',
    lowest.length ? `<li><b>Lowest rated:</b> ${lowest.map(x => `${esc(x.a.name)} (${avgText(x.coach || x.them)})`).join(', ')}</li>` : '',
  ].join('');
  return `<section class="card"><h2>By Area</h2>
    ${glance ? `<ul class="glance">${glance}</ul>` : ''}
    <div class="area-table" style="--cols:${2 + tagQs.length}">
      <span></span><small>Member</small><small>Coach</small>${tagQs.map(q => `<small>${esc(q.prompt)}</small>`).join('')}
      ${Object.entries(AREA_GROUPS).map(([g, label]) => { const inG = list.filter(x => x.a.area_group === g); return inG.length ? `<h3>${label}</h3>
        ${inG.map(x => `<span>${esc(x.a.name)}</span>${x.a.rated || x.them || x.coach ? `${val(x.them)}<span class="${x.gap ? 'gap' : ''}">${val(x.coach)}</span>`
          : '<span class="muted small-text tag-only">Tag only</span>'}${x.tagged.map(count).join('')}`).join('')}` : ''; }).join('')}
    </div>
    <p class="hint">Averages of each member's latest check-in; the small number is how many rated it. Lowest rated uses the coach average.
      ${list.some(x => x.gap) ? '<span class="gap">Highlighted</span>: members and coaches differ by 1 or more on average.' : ''}</p>
  </section>`;
}

// ---------- What They Said ----------

function answersCardHTML({ rows, areas, questions }) {
  const said = rows.map(r => ({ ...r, answers: answered(r.c, questions, areas) })).filter(r => r.answers.length);
  const chips = tags => tags.length ? ` <span class="chips">${tags.map(a => `<span class="chip">${esc(a.name)}</span>`).join('')}</span>` : '';
  const who = m => `<a href="#/member/${m.id}">${esc(m.name)}</a>`;
  let body = '<p class="muted">No answers yet. They come from the questions on each check-in.</p>';
  if (said.length && sumBy === 'question') body = questions.map(q => {
    const items = said.flatMap(r => r.answers.filter(x => x.q.id === q.id).map(x => ({ m: r.m, ...x })));
    return items.length ? `<h3>${esc(q.prompt)}</h3><ul class="said">${items.map(x =>
      `<li><b>${who(x.m)}</b>${x.text ? ` <span>${para(x.text)}</span>` : ''}${chips(x.tags)}</li>`).join('')}</ul>` : '';
  }).join('');
  else if (said.length) body = said.map(r => `<h3>${who(r.m)} <span class="muted small-text">${fmtDate(r.c.checkin_date)} · by ${esc(r.c.author_name || 'staff')}</span></h3>
    <ul class="said">${r.answers.map(x => `<li><b>${esc(x.q.prompt)}</b>${x.text ? ` <span>${para(x.text)}</span>` : ''}${chips(x.tags)}</li>`).join('')}</ul>`).join('');
  return `<section class="card"><div class="row between wrap"><h2>What They Said</h2>
      <div class="seg" role="group" aria-label="Group answers by">
        <button type="button" data-by="question" class="${sumBy === 'question' ? 'on' : ''}">By Question</button>
        <button type="button" data-by="member" class="${sumBy === 'member' ? 'on' : ''}">By Member</button></div></div>
    ${body}</section>`;
}

// ---------- Copy ----------

async function copyText(text, done) {
  try { await navigator.clipboard.writeText(text); flash(done); }
  catch { flash("Couldn't copy. Your browser may need permission to use the clipboard.", 'error'); }
}

function summaryText({ loc, members, rows, areas, questions, focus, s }) {
  const plain = t => t.replace(/\*\*/g, '');
  const L = [`${loc.name} Adult Team: Team Summary (${fmtDate(today())})`,
    `Each active member's latest check-in${sumSince ? ` since ${fmtDate(sumSince)}` : ''}: ${rows.length} of ${members.length} members.`, ''];
  const f = focus[0];
  if (f) {
    const names = byGroup(areas).filter(a => f.area_ids.includes(a.id)).map(a => a.name);
    L.push(`TEAM FOCUS (${fmtDate(f.focus_date)}, ${f.author_name || 'staff'})`, plain(f.body.trim()), ...(names.length ? [`Areas: ${names.join(', ')}`] : []), '');
  }
  if (rows.length) {
    L.push(`BY AREA (Member average / Coach average${s.tagQs.map(q => ` / ${q.prompt}`).join('')})`);
    for (const [g, label] of Object.entries(AREA_GROUPS)) {
      const inG = s.list.filter(x => x.a.area_group === g);
      if (!inG.length) continue;
      L.push(label);
      for (const x of inG) L.push(`- ${x.a.name}: ${[...(x.a.rated || x.them || x.coach ? [avgText(x.them), avgText(x.coach)] : ['tag only']),
        ...x.tagged.map(k => `${k} of ${rows.length}`)].join(' / ')}`);
    }
    L.push('');
  }
  for (const q of questions) {
    const items = rows.flatMap(r => answered(r.c, questions, areas).filter(x => x.q.id === q.id).map(x => ({ m: r.m, ...x })));
    if (!items.length) continue;
    L.push(q.prompt.toUpperCase());
    for (const x of items) L.push(`- ${x.m.name}: ${plain(x.text).replace(/\s*\n\s*/g, ' ')}${x.tags.length ? ` [${x.tags.map(a => a.name).join(', ')}]` : ''}`);
    L.push('');
  }
  return L.join('\n').trim() + '\n';
}

// One row per member, tab-separated, so it pastes into Sheets or Excel as cells. Tabs and new lines in answers become spaces.
function summaryTable({ rows, areas, questions }) {
  const cell = x => String(x ?? '').replace(/\*\*/g, '').replace(/\s*[\t\r\n]+\s*/g, ' ').trim();
  const qs = questions.filter(q => q.active || rows.some(r => r.c.answers[q.id] || r.c.tags[q.id]?.length));
  const tagQs = qs.filter(q => q.tags || rows.some(r => r.c.tags[q.id]?.length));
  const rated = areas.filter(a => (a.rated && a.active) || rows.some(r => r.c.ratings[a.id] != null || r.c.coach_ratings[a.id] != null));
  const head = ['Member', 'Check-In', 'By', ...qs.flatMap(q => tagQs.includes(q) ? [q.prompt, `${q.prompt}: Areas`] : [q.prompt]),
    ...rated.flatMap(a => [`${a.name} (Member)`, `${a.name} (Coach)`])];
  const line = ({ m, c }) => [m.name, c.checkin_date, c.author_name,
    ...qs.flatMap(q => [c.answers[q.id], ...(tagQs.includes(q) ? [byGroup(areas).filter(a => (c.tags[q.id] || []).includes(a.id)).map(a => a.name).join(', ')] : [])]),
    ...rated.flatMap(a => [c.ratings[a.id], c.coach_ratings[a.id]])];
  return [head, ...rows.map(line)].map(r => r.map(cell).join('\t')).join('\n') + '\n';
}
