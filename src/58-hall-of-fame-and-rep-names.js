// ┌─ src/58-hall-of-fame-and-rep-names.js ─────────────────────────────────────────────────────
// │ Hall of Fame + canonical rep-name cleaning / aliasing used by Indicators and comps.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
function viewHallOfFame() {
  // ACTIVE OFFICE STAFF only — this is the Inside Sales hall; D2D reps have
  // their own boards on Indicators/Competitions.
  const profiles = (state.allProfiles.length ? state.allProfiles : [state.profile])
    .filter(p => p && isSellerRole(p.role) && p.is_active !== false && isOfficeStaffProfile(p));
  const byRep = groupBy(dashboardSales(), s => s.rep_id);

  // Compute records for every rep + overall company records
  const repCards = profiles.map(p => {
    const records = computeRepRecords(p.id, byRep[p.id] || []);
    return { profile: p, ...records };
  });

  // All-time company best day/week/month
  const companyBest = {
    bestDay:   repCards.reduce((a, r) => r.bestDay.revenue   > (a?.revenue || 0) ? { rep: r.profile, ...r.bestDay }   : a, null),
    bestWeek:  repCards.reduce((a, r) => r.bestWeek.revenue  > (a?.revenue || 0) ? { rep: r.profile, ...r.bestWeek }  : a, null),
    bestMonth: repCards.reduce((a, r) => r.bestMonth.revenue > (a?.revenue || 0) ? { rep: r.profile, ...r.bestMonth } : a, null),
  };

  // ── DEPARTMENT RECORDS — best day / week / month of TOTAL production
  // per department (and the whole company), from the shared CRM dataset.
  // Etched in stone (per Isaac): the number to beat next. Live-computed,
  // so a record broken today shows the moment the sync lands.
  const deptRecords = (() => {
    const raw = state._indicatorRawSales || [];
    if (!raw.length || typeof _indicatorDeptOf !== 'function') return null;
    const GROUPS = [['all', '🏢 RIDD — Whole Company'], ['office', '☎️ Office Staff · new only'], ['d2d', '🚪 Sales Reps (D2D)'], ['techs', '🔧 Technicians']];
    const acc = {};
    GROUPS.forEach(([g]) => acc[g] = { day: {}, week: {}, month: {} });
    raw.forEach(s => {
      const iso = (typeof dateSoldToIso === 'function' && dateSoldToIso(s.dateSold)) || '';
      if (!iso) return;
      const cv = Number(s.contractValue) || 0;
      const d = new Date(iso + 'T00:00');
      if (isNaN(d)) return;
      const ws = new Date(d); ws.setDate(d.getDate() - d.getDay());
      const wk = ws.getFullYear() + '-' + String(ws.getMonth() + 1).padStart(2, '0') + '-' + String(ws.getDate()).padStart(2, '0');
      const mo = iso.slice(0, 7);
      const dept = _indicatorDeptOf(s);
      // Inside Sales records are NEW business only (per Isaac) — renewal
      // production (Renewal - Outbound / Inbound / Loyalty / Service Pro
      // Upsell) is a different motion and would drown the record board.
      // RIDD company-wide still counts everything.
      const isRen = (typeof _indicatorIsRenewal === 'function') && _indicatorIsRenewal(s);
      [dept, 'all'].forEach(g => {
        const a = acc[g]; if (!a) return;
        if (g === 'office' && isRen) return;
        a.day[iso] = (a.day[iso] || 0) + cv;
        a.week[wk] = (a.week[wk] || 0) + cv;
        a.month[mo] = (a.month[mo] || 0) + cv;
      });
    });
    const best = (obj) => { let k = null, v = 0; for (const kk in obj) if (obj[kk] > v) { v = obj[kk]; k = kk; } return k ? { k, v } : null; };
    return GROUPS.map(([g, label]) => ({ g, label, day: best(acc[g].day), week: best(acc[g].week), month: best(acc[g].month) }))
      .filter(r => r.day);
  })();
  const _todayIso2 = (typeof bizTodayIso === 'function') ? bizTodayIso() : new Date().toISOString().slice(0, 10);
  const _fmtRecDate = (kind, k) => {
    if (kind === 'month') { const [y, m] = k.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); }
    const d = new Date(k + 'T00:00');
    return (kind === 'week' ? 'Week of ' : '') + d.toLocaleDateString('en-US', { weekday: kind === 'day' ? 'short' : undefined, month: 'short', day: 'numeric', year: 'numeric' });
  };
  const _recFresh = (kind, k) => {
    if (kind === 'day') return k === _todayIso2;
    if (kind === 'month') return k === _todayIso2.slice(0, 7);
    const d = new Date(_todayIso2 + 'T00:00'); const ws = new Date(d); ws.setDate(d.getDate() - d.getDay());
    return k === ws.getFullYear() + '-' + String(ws.getMonth() + 1).padStart(2, '0') + '-' + String(ws.getDate()).padStart(2, '0');
  };
  const deptRecordRow = (label, kind, rec) => rec && el('div', { class: 'flex items-center justify-between gap-2 py-1.5 border-t border-' },
    el('div', {},
      el('div', { class: 'text-[9px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, label),
      el('div', { class: 'text-[10px] tabular-nums', style: { color: 'var(--text-muted)' } }, _fmtRecDate(kind, rec.k))),
    el('div', { class: 'text-right' },
      el('div', { class: 'text-base font-black tabular-nums' }, fmt.usd0(rec.v)),
      _recFresh(kind, rec.k) && el('div', { class: 'text-[9px] font-black uppercase tracking-widest', style: { color: 'var(--accent)' } }, '🔥 set ' + (kind === 'day' ? 'today' : 'this ' + kind))));

  return el('div', { class: 'flex flex-col gap-6 w-full' },
    el('div', {},
      el('h1', { class: 'text-3xl font-bold' }, 'Hall of Fame'),
    ),

    // ── Department records — total production, all-time in the dataset ──
    deptRecords && el('div', {},
      el('h2', { class: 'text-lg font-semibold mb-3' }, 'Department Records'),
      el('div', { class: 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3' },
        ...deptRecords.map(r => el('div', { class: 'card p-4' },
          el('div', { class: 'text-xs font-black mb-1' }, r.label),
          deptRecordRow('Best Day', 'day', r.day),
          deptRecordRow('Best Week', 'week', r.week),
          deptRecordRow('Best Month', 'month', r.month))))),

    // Company records podium
    companyBest.bestDay && el('div', {},
      el('h2', { class: 'text-lg font-semibold mb-3' }, 'Company Records'),
      el('div', { class: 'grid grid-cols-1 md:grid-cols-3 gap-3' },
        companyRecordCard('Best Day',   companyBest.bestDay,   'day'),
        companyRecordCard('Best Week',  companyBest.bestWeek,  'week'),
        companyRecordCard('Best Month', companyBest.bestMonth, 'month'),
      ),
    ),

    // Per-rep records
    el('div', {},
      el('h2', { class: 'text-lg font-semibold mb-3' }, 'Personal Bests'),
      el('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-3' },
        repCards
          .filter(r => r.bestDay.revenue > 0)
          .sort((a, b) => b.bestDay.revenue - a.bestDay.revenue)
          .map(r => el('div', { class: 'card p-5' },
            el('div', { class: 'flex items-center gap-3 mb-4' },
              avatarNode(r.profile.avatar_url, r.profile.initials, 'w-12 h-12 text-xs'),
              el('div', { class: 'flex-1' },
                el('div', { class: 'text-base font-bold' }, r.profile.full_name),
                el('div', { class: 'text-[10px] uppercase tracking-widest text-muted-' }, 'Personal bests'),
              ),
            ),
            el('div', { class: 'grid grid-cols-3 gap-3 text-center' },
              recordStat('Best Day',   r.bestDay.revenue,   r.bestDay.count,   r.bestDay.date),
              recordStat('Best Week',  r.bestWeek.revenue,  r.bestWeek.count,  r.bestWeek.weekStart),
              recordStat('Best Month', r.bestMonth.revenue, r.bestMonth.count, r.bestMonth.month),
            ),
          )),
      ),
      repCards.every(r => r.bestDay.revenue === 0) && el('div', { class: 'card p-8 text-center text-muted- text-sm' }, 'No records yet — start logging sales and the Hall of Fame will fill in.'),
    ),
  );
}

function companyRecordCard(title, rec, kind) {
  if (!rec || rec.revenue === 0) return el('div', { class: 'card p-5 text-center text-muted- text-sm' }, 'No record yet');
  const subtitle = kind === 'day' ? rec.date
    : kind === 'week' ? `Week of ${rec.weekStart}`
    : rec.month;
  return el('div', { class: 'card p-5' },
    el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold' }, title),
    el('div', { class: 'flex items-center gap-3 mt-3' },
      avatarNode(rec.rep?.avatar_url, rec.rep?.initials, 'w-10 h-10 text-xs'),
      el('div', { class: 'flex-1' },
        el('div', { class: 'text-sm font-semibold' }, rec.rep?.full_name || '—'),
        el('div', { class: 'text-[10px] text-muted-' }, subtitle),
      ),
    ),
    el('div', { class: 'mt-3 pt-3 border-t border-' },
      el('div', { class: 'text-2xl font-black tabular-nums', style: { color: 'var(--accent)' } }, fmt.usd0(rec.revenue)),
      el('div', { class: 'text-xs text-muted-' }, fmt.int(rec.count) + ' sales'),
    ),
  );
}

function recordStat(label, revenue, count, date) {
  return el('div', { class: 'card-2 rounded-lg p-3 border border-' },
    el('div', { class: 'text-[9px] uppercase tracking-widest text-muted- font-semibold' }, label),
    el('div', { class: 'text-base font-bold tabular-nums mt-1' }, revenue > 0 ? fmt.usd0(revenue) : '—'),
    el('div', { class: 'text-[10px] text-muted-' }, count > 0 ? fmt.int(count) + ' sales' : '\u00A0'),
  );
}

// ──────────────────────────────────────────────────────────────────────────
// VIEW: INDICATORS — D2D performance dashboard powered by CSV upload
// ──────────────────────────────────────────────────────────────────────────
// ── Branch alias resolver — ONE place where CRM branch names heal to a
// display identity (was copy-pasted regex in four code paths). Seeded with
// the Office 20 rename; admins can add future renames via the synced config
// (adminRules.branchAliases: { 'OFFICE 21': 'NASHVILLE' }) with no deploy.
const _BRANCH_ALIAS_SEED = [[/^office\s*20$/i, 'LITTLE ROCK']];
function branchAlias(name) {
  const n = String(name || '');
  const ar = (typeof _adminRules === 'function') ? _adminRules() : null;
  if (ar && ar.branchAliases && typeof ar.branchAliases === 'object') {
    const hit = ar.branchAliases[n] || ar.branchAliases[n.trim().toUpperCase()];
    if (hit) return hit;
  }
  for (const [re, to] of _BRANCH_ALIAS_SEED) if (re.test(n)) return to;
  return n;
}

const BRANCH_COLORS = {
  // Matches the RIDD Reporting workbook (IS sheet cell fills, extracted from
  // the xlsx itself — per Isaac, Jul 2026). Joplin/Little Rock aren't filled
  // in the workbook, so those two are matched to his screenshot by eye.
  'ATLANTA':        '#302CAE',
  'CHARLESTON':     '#416AA7',
  'DESTIN':         '#AD3CC4',
  'MYRTLE BEACH':   '#49AEAC',
  'RALEIGH':        '#A4C8DF',
  'SALT LAKE':      '#2A7727',
  'VIRGINIA BEACH': '#65EB4D',
  'DETROIT':        '#000000',
  'JOPLIN':         '#E5187D',
  'LITTLE ROCK':    '#8F1D2C',
};
// Company rollups — RPS = Detroit + Little Rock + Joplin; RPC = every other
// branch; RIDD = the sum of both (admin-only grouping on Indicators).
// Workbook rows: RPC light yellow-green, RPS orange-red (matched to the
// reporting sheet screenshot — tweak hexes here if the print looks off).
const COMPANY_COLORS = { 'RPS': '#D2451E', 'RPC': '#9BCB3C' };
const RPS_OFFICES_RE = /detroit|joplin|little\s*rock/i;
function companyGroupOf(office) {
  const o = String(office || '');
  const ar = (typeof _adminRules === 'function') ? _adminRules() : null;
  if (ar && ar.branchGroups && typeof ar.branchGroups === 'object') {
    const hit = ar.branchGroups[o] || ar.branchGroups[o.trim().toUpperCase()];
    if (hit === 'RPS' || hit === 'RPC') return hit;
  }
  return RPS_OFFICES_RE.test(o) ? 'RPS' : 'RPC';
}
// Readable text on any group color (SALT LAKE is near-white).
function groupHeaderTextColor(bg) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(bg || ''));
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  // Threshold 200 (was 175): Raleigh (#A4C8DF ≈ 192) and Virginia Beach
  // (#65EB4D ≈ 177) read fine with white text, and Isaac wants every
  // branch header white for consistency. Only a truly pale fill (near-
  // white) still flips to dark text.
  return lum > 200 ? '#323230' : '#fff';
}
const RIDD_COLOR = '#DF643A';
// Default palette for teams. Avoids red so excluded teams keep their distinct
// red tint. Teams without an explicit user-picked color are assigned one
// deterministically from this list (hash of team name → palette index) so the
// same team always renders in the same color across charts and tables.
// Curated to live alongside the RIDD lime accent (#DF643A) — mid-saturation
// mid-value hues that read as a coordinated brand-extended set rather than a
// rainbow. Lime sibling first so it ties back to the brand; reds avoided
// since red is reserved for excluded teams.
const TEAM_COLOR_PALETTE = [
  // Brand-derived (RPS Brand Guide): the four brand colours plus shades and
  // tints of them, so a dozen teams stay tellable apart without leaving the palette.
  '#DF643A', // brand orange
  '#5F6C5B', // brand sage
  '#323230', // brand charcoal
  '#9C3F1E', // dark orange
  '#3F4A3C', // deep sage
  '#A78256', // tan
  '#C8552E', // burnt orange
  '#8E9C8A', // light sage
  '#6B2A12', // rust
  '#7C857A', // sage-gray
  '#E8A06B', // apricot
  '#5A5A57', // warm gray
];
function _hashStr(s) {
  let h = 0; const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i) | 0;
  return Math.abs(h);
}
function defaultTeamColor(name) {
  return TEAM_COLOR_PALETTE[_hashStr(name) % TEAM_COLOR_PALETTE.length];
}
function getTeamColor(name) {
  if (!name) return '#666';
  const map = state._indicatorTeamColors || {};
  return map[name] || defaultTeamColor(name);
}
function setTeamColor(name, hex) {
  if (!name) return;
  if (!state._indicatorTeamColors) state._indicatorTeamColors = {};
  if (!hex) delete state._indicatorTeamColors[name];
  else      state._indicatorTeamColors[name] = hex;
  saveDemoData();
}

// Team logos — small (≤128px) JPEG data URLs stored alongside team colors.
// Render as <img> wherever a team name appears in a chip/row/legend.
function getTeamLogo(name) {
  if (!name) return '';
  return (state._indicatorTeamLogos || {})[name] || '';
}
function setTeamLogo(name, dataUrl) {
  if (!name) return;
  if (!state._indicatorTeamLogos) state._indicatorTeamLogos = {};
  if (!dataUrl) delete state._indicatorTeamLogos[name];
  else          state._indicatorTeamLogos[name] = dataUrl;
  saveDemoData();
}
// Render helper — small circular logo (or color-dot fallback) next to a
// team name. Pass `size` in px; defaults to 18px.
function teamLogoNode(name, size = 18) {
  const logo = getTeamLogo(name);
  const color = getTeamColor(name);
  const baseStyle = {
    width: size + 'px', height: size + 'px', borderRadius: '50%',
    flexShrink: '0', display: 'inline-block',
    border: '1px solid var(--border-2)',
  };
  if (logo) {
    return el('img', {
      src: logo, alt: name + ' logo', title: name,
      style: { ...baseStyle, objectFit: 'cover', background: '#fff' },
    });
  }
  return el('span', {
    title: name,
    style: { ...baseStyle, background: color },
  });
}

// Logo crop dialog — opens after the admin picks a file in Manage Teams.
// 280px circular viewport; drag the image to pan, slider to zoom (1×–3× over
// the cover-fit base scale). Save renders the visible square to a 128×128
// JPEG and persists via setTeamLogo. onDone() fires after Save so the
// caller (Manage Teams) can re-render with the new logo.
function openLogoCropper(file, teamName, onDone) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onerror = () => { URL.revokeObjectURL(url); toast('Could not read that image', 'error'); };
  img.onload = () => {
    const VIEWPORT = 280;   // on-screen crop window (px)
    const OUTPUT   = 128;   // saved logo size (px)
    // Base scale = "cover" — image always fills the viewport at zoom 1.
    const baseScale = Math.max(VIEWPORT / img.width, VIEWPORT / img.height);
    let scale = baseScale;
    let dx = (VIEWPORT - img.width  * scale) / 2;
    let dy = (VIEWPORT - img.height * scale) / 2;

    const imageNode = el('img', {
      src: url,
      draggable: false,
      style: {
        position: 'absolute', top: '0', left: '0',
        width: img.width + 'px', height: img.height + 'px',
        userSelect: 'none', pointerEvents: 'none',
        transformOrigin: 'top left', willChange: 'transform',
      },
    });

    const apply = () => {
      // Clamp pan so the image always covers the viewport — no transparent
      // gaps at the edge regardless of zoom.
      const minDx = VIEWPORT - img.width  * scale;
      const minDy = VIEWPORT - img.height * scale;
      dx = Math.min(0, Math.max(minDx, dx));
      dy = Math.min(0, Math.max(minDy, dy));
      imageNode.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) scale(' + scale + ')';
    };

    const viewport = el('div', {
      style: {
        position: 'relative', overflow: 'hidden',
        width: VIEWPORT + 'px', height: VIEWPORT + 'px',
        borderRadius: '50%', background: '#000',
        cursor: 'grab', touchAction: 'none',
        margin: '0 auto',
        boxShadow: '0 0 0 4px var(--border-2)',
      },
    }, imageNode);

    // Pointer-event drag (mouse + touch + pen all unified)
    let dragging = false, lastX = 0, lastY = 0;
    viewport.addEventListener('pointerdown', (e) => {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      viewport.setPointerCapture(e.pointerId);
      viewport.style.cursor = 'grabbing';
    });
    viewport.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      dx += e.clientX - lastX; dy += e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      apply();
    });
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      try { viewport.releasePointerCapture(e.pointerId); } catch {}
      viewport.style.cursor = 'grab';
    };
    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);

    const zoomSlider = el('input', {
      type: 'range', min: '1', max: '3', step: '0.01', value: '1',
      class: 'flex-1', style: { accentColor: 'var(--accent)' },
      oninput: (e) => {
        const z = parseFloat(e.target.value);
        // Keep the point under viewport-center stationary while zooming.
        const cx = VIEWPORT / 2, cy = VIEWPORT / 2;
        const imgX = (cx - dx) / scale, imgY = (cy - dy) / scale;
        scale = baseScale * z;
        dx = cx - imgX * scale; dy = cy - imgY * scale;
        apply();
      },
    });

    const overlay = el('div', { class: 'modal-overlay' });
    const cleanup = () => { URL.revokeObjectURL(url); overlay.remove(); };
    overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(); });

    const save = () => {
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT; canvas.height = OUTPUT;
      const ctx = canvas.getContext('2d');
      // Source rect (in image-pixel coords) = the slice currently visible
      // in the viewport, derived by inverting the on-screen transform.
      const srcX = -dx / scale, srcY = -dy / scale;
      const srcSize = VIEWPORT / scale;
      ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, OUTPUT, OUTPUT);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      setTeamLogo(teamName, dataUrl);
      cleanup();
      onDone && onDone();
    };

    const card = el('div', {
      class: 'card w-full max-w-md my-8 p-5 flex flex-col gap-4',
      style: { maxHeight: 'calc(100vh - 64px)', overflowY: 'auto' },
    },
      el('div', { class: 'flex items-center justify-between' },
        el('h3', { class: 'text-base font-bold' }, 'Crop logo · ' + teamName),
        el('button', { class: 'text-2xl text-muted- cursor-pointer', onclick: cleanup }, '×'),
      ),
      el('div', { class: 'text-xs text-muted-' }, 'Drag to reposition · use the slider to zoom in or out · click ', el('strong', {}, 'Save'), ' to apply.'),
      viewport,
      el('div', { class: 'flex items-center gap-3 text-sm text-muted-' },
        el('span', {}, '−'),
        zoomSlider,
        el('span', {}, '+'),
      ),
      el('div', { class: 'flex items-center justify-end gap-2 pt-2 border-t', style: { borderColor: 'var(--border)' } },
        el('button', {
          class: 'rounded-lg border px-2.5 py-1 text-[11px]',
          style: { borderColor: 'var(--border-2)' },
          onclick: cleanup,
        }, 'Cancel'),
        el('button', {
          class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold',
          style: { background: 'var(--accent)', color: 'var(--accent-text)' },
          onclick: save,
        }, 'Save'),
      ),
    );

    overlay.append(card);
    document.body.append(overlay);
    apply();
  };
  img.src = url;
}

// Raffle spin wheel — picks a weighted-random winner from the D2D comp's
// raffle entries. Each ticket is one entry, so reps with more tickets are
// proportionally more likely to win. Caller passes the same raffleSorted
// array the table renders from, so winners always match what the admin
// sees on screen.
function openRaffleSpinModal(raffleSorted, totalTickets, windowLabel) {
  if (!raffleSorted || raffleSorted.length === 0) {
    toast('No raffle entries to spin', 'warn');
    return;
  }

  // Wheel is intentionally compact so the entire modal (header + wheel +
  // pointer + button + result line) fits inside a typical laptop viewport
  // without scrolling — which was causing a flashing scrollbar during the
  // spin transition before.
  const SIZE = 320;
  const cx = SIZE / 2, cy = SIZE / 2, R = SIZE / 2 - 6;

  // Cycle through a small palette so adjacent wedges visually separate.
  // Reps' actual team color isn't used because nearby wedges would blur
  // together if they share a team.
  const COLORS = ['#DF643A', '#5F6C5B', '#323230', '#A78256', '#9C3F1E', '#8E9C8A', '#FFB899', '#C9B98A', '#3F4A3C', '#E8A06B', '#7C857A', '#6B2A12'];

  // Precompute each wedge's angular boundaries + midpoint. Angles are in
  // radians on the canvas's coordinate system (0 = 3 o'clock, +y = down).
  // We start at -π/2 so the first wedge begins at 12 o'clock (under the
  // pointer).
  const TWO_PI = Math.PI * 2;
  let cum = 0;
  const segments = raffleSorted.map((rep, i) => {
    const fraction = rep.total / totalTickets;
    const startAngle = cum * TWO_PI - Math.PI / 2;
    cum += fraction;
    const endAngle = cum * TWO_PI - Math.PI / 2;
    const midAngle = (startAngle + endAngle) / 2;
    return { rep, fraction, startAngle, endAngle, midAngle, color: COLORS[i % COLORS.length] };
  });

  const canvas = el('canvas', {
    width: SIZE, height: SIZE,
    style: {
      display: 'block',
      width: SIZE + 'px', height: SIZE + 'px',
      willChange: 'transform',
      // Cubic-bezier picked so the wheel spins fast then eases out slow —
      // gives a satisfying decel that takes 5 seconds total.
      transition: 'transform 5s cubic-bezier(0.17, 0.67, 0.12, 0.99)',
    },
  });
  const ctx = canvas.getContext('2d');

  segments.forEach(seg => {
    // Wedge fill
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, seg.startAngle, seg.endAngle);
    ctx.closePath();
    ctx.fillStyle = seg.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Label — only when the wedge is wide enough (>2.5% of the wheel)
    // to fit a first name + ticket count without clipping.
    if (seg.fraction > 0.025) {
      const labelR = R * 0.7;
      const x = cx + Math.cos(seg.midAngle) * labelR;
      const y = cy + Math.sin(seg.midAngle) * labelR;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(seg.midAngle + Math.PI / 2);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 10px -apple-system, system-ui, sans-serif';
      const firstName = (seg.rep.name.split(' ')[0] || '').slice(0, 12);
      ctx.fillText(firstName, 0, -5);
      ctx.font = '9px -apple-system, system-ui, sans-serif';
      ctx.fillText(seg.rep.total + 't', 0, 6);
      ctx.restore();
    }
  });

  // Center hub is rendered as a separate DOM element below — kept off the
  // canvas so the RIDD wordmark stays upright while the wheel spins around
  // it. (If we drew the logo on the canvas, it would tumble with the wheel.)

  // Fixed pointer at the top (does not rotate with the wheel).
  const pointer = el('div', {
    style: {
      position: 'absolute', top: '-6px', left: '50%', transform: 'translateX(-50%)',
      width: '0', height: '0',
      borderLeft: '14px solid transparent',
      borderRight: '14px solid transparent',
      borderTop: '26px solid #DC2626',
      zIndex: '3',
      filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))',
    },
  });

  // RIDD wordmark on the hub. Lives outside the rotating canvas so it
  // stays upright the whole spin — the wedges flow around a fixed center.
  // Admin can upload a custom logo (synced through app_settings via
  // saveCompanyLogo) so the brand wordmark renders 1:1 instead of
  // relying on a system font that doesn't match RIDD's actual mark.
  const HUB_W = 110, HUB_H = 80;  // rounded-rect so a wide wordmark fits
  // Hub doubles as the Spin button — click the logo in the middle of the
  // wheel to trigger / re-trigger the spin. Pointer-events stays on so the
  // click registers; the wedge hover tooltip on wheelWrap ignores any
  // mousemove inside the hub rectangle (see findSegmentAt).
  const centerHub = el('div', {
    style: {
      position: 'absolute', top: '50%', left: '50%',
      transform: 'translate(-50%, -50%)',
      width: HUB_W + 'px', height: HUB_H + 'px',
      borderRadius: '0',
      background: '#323230',
      border: '3px solid #fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#DF643A',
      fontWeight: '900', fontSize: '18px',
      letterSpacing: '0.5px',
      zIndex: '2',
      cursor: 'pointer',
      boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
      overflow: 'hidden',
      padding: '8px',
      transition: 'transform .15s ease-out, box-shadow .15s ease-out',
      // The CSS transform "scale" applies on top of the centering translate
      // so we always include both in the rule; hover handlers below tweak it.
    },
    title: 'Click to spin',
    onclick: () => { if (!spinning) spin(); },
  });
  // Subtle "this is clickable" feedback. Skipped while spinning so the
  // button doesn't visually pulse during the 5-second decel.
  centerHub.addEventListener('mouseenter', () => {
    if (spinning) return;
    centerHub.style.transform = 'translate(-50%, -50%) scale(1.07)';
    centerHub.style.boxShadow = '0 8px 22px rgba(223,100,58,0.45)';
  });
  centerHub.addEventListener('mouseleave', () => {
    centerHub.style.transform = 'translate(-50%, -50%) scale(1)';
    centerHub.style.boxShadow = '0 4px 12px rgba(0,0,0,0.35)';
  });
  const renderHub = () => {
    centerHub.innerHTML = '';
    const logoNow = state.companyLogo || '';
    if (logoNow) {
      centerHub.append(el('img', {
        src: logoNow, alt: 'RIDD',
        style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' },
      }));
    } else {
      centerHub.textContent = 'RIDD';
    }
  };
  renderHub();

  // Floating hover tooltip — shows the rep's name + tickets + odds + team
  // when the cursor is over their wedge. Anchored to wheelWrap so position
  // math stays in wrap-local coordinates regardless of canvas rotation.
  const tooltip = el('div', {
    style: {
      position: 'absolute', display: 'none',
      pointerEvents: 'none',
      background: '#323230', color: '#fff',
      padding: '8px 12px', borderRadius: '0',
      fontSize: '11px', fontWeight: '500',
      zIndex: '4',
      boxShadow: '0 6px 18px rgba(0,0,0,0.5)',
      whiteSpace: 'nowrap',
      maxWidth: '220px',
    },
  });

  const wheelWrap = el('div', {
    style: {
      position: 'relative',
      width: SIZE + 'px', height: SIZE + 'px',
      margin: '0 auto',
      overflow: 'visible',
    },
  }, pointer, canvas, centerHub, tooltip);

  // Hit-test the wheel — given an (mx, my) relative to wheelWrap, return
  // the segment under the cursor (or null if outside the wedge band).
  // Accounts for the canvas's current CSS rotation by subtracting it from
  // the cursor angle before scanning segments. The hub is now a rounded
  // rectangle, so the inner exclusion is a rect test, not a radius.
  const findSegmentAt = (mx, my) => {
    const dx = mx - cx, dy = my - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > R) return null;
    // Inside the central hub rectangle? Suppress tooltip there.
    if (Math.abs(dx) < HUB_W / 2 + 4 && Math.abs(dy) < HUB_H / 2 + 4) return null;
    let worldAngle = Math.atan2(dy, dx) - (currentRotation || 0);
    // Normalize to the segment range [-π/2, 3π/2)
    const lo = -Math.PI / 2;
    while (worldAngle <  lo)            worldAngle += TWO_PI;
    while (worldAngle >= lo + TWO_PI)   worldAngle -= TWO_PI;
    for (const seg of segments) {
      if (worldAngle >= seg.startAngle && worldAngle < seg.endAngle) return seg;
    }
    return null;
  };

  wheelWrap.addEventListener('mousemove', (e) => {
    // Don't fight with the spin animation — also avoids the angle math
    // doing anything dodgy while currentRotation is mid-transition.
    if (spinning) { tooltip.style.display = 'none'; return; }
    const rect = wheelWrap.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const seg = findSegmentAt(mx, my);
    if (!seg) { tooltip.style.display = 'none'; return; }
    const team = getRepTeam(seg.rep.name);
    tooltip.innerHTML = '';
    tooltip.append(
      el('div', { style: { fontWeight: '800', fontSize: '12px', color: '#DF643A' } }, seg.rep.name),
      el('div', { style: { marginTop: '3px', fontVariantNumeric: 'tabular-nums' } },
        fmt.int(seg.rep.total) + ' tickets · ' + (seg.fraction * 100).toFixed(1) + '% chance'),
      team && el('div', { style: { marginTop: '2px', color: 'rgba(255,255,255,.6)' } }, team),
    );
    // Default position: bottom-right of cursor. Flip to the left edge if
    // it would otherwise overflow the wheelWrap on the right.
    const TIP_OFFSET = 14;
    tooltip.style.display = 'block';
    const tipW = tooltip.offsetWidth || 160;
    const tipH = tooltip.offsetHeight || 60;
    let tx = mx + TIP_OFFSET;
    let ty = my + TIP_OFFSET;
    if (tx + tipW > SIZE) tx = mx - tipW - TIP_OFFSET;
    if (ty + tipH > SIZE) ty = my - tipH - TIP_OFFSET;
    tooltip.style.left = Math.max(0, tx) + 'px';
    tooltip.style.top  = Math.max(0, ty) + 'px';
  });
  wheelWrap.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });

  // Where the winner announcement lands after the spin completes. No
  // minHeight here — empty area would push the modal taller than necessary
  // and could nudge it past viewport height, triggering a scrollbar.
  const resultArea = el('div', {
    class: 'text-center',
    style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
  });

  let spinning = false;
  let currentRotation = 0;  // radians, accumulated across spins

  const spin = () => {
    if (spinning) return;
    spinning = true;
    // The hub is the button now — dim it + lock the cursor while the
    // wheel is decelerating so a click during the animation is ignored
    // visually as well as logically. Reset any hover scale/shadow so
    // the hub doesn't sit at 1.07× while it's supposed to look dimmed.
    centerHub.style.cursor = 'not-allowed';
    centerHub.style.opacity = '.7';
    centerHub.style.transform = 'translate(-50%, -50%) scale(1)';
    centerHub.style.boxShadow = '0 4px 12px rgba(0,0,0,0.35)';
    centerHub.title = 'Spinning…';
    resultArea.innerHTML = '';

    // Weighted-random winner. Each ticket = one entry, so probability is
    // proportional to ticket count.
    let pick = Math.random() * totalTickets;
    let winner = segments[0];
    let acc = 0;
    for (const seg of segments) {
      acc += seg.fraction * totalTickets;
      if (pick < acc) { winner = seg; break; }
    }

    // Math: after rotation r is applied, a wedge at original angle S sits
    // at (S + r). We want winner.midAngle + r === -π/2 (mod 2π), i.e.
    // r ≡ -π/2 − winner.midAngle. Start from currentRotation, add several
    // full spins for drama, then nudge to land on the winner.
    const targetMod = ((-Math.PI / 2 - winner.midAngle) % TWO_PI + TWO_PI) % TWO_PI;
    const currentMod = ((currentRotation % TWO_PI) + TWO_PI) % TWO_PI;
    let delta = targetMod - currentMod;
    if (delta <= 0) delta += TWO_PI;
    const extraSpins = 6;  // 6 full rotations of suspense
    currentRotation += delta + extraSpins * TWO_PI;

    const deg = (currentRotation * 180) / Math.PI;
    canvas.style.transform = 'rotate(' + deg + 'deg)';

    // Show the winner just after the transition wraps up.
    setTimeout(() => {
      resultArea.innerHTML = '';
      const winnerTeam = getRepTeam(winner.rep.name);
      resultArea.append(
        el('div', { class: 'text-xs uppercase tracking-widest font-bold mb-1', style: { color: 'var(--text-muted)' } }, '🎉 Winner'),
        el('div', { class: 'text-2xl font-black', style: { color: 'var(--accent)' } }, winner.rep.name),
        el('div', { class: 'text-xs mt-1', style: { color: 'var(--text-muted)' } },
          fmt.int(winner.rep.total) + ' tickets · ' + (winner.fraction * 100).toFixed(1) + '% chance' +
          (winnerTeam ? ' · ' + winnerTeam : '')),
      );
      spinning = false;
      centerHub.style.cursor = 'pointer';
      centerHub.style.opacity = '1';
      centerHub.title = 'Click to spin again';
    }, 5100);
  };

  // (Separate Spin button removed — the centerHub above doubles as the
  // button. Spinning state is reflected by dimming the hub during the
  // animation; see spin() + the setTimeout result block.)

  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  // (Logo upload UI removed once the company logo was set — re-add a
  // hidden file input + small upload button here if you need to swap it.)

  const card = el('div', {
    class: 'card w-full max-w-md my-4 p-5 flex flex-col gap-3',
    // overflow:hidden (not auto) — we sized the wheel + content to fit
    // inside the viewport, so we'd rather clip than reveal a scrollbar
    // that flashes during the 5-second spin transition.
    style: { maxHeight: 'calc(100vh - 32px)', overflow: 'hidden' },
  },
    el('div', { class: 'flex items-center justify-between' },
      el('h3', { class: 'text-base font-bold' }, '🎟️ Raffle Spin'),
      el('button', { class: 'text-2xl cursor-pointer', style: { color: 'var(--text-muted)' }, onclick: close }, '×'),
    ),
    el('div', { class: 'text-xs text-center', style: { color: 'var(--text-muted)' } },
      fmt.int(totalTickets) + ' tickets · ' + raffleSorted.length + ' rep' + (raffleSorted.length === 1 ? '' : 's') +
      (windowLabel ? ' · ' + windowLabel : '') + ' · click the RIDD logo to spin'),
    wheelWrap,
    resultArea,
  );

  overlay.append(card);
  document.body.append(overlay);
}

// Resolve the color for a group key (branch name or team name) based on the
// current Indicators groupBy mode. Used everywhere a chart/table colors a
// row by its group identity so branch and team views stay symmetrical.
function getGroupColor(name) {
  if (!name) return '#666';
  if (state.indicatorsGroupBy === 'teams') return getTeamColor(name);
  if (state.indicatorsGroupBy === 'dept') {
    return ({ 'SALES REP': '#DF643A', 'OFFICE STAFF': '#5F6C5B', 'TECHNICIAN': '#A9441F' })[String(name).toUpperCase()] || '#666';
  }
  if (state.indicatorsGroupBy === 'company') return COMPANY_COLORS[String(name).toUpperCase()] || '#666';
  const up = String(name).toUpperCase();
  const ar = (typeof _adminRules === 'function') ? _adminRules() : null;
  if (ar && ar.branchColors && (ar.branchColors[name] || ar.branchColors[up])) return ar.branchColors[name] || ar.branchColors[up];
  if (BRANCH_COLORS[name] || BRANCH_COLORS[up]) return BRANCH_COLORS[name] || BRANCH_COLORS[up];
  // New branch, no config yet: deterministic hue from the name — distinct,
  // stable across devices, never the "broken gray".
  let h = 0; for (let i = 0; i < up.length; i++) h = (h * 31 + up.charCodeAt(i)) >>> 0;
  return 'hsl(' + (h % 360) + ', 55%, 45%)';
}
// Date-range presets for the Indicators view. Presets are anchored to the
// system clock (today/this year). "This Year" is the default since most
// reporting cuts the year as the baseline window.
const INDICATOR_RANGE_PRESETS = [
  { id: 'this_week',   label: 'This Week' },
  { id: 'last_week',   label: 'Last Week' },
  { id: 'this_month',  label: 'This Month' },
  { id: 'last_month',  label: 'Last Month' },
  { id: 'this_year',   label: 'This Year' },
  { id: 'last_year',   label: 'Last Year' },
  { id: 'all_time',    label: 'All Time' },
  { id: 'custom',      label: 'Custom…' },
];

// Label for any preset id, including dynamic per-year ids ('year:2024').
function indicatorPresetLabel(id) {
  const m = /^year:(\d{4})$/.exec(id || '');
  if (m) return m[1];
  return (INDICATOR_RANGE_PRESETS.find(p => p.id === id) || {}).label || 'Range';
}

// Distinct years present in the uploaded raw sales, older than last year
// (This Year / Last Year presets already cover the recent two), newest first.
function indicatorDataYears() {
  const ys = new Set();
  for (const s of (state._indicatorRawSales || [])) {
    const d = s && s.date ? new Date(s.date) : null;
    if (d && !isNaN(d)) ys.add(d.getFullYear());
  }
  const cur = new Date().getFullYear();
  return [...ys].filter(y => y < cur - 1 && y > 2000).sort((a, b) => b - a);
}

// Static presets + a per-year option for every older year in the data,
// inserted just before Custom.
function indicatorPresetOptions() {
  const base = INDICATOR_RANGE_PRESETS.slice();
  const years = indicatorDataYears().map(y => ({ id: 'year:' + y, label: String(y) }));
  base.splice(base.findIndex(p => p.id === 'custom'), 0, ...years);
  return base;
}

function indicatorRangeBounds(preset, custom) {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const iso = (d) => d.toISOString().slice(0, 10);
  const startOfWeek = (d) => { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); return x; };
  const year = today.getFullYear();
  const ym = /^year:(\d{4})$/.exec(preset || '');
  if (ym) return { start: `${ym[1]}-01-01`, end: `${ym[1]}-12-31` };
  switch (preset) {
    case 'last_year':  return { start: `${year - 1}-01-01`, end: `${year - 1}-12-31` };
    case 'all_time':   return { start: '2000-01-01', end: todayIso };
    case 'this_week':  { const ws = startOfWeek(today); return { start: iso(ws), end: todayIso }; }
    case 'last_week':  { const ws = startOfWeek(today); ws.setDate(ws.getDate() - 7); const we = new Date(ws); we.setDate(we.getDate() + 6); return { start: iso(ws), end: iso(we) }; }
    case 'this_month': { const ms = new Date(year, today.getMonth(), 1); return { start: iso(ms), end: todayIso }; }
    case 'last_month': { const ms = new Date(year, today.getMonth() - 1, 1); const me = new Date(year, today.getMonth(), 0); return { start: iso(ms), end: iso(me) }; }
    case 'custom':     { const ws = startOfWeek(today); return { start: custom?.start || iso(ws), end: custom?.end || todayIso }; }
    case 'this_year':
    default:           return { start: `${year}-01-01`, end: todayIso };
  }
}

// Best-effort week-start ISO parsing. Raw-sales path stamps an explicit iso_start
// on every row. Pre-aggregated CSVs only have a "M/D-M/D" date label; we parse
// the first half and pin to the upload year (today's year — accurate for YTD).
function indicatorWeekStartIso(row) {
  if (row && row.iso_start) return row.iso_start;
  const m = (row?.date || '').match(/^(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const year = new Date().getFullYear();
  return `${year}-${String(m[1]).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`;
}

// Year-relative week label. All-time uploads made the absolute week index
// meaningless for display ("Week 295"), so labels show the week's number
// WITHIN its own year (Sunday-anchored; week 1 is the week containing
// Jan 1), with a short year suffix when it isn't the current year
// ("Wk 49 '25"). Falls back to the absolute index when the week's start
// date can't be determined.
function indicatorWeekLabel(w, opts) {
  const word = (opts && opts.short) ? 'Wk ' : 'Week ';
  const rows = (opts && opts.rows) || state.indicatorsData || [];
  const iso = indicatorWeekStartIso(rows.find(r => r.week === w));
  if (!iso) return word + w;
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return word + w;
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const anchor = new Date(jan1); anchor.setDate(anchor.getDate() - anchor.getDay());
  const n = Math.floor((d - anchor) / 604800000) + 1;
  const suffix = d.getFullYear() !== new Date().getFullYear() ? " '" + String(d.getFullYear()).slice(2) : '';
  return word + n + suffix;
}
function isInIndicatorRange(row, bounds) {
  const iso = indicatorWeekStartIso(row);
  if (!iso) return true; // unknown — keep, don't silently drop
  // Match weeks that OVERLAP the range (a week spans iso .. iso+6 days).
  // Anchor-only matching made short mid-week ranges (e.g. 6/1–6/3) match
  // nothing, because the containing week starts on the prior Sunday.
  const we = new Date(iso + 'T00:00:00'); we.setDate(we.getDate() + 6);
  const weekEndIso = we.toISOString().slice(0, 10);
  return iso <= bounds.end && weekEndIso >= bounds.start;
}


// Build the x-axis buckets for the Indicators charts based on the selected
// range. Auto-picks granularity so a short range gets daily detail and a long
// one rolls up to month bars.
//
//   Range span        Granularity   Bucket count examples
//   ─────────────────────────────────────────────────────
//   ≤ 31 days         day           7   (this week)  ·  31  (this month)
//   ≤ 180 days        week          12-26
//   > 180 days        month         12  (this year)
//
// Each bucket has:
//   key         — unique id used for chart labels
//   label       — human-readable, used on the x-axis
//   match(s)    — predicate filtering raw sales into this bucket (per-bucket value)
//   cumThrough(s)— predicate for cumulative metrics (every sale up to bucket end)
//   week        — fallback week number for CSV-only data (only set on weekly buckets)
function getChartBuckets(rangeBounds, allWeeks, indicatorsData) {
  const startIso = rangeBounds.start;
  const endIso   = rangeBounds.end;
  const startD = new Date(startIso + 'T00:00:00');
  const endD   = new Date(endIso   + 'T00:00:00');
  const dayMs  = 86400000;
  const days   = Math.max(1, Math.round((endD - startD) / dayMs) + 1);

  const isoOf = (d) => d.toISOString().slice(0, 10);
  const fmtDayLabel = (d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });

  if (days <= 31) {
    // Daily buckets
    const buckets = [];
    for (let cur = new Date(startD); cur <= endD; cur.setDate(cur.getDate() + 1)) {
      const iso = isoOf(cur);
      const label = fmtDayLabel(cur);
      buckets.push({
        kind: 'day',
        key: iso,
        label,
        startIso: iso,
        endIso: iso,
        match: (s) => dateSoldToIso(s.dateSold) === iso,
        cumThrough: (s) => dateSoldToIso(s.dateSold) <= iso,
      });
    }
    return buckets;
  }

  if (days <= 180) {
    // Weekly buckets — reuse the indicator CSV's week numbering so labels can
    // include the original "5/3-5/9" date hint when present.
    return (allWeeks || []).map(w => {
      const row = (indicatorsData || []).find(r => r.week === w);
      const label = indicatorWeekLabel(w, { short: true, rows: indicatorsData }) + (row?.date ? '\n' + row.date : '');
      return {
        kind: 'week',
        key: 'wk-' + w,
        label,
        week: w,
        match: (s) => s.week === w,
        cumThrough: (s) => s.week <= w,
      };
    });
  }

  // Monthly buckets
  const buckets = [];
  const cursor = new Date(startD.getFullYear(), startD.getMonth(), 1);
  const endMonth = new Date(endD.getFullYear(), endD.getMonth(), 1);
  while (cursor <= endMonth) {
    const yyyy = cursor.getFullYear();
    const mm = String(cursor.getMonth() + 1).padStart(2, '0');
    const monthKey = `${yyyy}-${mm}`;
    const label = cursor.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    buckets.push({
      kind: 'month',
      key: monthKey,
      label,
      monthKey,
      match: (s) => dateSoldToIso(s.dateSold).slice(0, 7) === monthKey,
      cumThrough: (s) => dateSoldToIso(s.dateSold).slice(0, 7) <= monthKey,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return buckets;
}

// One short word describing each bucket kind, used in subtitle text
// ("12 reps · 7 days" instead of "12 reps · 7 weeks" when daily-bucketed).
function chartBucketsGrainLabel(buckets) {
  if (!buckets || !buckets.length) return 'periods';
  const k = buckets[0].kind;
  return k === 'day' ? 'days' : k === 'month' ? 'months' : 'weeks';
}

// Reps W/ A Sale is intentionally NOT in this list — branch size isn't a
// signal of selling effectiveness, so it doesn't earn Power Ranking points
// and doesn't appear in the rankings matrix or the trend metric dropdown.
// The Power Ranking table itself DOES surface a Reps column for context
// (so the manager can read points-per-rep), but the value is rendered
// directly off branchData[b].reps — not from this metric list. The `reps`
// count is also the denominator of PRA.
const INDICATOR_METRICS = [
  { key: 'sold_accounts',  label: 'Subscriptions',    fmt: v => fmt.int(v) },
  { key: 'revenue',        label: 'Revenue',          fmt: v => fmt.usd0(v) },
  // New / Renewal revenue split — only SHOWN on the Office Staff table, but
  // defined here so RIDD totals + rankings compute them. Excluded from Power
  // Ranking scoring (they'd double-count Revenue).
  { key: 'new_revenue',     label: 'New Revenue',     fmt: v => fmt.usd0(v) },
  { key: 'renewal_revenue', label: 'Renewal Revenue', fmt: v => fmt.usd0(v) },
  { key: 'avg_initial',    label: 'Avg Pest Initial',   fmt: v => fmt.usd(v) },
  { key: 'acv',            label: 'ACV',              fmt: v => fmt.usd(v) },
  { key: 'pra',            label: 'PRA',              fmt: v => fmt.usd(v) },
  { key: 'multi_year_pct', label: 'Multi Year %',     fmt: v => (v * 100).toFixed(1) + '%' },
  { key: 'auto_pay_pct',   label: 'Auto Pay %',       fmt: v => (v * 100).toFixed(1) + '%' },
  { key: 'audit_pct',      label: 'Audit %',          fmt: v => (v * 100).toFixed(1) + '%' },
  // Last Resort % — accounts with an initial under $99 ÷ all accounts. A
  // pricing-quality signal for the Sales Rep dept only; like Audit %, it is
  // context, NOT a Power Ranking scorer.
  { key: 'last_resort_pct', label: 'Last Resort %',    fmt: v => (v * 100).toFixed(1) + '%' },
];

// EXACT calculation breakdown for each Power-Ranking-table row, built live
// from the CURRENT toggles so it always states every filter and exclusion in
// force. These popups are the source of truth for comps — keep them in
// lockstep with the aggregation code (aggregateRawSalesByGroup + the
// range-mode day-precision path in viewIndicators).
function indicatorMetricHelp(key) {
  // One clean definition per row (per Isaac, Jul 2026 — "take out all the
  // fluff"). Every metric already runs on the same canonical pool: the
  // window's Pending/Serviced sales after the standard exclusions, so the
  // popups just define the math.
  const teamsMode = state.indicatorsGroupBy === 'teams';
  const dept = state.indicatorDept || 'all';
  const F = {
    sold_accounts:  'Number of subscriptions sold in the window — one row per subscription, so a customer buying two plans counts twice.',
    revenue:        'Total Contract Value of all accounts sold in the window.',
    new_revenue:    'Revenue from new sales only — renewal sources are excluded.',
    renewal_revenue:'Revenue from renewal sources ("Renewal - …") only.',
    avg_initial:    (teamsMode || dept === 'office')
      ? 'Average Initial Service Price, excluding Sentricon, German Roach, and Interior Flea plans so termite installs don\u2019t skew the pest number.'
      : 'Average Initial Service Price across all accounts sold in the window.',
    acv:            'Revenue \u00f7 Subscriptions — the average contract value per subscription.',
    pra:            'Revenue \u00f7 Reps > $20K. Reps qualify on their company-wide total for the window and count toward the one column where they sold the most.',
    multi_year_pct: 'Contracts longer than 12 months \u00f7 all contracts that are 12 months or longer.',
    auto_pay_pct:   'Subscriptions with autopay on file \u00f7 Subscriptions.',
    audit_pct:      'Subscriptions NOT flagged Failed Audit \u00f7 Subscriptions — passed, pending, and unaudited all count as good.',
    last_resort_pct:'Subscriptions with an initial under $99 \u00f7 Subscriptions. Context only — not scored for Power Rank.',
    reps:           'Unique reps with at least one sale in the window. Context only — not scored for Power Rank.',
    reps20k:        'How many reps cleared $20,000 in total sales for the selected date range. A rep\u2019s sales are added up across every branch first, then the rep is placed in ONE column only \u2014 the branch where they sold the most \u2014 so a rep is never counted twice. This is also the denominator for PRA (Revenue \u00f7 Reps > $20K).',
    _points:        'Each column is ranked 1\u2013N on the seven scored rows (Subscriptions, Revenue, Avg Initial, ACV, PRA, Multi-Year %, Auto-Pay %); Power Rank is the sum of those ranks — lowest total wins.',
  };
  return F[key] || '';
}

// ── ONE HUMAN, MANY CRM ACCOUNTS — shared identity resolution ────────────
// FieldRoutes gives a person a separate employee row per branch (and the
// roster only groups them when they share an email or linked ids), and app
// profiles are sometimes linked to a BRANCH id instead of the group master.
// These helpers make every id in a person's group resolve to the same
// roster row/profile, so multi-account reps (Tyler Trump, Pere LeSueur)
// never split anywhere in the app.
let _frMasterCache = { roster: null, map: null, rowByMaster: null };
function _frMasterMaps() {
  if (_frMasterCache.roster === state.frRoster && _frMasterCache.map) return _frMasterCache;
  const map = new Map(), rowByMaster = new Map();
  (state.frRoster || []).forEach(e => {
    const master = String(e.employee_id);
    rowByMaster.set(master, e);
    String(e.employee_ids || e.employee_id || '').split(',').forEach(x => { const t = x.trim(); if (t) map.set(t, master); });
  });
  _frMasterCache = { roster: state.frRoster, map, rowByMaster };
  return _frMasterCache;
}
// Any of a person's branch ids → their roster MASTER id (unknown ids pass through).
function frResolveEmpId(id) { const t = String(id == null ? '' : id).trim(); return _frMasterMaps().map.get(t) || t; }
// A profile's roster row, even when the profile stores a branch id.
function frRosterRowForProfile(p) { return _frMasterMaps().rowByMaster.get(frResolveEmpId(p && p.fieldroutes_employee_id)) || null; }
// Squeeze signatures: spacing/case/punctuation-blind but ORDER-PRESERVING —
// "Pere LeSueur" and "Pere Le Sueur" both squeeze to "perelesueur", and the
// token-sorted variant catches "LeSueur, Pere". Unlike an anagram signature,
// different humans can't collide ("Aidan Smith" ≠ "Nadia Smith"). Two names
// are the same person when their signature sets intersect.
// CRM names export as "Last, First" — flip to "First Last" for display.
const FR_SYSTEM_NAME_RE = /\badmin\b|\bsystem\b|fieldroutes|fr-system|\btest\b|\breferral\b|sellify|pest routes|ridd account|ridd sales|pro products|mosquito joe|clicki|pest ai|pest booker|applause/i;
// ── CHART TOOLTIPS, APP-WIDE ─────────────────────────────────────────────
// One HTML tooltip for every Chart.js chart: theme-aware card (blur, border,
// shadow, CSS variables — canvas tooltips can't do any of that), color chips
// per series, tabular numbers, viewport-clamped. Installed as the GLOBAL
// Chart.js default; each chart's existing label/footer callbacks still shape
// the content — this only replaces the rendering.
const _riddTipEsc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function _riddChartTipEl() {
  let t = document.getElementById('riddChartTip');
  if (!t) {
    t = document.createElement('div');
    t.id = 'riddChartTip';
    // MOBILE FIX (per Isaac): the tooltip is position:fixed, so once a tap
    // summons it, scrolling carried it along forever — Chart.js only hides
    // it on canvas pointer events. Any scroll or a tap outside a chart
    // dismisses it. Registered once alongside the singleton element.
    const _hideTip = () => { const el = document.getElementById('riddChartTip'); if (el) el.style.opacity = '0'; };
    document.addEventListener('scroll', _hideTip, { capture: true, passive: true });
    window.addEventListener('resize', _hideTip, { passive: true });
    document.addEventListener('touchstart', (e) => { if (!(e.target && e.target.closest && e.target.closest('canvas'))) _hideTip(); }, { capture: true, passive: true });
    Object.assign(t.style, {
      position: 'fixed', pointerEvents: 'none', zIndex: '9999', opacity: '0',
      transition: 'opacity .12s ease', maxWidth: '340px',
      padding: '10px 13px', borderRadius: '0',
      border: '1px solid var(--border-2)',
      boxShadow: '0 12px 32px rgba(0,0,0,.35)',
      backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
    });
    // Solid fallback first; color-mix upgrades it where supported.
    t.style.background = 'var(--card)';
    t.style.background = 'color-mix(in srgb, var(--card) 90%, transparent)';
    document.body.append(t);
  }
  return t;
}
function _riddChartTooltip(ctx) {
  const t = _riddChartTipEl();
  const tip = ctx.tooltip;
  if (!tip || tip.opacity === 0) { t.style.opacity = '0'; return; }
  const title = (tip.title || []).join(' ');
  // Swatch colour: bars carry their colour in backgroundColor (their border is
  // Chart.js's default gray, which made the Sold bar look gray in the Daily
  // Pulse tooltip); lines carry it in borderColor. Pick by dataset type.
  const _dp = tip.dataPoints || [];
  const items = (tip.body || []).map((b, i) => {
    const lc = (tip.labelColors && tip.labelColors[i]) || {};
    const ds = _dp[i] && _dp[i].dataset;
    const isBar = ds && (ds.type === 'bar' || (!ds.type && ctx.chart && ctx.chart.config && ctx.chart.config.type === 'bar'));
    const solid = (c) => c && typeof c === 'string' && !/rgba\([^)]*,\s*0?\.\d+\)/.test(c) ? c : null;
    const color = isBar ? (solid(lc.backgroundColor) || lc.borderColor || lc.backgroundColor) : (lc.borderColor || lc.backgroundColor);
    return { text: b.lines.join(' '), color: color || 'var(--accent)' };
  });
  const footer = (tip.footer || []).join(' ');
  const MAX = 12;
  let html = '';
  if (title) html += '<div style="font-weight:800;font-size:12px;margin-bottom:6px;color:var(--text);letter-spacing:.01em">' + _riddTipEsc(title) + '</div>';
  items.slice(0, MAX).forEach(it => {
    html += '<div style="display:flex;align-items:center;gap:7px;font-size:11.5px;line-height:1.75;color:var(--text-muted)">'
      + '<span style="width:8px;height:8px;border-radius:3px;flex:none;background:' + _riddTipEsc(String(it.color)) + '"></span>'
      + '<span style="font-variant-numeric:tabular-nums">' + _riddTipEsc(it.text) + '</span></div>';
  });
  if (items.length > MAX) html += '<div style="font-size:10px;color:var(--text-subtle);margin-top:2px">+ ' + (items.length - MAX) + ' more</div>';
  if (footer) html += '<div style="margin-top:7px;padding-top:7px;border-top:1px solid var(--border);font-size:11px;font-weight:700;color:var(--text)">' + _riddTipEsc(footer) + '</div>';
  if (!html) { t.style.opacity = '0'; return; }
  t.innerHTML = html;
  // Position beside the caret, clamped to the viewport.
  const rect = ctx.chart.canvas.getBoundingClientRect();
  const w = t.offsetWidth, h = t.offsetHeight;
  let x = rect.left + tip.caretX + 14;
  if (x + w > window.innerWidth - 8) x = rect.left + tip.caretX - w - 14;
  x = Math.max(8, x);
  let y = rect.top + tip.caretY - h / 2;
  y = Math.max(8, Math.min(y, window.innerHeight - h - 8));
  t.style.left = x + 'px';
  t.style.top = y + 'px';
  t.style.opacity = '1';
}
// Install as the Chart.js global default the moment the (deferred) library
// lands — every chart created afterwards inherits it automatically.
(function _installRiddChartTooltips() {
  const apply = () => {
    if (typeof Chart === 'undefined') return false;
    if (!Chart._riddTipInstalled) {
      Chart._riddTipInstalled = true;
      Chart.defaults.plugins.tooltip.enabled = false;
      Chart.defaults.plugins.tooltip.external = _riddChartTooltip;
    }
    return true;
  };
  if (!apply()) {
    const iv = setInterval(() => { if (apply()) clearInterval(iv); }, 400);
    setTimeout(() => clearInterval(iv), 30000);
  }
})();

// "Today" for BUSINESS data, pinned to Eastern (the company clock). Device
// timezones vary (an MST admin, an EST rep) and UTC flips mid-evening —
// bucketing by one canonical business day keeps every screen identical.
// ── DATA ASSISTANT (admin-only 💬 widget, bottom right) ──────────────────
// Packs a compact snapshot of the numbers on screen and asks the server-side
// /api/ask-data proxy (Anthropic). The snapshot is rebuilt per question so
// answers always reflect the live data.
function buildAskDataContext() {
  const out = { generatedAt: new Date().toISOString(), businessToday: bizTodayIso() };
  const EXCLUDE = new Set(['cancelled', 'nsf', 'not_payable', 'reschedule', 'rejected']);
  try { out.dataSyncedAt = state.indicatorsUploadedAt || null; } catch (e) { /* partial context is fine */ }
  try { out.companyGoal = state.companyGoal || null; } catch (e) { /* ignore */ }
  try {
    const pool = dashboardSales().filter(s => !EXCLUDE.has(s.audit_status));
    const today = bizTodayIso(), y = today.slice(0, 4);
    const sum = (rows) => Math.round(rows.reduce((a, s) => a + Number(s.revenue_amount || 0), 0));
    const since = (iso) => pool.filter(s => s.sold_date >= iso);
    const renewalIds = new Set((state.sources || []).filter(s => s.is_renewal).map(s => s.id));
    const isRen = (s) => s._crmRenewal ?? renewalIds.has(s.source_id);
    const ytd = since(y + '-01-01');
    out.insideSales = {
      description: 'Office-staff (inside sales) CRM-synced sales + manually logged upsells — the Sales War Room data.',
      todayRevenue: sum(pool.filter(s => s.sold_date === today)),
      todayCount: pool.filter(s => s.sold_date === today).length,
      mtdRevenue: sum(since(today.slice(0, 8) + '01')),
      ytdRevenue: sum(ytd), ytdCount: ytd.length,
      ytdNewRevenue: sum(ytd.filter(s => !isRen(s))),
      ytdRenewalRevenue: sum(ytd.filter(isRen)),
    };
  } catch (e) { /* ignore */ }
  try {
    out.leaderboardYTD = computeLeaderboard('total').slice(0, 40).map(r => ({
      name: r.full_name, sales: r.count, revenue: Math.round(r.revenue),
      avgInitial: Math.round(r.initial), recurringRev: Math.round(r.recurring), acv: Math.round(r.acv),
      bestDay: Math.round(r.best_day || 0),
      wow: r.wow == null ? null : r.wow === Infinity ? 'new' : Math.round(r.wow * 100) + '%',
    }));
    out.leaderboardThisWeek = computeLeaderboard('total', getDateRange('week'))
      .filter(r => r.count > 0)
      .map(r => ({ name: r.full_name, sales: r.count, revenue: Math.round(r.revenue) }));
  } catch (e) { /* ignore */ }
  try {
    // Whole-company view (all departments) for the CURRENT year.
    const raw = state._indicatorRawSales || [];
    const yNow = String(new Date().getFullYear());
    const byDept = {};
    for (const s of raw) {
      const iso = (typeof dateSoldToIso === 'function' && dateSoldToIso(s.dateSold)) || '';
      if (iso.slice(0, 4) !== yNow) continue;
      const d = (typeof _indicatorDeptOf === 'function') ? _indicatorDeptOf(s) : 'unknown';
      byDept[d] = (byDept[d] || 0) + (Number(s.contractValue) || 0);
    }
    out.companyYtdRevenueByDept = Object.fromEntries(Object.entries(byDept).map(([k, v]) => [k, Math.round(v)]));
  } catch (e) { /* ignore */ }
  return out;
}
function _ensureAskWidget() {
  // RETIRED (per Isaac, Jul 2026) — the admin AI chat widget + speed-dial
  // FAB are gone. The /api/ask-data endpoint and the code below survive for
  // an easy future revival; this early return keeps it all dormant.
  { const existing0 = document.getElementById('askDataWidget'); if (existing0) existing0.remove(); return; }
  if (typeof DEMO !== 'undefined' && DEMO) return;
  const existing = document.getElementById('askDataWidget');
  if (!state.profile || !isAdminRole(state.profile?.role) || viewAsRole()) { if (existing) existing.remove(); return; }
  if (existing) return;   // created once; survives re-renders so typing is never interrupted
  if (!state._askChat) state._askChat = { open: false, msgs: [], busy: false };
  const C = state._askChat;
  const widget = el('div', { id: 'askDataWidget', style: { position: 'fixed', right: '18px', bottom: '18px', zIndex: '9997', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' } });
  const panel = el('div', { class: 'card', style: { width: 'min(360px, calc(100vw - 36px))', height: 'min(460px, calc(100vh - 120px))', display: C.open ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden', boxShadow: 'var(--shadow-lg)' } });
  const msgsEl = el('div', { style: { flex: '1', overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' } });
  const paint = () => {
    msgsEl.innerHTML = '';
    if (!C.msgs.length) msgsEl.append(el('div', { class: 'text-xs text-muted-', style: { padding: '8px' } },
      'Ask about the numbers on screen — "who\'s pacing to hit goal?", "compare Pere and Drew this month", "why is renewal revenue down?" Answers come from the live synced data.'));
    C.msgs.forEach(m => msgsEl.append(el('div', {
      style: { alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', padding: '8px 11px', borderRadius: '0', fontSize: '12.5px', lineHeight: '1.45', whiteSpace: 'pre-wrap',
               background: m.role === 'user' ? 'var(--accent)' : 'var(--card-2)', color: m.role === 'user' ? 'var(--accent-text)' : 'var(--text)' },
    }, m.content)));
    if (C.busy) msgsEl.append(el('div', { class: 'text-xs text-muted-', style: { padding: '4px 8px' } }, 'Thinking…'));
    msgsEl.scrollTop = msgsEl.scrollHeight;
  };
  const input = el('textarea', {
    rows: '2', placeholder: 'Ask about your data…', class: 'text-xs',
    style: { flex: '1', resize: 'none', border: 'none', outline: 'none', background: 'transparent', color: 'var(--text)', padding: '10px 12px' },
    onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } },
  });
  const send = async () => {
    const q = input.value.trim();
    if (!q || C.busy) return;
    input.value = '';
    C.msgs.push({ role: 'user', content: q });
    C.busy = true; paint();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch('/api/ask-data', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + ((session && session.access_token) || '') },
        body: JSON.stringify({ question: q, history: C.msgs.slice(0, -1).slice(-8), context: buildAskDataContext() }),
      });
      const j = await r.json().catch(() => ({}));
      C.msgs.push({ role: 'assistant', content: (r.ok && j.answer) ? j.answer : ('⚠ ' + (j.error || ('HTTP ' + r.status))) });
    } catch (e) { C.msgs.push({ role: 'assistant', content: '⚠ ' + ((e && e.message) || e) }); }
    C.busy = false; paint();
  };
  panel.append(
    el('div', { class: 'px-4 py-3 flex items-center justify-between border-b border-' },
      el('div', {},
        el('div', { class: 'text-sm font-bold' }, '💬 Data Assistant'),
        el('div', { class: 'text-[10px] text-muted-' }, 'Answers from the live synced data · admin only')),
      el('button', { class: 'text-xl leading-none text-muted-', onclick: () => { C.open = false; panel.style.display = 'none'; } }, '×')),
    msgsEl,
    el('div', { class: 'flex items-end border-t border-' },
      input,
      el('button', { class: 'px-2.5 py-1 text-[11px] font-bold cursor-pointer', style: { color: 'var(--accent)' }, onclick: send }, 'Send')));
  // ── Speed dial: ONE floating button fans out to the two actions (the
  // separate + FAB and 💬 used to stack on top of each other). ──
  const optBtn = (icon, labelTxt, onPick) => el('button', {
    class: 'flex items-center gap-2.5 rounded-full pl-3 pr-4 py-2.5 text-xs font-bold cursor-pointer transition hover:brightness-95',
    style: { background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border-2)', boxShadow: 'var(--shadow-lg)' },
    onclick: onPick,
  }, el('span', { style: { fontSize: '16px' } }, icon), labelTxt);
  let dialOpen = false;
  const fabIcon = el('span', { style: { fontSize: '22px', lineHeight: '1', transition: 'transform .18s ease', display: 'inline-block', marginTop: '-2px' } }, '\ud83d\udcac');
  const dial = el('div', { style: { display: 'none', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' } });
  const setDial = (v) => { dialOpen = v; dial.style.display = v ? 'flex' : 'none'; fabIcon.style.transform = v ? 'rotate(45deg)' : 'none'; };
  dial.append(
    optBtn('💬', 'RIDD AI Agent', () => { setDial(false); C.open = true; panel.style.display = 'flex'; paint(); setTimeout(() => input.focus(), 50); }),
  );
  const fab = el('button', {
    title: 'RIDD AI Agent',
    style: { width: '54px', height: '54px', borderRadius: '50%', background: 'var(--accent)', color: 'var(--accent-text)', boxShadow: 'var(--shadow-lg)', cursor: 'pointer', border: 'none', display: 'grid', placeItems: 'center' },
    onclick: () => {
      if (C.open) { C.open = false; panel.style.display = 'none'; setDial(false); return; }
      // One option left (New Sale retired) — open the agent straight away.
      setDial(false); C.open = true; panel.style.display = 'flex'; paint(); setTimeout(() => input.focus(), 50);
    },
  }, fabIcon);
  document.addEventListener('mousedown', (e) => { if (dialOpen && !widget.contains(e.target)) setDial(false); });
  widget.append(panel, dial, fab);
  document.body.append(widget);
  if (C.open) paint();
}
function bizTodayIso() {
  try {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return p;
  } catch (e) { /* fall through */ }
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function flipLastFirst(name) {
  const s = String(name || '').trim();
  const i = s.indexOf(',');
  if (i === -1) return s;
  const first = s.slice(i + 1).trim(), last = s.slice(0, i).trim();
  return (first + ' ' + last).trim();
}
function _nameSqueezeSigs(n) {
  const toks = String(n || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (!toks.length) return [];
  const raw = toks.join('');
  const sorted = toks.slice().sort().join('');
  return raw === sorted ? [raw] : [raw, sorted];
}
function _invalidateRepSigIndex(map) { if (map) _repSigIdxCache.delete(map); }
function _normalizeRepKeyedMaps() {
  for (const field of ['_indicatorRepTeam', '_indicatorRepTier', '_indicatorRepActive', '_indicatorRepOffice', '_indicatorRepAlias']) {
    const m = state[field];
    if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
    for (const k of Object.keys(m)) {
      const ck = _cleanRepName(k);
      if (ck !== k) { if (!(ck in m)) m[ck] = m[k]; delete m[k]; }
    }
    if (field === '_indicatorRepAlias') {
      for (const k of Object.keys(m)) { if (typeof m[k] === 'string') m[k] = _cleanRepName(m[k]); }
    }
    _invalidateRepSigIndex(m);
  }
}
// ── Year-scoped team assignments ──────────────────────────────────────────
// Team membership is now stored per CALENDAR YEAR: a rep can be on a team in
// 2025 and a different team (or none) in 2026. The source of truth is
// state._indicatorRepTeamByYear = { "2025": {rep:team}, "2026": {rep:team} }.
// state._teamYear is the year currently being viewed/edited (defaults to the
// current calendar year). For backwards compatibility every existing consumer
// still reads state._indicatorRepTeam — we keep that as a live pointer to the
// active year's sub-map via _activeTeamMap().
function _teamYearKey() { return String(state._teamYear || new Date().getFullYear()); }
function _activeTeamMap() {
  if (!state._indicatorRepTeamByYear || typeof state._indicatorRepTeamByYear !== 'object' || Array.isArray(state._indicatorRepTeamByYear)) {
    state._indicatorRepTeamByYear = {};
  }
  const y = _teamYearKey();
  if (!state._indicatorRepTeamByYear[y] || typeof state._indicatorRepTeamByYear[y] !== 'object') {
    // CARRY-FORWARD: a brand-new year copies last year's assignments so
    // Jan 1 doesn't wipe every leaderboard/comp to "Unassigned". Admins
    // then prune in Manage Teams instead of rebuilding from scratch.
    const prev = state._indicatorRepTeamByYear[String(Number(y) - 1)];
    state._indicatorRepTeamByYear[y] = (prev && typeof prev === 'object' && !Array.isArray(prev)) ? { ...prev } : {};
    if (prev && Object.keys(state._indicatorRepTeamByYear[y]).length && typeof logActivity === 'function') {
      try { logActivity('config_change', { detail: 'Teams ' + y + ' seeded from ' + (Number(y) - 1) + ' (carry-forward)' }); } catch (e) { /* log only */ }
    }
  }
  // Keep the legacy flat pointer aimed at the active year so direct readers
  // (distinctTeams, roster unions, etc.) transparently see the right map.
  state._indicatorRepTeam = state._indicatorRepTeamByYear[y];
  return state._indicatorRepTeam;
}
function _allTeamYearMaps() {
  const by = state._indicatorRepTeamByYear;
  const out = [];
  if (by && typeof by === 'object' && !Array.isArray(by)) {
    for (const y of Object.keys(by)) { if (by[y] && typeof by[y] === 'object') out.push(by[y]); }
  }
  return out;
}
// Migrate/normalize the by-year structure. Safe to call repeatedly after any
// load. Legacy flat rep_teams (rep→teamString) gets folded into the current
// year so nothing the admin already configured is lost.
function _hydrateTeamYears() {
  const cur = String(new Date().getFullYear());
  let byYear = state._indicatorRepTeamByYear;
  const looksByYear = byYear && typeof byYear === 'object' && !Array.isArray(byYear)
    && Object.keys(byYear).every(k => /^\d{4}$/.test(k) && byYear[k] && typeof byYear[k] === 'object');
  if (!looksByYear) {
    byYear = {};
    const legacy = state._indicatorRepTeam;
    if (legacy && typeof legacy === 'object' && !Array.isArray(legacy) && Object.values(legacy).some(v => typeof v === 'string')) {
      byYear[cur] = { ...legacy };
    }
  }
  if (!byYear[cur]) byYear[cur] = {};
  state._indicatorRepTeamByYear = byYear;
  if (!state._teamYear) state._teamYear = cur;
  // Normalize rep-name keys within every year (doubled-space spellings, etc.).
  for (const y of Object.keys(byYear)) {
    const m = byYear[y];
    if (!m || typeof m !== 'object') continue;
    for (const k of Object.keys(m)) {
      const ck = _cleanRepName(k);
      if (ck !== k) { if (!(ck in m)) m[ck] = m[k]; delete m[k]; }
    }
  }
  _activeTeamMap();
}
function getRepTeam(repName) {
  if (!repName) return '';
  return _repKeyedLookup(_activeTeamMap(), repName);
}
// ── Teams a partner / team lead is responsible for (per Isaac): set in
// Settings → Users, synced with the indicator config. A partner's reach
// on leaderboards / player cards = these teams + whatever team they're
// assigned to themselves in Manage Teams.
function partnerTeamsStore() {
  state._compExtras = state._compExtras || {};
  const pt = state._compExtras.partnerTeams;
  return (pt && typeof pt === 'object') ? pt : (state._compExtras.partnerTeams = {});
}
function partnerTeamsOf(profileId) {
  const v = partnerTeamsStore()[profileId];
  return Array.isArray(v) ? v.filter(Boolean) : [];
}
function setPartnerTeams(profileId, teams) {
  const st = partnerTeamsStore();
  if (teams && teams.length) st[profileId] = [...new Set(teams)]; else delete st[profileId];
  saveDemoData();
  if (typeof saveIndicatorConfigToSupabase === 'function') saveIndicatorConfigToSupabase().catch(() => {});
}
function allTeamNames() {
  const set = new Set(Object.values(_activeTeamMap() || {}).filter(Boolean));
  return [...set].sort((a, b) => a.localeCompare(b));
}
function myReachTeams() {
  const me = state.profile || {};
  const set = new Set(partnerTeamsOf(me.id));
  const own = getRepTeam(me.full_name) || '';
  if (own) set.add(own);
  if (!own && typeof myRepNameSet === 'function') for (const n of myRepNameSet()) { const t = getRepTeam(n) || ''; if (t) { set.add(t); break; } }
  return set;
}
// Read a rep's team for a SPECIFIC year without disturbing the active pointer.
function getRepTeamForYear(repName, year) {
  if (!repName) return '';
  const by = state._indicatorRepTeamByYear || {};
  const map = by[String(year)] || {};
  return map[repName] || map[_cleanRepName(repName)] || '';
}
function setRepTeam(repName, team) {
  const map = _activeTeamMap();
  if (!team) delete map[repName];
  else       map[repName] = team;
  _invalidateRepSigIndex(map);
  logActivity('team_change', { rep_name: repName, detail: (team ? repName + ' assigned to team ' + team : repName + ' removed from team') + ' (' + _teamYearKey() + ')' });
  saveDemoData();
}
function setActiveCompId(id) {
  if (getIndicatorCompetitions().some(c => c.id === id)) {
    state._indicatorActiveCompId = id;
    saveDemoData();
  }
}
function addCompetition(name) {
  const nm = (name || '').trim();
  if (!nm) return null;
  const comps = getIndicatorCompetitions();
  const id = 'comp_' + Date.now().toString(36);
  comps.push({ id, name: nm, excludedTeams: [REP_EXCLUDED_TEAM] });
  state._indicatorActiveCompId = id;   // jump to the new one
  saveDemoData();
  return id;
}
function renameCompetition(id, name) {
  const nm = (name || '').trim();
  if (!nm) return;
  const c = getIndicatorCompetitions().find(x => x.id === id);
  if (c) { c.name = nm; saveDemoData(); }
}
function deleteCompetition(id) {
  const comps = getIndicatorCompetitions();
  if (comps.length <= 1) return;       // always keep at least one
  state._indicatorCompetitions = comps.filter(c => c.id !== id);
  // Tombstone built-in comps so the Heal pass in getIndicatorCompetitions()
  // doesn't immediately re-seed them (that was why Remove "did nothing").
  if (DEFAULT_COMPETITIONS.some(d => d.id === id)) {
    state._indicatorRemovedDefaults = [...new Set([...(state._indicatorRemovedDefaults || []), id])];
  }
  if (state._indicatorActiveCompId === id) state._indicatorActiveCompId = state._indicatorCompetitions[0].id;
  saveDemoData();
}

// True for the Spring Cleaning competition (gets the custom branch scoreboard).
function isSpringCleaningComp(comp) {
  const c = comp || getActiveComp();
  return c && (c.scoring === 'spring_cleaning' || c.id === 'spring_cleaning' || /spring\s*clean/i.test(c.name || ''));
}

// ── Last Man Standing ──────────────────────────────────────────────────────
// Every-man-for-himself weekly elimination. SATURDAY ONLY. Each Saturday with
// qualifying sales is a round. Gate matches Spring Cleaning standings: D2D,
// ≥$99 initial, NOT Failed Audit (passed + no-audit + pending all count —
// pending is assumed passing so the comp runs before audits land). Round 1 is
// a pure qualifier (anyone with a qualifying account advances); from Round 2,
// among reps still alive, rank by qualifying revenue and the top 50% (rounded
// UP) advance, the rest are eliminated. A rep with no sale that Saturday stays
// in the pool at $0 and is subject to the cut. FINAL: once 3 or fewer remain,
// that round is winner-take-all — top revenue is champion (per Isaac).
function isLastManStandingComp(comp) {
  const c = comp || (typeof getActiveComp === 'function' ? getActiveComp() : null);
  return !!(c && (c.scoring === 'last_man_standing' || c.id === 'last_man_standing' || /last\s*man\s*standing/i.test(c.name || '')));
}
// 5-pointed star, drawn with a clip-path so it tints any color cleanly.
const LMS_STAR_CLIP = 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)';
function lastManStandingBoard(windowed, winLabel, compOverride, ctlHost) {
  let _lmsPosterDl = null;   // assigned below; rendered as a Comp Window bar button
  const R = lastManStandingCompute(windowed, compOverride);
  // KAWS-poster palette — black canvas, vivid pops.
  const RED = '#FF1F0E', MAG = '#FF18C8', CYAN = '#13DAF2', ORANGE = '#FFA01E', GREEN = '#21C61C', WHITE = '#FFFFFF';
  const DIM = '#6E6E6E', FAINT = 'rgba(255,255,255,.06)';
  const DISP = "var(--font-display, 'Anton', system-ui, sans-serif)";    // Anton — heavy poster display
  const money = (n) => (typeof fmt !== 'undefined' && fmt.usd0) ? fmt.usd0(n) : ('$' + Math.round(n || 0).toLocaleString());
  const firstLast = (r) => { const t = String(r || '').split(',').map(x => x.trim()); return (t.length === 2 && t[0] && t[1]) ? (t[1] + ' ' + t[0]) : String(r || ''); };

  // Scattered poster star — absolutely placed behind the type.
  const star = (color, size, top, left, rot, op) => el('div', { style: {
    position: 'absolute', top, left, width: size + 'px', height: size + 'px',
    background: color, clipPath: LMS_STAR_CLIP, transform: 'rotate(' + (rot || 0) + 'deg)',
    opacity: String(op == null ? 1 : op), pointerEvents: 'none', zIndex: '0',
  } });
  // A rotated poster blurb (the colored callouts from the flyer).
  const blurb = (color, lines, rot, size) => el('div', { style: {
    fontFamily: DISP, color, textTransform: 'uppercase', lineHeight: '.92',
    fontSize: (size || 'clamp(.95rem,1.9vw,1.45rem)'), transform: 'rotate(' + (rot || 0) + 'deg)',
    letterSpacing: '.005em', textShadow: '0 1px 10px rgba(0,0,0,.55)',
  } }, ...lines.map(t => el('div', {}, t)));

  // Headline stat — big colored number, small white label.
  const stat = (label, val, color) => el('div', { style: { textAlign: 'left' } },
    el('div', { style: { fontFamily: DISP, fontSize: 'clamp(2.2rem,5vw,3.4rem)', color, lineHeight: '.85' } }, String(val)),
    el('div', { style: { fontFamily: DISP, fontSize: '.7rem', letterSpacing: '.18em', color: WHITE, textTransform: 'uppercase', marginTop: '4px', opacity: '.85' } }, label));

  const hero = el('div', { style: {
      position: 'relative', overflow: 'hidden', background: '#000',
      padding: 'clamp(22px,4vw,40px) clamp(20px,3.5vw,38px) clamp(24px,4vw,38px)',
      borderRadius: '0',
    } },
    // grain + scattered stars (decorative layer)
    el('div', { style: { position: 'absolute', inset: '0', backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,.025) 0 1px, transparent 1px 3px)', pointerEvents: 'none', zIndex: '0' } }),
    star(ORANGE, 165, '-44px', '6%', -10, 1),
    star(ORANGE, 120, '38%', '74%', 14, 1),
    star(MAG, 140, '120px', '-22px', 8, 1),
    star(RED, 120, '64%', '58%', -12, 1),
    star(CYAN, 70, '8px', '52%', 18, .9),

    // (rules ⓘ moved to the Comp Days bar, right of ↺ Reset — per Isaac)

    // 📸 Survivors poster (admin) — downloads the rep-facing announcement
    // as a PNG: LAST MAN STANDING + the reps who advanced out of the latest
    // decided round. Matches the poster style already sent to reps.
    (_lmsPosterDl = () => {
        const rd = [...R.rounds].reverse().find(r => (r.contenders || []).some(c => c.advanced));
        if (!rd) { toast('No decided round to export yet', 'warn'); return; }
        const survivors = rd.contenders.filter(c => c.advanced)
          .sort((a, b) => b.rev - a.rev)
          .map(c => firstLast(c.rep));
        const W2 = 1080, H2 = 1920;
        const cv = document.createElement('canvas'); cv.width = W2; cv.height = H2;
        const x = cv.getContext('2d');
        x.fillStyle = '#0A0A0A'; x.fillRect(0, 0, W2, H2);
        // soft glow where the poster's cowboy silhouette sits
        const g = x.createRadialGradient(W2 * 0.42, H2 * 0.52, 80, W2 * 0.42, H2 * 0.52, 700);
        g.addColorStop(0, 'rgba(255,255,255,.16)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(0, 0, W2, H2);
        const star = (cx, cy, r, color, rot) => {
          x.save(); x.translate(cx, cy); x.rotate(rot || 0); x.fillStyle = color; x.beginPath();
          for (let i = 0; i < 10; i++) {
            const rr = i % 2 ? r * 0.45 : r;
            const a = Math.PI / 5 * i - Math.PI / 2;
            if (i) x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else x.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
          }
          x.closePath(); x.fill(); x.restore();
        };
        star(230, 210, 150, '#A9441F', -0.12);
        x.textAlign = 'left';
        x.fillStyle = '#FF1F0E'; x.font = "900 66px 'Anton', 'Arial Black', sans-serif";
        x.fillText('LAST MAN STANDING', 88, 224);
        x.fillStyle = '#FFFFFF'; x.font = "700 30px Arial, sans-serif";
        x.fillText('riddmade competition series', 92, 266);
        // survivor names — auto-sized to fit however many are left
        x.textAlign = 'center'; x.fillStyle = '#FFE600';
        const top = 420, bottom = H2 - 420;
        const lh = Math.max(34, Math.min(72, (bottom - top) / Math.max(1, survivors.length)));
        x.font = "900 " + Math.round(Math.min(56, lh * 0.8)) + "px 'Anton', 'Arial Black', sans-serif";
        survivors.forEach((n, i) => x.fillText(n, W2 / 2 + 40, top + lh * (i + 1)));
        star(300, H2 - 250, 130, '#FF18C8', 0.1);
        x.textAlign = 'left';
        x.fillStyle = '#FFFFFF'; x.font = "900 56px 'Anton', 'Arial Black', sans-serif";
        x.fillText('WEEK ' + rd.week + ' SURVIVORS', 120, H2 - 250);
        x.font = "700 30px Arial, sans-serif";
        x.fillText('these reps are still standing — next round Saturday!', 124, H2 - 205);
        x.fillStyle = 'rgba(255,255,255,.5)'; x.font = "700 22px Arial, sans-serif";
        x.fillText(survivors.length + ' of ' + rd.before + ' advance · ' + rd.iso, 124, H2 - 160);
        const a2 = document.createElement('a');
        a2.href = cv.toDataURL('image/png');
        a2.download = 'LMS_Week_' + rd.week + '_Survivors.png';
        a2.click();
      }, null),

    // (⏳ Pending Revenue + 📸 Survivors poster ride the Comp Window bar
    // now — per Isaac.)

    // headline block
    el('div', { style: { position: 'relative', zIndex: '2' } },
      el('div', { style: { fontFamily: DISP, fontSize: 'clamp(2.6rem,8vw,6rem)', color: RED, lineHeight: '.82', textTransform: 'uppercase', letterSpacing: '.005em' } }, 'The Arena'),
      el('div', { style: { fontFamily: DISP, fontSize: 'clamp(1rem,2.4vw,1.7rem)', color: WHITE, textTransform: 'lowercase', letterSpacing: '.02em', marginTop: '2px' } },
        el('span', {}, 'ridd'), el('span', {}, 'made competition series'))),

    // poster blurbs — echo the flyer copy in its colors
    el('div', { style: { position: 'relative', zIndex: '2', display: 'flex', flexWrap: 'wrap', gap: 'clamp(16px,3vw,40px)', margin: 'clamp(20px,3.5vw,34px) 0 0' } },
      blurb(ORANGE, ['Every Saturday', 'Until one man stands']),
      blurb(CYAN, ['Only the top half', 'advance each week']),
      blurb(GREEN, ['Every man', 'for himself'])),

    // live stats
    el('div', { style: { position: 'relative', zIndex: '2', display: 'flex', gap: 'clamp(26px,5vw,56px)', flexWrap: 'wrap', marginTop: 'clamp(22px,3.5vw,34px)' } },
      stat('Standing', R.champion ? 1 : R.alive.length, RED),
      stat('Rounds played', R.rounds.length, CYAN),
      stat('Started', R.rosterSize, ORANGE)),

    // champion call-out (red star + name), only once decided
    R.champion
      ? el('div', { style: { position: 'relative', zIndex: '2', display: 'flex', alignItems: 'center', gap: '14px', marginTop: 'clamp(20px,3vw,30px)' } },
          el('div', { style: { position: 'relative', width: '74px', height: '74px', flex: '0 0 auto' } },
            el('div', { style: { position: 'absolute', inset: '0', background: RED, clipPath: LMS_STAR_CLIP } }),
            el('div', { style: { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px' } }, '☠')),
          el('div', {},
            el('div', { style: { fontFamily: DISP, fontSize: '.78rem', letterSpacing: '.24em', color: GREEN, textTransform: 'uppercase' } }, 'Champion'),
            el('div', { style: { fontFamily: DISP, fontSize: 'clamp(1.8rem,4vw,2.8rem)', color: WHITE, textTransform: 'uppercase', lineHeight: '.9' } }, firstLast(R.champion))))
      : null);

  // ── THE GAUNTLET — rows = reps, columns = each Saturday. A rep's row runs
  // bright while alive and goes dark with a skull the week they fall.
  const reps = {};
  R.rounds.forEach((rd, i) => rd.contenders.forEach(c => {
    const e = reps[c.rep] || (reps[c.rep] = { rep: c.rep, office: c.office, cells: {}, elimWeek: null, total: 0 });
    e.cells[i] = { rev: c.rev, advanced: c.advanced }; e.total += c.rev;
    if (!c.advanced && e.elimWeek == null) e.elimWeek = i;
  }));
  const aliveSet = new Set(R.alive);
  const rows = Object.values(reps);
  rows.forEach(r => (r.alive = aliveSet.has(r.rep)));

  // ── Per-rep, per-week revenue breakdown — shown inside each Saturday cell so
  // you can read it week to week. Saturday sales only, same gating as Spring
  // Cleaning (with LMS's serviced-by-Friday deadline). Sold-Not-Started is out
  // of everything. Passed = passed/no-audit · Pending = awaiting an audit flag ·
  // Failed = failed audit + Last Resort (<$99) + not serviced by Friday.
  // Total = Passed + Pending + Failed (everything real). Keyed weekBreak[iso][rep].
  const weekBreak = {};
  // Comp-day predicate MATCHES the compute: custom compDays when configured,
  // else auto-Saturdays. (This used to hardcode Saturday-only — a custom
  // Friday round like 7/3 advanced reps correctly but displayed $0 for
  // everyone on the survivor cards and in the rep drill.)
  const _wbComp = (typeof getActiveComp === 'function') ? (compOverride || getActiveComp()) : null;
  const _wbCustom = (_wbComp && Array.isArray(_wbComp.compDays)) ? new Set(_wbComp.compDays) : null;
  const _wbIsCompDay = (d, iso) => _wbCustom
    ? _wbCustom.has(iso)
    : ((d.getDay() === 6 || LMS_EXTRA_DAYS.has(iso)) && !LMS_SKIP_DAYS.has(iso));
  for (const s of (windowed || [])) {
    if (typeof _indicatorDeptOf === 'function' && _indicatorDeptOf(s) !== 'd2d') continue;
    const d = (typeof _parseIndicatorDay === 'function') ? _parseIndicatorDay(s) : null;
    if (!d || isNaN(d) || !s.rep) continue;
    if (typeof frPendingServiced === 'function' && !frPendingServiced(s)) continue;        // FR Pending/Serviced gate — same base as the CRM report
    const iso = d.toISOString().slice(0, 10);
    if (!_wbIsCompDay(d, iso)) continue;                                                   // scheduled comp days only
    const wk = (weekBreak[iso] || (weekBreak[iso] = {}));
    const _cn = getCanonicalRepName(s.rep);
    const e = wk[_cn] || (wk[_cn] = { total: 0, passed: 0, failed: 0, pending: 0 });
    const cv = Number(s.contractValue) || 0;
    let bucket;
    if ((Number(s.initialPrice) || 0) < 99) bucket = 'failed';                             // Last Resort
    else if (typeof lmsServicedStatus === 'function' && lmsServicedStatus(s) === 'late') bucket = 'failed';   // not serviced by Friday
    else if (typeof scAuditPassed === 'function' && scAuditPassed(s.customerFlags)) bucket = 'passed';
    else if (SC_FAIL_RE.test(s.customerFlags || '')) bucket = 'failed';
    else bucket = 'pending';
    e[bucket] += cv; e.total += cv;
  }
  const EMPTY_RB = { total: 0, passed: 0, failed: 0, pending: 0 };

  // Running cumulative total per rep across EVERY week they played — so it keeps
  // counting even after older weeks scroll out of the rolling 3-week window.
  rows.forEach(r => {
    const rt = { total: 0, passed: 0, failed: 0, pending: 0 };
    Object.keys(r.cells).forEach(k => {
      const wb = weekBreak[R.rounds[k].iso] && weekBreak[R.rounds[k].iso][r.rep];
      if (wb) { rt.total += wb.total; rt.passed += wb.passed; rt.failed += wb.failed; rt.pending += wb.pending; }
    });
    r.runTotal = rt;
  });
  // Order the field FIRST by who's still standing, THEN by total QUALIFIED
  // revenue (Passed + Pending — the counting revenue) most to least.
  const _qual = (r) => (r.runTotal.passed || 0) + (r.runTotal.pending || 0);
  rows.sort((a, b) =>
    (b.alive ? 1 : 0) - (a.alive ? 1 : 0)
    || (_qual(b) - _qual(a))
    || String(a.rep).localeCompare(String(b.rep)));
  // Rolling window — show only the most recent 3 weeks as columns; the running
  // total on the right keeps the full picture as week 1 falls off in week 4, etc.
  const WINDOW = 3;
  const shownIdx = R.rounds.map((_, i) => i).slice(-WINDOW);

  // ── Clean gauntlet renderer ───────────────────────────────────────────────
  // Each cell: one big Total, with Passed / Pending / Failed as small colour-
  // coded figures beneath (legend above names the colours). A thin underline
  // marks advance (green) or elimination (red). The same body powers the pinned
  // Running-Total column on the right.
  const HAIR = '1px solid rgba(255,255,255,.07)';
  // Big white number = QUALIFIED revenue (passed + pending — what counts).
  // Trio below: Total (green), Pending (orange), Failed (red).
  const moneyTrio = (wb) => el('div', { style: { display: 'flex', gap: '13px', justifyContent: 'center', whiteSpace: 'nowrap', marginTop: '5px', fontFamily: DISP, fontSize: '.84rem', letterSpacing: '.01em' } },
    el('span', { style: { color: WHITE,  opacity: wb.total  ? '1' : '.5' } }, money(wb.total)),
    el('span', { style: { color: ORANGE } }, money(wb.pending)),
    el('span', { style: { color: RED,    opacity: wb.failed ? '1' : '.5' } }, money(wb.failed)));
  const cellBody = (wb, mode) => el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center' } },
    el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '6px' } },
      (mode === 'out' ? el('span', { style: { color: RED, fontSize: '1rem' } }, '☠') : null),
      el('span', { style: { fontFamily: DISP, fontWeight: '700', lineHeight: '1', fontSize: mode === 'total' ? '1.55rem' : '1.3rem', color: mode === 'out' ? DIM : GREEN, textDecoration: mode === 'out' ? 'line-through' : 'none' } }, money((wb.passed || 0) + (wb.pending || 0)))),
    moneyTrio(wb));

  const headCell = (rd) => el('th', { style: { position: 'sticky', top: '0', zIndex: '2', padding: '11px 18px', boxShadow: 'inset 0 -2px 0 ' + ORANGE, whiteSpace: 'nowrap', textAlign: 'center', background: '#000' } },
    el('div', { style: { fontFamily: DISP, fontSize: '1.05rem', color: ORANGE, lineHeight: '1', letterSpacing: '.04em' } }, 'Week ' + rd.week),
    el('div', { style: { fontFamily: DISP, fontSize: '.64rem', color: WHITE, opacity: '.5', letterSpacing: '.1em', marginTop: '3px', textTransform: 'uppercase' } }, new Date(rd.iso + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })));

  const statusPill = (r) => {
    const champ = r.rep === R.champion;
    const col = champ ? ORANGE : (r.alive ? GREEN : MAG);
    const txt = champ ? 'Champion' : (r.alive ? 'Still standing' : 'Out · Wk ' + (r.elimWeek + 1));
    return el('div', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '5px', fontFamily: DISP, fontSize: '.72rem', letterSpacing: '.08em', textTransform: 'uppercase', color: col } },
      el('span', { style: { width: '7px', height: '7px', borderRadius: '0', background: col, display: 'inline-block', flex: '0 0 auto' } }), txt);
  };
  const nameCell = (r) => el('td', { style: { position: 'sticky', left: '0', zIndex: '1', background: '#000', boxShadow: 'inset -2px 0 0 ' + CYAN, borderBottom: HAIR, padding: '12px 20px 12px 16px', whiteSpace: 'nowrap' } },
    el('div', { style: { fontFamily: DISP, fontSize: '1.35rem', letterSpacing: '.02em', textTransform: 'uppercase', lineHeight: '1.05', color: r.rep === R.champion ? RED : (r.alive ? WHITE : DIM) } },
      (r.rep === R.champion ? '☠ ' : '') + firstLast(r.rep)),
    statusPill(r));

  const gridCell = (r, i) => {
    const base = { fontFamily: DISP, textAlign: 'center', padding: '12px 18px', borderRight: HAIR, borderBottom: HAIR, whiteSpace: 'nowrap', minWidth: '188px', background: '#000' };
    const c = r.cells[i];
    if (!c) return el('td', { style: Object.assign({}, base, { color: '#222', fontSize: '1rem' }) }, '·');
    const wb = (weekBreak[R.rounds[i].iso] && weekBreak[R.rounds[i].iso][r.rep]) || EMPTY_RB;
    return el('td', { style: Object.assign({}, base, { boxShadow: 'inset 0 -3px 0 ' + (c.advanced ? GREEN : RED) }) },
      cellBody(wb, c.advanced ? 'alive' : 'out'));
  };

  // Running-total column, pinned to the right so it's always visible.
  const totalHead = el('th', { style: { position: 'sticky', right: '0', top: '0', zIndex: '4', background: '#000', boxShadow: 'inset 2px 0 0 ' + CYAN + ', inset 0 -2px 0 ' + ORANGE, textAlign: 'center', padding: '11px 18px', whiteSpace: 'nowrap' } },
    el('div', { style: { fontFamily: DISP, fontSize: '1.05rem', color: CYAN, lineHeight: '1', letterSpacing: '.06em', textTransform: 'uppercase' } }, 'Total'),
    el('div', { style: { fontFamily: DISP, fontSize: '.6rem', color: WHITE, opacity: '.45', letterSpacing: '.12em', marginTop: '3px', textTransform: 'uppercase' } }, 'Running'));
  const totalCell = (r) => el('td', { style: { position: 'sticky', right: '0', zIndex: '1', background: '#000', boxShadow: 'inset 2px 0 0 ' + CYAN, borderBottom: HAIR, padding: '12px 18px', whiteSpace: 'nowrap', textAlign: 'center' } },
    cellBody(r.runTotal || EMPTY_RB, 'total'));

  const dot = (c) => el('span', { style: { display: 'inline-block', width: '8px', height: '8px', borderRadius: '0', background: c, marginRight: '6px' } });
  const legend = el('div', { style: { display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap', padding: '11px 16px', fontFamily: DISP, fontSize: '.7rem', letterSpacing: '.1em', textTransform: 'uppercase' } },
    el('span', { style: { color: WHITE, opacity: '.45' } }, 'Weekly revenue'),
    el('span', { style: { color: WHITE, opacity: '.95', fontWeight: '700' } }, dot(GREEN), 'Qualified'),
    el('span', { style: { color: WHITE, opacity: '.85' } }, dot(WHITE), 'Total'),
    el('span', { style: { color: WHITE, opacity: '.85' } }, dot(ORANGE), 'Pending'),
    el('span', { style: { color: WHITE, opacity: '.85' } }, dot(RED), 'Failed'));

  // (Week-by-week gauntlet grid retired — the clean view is the view.)

  // ── CLEAN VIEW (default) — answers the one question everyone has:
  // "am I still in?" Alive reps big on top with this week + season qualified;
  // eliminated reps collapsed below, grouped by the week they went out. The
  // full week-by-week money matrix stays one toggle away.
  const curIdx = R.rounds.length - 1;
  const curRd = R.rounds[curIdx];
  const aliveRows = rows.filter(r => r.alive);
  const outRows = rows.filter(r => !r.alive);
  const secHead = (label, col, count) => el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px', padding: '18px 16px 8px', fontFamily: DISP, textTransform: 'uppercase' } },
    el('span', { style: { color: col, fontSize: '1.15rem', letterSpacing: '.14em' } }, label),
    el('span', { style: { color: WHITE, opacity: '.4', fontSize: '.75rem', letterSpacing: '.1em' } }, count));
  const _mmdd = (iso) => new Date(iso + 'T00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
  // Per-round placement — contenders are already ranked by that round's
  // qualifying revenue, so index = finishing place. Powers the "why you
  // advanced / why you were cut" context on cards + the rep drill.
  const _lmsPlace = R.rounds.map(rd => {
    const m = new Map();
    (rd.contenders || []).forEach((c, i) => m.set(c.rep, { place: i + 1, of: rd.before, advanceN: rd.advanceN, qualifier: !!rd.qualifier, advanced: !!c.advanced }));
    return m;
  });
  // Overall FINISH place — tournament style: everyone cut in a round ties
  // just below that round's survivors (cut when 12 advanced → T-13).
  const _lmsFinishPlace = (elimWeek) => {
    const rd = R.rounds[elimWeek];
    return rd ? (rd.advanceN || 0) + 1 : null;
  };
  const _lmsPlaceLine = (p, rd) => {
    if (!p || !rd) return null;
    return 'Wk ' + rd.week + ': #' + p.place + ' of ' + p.of
      + (p.qualifier ? ' · qualifier — any qualifying sale advances' : ' · top ' + p.advanceN + ' advance');
  };
  // ── ⏳ PENDING REVENUE — everything not yet confirmed for a round, split
  // by the service cutoff (the Friday after the comp day):
  //   · Scheduled in time — service date on/before the cutoff (or already
  //     done): counts as pending-passing unless the audit fails.
  //   · Unscheduled — no service date yet: counts for NOW, but flips to
  //     failed if the cutoff passes unserviced. The watch list.
  //   · Past the cutoff — scheduled AFTER the deadline: NOT counted as
  //     pending (already failed) — pull the appointment up and it counts
  //     again on the next sync.
  const openLmsPendingModal = (startIdx) => {
    let mIdx = Math.max(0, startIdx);
    const overlay = el('div', { class: 'modal-overlay' });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    const card = el('div', { class: 'card w-full max-w-3xl my-8 flex flex-col overflow-hidden', style: { maxHeight: 'calc(100vh - 64px)' } });
    overlay.append(card); document.body.append(overlay);
    const _dOf = (d) => (d && !isNaN(d)) ? (d.getMonth() + 1) + '/' + d.getDate() : '—';
    const render = () => {
      card.innerHTML = '';
      const rd = R.rounds[mIdx];
      const pool = (windowed || []).filter(x => {
        if (typeof _indicatorDeptOf === 'function' && _indicatorDeptOf(x) !== 'd2d') return false;
        if (typeof frPendingServiced === 'function' && !frPendingServiced(x)) return false;
        if (!x.rep) return false;
        const d = _parseIndicatorDay(x);
        return d && !isNaN(d) && d.toISOString().slice(0, 10) === rd.iso;
      }).filter(x => {
        if ((Number(x.initialPrice) || 0) < 99) return false;                                          // Last Resort — failed for good
        if (typeof scAuditPassed === 'function' && scAuditPassed(x.customerFlags)) return false;       // already confirmed passing
        if (SC_FAIL_RE.test(x.customerFlags || '')) return false;                                      // failed audit — gone either way
        return true;
      });
      const groups = { intime: [], open: [], late: [] };
      pool.forEach(x => {
        const st = (typeof lmsServicedStatus === 'function') ? lmsServicedStatus(x) : 'na';
        (st === 'late' ? groups.late : st === 'open' ? groups.open : groups.intime).push(x);
      });
      const sum = (arr) => arr.reduce((a, x) => a + (Number(x.contractValue) || 0), 0);
      const deadline = pool.length && typeof lmsServiceDeadline === 'function' ? lmsServiceDeadline(pool[0]) : null;
      const section = (title, arr, color, note) => el('div', { class: 'mb-4' },
        el('div', { class: 'flex items-baseline justify-between gap-2 mb-1 flex-wrap' },
          el('div', { class: 'text-[10px] font-black uppercase tracking-widest', style: { color } }, title),
          el('div', { class: 'text-[11px] font-bold tabular-nums', style: { color } }, arr.length + ' accts · ' + money(sum(arr)))),
        note ? el('div', { class: 'text-[10px] mb-1.5', style: { color: 'var(--text-muted)' } }, note) : null,
        arr.length === 0
          ? el('div', { class: 'text-[11px] italic py-1.5', style: { color: 'var(--text-subtle)' } }, 'None.')
          : el('div', { class: 'scroll-x rounded-lg border', style: { borderColor: 'var(--border)' } },
              el('table', { class: 'w-full text-[11px]' },
                el('thead', { class: 'text-[9px] uppercase tracking-wider', style: { background: 'var(--card-2)', color: 'var(--text-muted)' } },
                  el('tr', {},
                    el('th', { class: 'text-left pl-3 pr-2 py-1.5' }, 'Rep'),
                    el('th', { class: 'text-left px-2 py-1.5' }, 'Cust ID'),
                    el('th', { class: 'text-left px-2 py-1.5' }, 'Customer'),
                    el('th', { class: 'text-right px-2 py-1.5' }, 'Contract'),
                    el('th', { class: 'text-left pl-2 pr-3 py-1.5' }, 'Service Date'))),
                el('tbody', {},
                  ...arr.slice().sort((a, b) => (Number(b.contractValue) || 0) - (Number(a.contractValue) || 0)).map(x => {
                    const svc = (typeof _scParseServiced === 'function') ? _scParseServiced(x.servicedDate) : null;
                    return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
                      el('td', { class: 'pl-3 pr-2 py-1.5 whitespace-nowrap' }, firstLast(x.rep)),
                      el('td', { class: 'px-2 py-1.5 tabular-nums', style: { color: 'var(--text-muted)' } }, x.customerId || '—'),
                      el('td', { class: 'px-2 py-1.5 whitespace-nowrap' }, x.customer || '—'),
                      el('td', { class: 'px-2 py-1.5 text-right tabular-nums font-semibold' }, money(Number(x.contractValue) || 0)),
                      el('td', { class: 'pl-2 pr-3 py-1.5 tabular-nums whitespace-nowrap', style: { color } }, svc ? _dOf(svc) : 'not scheduled'));
                  })))));
      card.append(
        el('div', { class: 'px-5 py-3 flex items-center justify-between gap-3 flex-wrap border-b', style: { borderColor: 'var(--border)' } },
          el('div', { class: 'flex items-center gap-2 flex-wrap' },
            el('h2', { class: 'text-lg font-bold' }, 'Pending Revenue'),
            el('select', {
              class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer',
              style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
              onchange: (e) => { mIdx = Number(e.target.value); render(); },
            }, ...R.rounds.map((r2, i2) => { const o = el('option', { value: String(i2) }, 'Week ' + r2.week + ' · ' + _mmdd(r2.iso)); if (i2 === mIdx) o.selected = true; return o; }))),
          el('button', { class: 'text-xl leading-none text-muted-', style: { lineHeight: '1' }, onclick: () => overlay.remove() }, '×')),
        el('div', { class: 'px-5 py-2 text-[11px] font-bold tabular-nums border-b flex items-center gap-4 flex-wrap', style: { borderColor: 'var(--border)' } },
          el('span', { style: { color: '#A9441F' } }, '⏳ ' + money(sum(groups.intime) + sum(groups.open)) + ' counting as pending'),
          el('span', { style: { color: '#DC2626' } }, '🚫 ' + money(sum(groups.late)) + ' out of window'),
          deadline ? el('span', { style: { color: 'var(--text-muted)' } }, 'service cutoff: ' + _dOf(deadline)) : null),
        el('div', { class: 'p-4 overflow-auto' },
          section('📅 Scheduled in time', groups.intime, '#DF643A', 'Service booked (or done) on/before the cutoff — stays pending until the audit lands.'),
          section('⏳ Unscheduled — at risk', groups.open, '#A9441F', 'No service date yet. Counting for now, but flips to failed if the cutoff passes unserviced.'),
          section('🚫 Scheduled past the cutoff — not counting', groups.late, '#DC2626', 'Booked after the deadline, so already excluded. Pull the appointment up before the cutoff and it counts again on the next sync.')));
    };
    render();
  };
  // ── Rep drill — click any rep (survivor card or eliminated chip) for their
  // round-by-round production: qualified / total / pending / failed per comp
  // day, the season total, and a jump to their full player card. Settles any
  // "wait, why am I out?" question with the receipts.
  const openLmsRepModal = (r) => {
    const played = R.rounds.map((rd, i) => {
      const c = r.cells[i];
      if (!c) return null;                                   // already out this round
      const wb = (weekBreak[rd.iso] && weekBreak[rd.iso][r.rep]) || EMPTY_RB;
      return { rd, c, wb, qual: (wb.passed || 0) + (wb.pending || 0) };
    }).filter(Boolean);
    const overlay = el('div', { class: 'modal-overlay' });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    const th2 = (lab, right) => el('th', { style: { fontFamily: DISP, fontSize: '.6rem', letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,.45)', padding: '8px 10px', textAlign: right ? 'right' : 'left', whiteSpace: 'nowrap' } }, lab);
    const td2 = (val, color, right) => el('td', { style: { fontFamily: DISP, fontSize: '.95rem', color: color || WHITE, padding: '7px 10px', textAlign: right ? 'right' : 'left', whiteSpace: 'nowrap', borderTop: HAIR } }, val);
    const champ = r.rep === R.champion;
    const rt = r.runTotal || EMPTY_RB;
    const card = el('div', { class: 'card w-full max-w-lg my-8 flex flex-col', style: { background: '#0A0A0A', border: '1px solid rgba(255,255,255,.18)', maxHeight: 'calc(100vh - 64px)', overflow: 'hidden' } },
      el('div', { style: { padding: '16px 18px 12px', borderBottom: '1px solid rgba(255,255,255,.1)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' } },
        el('div', {},
          el('div', { style: { fontFamily: DISP, fontSize: '1.5rem', textTransform: 'uppercase', color: champ ? ORANGE : WHITE, lineHeight: '1' } }, (champ ? '👑 ' : '') + firstLast(r.rep)),
          el('div', { style: { fontFamily: DISP, fontSize: '.62rem', letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,.4)', marginTop: '5px' } },
            (r.office || '—') + ' · ' + (champ ? 'champion' : r.alive ? 'still standing' : (() => {
              const pl = (_lmsPlace[r.elimWeek] || new Map()).get(r.rep);
              const fin = _lmsFinishPlace(r.elimWeek);
              return 'out week ' + (r.elimWeek + 1)
                + (fin ? ' · T-#' + fin + ' overall of ' + rows.length : '')
                + (pl ? ' · that round #' + pl.place + ' of ' + pl.of + (pl.qualifier ? ' (no qualifying sale)' : ' — top ' + pl.advanceN + ' advanced') : '');
            })()))),
        el('button', { style: { color: 'rgba(255,255,255,.6)', fontSize: '22px', lineHeight: '1', background: 'none', border: 'none', cursor: 'pointer' }, onclick: () => overlay.remove() }, '×')),
      el('div', { style: { overflowY: 'auto', padding: '4px 8px 0' } },
        el('table', { style: { width: '100%', borderCollapse: 'collapse' } },
          el('thead', {}, el('tr', {}, th2('Week'), th2('Qualified', true), th2('Total', true), th2('Pending', true), th2('Failed', true), th2('Result', true))),
          el('tbody', {},
            ...played.map(p => el('tr', {},
              td2('Wk ' + p.rd.week + ' · ' + _mmdd(p.rd.iso), 'rgba(255,255,255,.75)'),
              td2(money(p.qual), p.qual ? GREEN : 'rgba(255,255,255,.3)', true),
              td2(money(p.wb.total), 'rgba(255,255,255,.75)', true),
              td2(money(p.wb.pending), p.wb.pending ? ORANGE : 'rgba(255,255,255,.3)', true),
              td2(money(p.wb.failed), p.wb.failed ? RED : 'rgba(255,255,255,.3)', true),
              td2((() => {
                const pl = (_lmsPlace[R.rounds.indexOf(p.rd)] || new Map()).get(r.rep);
                const tag = p.c.advanced ? 'Advanced' : 'Cut';
                return pl ? '#' + pl.place + '/' + pl.of + ' · ' + tag : tag;
              })(), p.c.advanced ? GREEN : RED, true))),
            el('tr', {},
              td2('Season', WHITE),
              td2(money((rt.passed || 0) + (rt.pending || 0)), GREEN, true),
              td2(money(rt.total || 0), WHITE, true),
              td2(money(rt.pending || 0), ORANGE, true),
              td2(money(rt.failed || 0), RED, true),
              td2('', WHITE, true))))),
      el('div', { style: { padding: '12px 18px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
        el('div', { style: { fontFamily: DISP, fontSize: '.58rem', letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,.35)' } },
          'Qualified = passed + pending on the comp day · serviced by the following Friday'),
        el('button', {
          style: { fontFamily: DISP, fontSize: '.75rem', letterSpacing: '.08em', textTransform: 'uppercase', color: '#0A0A0A', background: GREEN, border: 'none', borderRadius: '0', padding: '8px 14px', cursor: 'pointer' },
          onclick: () => {
            overlay.remove();
            try {
              const nm = getCanonicalRepName(r.rep);
              openIndicatorRepCard(_enrichRepFromRawSales(nm, state._indicatorRawSales || []), []);
            } catch (e) { toast('Player card unavailable', 'warn'); }
          },
        }, 'Full player card →')));
    overlay.append(card);
    document.body.append(overlay);
  };
  // Survivor CARDS in a responsive grid — no dead middle. Rank badge top-right,
  // week + season side by side, green underline = posted this week.
  // Card stats: NEXT round (live $ if today's a comp day, else its date),
  // LAST round (the one that advanced them — was misread as "$0 this week"
  // when the next Saturday hadn't happened yet), and Competition total.
  const _isoLocal = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const _todayIso = (() => { const t = new Date(); t.setHours(0, 0, 0, 0); return _isoLocal(t); })();
  const _lmsLiveNow = !!(curRd && curRd.iso === _todayIso);
  const _lmsNextDay = (() => {
    const after = curRd ? curRd.iso : '';
    const c2 = (typeof getActiveComp === 'function') ? (compOverride || getActiveComp()) : null;
    const days = (c2 && Array.isArray(c2.compDays)) ? c2.compDays.slice().sort() : null;
    if (days) return days.find(d => d > after && d >= _todayIso && !(_lmsLiveNow && d === curRd.iso)) || null;
    // auto-Saturday mode: the next Saturday after the current round / today
    const t = new Date(); t.setHours(0, 0, 0, 0);
    for (let k = 0; k < 15; k++) {
      const d = new Date(t); d.setDate(d.getDate() + k);
      const iso = _isoLocal(d);
      if (d.getDay() === 6 && iso > after && iso >= _todayIso) return iso;
    }
    return null;
  })();
  const cleanCard = (r, rank) => {
    const champ = r.rep === R.champion;
    // Last round = the round that decided their fate; when today IS a comp
    // day the latest round is live, so "last" steps back one.
    const lastRd = _lmsLiveNow ? (R.rounds.length > 1 ? R.rounds[R.rounds.length - 2] : null) : curRd;
    const qualAt = (rd) => { if (!rd) return 0; const wb = (weekBreak[rd.iso] && weekBreak[rd.iso][r.rep]) || EMPTY_RB; return (wb.passed || 0) + (wb.pending || 0); };
    const liveQual = _lmsLiveNow ? qualAt(curRd) : 0;
    const lastQual = qualAt(lastRd);
    const _stat = (label, val, color) => el('div', {},
      el('div', { style: { fontFamily: DISP, fontSize: '.56rem', color: 'rgba(255,255,255,.4)', letterSpacing: '.12em', textTransform: 'uppercase', whiteSpace: 'nowrap' } }, label),
      el('div', { style: { fontFamily: DISP, fontSize: '1.25rem', lineHeight: '1.1', color, whiteSpace: 'nowrap' } }, val));
    return el('div', { style: {
      position: 'relative', borderRadius: '0', padding: '14px 16px 12px', cursor: 'pointer',
      background: champ ? 'linear-gradient(135deg, rgba(240,172,30,.16), #323230 65%)' : '#323230',
      border: '1px solid ' + (champ ? ORANGE : (rank <= 3 ? 'rgba(240,172,30,.45)' : 'rgba(255,255,255,.12)')),
      boxShadow: 'inset 0 -3px 0 ' + ((_lmsLiveNow ? liveQual : lastQual) ? GREEN : 'rgba(255,255,255,.08)'),
    },
      'data-lms': (r.rep + ' ' + firstLast(r.rep)).toLowerCase(),
      title: 'Week-by-week production for ' + firstLast(r.rep),
      onclick: () => openLmsRepModal(r),
    },
      el('div', { style: { position: 'absolute', top: '8px', right: '12px', fontFamily: DISP, fontSize: '1.5rem', lineHeight: '1', color: rank <= 3 ? ORANGE : 'rgba(255,255,255,.18)' } }, '#' + rank),
      el('div', { style: { fontFamily: DISP, fontSize: '1.15rem', textTransform: 'uppercase', color: champ ? ORANGE : WHITE, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: '44px' } }, (champ ? '👑 ' : '') + firstLast(r.rep)),
      el('div', { style: { fontFamily: DISP, fontSize: '.6rem', letterSpacing: '.12em', color: 'rgba(255,255,255,.35)', textTransform: 'uppercase', marginBottom: '10px' } }, r.office || '—'),
      el('div', { style: { display: 'flex', gap: '14px', flexWrap: 'wrap' } },
        _lmsLiveNow
          ? _stat('Live · Wk ' + curRd.week, money(liveQual), liveQual ? GREEN : 'rgba(255,255,255,.25)')
          : (_lmsNextDay ? _stat('Next Round', _mmdd(_lmsNextDay), 'rgba(255,255,255,.55)') : null),
        lastRd ? _stat('Last Rd · Wk ' + lastRd.week, money(lastQual), lastQual ? GREEN : 'rgba(255,255,255,.25)') : null,
        _stat('Competition', money(_qual(r)), WHITE)),
      // Why they're still in — place taken in the deciding round + the rule.
      (() => {
        const ctxIdx = _lmsLiveNow ? R.rounds.length - 1 : R.rounds.length - 1;
        const ctxRd = lastRd || R.rounds[ctxIdx];
        const p = ctxRd ? (_lmsPlace[R.rounds.indexOf(ctxRd)] || new Map()).get(r.rep) : null;
        const line = _lmsPlaceLine(p, ctxRd);
        return line ? el('div', { style: { marginTop: '8px', fontFamily: DISP, fontSize: '.58rem', letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,.45)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, line) : null;
      })());
  };
  // Eliminated reps: compact name chips, grouped by exit week — a whole comp's
  // casualties fit on one screen instead of 400 rows.
  const outGroups = {};
  outRows.forEach(r => { (outGroups[r.elimWeek] = outGroups[r.elimWeek] || []).push(r); });
  const outSections = Object.keys(outGroups).map(Number).sort((a, b) => b - a).map(k => el('div', { style: { padding: '4px 16px 8px' } },
    el('div', { style: { padding: '10px 0 8px', fontFamily: DISP, fontSize: '.85rem', letterSpacing: '.14em', textTransform: 'uppercase', color: MAG } },
      'Out · Week ' + (k + 1) + (R.rounds[k] ? ' · ' + _mmdd(R.rounds[k].iso) : '') + ' — ' + outGroups[k].length + ' rep' + (outGroups[k].length === 1 ? '' : 's')
      + (_lmsFinishPlace(k) ? ' · finish T-#' + _lmsFinishPlace(k) + ' of ' + rows.length : '')),
    el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
      // Sorted by the place they took in their elimination round — the top
      // of each group is the closest miss (one spot below the cut line).
      ...outGroups[k]
        .map(r => ({ r, pl: (_lmsPlace[k] || new Map()).get(r.rep) || null }))
        .sort((a, b) => (a.pl ? a.pl.place : 9999) - (b.pl ? b.pl.place : 9999) || _qual(b.r) - _qual(a.r))
        .map(({ r, pl }) => el('span', {
          'data-lms': (r.rep + ' ' + firstLast(r.rep)).toLowerCase(),
          style: { fontFamily: DISP, textTransform: 'uppercase', fontSize: '.98rem', letterSpacing: '.03em',
                   padding: '6px 14px', borderRadius: '0', border: '1px solid rgba(255,255,255,.2)',
                   color: WHITE, whiteSpace: 'nowrap', cursor: 'pointer' },
          title: firstLast(r.rep) + ' — ' + money(_qual(r)) + ' qualified · out week ' + (k + 1)
            + (pl ? ' · that round #' + pl.place + ' of ' + pl.of + ' (top ' + pl.advanceN + ' advanced' + (pl.place === pl.advanceN + 1 ? ' — ONE spot short' : '') + ')' : '')
            + (_lmsFinishPlace(k) ? ' · finished T-#' + _lmsFinishPlace(k) + ' of ' + rows.length : '') + ' · click for week-by-week production',
          onclick: () => openLmsRepModal(r),
        },
          pl ? el('span', { style: { color: pl.place === pl.advanceN + 1 ? ORANGE : MAG, marginRight: '8px', fontWeight: '900' } }, '#' + pl.place) : null,
          firstLast(r.rep),
          el('span', { style: { color: 'rgba(255,255,255,.55)', marginLeft: '8px' } }, money(_qual(r))))))));
  const cleanView = el('div', { style: { background: '#000', borderTop: '1px solid rgba(255,255,255,.08)' } },
    // Search — filters survivor cards AND eliminated chips in place
    // (show/hide, no re-render, so typing never loses focus).
    el('div', { style: { padding: '14px 16px 0' } },
      el('input', {
        type: 'text', placeholder: 'Search rep…',
        class: 'rounded-lg px-2.5 py-1 text-[11px] w-full',
        style: { maxWidth: '300px', background: '#323230', border: '1px solid rgba(255,255,255,.22)', color: '#fff' },
        oninput: (e) => {
          const q = e.target.value.trim().toLowerCase();
          cleanView.querySelectorAll('[data-lms]').forEach(n => {
            n.style.display = (!q || (n.getAttribute('data-lms') || '').includes(q)) ? '' : 'none';
          });
        },
      })),
    secHead(R.champion ? '👑 Champion' : 'Still Standing', GREEN, aliveRows.length + ' of ' + rows.length + ' reps'),
    el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(235px, 1fr))', gap: '10px', padding: '4px 16px 14px' } },
      ...aliveRows.map((r, i) => cleanCard(r, i + 1))),
    outRows.length ? secHead('Eliminated', MAG, outRows.length + ' reps') : null,
    ...outSections,
    el('div', { style: { padding: '12px 16px 16px', fontFamily: DISP, fontSize: '.62rem', letterSpacing: '.1em', color: 'rgba(255,255,255,.35)', textTransform: 'uppercase' } },
      'Green = qualified revenue (passed + pending) · Competition = cumulative qualified'));
  // ⏳ + 📸 live in the Comp Window bar (per Isaac) — light styling to
  // match the other bar controls.
  if (ctlHost && isAdminRole(state.profile?.role) && R.rounds.length) {
    const barBtn = (glyph, title, onclick) => el('button', {
      class: 'cursor-pointer transition hover:brightness-95 border rounded-full',
      style: { width: '26px', height: '26px', borderColor: 'var(--border-2)', background: 'var(--card)', display: 'grid', placeItems: 'center', fontSize: '13px', lineHeight: '1', padding: '0' },
      title, onclick,
    }, glyph);
    ctlHost.append(
      barBtn('⏳', 'Pending revenue — split by whether each account is scheduled to be serviced before the round cutoff', () => openLmsPendingModal(R.rounds.length - 1)),
      barBtn('📸', 'Download the survivors poster for the latest decided round (PNG — drop it straight in the group chat)', () => _lmsPosterDl && _lmsPosterDl()));
  }
  return el('div', { class: 'card', style: { padding: '0', border: '1px solid #000', background: '#000', overflow: 'hidden' } },
    hero,
    R.rounds.length
      ? el('div', { style: { padding: '12px 0 0' } }, cleanView)
      : el('div', { style: { fontFamily: DISP, color: MAG, textAlign: 'center', padding: '26px', fontSize: '1rem', background: '#000', textTransform: 'uppercase', letterSpacing: '.05em' } },
          (() => {
            const c = (typeof getActiveComp === 'function') ? (compOverride || getActiveComp()) : null;
            const days = c && Array.isArray(c.compDays) ? c.compDays : null;
            if (days && days.length === 0) return 'Season cleared — add comp days (admins: + Add day or Generate Season above)';
            if (days && days.length) {
              const future = days.filter(d => d >= new Date().toISOString().slice(0, 10)).sort()[0];
              return 'No qualifying sales on the scheduled comp days yet' + (future ? ' — next round ' + future : '');
            }
            return 'No Saturday rounds played in this window yet.';
          })()));
}

// ── NRLA — National RIDD League Association ────────────────────────────────
// Branch-vs-branch round-robin league, decoded from the 2025 workbook:
//   • Teams = branches. Every D2D rep counts under their home branch unless
//     the admin transfers them (👥 — same per-comp repBranchOverrides store
//     Spring Cleaning uses, so a rep knocking one market can compete for any
//     team).
//   • GOAL: each team's SERVICED revenue over the baseline window, normalized
//     to a 2-day pace (rev ÷ days × 2). Same one goal is used every round.
//     (2025 built it as the sum of each competing rep's "2-day average" —
//     identical math when the roster is the whole branch.)
//   • ROUNDS: consecutive 2-day blocks starting at the season start date,
//     skipping Sundays (2025: Jul 28-29 · 30-31 · Aug 1-2 · skip Sun · 4-5 …).
//   • SCORE: serviced revenue sold in the round (Contract Value of accounts
//     that have been serviced) vs the team's goal → % over/under goal.
//   • Matchup winner = the better % vs OWN goal (levels the field between
//     big and small branches). BYE = automatic win — verified against the
//     2025 standings. Standings = W-L; ties broken by cumulative % vs goal.
function isNrlaComp(comp) {
  const c = comp || (typeof getActiveComp === 'function' ? getActiveComp() : null);
  return !!(c && (c.scoring === 'nrla' || c.id === 'nrla' || /\bnrla\b/i.test(c.name || '')));
}
const _nrlaIso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
// Baseline window: explicit dates win; otherwise default to the 28 days
// ending the day before the season starts (a trailing average, like 2025).
function nrlaBaselineBounds(cfg) {
  let s = _nrlaDay(cfg.baselineStart), e = _nrlaDay(cfg.baselineEnd);
  if ((!s || !e) && cfg.start) {
    const st = _nrlaDay(cfg.start);
    if (st) {
      if (!e) { e = new Date(st); e.setDate(e.getDate() - 1); }
      if (!s) { s = new Date(e); s.setDate(s.getDate() - 27); }
    }
  }
  if (!s || !e || e < s) return null;
  return { s, e, days: Math.round((e - s) / 86400000) + 1 };
}
// Serviced = the account has actually been serviced (any time — v1 has no
// service deadline): a service on record, a serviced date, or a Serviced status.
function nrlaServiced(s) {
  if ((Number(s.services) || 0) > 0) return true;
  if (typeof _scParseServiced === 'function' && _scParseServiced(s.servicedDate)) return true;
  return /serviced/i.test(String(s.status || ''));
}
// ── Branch local time — time matters in this league: a trailing team may
// still have daylight to knock after another market's day has ended. Known
// branches default here; anything new falls back to Eastern until an admin
// sets it (⏰ on the board hero → saved to the comp config, synced to all). ──
const NRLA_BRANCH_TZ = {
  'ATLANTA': 'America/New_York', 'DETROIT': 'America/New_York', 'RALEIGH': 'America/New_York',
  'CHARLESTON': 'America/New_York', 'VIRGINIA BEACH': 'America/New_York', 'MYRTLE BEACH': 'America/New_York',
  'DESTIN': 'America/Chicago',   // FL panhandle runs Central
  'JOPLIN': 'America/Chicago',   // MO — also Central
};
const NRLA_TZ_SHORT = { 'America/New_York': 'ET', 'America/Chicago': 'CT', 'America/Denver': 'MT', 'America/Phoenix': 'AZ', 'America/Los_Angeles': 'PT' };
const _nrlaTitle = (t) => String(t || '').split(' ').map(w => w ? w[0] + w.slice(1).toLowerCase() : w).join(' ');
const nrlaBranchTzOf = (cfg, t) => (cfg && cfg.branchTz && cfg.branchTz[t]) || NRLA_BRANCH_TZ[t] || 'America/New_York';
const _nrlaTzTime = (z) => { try { return new Date().toLocaleTimeString('en-US', { timeZone: z, hour: 'numeric', minute: '2-digit' }); } catch (e) { return '—'; } };
const _nrlaTzHour = (z) => { try { return Number(new Intl.DateTimeFormat('en-US', { timeZone: z, hour: 'numeric', hour12: false, hourCycle: 'h23' }).format(new Date())); } catch (e) { return 12; } };
// Self-ticking branch-clock strip (one chip per time zone). Reused on the
// hero AND the rounds header — admins click a chip to set branch time zones.
function nrlaBranchClocks(teams, cfg, opts) {
  const o = opts || {};
  if (!teams || !teams.length) return null;
  const groups = new Map();
  teams.forEach(t => { const z = nrlaBranchTzOf(cfg, t); if (!groups.has(z)) groups.set(z, []); groups.get(z).push(t); });
  if (!groups.size) return null;
  const strip = el('div', { class: 'flex items-center gap-2 flex-wrap', style: o.style || {} });
  const live = [];
  [...groups.entries()].sort((a, b) => _nrlaTzHour(b[0]) - _nrlaTzHour(a[0])).forEach(([z, ts]) => {
    const sun = el('span', { style: { fontSize: '10px' } }, '');
    const timeSpan = el('span', { style: { fontWeight: '900', color: o.dark ? '#fff' : 'var(--text)' } }, '');
    const paint = () => {
      timeSpan.textContent = _nrlaTzTime(z);
      const h = _nrlaTzHour(z);
      sun.textContent = (h >= 6 && h < 21) ? '☀️' : '🌙';
    };
    paint();
    live.push(paint);
    strip.append(el('span', {
      title: ts.map(_nrlaTitle).join(', ') + ' — local time' + (o.RO ? '' : '. Click to set branch time zones.'),
      class: o.RO ? '' : 'cursor-pointer transition hover:brightness-110',
      style: Object.assign({
        display: 'inline-flex', alignItems: 'center', gap: '5px',
        padding: o.small ? '3px 9px' : '4px 11px', borderRadius: '0',
        fontSize: o.small ? '10px' : '11px', whiteSpace: 'nowrap', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis',
      }, o.dark
        ? { background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.18)', color: 'rgba(255,255,255,.85)' }
        : { background: 'var(--card-2)', border: '1px solid var(--border-2)', color: 'var(--text-muted)' }),
      onclick: o.RO ? null : () => openNrlaTzModal(teams, cfg, o.save),
    },
      sun, timeSpan,
      el('span', { style: { fontWeight: '900', color: '#F2148C' } }, NRLA_TZ_SHORT[z] || z),
      el('span', { style: { opacity: '.7', overflow: 'hidden', textOverflow: 'ellipsis' } },
        o.small ? ts.map(t => _nrlaTitle(t).split(' ').map(w => w.slice(0, 3)).join(' ')).join(' · ') : ts.map(_nrlaTitle).join(' · ')),
    ));
  });
  const iv = setInterval(() => {
    if (!strip.isConnected) { clearInterval(iv); return; }
    live.forEach(fn => fn());
  }, 15000);
  return strip;
}
function openNrlaTzModal(teams, cfg, save) {
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  const OPTS = [
    ['America/New_York', 'Eastern (ET)'], ['America/Chicago', 'Central (CT)'],
    ['America/Denver', 'Mountain (MT)'], ['America/Phoenix', 'Arizona (no DST)'],
    ['America/Los_Angeles', 'Pacific (PT)'],
  ];
  const card = el('div', { class: 'card w-full max-w-sm my-8 overflow-hidden flex flex-col' },
    el('div', { class: 'flex items-start justify-between gap-3 p-4 pb-2' },
      el('div', {},
        el('h2', { class: 'text-base font-bold' }, '⏰ Branch time zones'),
        el('div', { class: 'text-[11px] text-muted- mt-0.5' }, 'Drives the local-time clocks on the board. New markets default to Eastern.')),
      el('button', { class: 'text-2xl leading-none', style: { color: 'var(--text-muted)' }, onclick: () => overlay.remove() }, '×'),
    ),
    el('div', { class: 'px-4 pb-2' },
      ...teams.map(t => el('div', { class: 'flex items-center justify-between gap-3 py-2 border-b border-' },
        el('span', { class: 'text-sm font-semibold' }, _nrlaTitle(t)),
        el('select', {
          class: 'rounded-lg px-2.5 py-1 text-[11px] cursor-pointer',
          onchange: (e) => { cfg.branchTz[t] = e.target.value; },
        }, ...OPTS.map(([v, l]) => el('option', { value: v, selected: nrlaBranchTzOf(cfg, t) === v }, l))),
      )),
    ),
    el('div', { class: 'p-4 pt-3' },
      el('button', {
        class: 'w-full rounded-xl px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95',
        style: { background: 'var(--accent)', color: 'var(--accent-text)' },
        onclick: () => { overlay.remove(); save('branch time zones'); },
      }, 'Save'),
    ),
  );
  overlay.append(card);
  document.body.append(overlay);
}
