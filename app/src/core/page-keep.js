// ┌─ core/page-keep.js ───────────────────────────────────────────────────────
// │ The page you were on, back on screen the moment you refresh (per Isaac,
// │ Nov 25 2026: "every time I refresh the app, it refreshes everything all
// │ over again. We should be able to hold older loaded tables and pages").
// │
// │ A refresh used to mean several seconds of splash and half-built tables on
// │ every tab, every time, while the same data was read and added up again.
// │ Now:
// │   1. While you use the app, the page as it stands is kept in this browser
// │      (IndexedDB, one copy per tab / sub-tab, per signed-in user).
// │   2. On a refresh that copy is put on screen straight away, over the top,
// │      while the live app loads underneath. It scrolls; it does not click.
// │   3. When the live page has finished building, the copy is lifted and the
// │      live page is simply there, at the same scroll position. If nothing
// │      has synced since, the two are identical and nothing visibly changes.
// │ Nothing is computed from the kept copy: it is a picture of the last page,
// │ so a number can never be wrong for longer than the load it is covering.
// │ A refresh also returns to the same sub-tab (Reporting → Marketing → Budget,
// │ say) instead of the first one.
// │ Not kept: view-as sessions, the TV board, pages over the size cap, pages
// │ with a pop-up open. Copies are per user id and pruned to the newest 12.
// └──────────────────────────────────────────────────────────────────────────
const PK = window._pageKeep = { el: null, shownAt: 0, saveT: 0, poll: 0, lastSeq: -1, lastSeqAt: 0 };
const PK_WHERE = 'ridd_where_v1', PK_IDX = 'ridd_page_keep_idx', PK_MAX_CHARS = 3500000, PK_KEEP = 12;
// The sub-tab state that decides which page a refresh lands on.
const PK_STATE_KEYS = ['reportingSubTab', '_mktSub', 'adminSection', '_adminSubTab'];

function _pkOff() {
  try { if (typeof DEMO !== 'undefined' && DEMO) return true; } catch (e) { /* no demo flag */ }
  try { if (typeof viewAsRole === 'function' && (viewAsRole() || viewAsProfileId())) return true; } catch (e) { /* no view-as */ }
  try { if (localStorage.getItem('ridd_tv_board') === '1') return true; } catch (e) { /* private mode */ }
  return false;
}
function _pkUid() { try { return (state.session && state.session.user && state.session.user.id) || ''; } catch (e) { return ''; } }
function _pkKey() {
  const uid = _pkUid(); if (!uid || !state.view) return '';
  return 'keep:page:' + uid + ':' + [state.view].concat(PK_STATE_KEYS.map(k => state[k] == null ? '' : String(state[k]))).join('|');
}

// ── Where you were (sub-tabs), per browser tab ──
function pageKeepSaveWhere() {
  // Not before the boot has read the last spot back, or a signed-in profile exists: an early render (the splash, a
  // background refresh) would otherwise overwrite where you were with the defaults.
  if (!PK.whereReady || !state.profile) return;
  try { if (!state.view || _pkOff()) return; const o = { view: state.view }; for (const k of PK_STATE_KEYS) if (state[k] != null) o[k] = state[k]; sessionStorage.setItem(PK_WHERE, JSON.stringify(o)); } catch (e) { /* private mode */ }
}
function pageKeepRestoreWhere() {
  PK.whereReady = true;
  try {
    const o = JSON.parse(sessionStorage.getItem(PK_WHERE) || 'null');
    if (!o || o.view !== state.view) return;   // a link or another tab chose somewhere else — leave it
    for (const k of PK_STATE_KEYS) if (o[k] != null) state[k] = o[k];
  } catch (e) { /* private mode */ }
}

// ── Keep the page ──
function pageKeepAfterMount() {
  pageKeepSaveWhere();
  if (_pkOff() || !state.profile) return;
  clearTimeout(PK.saveT);
  PK.saveT = setTimeout(() => { const run = () => { try { _pkSave(); } catch (e) { /* best effort */ } }; if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 4000 }); else run(); }, 3500);
}
function _pkSave() {
  if (PK.el || _pkOff() || !state.profile || document.visibilityState === 'hidden') return;
  const root = document.getElementById('app'), key = _pkKey();
  if (!root || !key || !root.firstElementChild || document.querySelector('.modal-overlay') || document.getElementById('splashMark')) return;
  if (root.querySelector('.spinner')) return;   // still loading something — the next mount will try again
  const clone = root.cloneNode(true), src = root.querySelectorAll('canvas'), dst = clone.querySelectorAll('canvas');
  dst.forEach((c, i) => { try { const img = document.createElement('img'); img.src = src[i].toDataURL('image/png'); img.style.cssText = 'width:' + (src[i].clientWidth || 300) + 'px;height:' + (src[i].clientHeight || 150) + 'px;display:block'; c.replaceWith(img); } catch (e) { /* a canvas that cannot be read stays as a gap */ } });
  clone.querySelectorAll('script, .arr-grip').forEach(n => n.remove());
  // A copy does not carry what a box currently shows (only what it was built with), so write it in — passwords never.
  { const live = root.querySelectorAll('input, textarea, select'), cp = clone.querySelectorAll('input, textarea, select');
    cp.forEach((n, i) => { try { const L = live[i]; if (!L) return;
      if (n.tagName === 'INPUT') { if (n.type === 'password') { n.removeAttribute('value'); return; } if (n.type === 'checkbox' || n.type === 'radio') { if (L.checked) n.setAttribute('checked', ''); else n.removeAttribute('checked'); } else n.setAttribute('value', L.value); }
      else if (n.tagName === 'TEXTAREA') n.textContent = L.value;
      else if (n.tagName === 'SELECT') [...n.options].forEach((o, j) => { if (j === L.selectedIndex) o.setAttribute('selected', ''); else o.removeAttribute('selected'); });
    } catch (e) { /* skip that box */ } }); }
  const html = clone.innerHTML; if (!html || html.length > PK_MAX_CHARS) return;
  if (typeof reportingIdbPutKeep !== 'function') return;
  reportingIdbPutKeep(key, { html, at: Date.now(), y: window.scrollY || 0, theme: state.theme || '' });
  // Newest PK_KEEP copies stay; older ones go.
  try {
    let idx = JSON.parse(localStorage.getItem(PK_IDX) || '[]'); if (!Array.isArray(idx)) idx = [];
    idx = idx.filter(x => x && x.k !== key); idx.unshift({ k: key, at: Date.now() });
    const drop = idx.slice(PK_KEEP); idx = idx.slice(0, PK_KEEP);
    localStorage.setItem(PK_IDX, JSON.stringify(idx));
    if (drop.length) _pkDelete(drop.map(x => x.k));
  } catch (e) { /* private mode */ }
}
function _pkDelete(keys) {
  try { if (typeof _reportingIdb !== 'function') return; _reportingIdb().then(db => { const tx = db.transaction(REPORTING_IDB_STORE, 'readwrite'), st = tx.objectStore(REPORTING_IDB_STORE); keys.forEach(k => { try { st.delete(k); } catch (e) { /* gone */ } }); }).catch(() => {}); } catch (e) { /* best effort */ }
}

// ── Put it back on a refresh ──
async function pageKeepShow() {
  try {
    if (PK.el || _pkOff() || typeof reportingIdbGet !== 'function') return;
    const key = _pkKey(); if (!key) return;
    PK.curKey = key;
    const v = await reportingIdbGet(key);
    if (!v || !v.html || PK.el) return;
    if (state.profile && document.getElementById('app') && !document.getElementById('splashMark') && (window._riddSeq || 0) > 0 && !document.querySelector('#app .spinner')) return;   // the live page beat it
    // Scroll: where you actually left the page (noted as the tab closed or reloaded) beats where it was when the copy was taken.
    let y = Number(v.y) || 0;
    try { const r = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null'); if (r && r.view === state.view && Date.now() - (r.at || 0) < 10 * 60 * 1000 && r.scroll != null) y = Number(r.scroll) || 0; } catch (e) { /* keep the copy's own */ }
    _pkPut(v, y);
    state._resumeScroll = 0;   // the copy carries the scroll position; boot must not jump the window under it
  } catch (e) { /* no copy: the normal load shows */ }
}
function _pkPut(v, y) {
  const ov = document.createElement('div');
  ov.id = 'pageKeep';
  ov.style.cssText = 'position:fixed;inset:0;z-index:9000;overflow:auto;background:var(--bg);-webkit-overflow-scrolling:touch;';
  const inner = document.createElement('div');
  inner.style.cssText = 'min-height:100%;';
  inner.setAttribute('aria-hidden', 'true');
  inner.innerHTML = v.html;   // this browser's own earlier render of this page, for this user
  inner.querySelectorAll('input, textarea, select').forEach(n => { n.disabled = true; });   // nothing can be typed into a copy
  const pill = document.createElement('div');
  pill.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:9001;display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:rgba(29,29,29,.82);color:#fff;font:600 11px Archivo,system-ui,sans-serif;pointer-events:none;';
  pill.innerHTML = '<span class="spinner" style="width:12px;height:12px;border-color:#fff;border-top-color:transparent"></span><span>Checking for new data…</span>';
  ov.appendChild(inner); ov.appendChild(pill);
  ov.addEventListener('click', _pkClick, true);
  document.body.appendChild(ov);
  PK.el = ov; PK.pill = pill; PK.pending = null; PK.shownAt = Date.now(); PK.lastSeq = -1; PK.lastSeqAt = Date.now();
  try { ov.scrollTop = Number(y) || 0; } catch (e) { /* top is fine */ }
  clearInterval(PK.poll); PK.poll = setInterval(_pkTick, 250);
}
// A click on the copy (per Isaac, Nov 25 — "click from tab to tab quicker"). Nothing in a copy runs, but a click on a
// TAB or the top bar is passed to the same control on the live page as soon as it exists, so you can leave for another
// tab without waiting for this one to finish. A click anywhere else just lifts the copy if the live page is up.
function _pkClick(e) {
  try { e.preventDefault(); e.stopPropagation(); } catch (err) { /* fine */ }
  const ov = PK.el, inner = ov && ov.firstElementChild; if (!inner) return;
  const t = e.target && e.target.closest ? e.target.closest('button, a, [role="tab"]') : null;
  const nav = t && inner.contains(t) && t.closest('.rpt-subtabs, .sales-subtabs, .mktg-bar-tabs, .mktg-bar, header, nav');
  if (nav) {
    const text = _pkTxt(t);
    if (text) { const same = [...inner.querySelectorAll('button, a, [role="tab"]')].filter(x => _pkTxt(x) === text);
      PK.pending = { text, idx: Math.max(0, same.indexOf(t)) };
      try { if (PK.pill) PK.pill.lastChild.textContent = 'Opening ' + text.slice(0, 30) + '…'; } catch (err) { /* no pill */ } }
  }   // a click anywhere else does nothing: the copy stays until the live page is ready
  _pkTryPending();
}
// A control's words, without a count bubble riding on it ("Auditing 19" is still Auditing).
function _pkTxt(n) { return String((n && n.innerText) || '').replace(/\s*\d+\s*$/, '').trim(); }
function _pkBuilt() { const root = document.getElementById('app'); return !!state.profile && (window._riddSeq || 0) > 0 && !!root && !document.getElementById('splashMark'); }
function _pkTryPending() {
  const p = PK.pending; if (!p || !PK.el || !_pkBuilt()) return false;
  PK.pending = null;
  const root = document.getElementById('app');
  const live = [...root.querySelectorAll('button, a, [role="tab"]')].filter(x => _pkTxt(x) === p.text);
  const target = live[p.idx] || live[0];
  pageKeepDone();   // lift first, so the tab being opened can put up its own copy
  if (target) { try { target.click(); } catch (e) { /* the live page is there to click */ } }
  return true;
}
// Going to another tab (per Isaac, Nov 25): if that tab has a copy, it goes up first and the live page is built a
// moment later, behind it — building a page ties the browser up for seconds, and nothing can be drawn while it does.
// Only for a move the user just clicked, and only when a copy exists; every other render goes straight through.
function pageKeepNav() {
  try {
    if (PK.navBusy || _pkOff() || !state.profile || typeof reportingIdbGet !== 'function') return false;
    const key = _pkKey(); if (!key) return false;
    const prev = PK.curKey; PK.curKey = key;
    if (!prev || prev === key) return false;
    const ev = window.event; if (!ev || ev.type !== 'click') return false;
    let idx = []; try { idx = JSON.parse(localStorage.getItem(PK_IDX) || '[]'); } catch (e) { idx = []; }
    if (!Array.isArray(idx) || !idx.some(x => x && x.k === key)) return false;
    if (PK.el) pageKeepDone();   // a copy of the page being left
    PK.navBusy = true;
    const go = () => { if (!PK.navBusy) return; PK.navBusy = false; try { mountApp(); } catch (e) { console.warn('[page-keep] mount', e); } };
    const timer = setTimeout(go, 400);   // never hold a click longer than this for a copy
    reportingIdbGet(key).then(v => {
      if (!PK.navBusy) return;
      if (v && v.html && _pkKey() === key && !PK.el) { _pkPut(v, 0); try { window.scrollTo(0, 0); } catch (e) { /* fine */ } }
      clearTimeout(timer);
      // Two frames so the copy is actually on screen before the build starts.
      const raf = window.requestAnimationFrame || ((f) => setTimeout(f, 16));
      raf(() => raf(() => setTimeout(go, 0)));
    }).catch(() => { clearTimeout(timer); go(); });
    return true;
  } catch (e) { PK.navBusy = false; return false; }
}
// Lift the copy once the live page underneath has finished building.
function _pkTick() {
  if (!PK.el) { clearInterval(PK.poll); return; }
  const now = Date.now(), age = now - PK.shownAt, root = document.getElementById('app');
  const seq = window._riddSeq || 0;
  if (seq !== PK.lastSeq) { PK.lastSeq = seq; PK.lastSeqAt = now; }
  const authScreen = !!(root && root.querySelector('input[type="password"]'));
  const built = !!state.profile && seq > 0 && root && !document.getElementById('splashMark');
  const quiet = now - PK.lastSeqAt > 900 && !(root && root.querySelector('.spinner'));
  // Reporting pages are built from the FieldRoutes snapshot — wait for it to be in.
  const needSubs = state.view === 'reporting' && !['config', 'uploads', 'putis'].includes(state.reportingSubTab || '');
  const subsIn = !needSubs || (state.reportingSubscriptions || []).length > 0;
  if (PK.pending && _pkTryPending()) return;
  PK.dbg = { age, built, quietMs: now - PK.lastSeqAt, spin: root ? root.querySelectorAll('.spinner').length : -1, subsIn, seq };
  if (authScreen || age > 25000 || (built && quiet && subsIn)) pageKeepDone();
}
function pageKeepDone() {
  clearInterval(PK.poll);
  const ov = PK.el; if (!ov) return; PK.el = null;
  const y = ov.scrollTop || 0;
  try { ov.remove(); } catch (e) { /* already gone */ }
  try { window.scrollTo(0, y); } catch (e) { /* fine */ }
  if (typeof pageKeepAfterMount === 'function') pageKeepAfterMount();   // the live page becomes the next copy
}
