// ---------- A location's calendar: #/loc/<id>/calendar ----------
// Month grid (weeks start Sunday), the picked day's events beside it, and what's coming up.
// Events at location_id null show at every location; only admins add or change those.

let calMonth = null;   // first of the shown month, YYYY-MM-01
let calPick = null;    // the picked day, YYYY-MM-DD
const UPCOMING = 8;

const canEditEvent = e => me.isAdmin || !!e.location_id;   // RLS only lets a coach see their own locations' events
const eventEnd = e => e.end_date || e.event_date;
const onDay = (e, d) => e.event_date <= d && eventEnd(e) >= d;
const addDays = (d, n) => { const x = day(d); x.setDate(x.getDate() + n); return iso(x); };

async function calendarTab(loc, head, t) {
  calPick ??= today();
  calMonth ??= calPick.slice(0, 8) + '01';
  const first = day(calMonth), gridStart = addDays(calMonth, -first.getDay());
  const from = [gridStart, today()].sort()[0];
  const events = await sb.from('team_events').select('*').or(`location_id.eq.${loc.id},location_id.is.null`)
    .gte('event_date', addDays(from, -60)).order('event_date').order('start_time', { nullsFirst: true }).limit(1000).then(must);
  if (t !== navToken) return;
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const weeks = cells.at(35).slice(0, 7) === calMonth.slice(0, 7) ? 6 : 5;   // a sixth row only when the month reaches it
  const month = calMonth.slice(0, 7), now = today();
  const cell = d => {
    const list = events.filter(e => onDay(e, d));
    return `<button type="button" class="cal-day${d.slice(0, 7) === month ? '' : ' out'}${d === now ? ' now' : ''}${d === calPick ? ' pick' : ''}"
      data-day="${d}" aria-label="${fmtDay(d)}${list.length ? `, ${list.length} ${list.length === 1 ? 'event' : 'events'}` : ''}"${d === calPick ? ' aria-pressed="true"' : ''}>
      <span class="num">${day(d).getDate()}</span>
      <span class="cal-evs">${list.slice(0, 3).map(e => `<span class="cal-ev k-${e.kind}">${esc(e.title)}</span>`).join('')}
        ${list.length > 3 ? `<span class="cal-more">+${list.length - 3}</span>` : ''}</span></button>`;
  };
  const picked = events.filter(e => onDay(e, calPick));
  const upcoming = events.filter(e => eventEnd(e) >= now).slice(0, UPCOMING);
  const dows = cells.slice(0, 7).map(d => day(d).toLocaleDateString(undefined, { weekday: 'short' }));
  view(`${head}
    <div class="cal-layout">
      <section class="card cal-card">
        <div class="row between cal-head"><h2>${fmtMonthYear(calMonth)}</h2>
          <div class="row"><button type="button" class="small ghost" data-month="-1" aria-label="Previous month">‹</button>
            <button type="button" class="small ghost" data-month="0">Today</button>
            <button type="button" class="small ghost" data-month="1" aria-label="Next month">›</button></div></div>
        <div class="cal-grid" role="grid">${dows.map(w => `<span class="dow">${w}</span>`).join('')}${cells.slice(0, weeks * 7).map(cell).join('')}</div>
        <div class="legend">${Object.entries(KINDS).map(([k, v]) => `<span><i class="k-${k}"></i>${v}</span>`).join('')}</div>
      </section>
      <div class="side">
        <section class="card">
          <div class="row between"><h2>${fmtDay(calPick)}</h2><button type="button" class="small fill" id="addEvent">+ Add Event</button></div>
          ${picked.length ? picked.map(e => eventRow(e, { where: e.location_id ? '' : 'All Locations' })).join('')
            : '<p class="muted">Nothing on this day.</p>'}
        </section>
        <section class="card">
          <h2>Coming Up</h2>
          ${upcoming.length ? upcoming.map(e => eventRow(e, { where: e.location_id ? '' : 'All Locations' })).join('')
            : '<p class="muted">Nothing coming up. Pick a day and add an event.</p>'}
        </section>
      </div>
    </div>`, { keepScroll: true });

  app.onclick = e => {
    const m = e.target.closest('[data-month]'), d = e.target.closest('[data-day]'), ev = e.target.closest('[data-event]');
    if (m) {
      const n = +m.dataset.month;
      if (!n) { calPick = today(); calMonth = calPick.slice(0, 8) + '01'; }
      else { const x = day(calMonth); x.setMonth(x.getMonth() + n); calMonth = iso(x); }
      route();
    } else if (d) {
      calPick = d.dataset.day;
      if (calPick.slice(0, 7) !== month) calMonth = calPick.slice(0, 8) + '01';
      route();
    } else if (ev) showEvent(events.find(x => x.id === ev.dataset.event), loc);
  };
  $('#addEvent').onclick = () => editEvent(null, loc);
}

// An event's details, with Edit and Delete for someone who can change it.
async function showEvent(e, loc) {
  const edit = canEditEvent(e);
  const f = await ask({ title: e.title, ok: edit ? 'Edit' : 'Close', cancel: edit,
    extra: edit ? { value: 'delete', label: 'Delete' } : null,
    body: `<p class="event-meta"><span class="kind k-${e.kind}">${KINDS[e.kind]}</span> ${e.location_id ? '' : '<span class="chip">All Locations</span>'}</p>
      <p><strong>${esc(eventWhen(e))}</strong>${e.place ? `<br>${esc(e.place)}` : ''}</p>
      ${e.notes ? `<div class="note-body">${para(e.notes)}</div>` : ''}
      <p class="hint">Added by ${esc(e.author_name || 'staff')}${e.edited_at ? ` · edited ${fmtWhen(e.edited_at)}` : ''}</p>` });
  if (!f || !edit) return;
  if (f.get('button') === 'delete') {
    if (!await confirmDelete('Delete Event?', `“${esc(e.title)}” will be removed from the calendar${e.location_id ? '' : ' at every location'}.`)) return;
    await busy(null, async () => { await sb.from('team_events').delete().eq('id', e.id).then(must); flash('Event deleted.'); redraw(); });
    return;
  }
  editEvent(e, loc);
}

async function editEvent(e, loc) {
  const v = e || { kind: 'practice', title: '', event_date: calPick || today(), end_date: null, start_time: null, end_time: null, place: '', notes: '', location_id: loc.id };
  const allDay = !v.start_time;
  const f = await ask({ title: e ? 'Edit Event' : 'Add Event', ok: e ? 'Save Event' : 'Add Event', wide: true,
    body: `<label>Title<input name="title" maxlength="120" required value="${esc(v.title)}" data-need="Give the event a title."
        placeholder="E.g. Tuesday practice: overhangs" autocomplete="off"></label>
      <div class="two"><label>Type<select name="kind">${Object.entries(KINDS).map(([k, l]) =>
        `<option value="${k}"${k === v.kind ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Place <span class="muted">(optional)</span><input name="place" maxlength="200" value="${esc(v.place)}" autocomplete="off"></label></div>
      <div class="two"><label>Date<input type="date" name="event_date" required value="${v.event_date}" data-need="Pick the date."></label>
        <label>Last Day <span class="muted">(if several days)</span><input type="date" name="end_date" value="${v.end_date || ''}" min="${v.event_date}"
          data-range="The last day can't be before the first."></label></div>
      <label class="check"><input type="checkbox" name="all_day"${allDay ? ' checked' : ''}> All Day</label>
      <div class="two" id="evTimes"${allDay ? ' hidden' : ''}><label>Start Time<input type="time" name="start_time" value="${(v.start_time || '').slice(0, 5)}"
          ${allDay ? '' : 'required'} data-need="Pick a start time, or tick All Day."></label>
        <label>End Time <span class="muted">(optional)</span><input type="time" name="end_time" value="${(v.end_time || '').slice(0, 5)}"
          data-range="End after it starts."></label></div>
      <label>Notes <span class="muted">(agenda, what to bring, links)</span><textarea name="notes" rows="5"
        placeholder="E.g. Warm-up, then 4×4s on the 40° wall. Focus: heel hooks.">${esc(v.notes)}</textarea></label>
      ${me.isAdmin ? `<label class="check"><input type="checkbox" name="everywhere"${v.location_id ? '' : ' checked'}> Show at Every Location</label>` : ''}`,
    onOpen: form => {
      const els = form.elements;
      els.all_day.onchange = () => {
        $('#evTimes').hidden = els.all_day.checked;
        els.start_time.required = !els.all_day.checked;
        if (els.all_day.checked) { clearFieldError(els.start_time); }
      };
      els.event_date.onchange = () => { els.end_date.min = els.event_date.value; };
      els.start_time.onchange = () => { els.end_time.min = els.start_time.value; };
      if (els.start_time.value) els.end_time.min = els.start_time.value;
    } });
  if (!f) return;
  const timed = !f.get('all_day');
  const row = {
    title: f.get('title').trim(), kind: f.get('kind'), place: f.get('place').trim(), notes: f.get('notes').trim(),
    event_date: f.get('event_date'), end_date: f.get('end_date') && f.get('end_date') !== f.get('event_date') ? f.get('end_date') : null,
    start_time: timed ? f.get('start_time') : null, end_time: timed && f.get('end_time') ? f.get('end_time') : null,
    location_id: me.isAdmin && f.get('everywhere') ? null : (v.location_id || loc.id),
  };
  await busy(null, async () => {
    if (e) await sb.from('team_events').update(row).eq('id', e.id).then(must);
    else await sb.from('team_events').insert(row).then(must);
    calPick = row.event_date;
    calMonth = calPick.slice(0, 8) + '01';
    flash(e ? 'Event saved.' : 'Event added.');
    redraw();
  });
}
