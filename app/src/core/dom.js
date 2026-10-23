// ──────────────────────────────────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────────────────────────────────
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
// Double-click protection for every async button in the app (AUDIT.md,
// Sprint 2): when a click handler returns a promise the button is disabled
// and marked busy until it settles, so a second tap during a save / send /
// publish can't fire the request twice. Sync handlers are untouched.
const _withBusy = (node, fn) => function (ev) {
  if (node._busy) { ev.preventDefault(); ev.stopImmediatePropagation(); return; }
  let r;
  try { r = fn.call(this, ev); } catch (err) { throw err; }
  if (r && typeof r.then === 'function') {
    node._busy = true; const wasDisabled = node.disabled; node.disabled = true; node.setAttribute('aria-busy', 'true');
    const done = () => { node._busy = false; node.removeAttribute('aria-busy'); if (!wasDisabled && node.isConnected) node.disabled = false; };
    r.then(done, done);
  }
  return r;
};
const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'onclick' && typeof v === 'function' && (tag === 'button' || tag === 'a')) e.addEventListener('click', _withBusy(e, v));
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
};

const fmt = {
  usd:   n => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
  usd0:  n => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })),
  // Compact money for tight cells: $16.99M · $846.7K · $993 (per Isaac).
  usdShort: n => {
    if (n == null) return '—';
    const v = Number(n), a = Math.abs(v), sign = v < 0 ? '-' : '';
    if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(2) + 'M';
    if (a >= 1e4) return sign + '$' + (a / 1e3).toFixed(1) + 'K';
    return sign + '$' + a.toLocaleString('en-US', { maximumFractionDigits: 0 });
  },
  pct:   n => (n == null ? '—' : (Number(n) * 100).toFixed(2) + '%'),
  int:   n => (n == null ? '—' : Number(n).toLocaleString('en-US')),
  date:  s => (s ? new Date(s + 'T00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }) : '—'),
  dateShort: s => (s ? new Date(s + 'T00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) : '—'),
  // M/D/YY — same as dateShort but with a 2-digit year. Used in the Sales
  // table where year matters (sales can sit a quarter or two in flight).
  dateShortYear: s => (s ? new Date(s + 'T00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' }) : '—'),
  // Percent helpers where x is ALREADY a percentage (0–100), unlike fmt.pct.
  pct1:  x => (Number(x) || 0).toFixed(1) + '%',
  pct0:  x => (Number(x) || 0).toFixed(0) + '%',
  // "Sep 6" — accepts YYYY-MM-DD (local midnight) or a full ISO timestamp.
  dateMed: s => {
    if (!s) return '—';
    const d = typeof s === 'string' && s.length === 10 ? new Date(s + 'T00:00') : new Date(s);
    return isNaN(d) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  },
  // +$1,234 / −$1,234 (unicode minus). money=false → +1,234 / −1,234.
  signed: (n, money) => {
    const v = Number(n) || 0, a = Math.abs(v);
    const body = money ? '$' + a.toLocaleString('en-US', { maximumFractionDigits: 0 }) : a.toLocaleString('en-US');
    return (v < 0 ? '−' : '+') + body;
  },
};
fmt.usd2 = fmt.usd;

// Canonical empty-state card ("No data yet", "Admins only.", "Loading…").
function emptyCard(msg, extra) {
  return el('div', { class: 'card p-10 text-center text-sm text-muted-' }, msg, extra || null);
}

function toast(msg, type = 'info') {
  // Card-token skin (legacy bg-eerie3 / bg-lime palette retired).
  const colors = {
    info:    { background: 'var(--card-2)', color: 'var(--text)', borderColor: 'var(--border-2)' },
    success: { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' },
    error:   { background: '#DC2626', color: '#fff', borderColor: '#DC2626' },
    warn:    { background: '#A9441F', color: '#fff', borderColor: '#A9441F' },
  };
  const t = el('div', {
    class: 'pointer-events-auto fade-in rounded-xl border px-4 py-3 shadow-lg text-sm font-semibold',
    style: Object.assign({ maxWidth: 'min(360px, calc(100vw - 2rem))' }, colors[type] || colors.info),
  }, msg);
  $('#toasts').append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 3200);
  setTimeout(() => t.remove(), 3600);
}

