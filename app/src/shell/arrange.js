// ┌─ shell/arrange ──────────────────────────────────────────────────────────
// │ Drag to rearrange, everywhere (per Isaac, Nov 19 — "everything becomes
// │ click and draggable … a nice feature when I want to bump something up or
// │ down"). After every render, each group of sibling cards on the page gets
// │ the owner's saved order; for the OWNER only, every card shows a small grip
// │ on hover — drag it onto another card in the same group to move it there.
// │ The order is saved company-wide (adminRules.layout → app settings), so
// │ everyone who can see that page sees the owner's layout. Double-click a grip
// │ to put that page back to the built-in order.
// │
// │ How a card is recognised: a direct child of a container that has class
// │ "card", or data-section / data-arrange-id. Its id is data-arrange-id, else
// │ data-section, else its first heading's text (numbers stripped, so a title
// │ that carries a live count keeps its place). Cards without an id, or with an
// │ id repeated in the same group, simply stay where they render.
// │ Saved shape: { 'view:subtab': [id, id, …] } — one ranking per page; only
// │ the relative order of ids that share a container matters, so cards that
// │ appear conditionally never scramble the rest.
// └────────────────────────────────────────────────────────────────────────

function _arrPageKey() {
  const v = state.view || '';
  let sub = '';
  if (v === 'reporting') sub = state.reportingSubTab || 'overview';
  else if (v === 'admin') sub = state.adminSection || state.adminSect || '';
  else if (v === 'dashp' && typeof dashpStore === 'function') { try { sub = dashpStore().tab || ''; } catch (e) { sub = ''; } }
  return v + (sub ? ':' + sub : '');
}
function _arrLayout() { const r = typeof _adminRules === 'function' ? _adminRules() : null; return (r && r.layout && typeof r.layout === 'object') ? r.layout : {}; }
function _arrSave(pageKey, list) {
  const next = Object.assign({}, _arrLayout());
  if (list && list.length) next[pageKey] = list; else delete next[pageKey];
  if (typeof _setAdminRule === 'function') _setAdminRule('layout', next);
  try { if (typeof saveIndicatorConfigToSupabase === 'function') saveIndicatorConfigToSupabase().catch(() => {}); } catch (e) { /* saved locally; syncs next save */ }
}
function _arrClean(t) { return String(t || '').replace(/[0-9$%,.·:+\-−()]+/g, ' ').replace(/[▸▾⚑ⓘ↻⬇▼⋮]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 50); }
function _arrCardId(node) {
  if (node.dataset.arrangeId) return node.dataset.arrangeId;
  if (node.dataset.section) return 's:' + node.dataset.section;
  const h = node.querySelector('h1, h2, h3, h4');
  const ht = h ? _arrClean(h.textContent) : '';
  if (ht) return 'h:' + ht;
  // No heading (stat tiles): the first line of text that has words — the tile's label.
  const line = String(node.innerText || '').split('\n').map(_arrClean).find(x => /[a-z]{3,}/.test(x));
  return line && !/loading|downloading/.test(line) ? 't:' + line : null;
}
// A ROW = a wrapper whose element children are all cards (e.g. the Overview's three-card rows). Rows move as a unit
// among their sibling rows / cards, so "bump this section up" works on screens built from rows of tiles.
function _arrIsRow(node) {
  if (!node || node.nodeType !== 1 || node.classList.contains('card') || node.closest('table')) return false;
  const kids = [...node.children].filter(c => !c.classList.contains('arr-grip'));
  return kids.length >= 2 && kids.every(c => c.classList.contains('card') || !!c.dataset.section || !!c.dataset.arrangeId);
}
function _arrId(node) {
  if (!node || node.nodeType !== 1) return null;
  if (_arrIsRow(node)) { const ids = [...node.children].filter(c => !c.classList.contains('arr-grip')).map(_arrCardId).filter(Boolean).sort(); return ids.length ? 'r:' + ids.join('+').slice(0, 160) : null; }
  return _arrCardId(node);
}
function _arrIsBlock(node) {
  if (!node || node.nodeType !== 1 || node.classList.contains('no-arrange') || node.classList.contains('arr-grip')) return false;
  if (node.getAttribute('draggable') === 'true' && node.dataset.arrGrip !== '1') return false;   // has its own drag (Marketing tiles)
  return node.classList.contains('card') || !!node.dataset.section || !!node.dataset.arrangeId || _arrIsRow(node);
}
// The movable children of one container: [{ node, id }] in DOM order (ids unique within the container).
function _arrKids(parent) {
  const seen = new Map(), out = [];
  for (const c of parent.children) {
    if (!_arrIsBlock(c)) continue;
    const id = _arrId(c); if (!id) continue;
    seen.set(id, (seen.get(id) || 0) + 1); out.push({ node: c, id });
  }
  return out.filter(k => seen.get(k.id) === 1);
}
function _arrContainers(root) {
  const set = new Set();
  for (const n of root.querySelectorAll('.card, [data-section], [data-arrange-id]')) {
    const p = n.parentElement;
    if (!p || !root.contains(p) || p.closest('table, .no-arrange, [role="dialog"]')) continue;
    set.add(p);
    if (_arrIsRow(p) && p.parentElement && root.contains(p.parentElement)) set.add(p.parentElement);   // the rows' own container
  }
  return [...set].filter(p => _arrKids(p).length >= 2);
}
// Put one container's movable cards in the saved order: the slots the ranked cards occupy are refilled in rank order;
// unranked cards keep their slots.
function _arrApply(parent, rank) {
  const kids = _arrKids(parent).filter(k => rank.has(k.id));
  if (kids.length < 2) return;
  const want = kids.slice().sort((a, b) => rank.get(a.id) - rank.get(b.id));
  if (want.every((k, i) => k === kids[i])) return;
  const marks = kids.map(k => { const m = document.createComment('arr'); parent.replaceChild(m, k.node); return m; });
  marks.forEach((m, i) => parent.replaceChild(want[i].node, m));
}
let _arrDrag = null;
function _arrGrip(parent, kid, pageKey) {
  const node = kid.node;
  if (node.dataset.arrGrip === '1') return;
  node.dataset.arrGrip = '1';
  try { if (getComputedStyle(node).position === 'static') node.style.position = 'relative'; } catch (e) { /* layout not ready */ }
  const grip = document.createElement('button');
  grip.type = 'button';
  grip.className = 'arr-grip';
  grip.title = 'Drag to move this card (only you see this) · double-click to reset this page’s layout';
  grip.textContent = '⋮⋮';
  grip.addEventListener('mousedown', () => { node.draggable = true; });
  grip.addEventListener('mouseup', () => { node.draggable = false; });   // a click with no drag leaves the card selectable
  grip.addEventListener('touchstart', () => { node.draggable = true; }, { passive: true });
  grip.addEventListener('dblclick', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!window.confirm('Reset this page to the built-in card order for everyone?')) return;
    _arrSave(pageKey, null); if (typeof mountApp === 'function') mountApp();
  });
  grip.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
  node.prepend(grip);
  node.addEventListener('dragstart', (e) => {
    if (!node.draggable) return;
    e.stopPropagation();
    _arrDrag = { node, parent };
    node.classList.add('arr-dragging');
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', kid.id); } catch (x) { /* ok */ }
  });
  node.addEventListener('dragend', () => {
    node.draggable = false; node.classList.remove('arr-dragging');
    document.querySelectorAll('.arr-over-before, .arr-over-after').forEach(n => n.classList.remove('arr-over-before', 'arr-over-after'));
    _arrDrag = null;
  });
  const side = (e) => {
    const r = node.getBoundingClientRect();
    const sameRow = _arrDrag && Math.abs(_arrDrag.node.getBoundingClientRect().top - r.top) < 8;
    return sameRow ? (e.clientX < r.left + r.width / 2 ? 'before' : 'after') : (e.clientY < r.top + r.height / 2 ? 'before' : 'after');
  };
  node.addEventListener('dragover', (e) => {
    if (!_arrDrag || _arrDrag.parent !== parent || _arrDrag.node === node) return;
    e.preventDefault(); e.stopPropagation();
    const s = side(e);
    node.classList.toggle('arr-over-before', s === 'before'); node.classList.toggle('arr-over-after', s === 'after');
  });
  node.addEventListener('dragleave', () => node.classList.remove('arr-over-before', 'arr-over-after'));
  node.addEventListener('drop', (e) => {
    if (!_arrDrag || _arrDrag.parent !== parent || _arrDrag.node === node) return;
    e.preventDefault(); e.stopPropagation();
    const s = side(e), moving = _arrDrag.node;
    node.classList.remove('arr-over-before', 'arr-over-after');
    if (s === 'before') parent.insertBefore(moving, node); else parent.insertBefore(moving, node.nextSibling);
    // Save: this container's new order replaces these ids' place in the page ranking.
    const ids = _arrKids(parent).map(k => k.id), drop = new Set(ids);
    _arrSave(pageKey, [..._arrLayout()[pageKey] || []].filter(x => !drop.has(x)).concat(ids));
  });
}
function arrangeApply() {
  const root = document.querySelector('.content-wrap');
  if (!root) return;
  const pageKey = _arrPageKey();
  const saved = _arrLayout()[pageKey] || [];
  const rank = new Map(saved.map((id, i) => [id, i]));
  const owner = typeof isOwnerUser === 'function' && isOwnerUser();
  for (const p of _arrContainers(root)) {
    if (rank.size) _arrApply(p, rank);
    if (owner) for (const k of _arrKids(p)) _arrGrip(p, k, pageKey);
  }
}
// After every render (and once more for screens that finish building a beat later).
let _arrTimer = null;
function arrangeSchedule() {
  if (typeof document === 'undefined') return;
  requestAnimationFrame(() => { try { arrangeApply(); } catch (e) { console.warn('[ridd] arrange', e); } });
  clearTimeout(_arrTimer);
  _arrTimer = setTimeout(() => { try { arrangeApply(); } catch (e) { /* best effort */ } }, 600);
}
