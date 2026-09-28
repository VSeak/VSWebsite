// ---------- Notes (shared by the student's view and the coach's editor) ----------

// notesCtx.coach: posting as the student's coach (their plan editor); otherwise as the student.
// notesCtx.canPost: false for a coach reading another coach's student's plan.
function notesHTML(sid) {
  const list = notesCtx.notes.filter(n => n.session_id === sid);
  const canDelete = n => notesCtx.coach || (n.author_id === me.user.id && !n.from_coach);
  if (!notesCtx.canPost && !list.length) return '';
  return `<details class="notes" data-notes="${sid}" ${list.length ? 'open' : ''}>
    <summary>${list.length ? `Notes (${list.length})` : 'Add a Note'}</summary>
    ${list.map(n => `<div class="note${n.author_id === me.user.id ? ' mine' : ''}">
      <div class="note-meta"><strong>${n.from_coach ? esc(n.author_name || 'Coach') : esc(notesCtx.studentName)}</strong> · ${fmtWhen(n.created_at)}
      ${canDelete(n) ? ` · <button type="button" class="link" data-del-note="${n.id}">Delete</button>` : ''}</div>
      <p>${para(n.body)}</p></div>`).join('')}
    ${notesCtx.canPost ? `<form class="note-form" data-note-form="${sid}">
      <textarea name="body" rows="2" maxlength="4000" required data-need="Write your note first."
        placeholder="${notesCtx.coach ? 'Reply to your student…'
          : list.some(n => !n.from_coach) ? 'Any other thoughts?' : 'How did the session go? Any questions?'}"></textarea>
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
