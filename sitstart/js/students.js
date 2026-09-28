// ---------- Coach: students ----------

const accountStatus = s => s.user_id ? 'Active' : s.invited_at ? 'Invited' : 'Not Invited';

// One student note in a feed: who (on the Students list; left out on a student's own page), when, and its plan and week.
// The whole note is the link to its plan, opened at that session's notes (#/plan/<id>/<session id>), so it's easy to tap on a phone.
const noteFeedItem = (n, name) => `<a class="note-wrap note-link" href="#/plan/${n.session?.plan?.id}/${n.session_id}"><div class="note-meta">
    ${name ? `<strong>${esc(name)}</strong> · ` : ''}${fmtWhen(n.created_at)} ·
    <span class="note-plan">${esc(n.session?.plan?.title || 'Untitled Plan')}, ${n.session?.plan?.repeats
      ? esc(n.session?.title || 'Session') : `Week ${n.session?.week}`}</span></div>
    <p>${para(n.body)}</p></a>`;

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
  // The section says whose they are, or Inactive. Warn tags and Not Invited or Invited only on students you coach.
  const row = s => {
    const current = s.plans.filter(p => p.active).map(p => p.title || 'Untitled Plan').join(', '), mine = canCoach(s);
    return `<li><a class="item" href="#/student/${s.id}">
      <span><strong>${esc(s.name)}</strong>${pronounsTag(s.pronouns)}${isSelf(s) ? ' <span class="muted">(you)</span>' : ''}
        <span class="item-sub">${s.email ? esc(s.email) : 'No email yet'}${s.coach_id && s.coach_id !== me.staffId ? ` · Coached by ${esc(coachName(s.coach_id))}` : ''}</span></span>
      <span class="row"><span class="muted">${current ? esc(current) : 'No current plan'}</span>
      ${s.training_ended_at || !mine ? '' : `
      ${nextOverdue(s) ? '<span class="tag warn">Update Next Session</span>' : ''}
      ${s.user_id ? '' : `<span class="tag">${accountStatus(s)}</span>`}`}</span></a></li>`;
  };
  const active = students.filter(s => !s.training_ended_at), inactive = students.filter(s => s.training_ended_at);
  const mine = active.filter(s => s.coach_id && s.coach_id === me.staffId), none = active.filter(s => !s.coach_id),
    others = active.filter(s => s.coach_id && s.coach_id !== me.staffId);
  const section = (title, list, hint, empty, folded) => `<section class="card" data-fold="${title}"${folded ? ' data-fold-start' : ''}><h2>${title} (${list.length})</h2>
    <p class="hint">${hint}</p>
    ${list.length ? `<div class="list-head"><span>Student</span><span>Current Plan</span></div>
    <ul class="list">${list.map(row).join('')}</ul>` : `<p class="muted">${empty}</p>`}</section>`;
  // Notes from the students you coach (or who have no coach): the ones you reply to.
  const feed = recent.filter(n => n.session?.plan?.student && canCoach(n.session.plan.student)).slice(0, 8)
    .map(n => noteFeedItem(n, n.session.plan.student.name)).join('');

  view(`${crumbs([['Home', '#/'], ['Students']])}
  <h1>Students</h1>
  <div class="grid2" data-folds="students">
    <div>${students.length
      ? section('My Students', mine, 'Students you are coaching now. Only you change their plans, goals and sessions.', 'No students yet.')
        + (none.length ? section('No Coach', none, 'Active students with no coach. Any coach can change them until an admin picks their coach.', '') : '')
        + section("Other Coaches' Students", others, 'You can read their plans and goals, add Coach Notes and add past sessions you ran.', 'None right now.', true)
        + section('Inactive', inactive, 'Students no longer being coached. Resume Coaching on their page brings them back. You stay their coach only if you were when coaching ended; otherwise an admin picks one.', 'No inactive students.', true)
      : '<section class="card"><p class="muted">No students yet. Add your first one.</p></section>'}</div>
    <aside>
      <section class="card"><h2>Add a Student</h2>
        <p class="hint">You'll be their coach. Build their plan and add a goal first, then add their email and send the invite from their page.</p>
        <form id="addForm" class="stack" data-save>
          <label>First Name<input name="first_name" required data-need="Enter their first name." autocomplete="off"></label>
          <label>Last Name<input name="last_name" autocomplete="off"></label>
          ${pronounsField()}
          <button class="primary">+ Add Student</button>
        </form>
      </section>
      <section class="card feed"><h2>Latest Student Notes</h2>
        <p class="hint">The newest notes your students left on their sessions. Open one to reply in the plan.</p>
        ${feed || '<p class="muted">No notes yet.</p>'}</section>
    </aside>
  </div>`);

  $('#addForm').onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const first_name = f.get('first_name').trim(), last_name = f.get('last_name').trim(), pronouns = readPronouns(f);
    busy(e.submitter, async () => {
      const data = await sb.from('students').insert({ first_name, last_name, pronouns }).select('id').single().then(must);
      flash(`${first_name} added. Make ${pro(pronouns).their} plan, then send the invite when it's ready.`);
      goTo('#/student/' + data.id);
    });
  };
}
