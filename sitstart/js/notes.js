// ---------- Notes (shared by the student's view and the coach's editor) ----------

// A plan's notes, oldest first. Filtered through the session join so they load alongside the plan, not after it.
const planNotes = id => sb.from('notes').select('*, session:sessions!inner(plan_id)').eq('session.plan_id', id)
  .order('created_at').then(must);

// notesCtx.coach: posting as the student's coach (their plan editor); otherwise as the student.
// notesCtx.canPost: false for a coach reading another coach's student's plan.
function notesHTML(sid) {
  const list = notesCtx.notes.filter(n => n.session_id === sid);
  const canDelete = n => notesCtx.coach || (n.author_id === me.user.id && !n.from_coach);
  const mine = n => n.author_id === me.user.id;   // only the author edits a note
  if (!notesCtx.canPost && !list.length) return '';
  return `<details class="notes" data-notes="${sid}" ${list.length ? 'open' : ''}>
    <summary>${list.length ? `Notes (${list.length})` : 'Add a Note'}</summary>
    ${list.map(n => `<div class="note${mine(n) ? ' mine' : ''}">
      <div class="note-meta"><strong>${n.from_coach ? esc(n.author_name || 'Coach') : esc(notesCtx.studentName)}</strong> · ${fmtWhen(n.created_at)}${n.edited_at ? ' · Edited' : ''}
      ${mine(n) ? ` · <button type="button" class="link" data-edit-note="${n.id}">Edit</button>` : ''}
      ${canDelete(n) ? ` · <button type="button" class="link" data-del-note="${n.id}">Delete</button>` : ''}</div>
      <p>${para(n.body)}</p></div>`).join('')}
    ${notesCtx.canPost ? `<form class="note-form" data-note-form="${sid}">
      ${rich(`<textarea name="body" rows="2" maxlength="4000" data-grow required data-need="Write your note first."
        placeholder="${notesCtx.coach ? 'Reply to your student…'
          : list.some(n => !n.from_coach) ? 'Any other thoughts?' : 'How did the session go? Any questions?'}"></textarea>`)}
      <button class="small">+ Post Notes</button>
    </form>` : ''}
  </details>`;
}

function refreshNotes(sid) {
  const el = app.querySelector(`[data-notes="${sid}"]`);
  if (el) { el.outerHTML = notesHTML(sid); app.querySelector(`[data-notes="${sid}"]`).open = true; }
}

app.addEventListener('submit', e => {
  const f = e.target.closest('[data-note-form]');
  if (!f) return;
  e.preventDefault();
  const body = f.elements.body.value.trim();
  if (!body) return;
  busy(e.submitter, async () => {
    const n = await sb.from('notes').insert({ session_id: f.dataset.noteForm, body, from_coach: !!notesCtx.coach }).select().single().then(must);
    notesCtx.notes.push(n);
    refreshNotes(n.session_id);
  });
});

// Edit: the author's own note, in a dialog.
app.addEventListener('click', async e => {
  const b = e.target.closest('[data-edit-note]');
  if (!b) return;
  const n = notesCtx.notes.find(x => x.id === b.dataset.editNote);
  const f = await ask({ title: 'Edit Note', ok: 'Save Note',
    body: `<label>Note${rich(`<textarea name="body" rows="6" maxlength="4000" data-grow required data-need="Write your note.">${esc(n.body)}</textarea>`)}</label>` });
  const body = f?.get('body').trim();
  if (!body || body === n.body) return;
  busy(b, async () => {
    Object.assign(n, await sb.from('notes').update({ body }).eq('id', n.id).select().single().then(must));
    refreshNotes(n.session_id);
    flash('Note saved.');
  });
});

app.addEventListener('click', async e => {
  const b = e.target.closest('[data-del-note]');
  if (!b) return;
  if (!await ask({ title: 'Delete This Note?', body: "<p>This can't be undone.</p>", ok: 'Delete', warn: true })) return;
  const id = b.dataset.delNote, n = notesCtx.notes.find(x => x.id === id);
  busy(b, async () => {
    must(await sb.from('notes').delete().eq('id', id));
    notesCtx.notes = notesCtx.notes.filter(x => x.id !== id);
    refreshNotes(n.session_id);
  });
});
