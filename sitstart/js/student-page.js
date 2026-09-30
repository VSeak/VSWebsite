// ---------- Coach: one student's page ----------

// again: redraw after a change, without the Loading… step or a jump to the top. It can be the form
// just saved; unsaved edits in the other forms are kept (keepEdits).
async function adminStudent(id, again = false) {
  const t = ++navToken;
  const restore = again && keepEdits(again);
  if (!again) view(loading);
  const [s, coaches, notes, cnotes, log] = await Promise.all([
    sb.from('students').select('*, plans(id,title,active,start_date,repeats,blocks,updated_at), goals(*)').eq('id', id).maybeSingle().then(must),
    sb.rpc('coaches_of', { p_id: id }).then(must),
    // This student's own notes on any of their plans, newest first (like Latest Student Notes on the Students list).
    sb.from('notes').select('id,session_id,body,created_at,session:sessions!inner(title,week,plan:plans!inner(id,title,repeats,blocks,student_id))')
      .eq('from_coach', false).eq('session.plan.student_id', id).order('created_at', { ascending: false }).then(must),
    sb.from('coach_notes').select('*').eq('student_id', id).then(must),
    sb.from('session_history').select('*').eq('student_id', id).then(must),
  ]);
  if (t !== navToken) return;
  if (!s) { location.hash = '#/students'; return; }
  // Your own student page: as your students see theirs.
  if (isSelf(s)) return redirect('#/me');
  s.plans.sort((a, b) => (b.active - a.active) || b.updated_at.localeCompare(a.updated_at));
  sortGoals(s.goals);
  sortCoachNotes(cnotes);
  const p = pro(s.pronouns), edit = canCoach(s), coach = coaches.find(c => c.is_current);

  // The current plan up top; every other plan (past, or inactive) a page at a time under Other Plans.
  const current = s.plans.find(p => p.active), others = s.plans.filter(p => !p.active);
  const plansHTML = page => {
    const [shown, at] = pageOf(others, page, PLANS_PAGE);
    return `<ul class="list">${shown.map(p => `<li><a class="item" href="#/plan/${p.id}">
    <span><strong>${esc(p.title || 'Untitled Plan')}</strong><span class="item-sub">${p.start_date ? fmtStart(p.start_date) : 'No start date'}</span></span>
    ${planTag(p)}</a></li>`).join('')}</ul>${pagerHTML(at, others.length, PLANS_PAGE)}`;
  };
  const snotesHTML = page => {
    const [shown, at] = pageOf(notes, page, SNOTES_PAGE);
    return shown.map(n => noteFeedItem(n)).join('') + pagerHTML(at, notes.length, SNOTES_PAGE);
  };
  const status = s.training_ended_at ? 'Inactive' : edit ? (coach ? 'My Student · Active' : 'No Coach · Active') : `Coached by ${esc(coach?.name || 'another coach')}`;
  const stat = (label, n, id = '') => `<div class="stat"><span class="stat-l">${label}</span><span class="stat-v"${id ? ` id="${id}"` : ''}>${n}</span></div>`;

  view(`${crumbs([['Home', '#/'], ['Students', '#/students'], [s.name]])}
  <div class="page-head"><div><span class="eyebrow">${status}</span><h1>${esc(s.name)}${pronounsTag(s.pronouns)}</h1></div>
    <div class="stats head-stats">${stat('Sessions', historyOf(log, s).length)}${stat('Goals', s.goals.filter(g => g.status === 'current').length, 'statGoals')}${stat('Notes', notes.length)}</div></div>
  ${edit ? '' : `<p class="alert">${esc(s.first_name)} is coached by ${esc(coach?.name || 'another coach')}. You can read everything here,
    add Coach Notes and add past sessions you ran. Only ${p.their} coach can change the rest.</p>`}
  <div class="grid2 phone-order" data-folds="student">
    <div>
      <section class="card" id="planCard">
        ${current ? `<span class="eyebrow">Current Plan · ${layoutName(current)}</span>
        <h2 class="plan-title">${esc(current.title || 'Untitled Plan')}</h2>
        <p class="muted">${current.start_date ? fmtStart(current.start_date) : 'No start date'}</p>
        <div class="row"><a class="fill grow" href="#/plan/${current.id}">Open Plan</a>${edit ? '<button type="button" data-act="new-plan">+ New Plan</button>' : ''}</div>`
        : `<div class="row between"><h2>Training Plans</h2>${edit ? '<button type="button" class="fill" data-act="new-plan">+ New Plan</button>' : ''}</div>
        <p class="muted">No current plan.${others.length ? ` Open one below to make it current, or start a new one.` : ''}</p>`}
        ${others.length ? `<details class="other-plans"${current ? '' : ' open'}><summary>${current ? 'Other Plans' : 'Plans'} (${others.length})</summary>
          <div id="plansBox">${plansHTML(1)}</div></details>` : ''}
      </section>
      <section class="card feed" id="snotesCard"><h2>Student Notes${notes.length ? ` <span class="count">(${notes.length})</span>` : ''}</h2>
        <p class="hint">Newest first. Tap a note to open it in the plan and reply.</p>
        ${notes.length ? `<div id="snotesBox">${snotesHTML(1)}</div>` : `<p class="muted">${p.They} ${p.v("haven't", "hasn't")} left any notes yet.</p>`}</section>
      <section class="card" id="coachNotesCard"></section>
    </div>
    <aside>
      ${nextCardHTML(s, edit)}
      <section class="card goals-card" id="goalsCard"></section>
      <div class="card-group">
      ${historyCardHTML(s)}
      ${trainingCardHTML(s, coaches, edit)}
      ${edit ? `<section class="card" data-fold-start><div class="row between"><h2>Details</h2><span class="fold-sum">Name, pronouns</span></div>
        <p class="hint">Emails and ${p.their} page greet ${p.them} by first name. ${p.They} can change ${p.their} own pronouns too.</p>
        <form id="stuForm" class="stack" data-save>
          <label>First Name<input name="first_name" value="${esc(s.first_name)}" required data-need="Enter ${p.their} first name."></label>
          <label>Last Name<input name="last_name" value="${esc(s.last_name)}"></label>
          ${pronounsField(s.pronouns)}
          <button class="primary">Save Details</button>
        </form>
      </section>` : ''}
      <section class="card" data-fold-start><div class="row between"><h2>Coach</h2><span class="fold-sum">${
        !coach ? 'None' : coach.staff_id === me.staffId ? 'You' : esc(coach.name)}</span></div>
        <p class="hint">${me.isAdmin ? `Change it on <a href="#/user/${id}">${p.their} user page</a>.` : `An admin can change ${p.their} coach.`}</p>
        ${coachesHTML(coaches, 'No coach yet.')}</section>
      ${accountCardStart(!!s.user_id || !edit, s.invited_at, s.first_name, p, s.user_id ? 'Signed in' : s.invited_at ? 'Invited' : 'Not invited')}
        ${!edit && !s.user_id ? `<p class="muted">${s.invited_at ? `Invited ${fmtWhen(s.invited_at)}, but hasn't signed in yet.` : 'Not invited yet.'}
          ${p.Their} coach sends the invite.</p>`
        : s.user_id ? `
        <p class="hint">How ${p.they} ${p.v('sign', 'signs')} in. Send a new sign-in link if ${p.they}${p.v("'re", "'s")} locked out.
          ${me.isAdmin ? `Change ${p.their} email on <a href="#/user/${id}">${p.their} user page</a>.` : `An admin can change ${p.their} email.`}</p>
        <p>Signs in as ${esc(s.email)}.</p>
        <div class="row"><button data-act="send-link">Send Sign-In Link</button></div>` : `
        <form id="inviteForm" class="stack" data-save="show">
          ${s.invited_at ? `<p>Invited ${fmtWhen(s.invited_at)}, but hasn't signed in yet.</p>` : ''}
          <label>Email<input type="email" name="email" value="${esc(s.email || '')}" required data-need="Enter ${p.their} email to send the invite." autocomplete="off"></label>
          <p class="hint">${s.invited_at ? 'Fix the email here if it was wrong, then resend.' : `${p.They}'ll get an email saying ${p.their} plan is ready, with a link to choose a password.`}</p>
          <div class="row"><button class="primary" id="inviteBtn">${s.invited_at ? 'Resend Invite' : 'Send Invite'}</button></div>
          <p class="hint need" id="inviteNeed" hidden></p>
        </form>`}
      </section>
      </div>
    </aside>
  </div>`, { keepScroll: again });
  bindTraining(id, s, () => adminStudent(id, true));
  if (others.length) pagedBox($('#plansBox'), { page: 1 }, plansHTML);
  if (notes.length) pagedBox($('#snotesBox'), { page: 1 }, snotesHTML);
  // Session History links to Coach Notes from the same day.
  // Coach Notes redraw when the sessions change, for their prompt about the newest past session.
  const hist = { log, page: 1, readOnly: !edit, notes: d => cnotes.filter(n => n.session_date === d).length, showNotes: showCoachNotes,
    addNotes: startCoachNote, changed: () => renderCoachNotes() };
  bindSessions(id, s, hist);

  if (edit) $('#stuForm').onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    busy(e.submitter, async () => {
      must(await sb.from('students').update({
        first_name: f.get('first_name').trim(), last_name: f.get('last_name').trim(), pronouns: readPronouns(f),
      }).eq('id', id));
      flash('Details saved.');
      adminStudent(id, e.target);
    });
  };

  // The invite waits for a saved plan (new plans have no title until saved) and a goal. Matches student_ready().
  const inviteNeed = () => {
    const need = [!s.plans.some(p => p.title) && 'save a training plan', !s.goals.length && 'add a goal'].filter(Boolean);
    return need.length ? `${need.join(' and ').replace(/^./, c => c.toUpperCase())} before sending the invite.` : '';
  };

  // Goals change in place, so the rest of the page (and the scroll) stays put.
  // focusAdd: a goal was just added, so the box starts empty; otherwise a goal being typed stays.
  // added: the goal just added, so its page shows. Archived stays open or shut.
  const goalAt = { current: { page: 1 }, achieved: { page: 1 }, archived: { page: 1 }, readOnly: !edit };
  function renderGoals(focusAdd, added) {
    gateInvite(inviteNeed());
    const typing = !focusAdd && $('#goalForm')?.elements.body.value;
    goalAt.archivedOpen = !!$('#goalsCard details')?.open;
    if (added) goalAt.current.page = Math.floor(s.goals.filter(g => g.status === 'current').indexOf(added) / GOALS_PAGE) + 1;
    $('#goalsCard').innerHTML = coachGoalsHTML(s.goals, p, goalAt);
    $('#statGoals').textContent = s.goals.filter(g => g.status === 'current').length;
    $('#goalsCard').querySelectorAll('[data-goals]').forEach(box =>
      pagedBox(box, goalAt[box.dataset.goals], () => goalGroupHTML(s.goals, box.dataset.goals, goalAt)));
    const form = $('#goalForm');
    if (!form) return;
    if (typing) form.elements.body.value = typing;
    if (focusAdd) form.elements.body.focus();
    form.onsubmit = e => {
      e.preventDefault();
      const body = form.elements.body.value.trim();
      if (!body) return;
      busy(e.submitter, async () => {
        const g = await sb.from('goals').insert({ student_id: id, body }).select().single().then(must);
        s.goals.push(g);
        sortGoals(s.goals);
        renderGoals(true, g);
      });
    };
  }
  const saveGoal = (b, g, patch, msg) => busy(b, async () => {
    Object.assign(g, await sb.from('goals').update(patch).eq('id', g.id).select().single().then(must));
    sortGoals(s.goals);
    renderGoals();
    if (msg) flash(msg);
  });
  renderGoals();

  // Coach Notes also change in place, and Session History redraws for its Notes counts. added: the note just
  // added, so the form starts empty and shows All, on the page with the new note; otherwise a note being typed stays.
  const cnoteAt = { filter: 'all', page: 1 };
  function renderCoachNotes(added) {
    const old = !added && $('#cnoteForm');
    // The date only if the coach changed it: a filled-in one follows the prompt.
    const date = old && old.elements.session_date, typed = old && [old.elements.body.value, date.value !== date.defaultValue && date.value];
    if (added) Object.assign(cnoteAt, { filter: 'all', spot: null, day: null, page: Math.floor(cnotes.indexOf(added) / CNOTES_PAGE) + 1 });
    const card = $('#coachNotesCard');
    card.innerHTML = coachNotesHTML(cnotes, s, log, cnoteAt);
    card.classList.toggle('overdue', cnoteMissing(cnotes, s, log).length > 0);
    bindPager(card, page => { cnoteAt.page = page; renderCoachNotes(); if (cnoteAt.spot) spotCoachNotes(); });
    // Picking a missing session: its date becomes the filled-in one (so a picked date isn't an unsaved edit).
    card.querySelectorAll('[data-cnote-day]').forEach(b => b.onclick = () => {
      const date = $('#cnoteForm').elements.session_date;
      date.value = date.defaultValue;
      cnoteAt.day = b.dataset.cnoteDay;
      renderCoachNotes();
      $('#cnoteForm').elements.body.focus();
    });
    const more = card.querySelector('[data-cnote-more]');
    // And n More shows every missing session; Show Fewer goes back to the newest few. A picked date that gets
    // hidden stays picked (it's still filled in below).
    if (more) more.onclick = () => {
      cnoteAt.allMissing = !cnoteAt.allMissing;
      renderCoachNotes();
      if (cnoteAt.allMissing) card.querySelectorAll('[data-cnote-day]')[CNOTE_MISSING_SHOWN]?.focus();   // the first one that was hidden
      else card.querySelector('[data-cnote-more]')?.focus();
    };
    hist.redraw();
    const form = $('#cnoteForm');
    if (typed) {
      form.elements.body.value = typed[0];
      if (typed[1] !== false) form.elements.session_date.value = typed[1];
    }
    form.onsubmit = e => {
      e.preventDefault();
      const f = new FormData(form), body = f.get('body').trim();
      if (!body) return;
      busy(e.submitter, async () => {
        const note = await sb.from('coach_notes').insert({ student_id: id, body, session_date: f.get('session_date') || null })
          .select().single().then(must);
        cnotes.push(note);
        sortCoachNotes(cnotes);
        renderCoachNotes(note);
        flash('Note added.');
      });
    };
    card.querySelector('.seg')?.addEventListener('change', e => { Object.assign(cnoteAt, { filter: e.target.value, page: 1, spot: null }); renderCoachNotes(); });
  }
  renderCoachNotes();
  // From Session History: the page of session notes with that day's first note, scrolled to, and every note from
  // that day lit up for a moment. If they run onto the next page, paging there lights those up too (cnoteAt.spot).
  function spotCoachNotes() {
    const els = cnotes.filter(n => n.session_date === cnoteAt.spot).map(n => $(`#cnote-${n.id}`)).filter(Boolean);
    els.forEach(el => el.classList.remove('spot'));
    if (els.length) void els[0].offsetWidth;   // restart the animation
    els.forEach(el => el.classList.add('spot'));
    return els;
  }
  // From Session History's Add Notes: that day becomes the filled-in Session Date (like picking a missing session),
  // then the form is scrolled to with the Notes box focused. Notes already typed stay.
  function startCoachNote(date) {
    const field = $('#cnoteForm').elements.session_date;
    field.value = field.defaultValue;
    cnoteAt.day = date;
    renderCoachNotes();
    const card = $('#coachNotesCard');
    if (card.classList.contains('folded')) setFold(card, false);
    const form = $('#cnoteForm');
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    form.elements.body.focus({ preventScroll: true });
  }
  function showCoachNotes(date) {
    const list = cnotes.filter(n => cnoteIn(n, 'session')), i = list.findIndex(n => n.session_date === date);
    if (i < 0) return;
    Object.assign(cnoteAt, { filter: 'session', page: Math.floor(i / CNOTES_PAGE) + 1, spot: date });
    renderCoachNotes();
    const card = $('#coachNotesCard');
    if (card.classList.contains('folded')) setFold(card, false);
    const els = spotCoachNotes();
    els[0].scrollIntoView({ behavior: 'smooth', block: els.length > 1 ? 'start' : 'center' });
  }
  if (restore) restore();

  const inviteForm = $('#inviteForm');
  if (inviteForm) inviteForm.onsubmit = e => {
    e.preventDefault();
    if (inviteNeed()) return;
    const email = new FormData(e.target).get('email').trim().toLowerCase();
    busy(e.submitter, async () => {
      // Save the email first: the sign-up gate only lets listed emails create an account.
      if (email !== s.email) {
        const { error } = await sb.from('students').update({ email }).eq('id', id);
        if (error) throw error.code === '23505' ? new Error('Another student already has that email.') : error;
      }
      const sent = await sendInvite(email, s.first_name);
      must(await sb.from('students').update({ invited_at: new Date().toISOString() }).eq('id', id));
      flash(sent ? `Invite sent to ${email}.` : `${s.first_name} already has a password (from Top Out), so no email was sent: ${p.they} can sign in now. Let ${p.them} know ${p.their} plan is ready.`);
      adminStudent(id, e.target);
    });
  };

  app.onclick = async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act, g = s.goals.find(x => x.id === b.dataset.goal), cn = cnotes.find(x => x.id === b.dataset.cnote);
    if (cn) {
      if (act === 'cnote-edit') {
        const f = await ask({ title: 'Edit Notes', ok: 'Save Notes', body: `<div class="stack">
          <label>Notes${rich(`<textarea name="body" rows="6" maxlength="4000" data-grow required data-need="Write notes.">${esc(cn.body)}</textarea>`)}</label>
          ${cnoteDateField(cn.session_date || '')}</div>` });
        const body = f?.get('body').trim();
        if (body) busy(b, async () => {
          Object.assign(cn, await sb.from('coach_notes').update({ body, session_date: f.get('session_date') || null })
            .eq('id', cn.id).select().single().then(must));
          sortCoachNotes(cnotes);
          renderCoachNotes();
          flash('Note saved.');
        });
      } else if (act === 'cnote-delete') {
        if (await ask({ title: 'Delete This Note?', body: "<p>This can't be undone.</p>", ok: 'Delete', warn: true }))
          busy(b, async () => {
            must(await sb.from('coach_notes').delete().eq('id', cn.id));
            cnotes.splice(cnotes.indexOf(cn), 1);
            renderCoachNotes();
            flash('Note deleted.');
          });
      }
      return;
    }
    if (g) {
      if (act === 'goal-edit') {
        const f = await ask({ title: 'Edit Goal', ok: 'Save Goal',
          body: `<label>Goal<textarea name="body" rows="3" maxlength="500" required data-need="Write the goal.">${esc(g.body)}</textarea></label>` });
        const body = f?.get('body').trim();
        if (body) saveGoal(b, g, { body });
      } else if (act === 'goal-date') {
        const f = await ask({ title: 'Edit Date Achieved', ok: 'Save Date',
          body: `<label>Date Achieved<input type="date" name="day" value="${g.done_at}"
            max="${localToday()}" required data-need="Pick the day." data-high="Pick today or an earlier day."></label>` });
        const d = f?.get('day');
        if (d) saveGoal(b, g, { done_at: d }, 'Date saved.');
      } else if (act === 'goal-delete') {
        if (await ask({ title: 'Delete This Goal?', body: "<p>This can't be undone. To just hide it, keep it archived.</p>", ok: 'Delete', warn: true }))
          busy(b, async () => {
            must(await sb.from('goals').delete().eq('id', g.id));
            s.goals = s.goals.filter(x => x !== g);
            renderGoals();
          });
      } else {
        const status = { 'goal-achieved': 'achieved', 'goal-archive': 'archived', 'goal-current': 'current' }[act];
        saveGoal(b, g, { status, done_at: status === 'current' ? null : localToday() },
          { achieved: 'Goal marked achieved.', archived: 'Goal archived.', current: 'Goal is current again.' }[status]);
      }
      return;
    }
    // Ask before making the plan, so cancelling doesn't leave an empty one behind.
    if (b.dataset.act === 'new-plan' && await okToLeave()) busy(b, async () => {
      const p = await sb.from('plans').insert({ student_id: id, title: '', active: !s.plans.some(x => x.active) })
        .select('id').single().then(must);
      goTo('#/plan/' + p.id);
    });
    if (b.dataset.act === 'send-link') busy(b, async () => {
      const { error } = await sendLink(s.email);
      if (error) throw error;
      flash(`Link sent to ${s.email}.`);
    });
    if (b.dataset.act === 'del-student') {
      const n = s.plans.length;
      const ok = await ask({ title: `Delete ${s.name}?`, warn: true, ok: 'Delete Student',
        body: `<p>This deletes ${n ? `${p.their} ${n} plan${n > 1 ? 's' : ''}, all notes` : `${p.them} from your list`}
        and ${p.their} login. This can't be undone.</p>` });
      if (ok) busy(b, async () => {
        must(await sb.rpc('delete_student', { p_id: id }));
        flash(`${s.name} deleted.`);
        goTo('#/students');
      });
    }
  };
}
