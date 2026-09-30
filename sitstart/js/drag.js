// ---------- Drag to reorder ----------

// Press an item and drag it somewhere new: it lifts and follows the pointer, and a gap opens where it would land.
// Letting go calls drop(el, list, index), index counting the list's items without el. Esc puts it back; outside
// every list the gap stays where it last was. The page scrolls near the top and bottom of the screen.
// A mouse or pen starts dragging after a small move. Touch starts after a short hold (hold: true), so a swipe still
// scrolls, or after a small move on a handle made for dragging (touch-action: none in styles.css).
// opts: handle (selector), item(handle) → what moves, lists(el) → where it may go, items (selector for a list's
// children), end(list) → what the gap goes before at the end (or nothing), zone(list) → the area that counts as over
// that list, axis 'y' (a column) or 'x' (a row that wraps). True when the press was on a handle.
let dragging = false;
app.addEventListener('touchmove', e => { if (dragging) e.preventDefault(); }, { passive: false });

function dragSort(e, opts) {
  const h = e.target.closest(opts.handle);
  if (!h || e.button !== 0 || !e.isPrimary) return false;
  const el = opts.item(h), touch = e.pointerType === 'touch', x0 = e.clientX, y0 = e.clientY;
  let x = x0, y = y0, timer, gap, lists, off, frame;
  if (!touch) e.preventDefault();   // no text selection

  const kids = list => [...list.querySelectorAll(':scope > ' + opts.items)].filter(k => k !== el);
  const start = () => {
    clearTimeout(timer);
    dragging = true;
    const r = el.getBoundingClientRect();
    off = { x: x - r.left, y: y - r.top };
    gap = document.createElement(el.tagName === 'BUTTON' ? 'span' : 'div');
    gap.className = 'drag-gap';
    gap.style.height = r.height + 'px';
    if (opts.axis === 'x') gap.style.width = r.width + 'px';
    el.before(gap);
    Object.assign(el.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    el.classList.add('drag-lift');
    document.body.classList.add('dragging');
    lists = opts.lists(el);
    if (touch) navigator.vibrate?.(10);
    frame = requestAnimationFrame(tick);
  };
  // The gap goes before the first item the pointer is ahead of, in the list it's over.
  const place = () => {
    const list = lists.find(l => {
      const z = (opts.zone?.(l) || l).getBoundingClientRect();
      return x >= z.left && x <= z.right && y >= z.top && y <= z.bottom;
    });
    if (!list) return;
    const before = kids(list).find(k => {
      const r = k.getBoundingClientRect();
      return opts.axis === 'x' ? y < r.top || (y <= r.bottom && x < r.left + r.width / 2) : y < r.top + r.height / 2;
    });
    const anchor = before || opts.end?.(list) || null;
    let next = gap.nextElementSibling;
    if (next === el) next = next.nextElementSibling;
    if (gap.parentNode !== list || next !== anchor) list.insertBefore(gap, anchor);
  };
  const tick = () => {
    const edge = 70, dy = y < edge ? y - edge : y > innerHeight - edge ? y - innerHeight + edge : 0;
    if (dy) { window.scrollBy(0, Math.round(dy / 3)); place(); }
    frame = requestAnimationFrame(tick);
  };
  const move = ev => {
    if (ev.pointerId !== e.pointerId) return;
    x = ev.clientX; y = ev.clientY;
    if (dragging) {
      el.style.left = x - off.x + 'px';
      el.style.top = y - off.y + 'px';
      place();
    } else if (Math.hypot(x - x0, y - y0) > (touch ? 8 : 5)) {
      if (touch && opts.hold) finish(false);   // moved before the hold: a scroll
      else start();
    }
  };
  const up = ev => { if (ev.pointerId === e.pointerId) finish(true); };
  const cancel = ev => { if (ev.pointerId === e.pointerId) finish(false); };
  const key = ev => { if (ev.key === 'Escape') { ev.preventDefault(); finish(false); } };
  const menu = ev => ev.preventDefault();   // a long press opens no menu
  const swallow = ev => { ev.stopPropagation(); ev.preventDefault(); };

  function finish(ok) {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', cancel);
    removeEventListener('keydown', key);
    removeEventListener('contextmenu', menu);
    if (!dragging) return;
    dragging = false;
    const list = gap.parentNode;
    const index = kids(list).filter(k => gap.compareDocumentPosition(k) & Node.DOCUMENT_POSITION_PRECEDING).length;
    gap.remove();
    el.classList.remove('drag-lift');
    el.style.cssText = '';
    document.body.classList.remove('dragging');
    // The click that ends a drag isn't a tap.
    addEventListener('click', swallow, true);
    setTimeout(() => removeEventListener('click', swallow, true));
    if (ok) opts.drop(el, list, index);
  }

  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', cancel);
  addEventListener('keydown', key);
  addEventListener('contextmenu', menu);
  if (touch && opts.hold) timer = setTimeout(start, 300);
  return true;
}
