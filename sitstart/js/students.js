// ---------- Coach: students ----------

const accountStatus = s => s.user_id ? 'Active' : s.invited_at ? 'Invited' : 'Not Invited';

// One student note in a feed: who (on the Students list; left out on a student's own page), when, and its plan and week.
// The whole note is the link to its plan, opened at that session's notes (#/plan/<id>/<session id>), so it's easy to tap on a phone.
// It reads like a text message: a small line on top, then the note in a bubble.
const noteFeedItem = (n, name) => `<a class="note-link" href="#/plan/${n.session?.plan?.id}/${n.session_id}"><span class="note-meta">
    ${name ? `<strong>${esc(name)}</strong> · ` : ''}${fmtWhen(n.created_at)} ·
    <span class="note-plan">${esc(n.session?.plan?.title || 'Untitled Plan')}, ${n.session?.plan?.repeats
      ? esc(n.session?.title || 'Session') : `Week ${n.session?.week}`}</span></span>
    <span class="bub">${para(n.body)}</span></a>`;
// The student's initials, in a round badge.
const initials = name => esc((name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase());
// Short day for a chip: "Wed, Oct 1".
const shortDay = d => day(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
let studentsTab = 'mine';   // the Students list's tab, kept while you move around the site

async function adminStudents() {
  const t = ++navToken;
  view(loading);
  const [students, recent, coachList] = await Promise.all([
    sb.from('students').select(`id,name,pronouns,email,invited_at,user_id,coach_id,training_ended_at,${NEXT_COLS},plans(id,title,active)`).order('name').then(must),
    sb.from('notes').select('id,session_id,body,created_at,session:sessions(title,week,plan:plans(id,title,repeats,student:students(id,name,email,coach_id)))')
      .eq('from_coach', false).order('created_at', { ascending: false }).limit(40).then(must),
    sb.rpc('coach_list').then(must),
  ]);
  if (t !== navToken) return;
  const coachName = id => coachList.find(c => c.id === id)?.name || 'another coach';
  // A card per student: whose they are or Inactive comes from the tab. Warn chips and Not Invited or Invited only on
  // students you coach; a next session chip while one is coming up.
  const card = s => {
    const current = s.plans.filter(p => p.active).map(p => p.title || 'Untitled Plan').join(', '), mine = canCoach(s) && !s.training_ended_at;
    const chips = [
      mine && nextOverdue(s) && '<span class="chip warn">Update Next Session</span>',
      mine && !s.user_id && `<span class="chip${s.invited_at ? '' : ' warn'}">${accountStatus(s)}</span>`,
      mine && !current && '<span class="chip">Needs a Plan</span>',
      !s.training_ended_at && !nextPassed(s) && `<span class="chip ok">Next: ${esc(shortDay(s.next_date))}</span>`,
      s.coach_id && s.coach_id !== me.staffId && `<span class="chip">Coached by ${esc(coachName(s.coach_id))}</span>`,
    ].filter(Boolean).join('');
    return `<a class="person" href="#/student/${s.id}"><span class="ini">${initials(s.name)}</span>
      <span class="person-body"><b>${esc(s.name)}</b>${pronounsTag(s.pronouns)}${isSelf(s) ? ' <span class="muted">(you)</span>' : ''}
        <span class="person-sub${current ? '' : ' blank'}">${current ? esc(current) : 'No current plan'}</span>
        ${chips ? `<span class="chips">${chips}</span>` : ''}</span></a>`;
  };
  const active = students.filter(s => !s.training_ended_at);
  // Each tab: [label, its students, what it means, what it says when empty]. No Coach only shows when there are some.
  const tabs = {
    mine: ['Mine', active.filter(s => s.coach_id && s.coach_id === me.staffId),
      'Students you coach now. Only you change their plans, goals and sessions.', 'No students yet. Add your first one.'],
    none: ['No Coach', active.filter(s => !s.coach_id),
      'Active students with no coach. Any coach can change them until an admin picks their coach.', ''],
    others: ['Others', active.filter(s => s.coach_id && s.coach_id !== me.staffId),
      'Other coaches’ students. You can read their plans and goals, add Coach Notes and add past sessions you ran.', 'None right now.'],
    inactive: ['Inactive', students.filter(s => s.training_ended_at),
      'No longer being coached. Resume Coaching on their page brings them back. You stay their coach only if you were when coaching ended; otherwise an admin picks one.',
      'No inactive students.'],
  };
  if (!tabs.none[1].length) delete tabs.none;
  if (!tabs[studentsTab]) studentsTab = 'mine';
  // Notes from the students you coach (or who have no coach): the ones you reply to.
  const feed = recent.filter(n => n.session?.plan?.student && canCoach(n.session.plan.student)).slice(0, 8)
    .map(n => noteFeedItem(n, n.session.plan.student.name)).join('');
  const drawTab = () => {
    const [, list, hint, empty] = tabs[studentsTab];
    $('#tabHint').textContent = hint;
    $('#people').innerHTML = list.map(card).join('') || `<p class="muted">${empty}</p>`;
    app.querySelectorAll('#stuTabs [data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === studentsTab));
  };

  view(`${crumbs([['Home', '#/'], ['Students']])}
  <div class="page-head"><h1>Students</h1><button type="button" class="fill" id="addStudent">+ Add Student</button></div>
  <div class="grid2">
    <div class="stack">
      <div class="tabs" id="stuTabs" role="tablist" aria-label="Show">${Object.entries(tabs).map(([k, [label, list]]) =>
        `<button type="button" role="tab" data-tab="${k}">${label}<span class="count">${list.length}</span></button>`).join('')}</div>
      <p class="muted" id="tabHint" style="margin:0"></p>
      <div class="people" id="people"></div>
    </div>
    <aside>
      <section class="card feed"><h2>Latest Student Notes</h2>
        <p class="hint">Newest first, from students you coach. Tap one to reply in the plan.</p>
        ${feed || '<p class="muted">No notes yet.</p>'}</section>
    </aside>
  </div>`);
  drawTab();
  $('#stuTabs').onclick = e => {
    const b = e.target.closest('[data-tab]');
    if (b) { studentsTab = b.dataset.tab; drawTab(); }
  };

  $('#addStudent').onclick = async e => {
    const f = await ask({ title: 'Add a Student', ok: '+ Add Student', body: `<p class="hint">You'll be their coach. Build their plan and add a goal first,
      then add their email and send the invite from their page.</p>
      <div class="stack"><label>First Name<input name="first_name" required data-need="Enter their first name." autocomplete="off"></label>
      <label>Last Name<input name="last_name" autocomplete="off"></label>${pronounsField()}</div>` });
    if (!f) return;
    const first_name = f.get('first_name').trim(), last_name = f.get('last_name').trim(), pronouns = readPronouns(f);
    busy(e.target, async () => {
      const data = await sb.from('students').insert({ first_name, last_name, pronouns }).select('id').single().then(must);
      flash(`${first_name} added. Make ${pro(pronouns).their} plan, then send the invite when it's ready.`);
      goTo('#/student/' + data.id);
    });
  };
}
