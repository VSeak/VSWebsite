// ---------- A location's calendar: #/loc/<id>/calendar ----------
// Month grid (weeks start Sunday), the picked day's events beside it, and what's coming up.
// An event shows at the locations in location_ids, or at every location when that's null (only admins add those).
// Repeats Weekly makes one event per day, tied by series_id so they can be changed or deleted together.

let calMonth = null;   // first of the shown month, YYYY-MM-01
let calPick = null;    // the picked day, YYYY-MM-DD
let calOpen = null;    // an event to open when the calendar draws (clicked in Home's Coming Up): { id, date }
let calPractices = [];  // the practices an event can link to: { id, name }
const hasPlan = kind => kind !== 'competition';   // Practice, Open House and Other can have a Practice Plan
const UPCOMING = 8;
const MAX_REPEATS = 200;

// A coach changes an event only when it's at their locations alone (RLS: team_can_all_locations). locs = the ones they see.
const canEditEvent = (e, locs) => me.isAdmin || !!e.location_ids?.every(id => locs.some(l => l.id === id));
const eventEnd = e => e.end_date || e.event_date;
const onDay = (e, d) => e.event_date <= d && eventEnd(e) >= d;
const addDays = (d, n) => { const x = day(d); x.setDate(x.getDate() + n); return iso(x); };
const addMonths = (d, n) => { const x = day(d); x.setMonth(x.getMonth() + n); return iso(x); };
// Where else an event is, beside the location being shown.
const alsoAt = (e, loc, locs) => !e.location_ids ? 'All Locations'
  : e.location_ids.filter(id => id !== loc.id).map(id => locs.find(l => l.id === id)?.name).filter(Boolean).map(n => 'Also ' + n).join(', ');

async function calendarTab(loc, head, t) {
  // Coming to the calendar starts at this month. A redraw (a picked day, another month, a save) keeps the place.
  // An event clicked on Home starts at its day.
  if (calOpen) { calPick = calOpen.date; calMonth = calPick.slice(0, 8) + '01'; }
  else if (!redrawing || !calPick) { calPick = today(); calMonth = calPick.slice(0, 8) + '01'; }
  const first = day(calMonth), gridStart = addDays(calMonth, -first.getDay());
  const from = [gridStart, today()].sort()[0];
  const [events, locs, practices] = await Promise.all([
    sb.from('team_events').select('*').or(`location_ids.is.null,location_ids.cs.{${loc.id}}`)
      .gte('event_date', addDays(from, -60)).order('event_date').order('start_time', { nullsFirst: true }).limit(1000).then(must),
    sb.from('team_locations').select('id, name').order('position').order('name').then(must),
    sb.from('team_practices').select('id, name').order('name').then(r => r.data || []),   // the calendar still works if it can't be read
  ]);
  if (t !== navToken) return;
  calPractices = practices;
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
          ${picked.length ? picked.map(e => eventRow(e, { where: alsoAt(e, loc, locs) })).join('')
            : '<p class="muted">Nothing on this day.</p>'}
        </section>
        <section class="card">
          <h2>Coming Up</h2>
          ${upcoming.length ? upcoming.map(e => eventRow(e, { where: alsoAt(e, loc, locs) })).join('')
            : '<p class="muted">Nothing coming up. Pick a day and add an event.</p>'}
        </section>
      </div>
    </div>`, { keepScroll: true });

  // Another month or day redraws in place (no Loading step).
  app.onclick = e => {
    const m = e.target.closest('[data-month]'), d = e.target.closest('[data-day]'), ev = e.target.closest('[data-event]');
    if (m) {
      const n = +m.dataset.month;
      if (!n) { calPick = today(); calMonth = calPick.slice(0, 8) + '01'; }
      else calMonth = addMonths(calMonth, n);
      redraw();
    } else if (d) {
      calPick = d.dataset.day;
      if (calPick.slice(0, 7) !== month) calMonth = calPick.slice(0, 8) + '01';
      redraw();
    } else if (ev) showEvent(events.find(x => x.id === ev.dataset.event), loc, locs);
  };
  $('#addEvent').onclick = () => editEvent(null, loc, locs);
  if (calOpen) {
    const e = events.find(x => x.id === calOpen.id);
    calOpen = null;
    if (e) showEvent(e, loc, locs);
  }
}

const locsText = (e, locs) => !e.location_ids ? 'All Locations' : e.location_ids.map(id => locs.find(l => l.id === id)?.name).filter(Boolean).join(', ');

// An event's details, with Edit and Delete for someone who can change it.
async function showEvent(e, loc, locs) {
  const edit = canEditEvent(e, locs);
  const plan = hasPlan(e.kind) && calPractices.find(p => p.id === e.practice_id);
  const f = await ask({ title: e.title, ok: edit ? 'Edit' : 'Close', cancel: edit,
    extra: edit ? { value: 'delete', label: 'Delete' } : null,
    onOpen: form => form.querySelector('[data-close]')?.addEventListener('click', () => $('#dlg').close()),
    body: `<p class="event-meta wrap"><span class="kind k-${e.kind}">${KINDS[e.kind]}</span> <span class="chip">${esc(locsText(e, locs))}</span>
        ${e.series_id ? '<span class="chip soft">Repeats Weekly</span>' : ''}</p>
      <p><strong>${esc(eventWhen(e))}</strong>${e.place ? `<br>${esc(e.place)}` : ''}</p>
      ${plan ? `<p><a class="button small" href="#/practice/${plan.id}" data-close>Practice Plan: ${esc(plan.name)}</a></p>` : ''}
      ${e.notes ? `<div class="note-body">${para(e.notes)}</div>` : ''}
      <p class="hint">Added by ${esc(e.author_name || 'staff')}${e.edited_at ? ` · edited ${fmtWhen(e.edited_at)}` : ''}</p>` });
  if (!f || !edit) return;
  if (f.get('button') === 'delete') return deleteEvent(e);
  editEvent(e, loc, locs);
}

const SCOPES = { one: 'This Event Only', later: 'This and Later Events' };
const scopeField = (verb) => `<fieldset><legend>${verb}</legend>${Object.entries(SCOPES).map(([k, v], i) =>
  `<label class="check"><input type="radio" name="scope" value="${k}"${i ? '' : ' checked'}> ${v}</label>`).join('')}</fieldset>`;

async function deleteEvent(e) {
  const where = e.location_ids ? '' : ' at every location';
  const f = e.series_id
    ? await ask({ title: 'Delete Event?', ok: 'Delete', warn: true,
        body: `<p>“${esc(e.title)}” repeats weekly. Delete just this one, or it and every later one?</p>${scopeField('Delete')}` })
    : await confirmDelete('Delete Event?', `“${esc(e.title)}” will be removed from the calendar${where}.`);
  if (!f) return;
  await busy(null, async () => {
    if (f.get('scope') === 'later') await sb.from('team_events').delete().eq('series_id', e.series_id).gte('event_date', e.event_date).then(must);
    else await sb.from('team_events').delete().eq('id', e.id).then(must);
    flash(f.get('scope') === 'later' ? 'Events deleted.' : 'Event deleted.');
    redraw();
  });
}

// The days a weekly repeat lands on, from the first date to the last, on the ticked weekdays (0 = Sunday).
function repeatDates(from, until, weekdays) {
  const out = [];
  for (let d = from; d <= until && out.length <= MAX_REPEATS; d = addDays(d, 1)) if (weekdays.includes(day(d).getDay())) out.push(d);
  return out;
}

async function editEvent(e, loc, locs) {
  // A new event starts as a practice at the usual time, 6 to 8 PM.
  const v = e || { kind: 'practice', title: '', event_date: calPick || today(), end_date: null, start_time: '18:00', end_time: '20:00', place: '', notes: '',
    location_ids: [loc.id] };
  const allDay = !v.start_time;
  const pickLocs = me.isAdmin || locs.length > 1;   // a coach at one location has nothing to pick
  const at = id => !v.location_ids || v.location_ids.includes(id);
  const weekdayNames = Array.from({ length: 7 }, (_, i) => day(addDays('2026-01-04', i)).toLocaleDateString(undefined, { weekday: 'short' }));   // Jan 4 2026 is a Sunday
  const f = await ask({ title: e ? 'Edit Event' : 'Add Event', ok: e ? 'Save Event' : 'Add Event', wide: true,
    body: `${e?.series_id ? scopeField('Change') + '<p class="hint" id="scopeHint" hidden>Later events keep their own dates.</p>' : ''}
      <label>Title<input name="title" maxlength="120" required value="${esc(v.title)}" data-need="Give the event a title."
        placeholder="E.g. Tuesday practice: overhangs" autocomplete="off"></label>
      <div class="two"><label>Type<select name="kind">${Object.entries(KINDS).map(([k, l]) =>
        `<option value="${k}"${k === v.kind ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Place <span class="muted">(optional)</span><input name="place" maxlength="200" value="${esc(v.place)}" autocomplete="off"></label></div>
      ${calPractices.length ? `<label id="evPlan"${hasPlan(v.kind) ? '' : ' hidden'}>Practice Plan <span class="muted">(optional, from Practices)</span>
        <select name="practice_id"><option value="">None</option>${calPractices.map(p =>
          `<option value="${p.id}"${p.id === v.practice_id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}
      <div class="two"><label>Date<input type="date" name="event_date" required value="${v.event_date}" data-need="Pick the date."></label>
        <label id="evLast">Last Day <span class="muted">(if several days)</span><input type="date" name="end_date" value="${v.end_date || ''}" min="${v.event_date}"
          data-range="The last day can't be before the first."></label></div>
      ${e ? '' : `<label class="check"><input type="checkbox" name="repeat"> Repeats Weekly</label>
      <fieldset id="evRepeat" hidden><legend>Repeats On</legend>
        <div class="days">${weekdayNames.map((w, i) => `<label class="check"><input type="checkbox" name="dow" value="${i}"> ${w}</label>`).join('')}</div>
        <label>Until<input type="date" name="until" value="${addMonths(v.event_date, 3)}" min="${v.event_date}"
          data-need="Pick the last day it repeats." data-range="Pick a day after the first date, within a year."></label>
      </fieldset>`}
      <label class="check"><input type="checkbox" name="all_day"${allDay ? ' checked' : ''}> All Day</label>
      <div class="two" id="evTimes"${allDay ? ' hidden' : ''}><label>Start Time<input type="time" name="start_time" value="${(v.start_time || '').slice(0, 5)}"
          ${allDay ? '' : 'required'} data-need="Pick a start time, or tick All Day."></label>
        <label>End Time <span class="muted">(optional)</span><input type="time" name="end_time" value="${(v.end_time || '').slice(0, 5)}"
          data-range="End after it starts."></label></div>
      <label>Notes <span class="muted">(agenda, what to bring, links)</span><textarea name="notes" rows="5"
        placeholder="E.g. Warm-up, then 4×4s on the 40° wall. Focus: heel hooks.">${esc(v.notes)}</textarea></label>
      ${pickLocs ? `<fieldset><legend>Show At</legend>
        ${me.isAdmin ? `<label class="check"><input type="checkbox" name="everywhere"${v.location_ids ? '' : ' checked'}> Every Location</label>` : ''}
        ${locs.map(l => `<label class="check"><input type="checkbox" name="loc" value="${l.id}"${at(l.id) ? ' checked' : ''}> ${esc(l.name)}</label>`).join('')}
      </fieldset>` : ''}`,
    onOpen: form => {
      const els = form.elements;
      els.kind.onchange = () => { if ($('#evPlan')) $('#evPlan').hidden = !hasPlan(els.kind.value); };
      els.all_day.onchange = () => {
        $('#evTimes').hidden = els.all_day.checked;
        els.start_time.required = !els.all_day.checked;
        if (els.all_day.checked) { clearFieldError(els.start_time); }
      };
      els.event_date.onchange = () => {
        els.end_date.min = els.event_date.value;
        if (els.until) { els.until.min = els.event_date.value; els.until.max = addDays(els.event_date.value, 366); }
      };
      els.start_time.onchange = () => { els.end_time.min = els.start_time.value; };
      if (els.start_time.value) els.end_time.min = els.start_time.value;
      // Repeats Weekly: pick the weekdays and the last day; a repeating event is one day long.
      if (els.repeat) {
        const days = [...form.querySelectorAll('[name="dow"]')];
        const need = () => days[0].setCustomValidity(els.repeat.checked && !days.some(b => b.checked) ? 'Pick at least one day.' : '');
        days[0].dataset.need = 'Pick at least one day.';
        els.until.max = addDays(v.event_date, 366);
        els.repeat.onchange = () => {
          const on = els.repeat.checked;
          $('#evRepeat').hidden = !on;
          $('#evLast').hidden = on;
          els.until.required = on;
          if (on) { els.end_date.value = ''; if (!days.some(b => b.checked)) days[day(els.event_date.value || v.event_date).getDay()].checked = true; }
          need();
        };
        days.forEach(b => b.addEventListener('change', () => { need(); clearFieldError(days[0]); }));
      }
      // This and Later Events: the dates stay as they are.
      form.querySelectorAll('[name="scope"]').forEach(r => r.onchange = () => {
        const later = form.querySelector('[name="scope"]:checked').value === 'later';
        els.event_date.disabled = els.end_date.disabled = later;
        $('#scopeHint').hidden = !later;
      });
      // Every Location ticks them all; unticking one takes it off.
      if (pickLocs) {
        const boxes = [...form.querySelectorAll('[name="loc"]')], every = els.everywhere;
        const need = () => boxes[0].setCustomValidity(boxes.some(b => b.checked) ? '' : 'Pick at least one location.');
        boxes[0].dataset.need = 'Pick at least one location.';
        if (every) every.onchange = () => {
          boxes.forEach(b => { b.checked = every.checked || b.value === loc.id; });
          need(); clearFieldError(boxes[0]);
        };
        boxes.forEach(b => b.addEventListener('change', () => {
          if (every && !b.checked) every.checked = false;
          need(); clearFieldError(boxes[0]);
        }));
        need();
      }
    } });
  if (!f) return;
  const timed = !f.get('all_day');
  const row = {
    title: f.get('title').trim(), kind: f.get('kind'), place: f.get('place').trim(), notes: f.get('notes').trim(),
    start_time: timed ? f.get('start_time') : null, end_time: timed && f.get('end_time') ? f.get('end_time') : null,
    location_ids: !pickLocs ? v.location_ids : f.get('everywhere') ? null : f.getAll('loc'),
  };
  // Every type but Competition can link to a plan. (Without the list, keep whatever it had.)
  if (calPractices.length) row.practice_id = hasPlan(f.get('kind')) && f.get('practice_id') || null;
  const later = f.get('scope') === 'later';
  const date = later ? v.event_date : f.get('event_date');
  if (!later) row.end_date = f.get('end_date') && f.get('end_date') !== date ? f.get('end_date') : null;
  await busy(null, async () => {
    if (e && later) await sb.from('team_events').update(row).eq('series_id', e.series_id).gte('event_date', e.event_date).then(must);
    else if (e) await sb.from('team_events').update({ ...row, event_date: date }).eq('id', e.id).then(must);
    else if (f.get('repeat')) {
      const dates = repeatDates(date, f.get('until'), f.getAll('dow').map(Number));
      if (dates.length > MAX_REPEATS) throw new Error(`That's more than ${MAX_REPEATS} events. Pick an earlier Until date.`);
      if (!dates.length) throw new Error('None of the picked weekdays fall between the date and Until.');
      const series_id = crypto.randomUUID();
      await sb.from('team_events').insert(dates.map(d => ({ ...row, event_date: d, end_date: null, series_id }))).then(must);
      calPick = dates[0];
    } else await sb.from('team_events').insert({ ...row, event_date: date }).then(must);
    calPick = e || !f.get('repeat') ? date : calPick;
    calMonth = calPick.slice(0, 8) + '01';
    flash(e ? (later ? 'Events saved.' : 'Event saved.') : f.get('repeat') ? 'Events added.' : 'Event added.');
    redraw();
  });
}
