// ┌─ src/indicators/pacer-card.js ──────────────────────────────────────────
// │ Revenue Pacer, rebuilt (per Isaac, Nov 5 2026 — the approved mock-up):
// │ one VERDICT per stream — Hit / Ahead / On pace / Behind / Missed — with
// │ the $ gap to where the range's pace sits RIGHT NOW as the second number,
// │ a bar whose tick is the thing to beat (not 100%), one quiet line under
// │ it (what it takes from here), and the year as a context strip with a
// │ projection instead of a second percentage. Colors mean STATUS, never the
// │ stream: sage = ahead / hit, orange = behind / missed, charcoal = on pace.
// │ The math is the callers' (deptRangePacer / dashLensPacer): this file only
// │ draws what they hand in, plus the intra-day share of today's goal.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
const PACER_SAGE = '#5F6C5B', PACER_ORANGE = '#DF643A', PACER_INK = '#323230';
// "On pace" = within this share of the range's goal either side of the tick.
const PACER_ON_PACE_BAND = 0.03;
// How much of TODAY's goal should be in by now: the work day's clock, by rep type (local time). Inside sales runs
// 7–3 and 9–5 (per Isaac, Oct 2026); door-to-door and technicians default to 9–8 / 8–5 until Isaac sets otherwise.
const PACER_DAY_HOURS = { office: [7, 17], d2d: [9, 20], techs: [8, 17] };
// The live hours: Settings → Goals → Pacer hours (shared admin rule, per rep type), else the defaults above.
function pacerDayHours(type) {
  try {
    const r = typeof _adminRules === 'function' ? _adminRules() : null;
    const h = r && r.pacerHours && r.pacerHours[type];
    if (Array.isArray(h) && h.length === 2 && Number.isFinite(Number(h[0])) && Number.isFinite(Number(h[1])) && Number(h[1]) > Number(h[0])) return [Number(h[0]), Number(h[1])];
  } catch (e) { /* defaults */ }
  return PACER_DAY_HOURS[type] || PACER_DAY_HOURS.office;
}
function pacerDayFraction(type, now) {
  const h = pacerDayHours(type);
  const t = (now || new Date()); const x = t.getHours() + t.getMinutes() / 60;
  return Math.max(0, Math.min(1, (x - h[0]) / (h[1] - h[0])));
}
const _pacerUsd = (v) => (typeof fmt !== 'undefined' && fmt.usd0) ? fmt.usd0(v) : '$' + Math.round(v).toLocaleString();
const _pacerShort = (v) => { v = Number(v) || 0; return v >= 1e6 ? '$' + (v / 1e6).toFixed(v % 1e5 === 0 ? 1 : 2) + 'M' : v >= 1e5 ? '$' + Math.round(v / 1e3) + 'K' : _pacerUsd(v); };
const _pacerSigned = (v) => (v < 0 ? '−' : '+') + _pacerUsd(Math.abs(v));
const _pacerClock = (d) => { const h = d.getHours(), m = d.getMinutes(); return ((h % 12) || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' AM' : ' PM'); };

// The verdict for one stream. s = { actual, target, sp (share of the goal that should be in by now, 0–1), over
// (range finished), elapsed (anything of the range gone yet) }.
function pacerVerdict(s) {
  const target = Number(s.target) || 0, actual = Number(s.actual) || 0;
  if (!(target > 0)) return { kind: 'none', color: 'var(--text-muted)', label: '', gap: 0, expected: 0 };
  const expected = target * Math.max(0, Math.min(1, Number(s.sp) || 0));
  const gap = actual - expected;
  if (actual >= target) return { kind: 'hit', color: PACER_SAGE, label: 'Hit', gap: actual - target, expected };
  if (s.over) return { kind: 'missed', color: PACER_ORANGE, label: 'Missed', gap: actual - target, expected };
  if (!s.elapsed) return { kind: 'start', color: PACER_INK, label: 'Starts today', gap, expected };
  if (Math.abs(gap) <= target * PACER_ON_PACE_BAND) return { kind: 'pace', color: PACER_INK, label: 'On pace', gap, expected };
  return gap > 0 ? { kind: 'ahead', color: PACER_SAGE, label: 'Ahead', gap, expected } : { kind: 'behind', color: PACER_ORANGE, label: 'Behind', gap, expected };
}
function _pacerIcon(kind) {
  const d = kind === 'hit' || kind === 'ahead' ? 'M4 12l5 5L20 7' : kind === 'behind' || kind === 'missed' ? 'M12 5v14M5 12l7 7 7-7' : 'M5 12h14';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '11'); svg.setAttribute('height', '11'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '3'); svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); svg.appendChild(p);
  return svg;
}
function _pacerChip(v) {
  if (v.kind === 'none') return null;
  return el('div', { class: 'inline-flex items-center gap-1.5 shrink-0 uppercase font-bold', style: { padding: '3px 9px', background: v.color, color: '#fff', fontSize: '10px', letterSpacing: '.06em' } },
    _pacerIcon(v.kind), v.label);
}
// A bar with the pace tick. pct / tick in 0–1.
// split (optional) = share of the fill, 0–1, drawn solid; the rest of the fill is the same color at 55% (the
// Loyalty Total bar: renewals solid, overflow new sales lighter).
function _pacerBar(pct, tick, color, h, tickTip, split) {
  const w = Math.max(0, Math.min(1, pct));
  return el('div', { style: { position: 'relative', height: h + 'px', background: 'var(--border)' } },
    el('div', { style: { position: 'absolute', left: 0, top: 0, bottom: 0, width: (w * 100).toFixed(2) + '%', background: color, transition: 'width .3s', opacity: split != null ? '.55' : '1' } }),
    split != null ? el('div', { style: { position: 'absolute', left: 0, top: 0, bottom: 0, width: (w * Math.max(0, Math.min(1, split)) * 100).toFixed(2) + '%', background: color, transition: 'width .3s' } }) : null,
    tick != null ? el('div', { title: tickTip || '', style: { position: 'absolute', left: (Math.max(0, Math.min(1, tick)) * 100).toFixed(2) + '%', top: '-4px', bottom: '-4px', width: '2px', background: 'var(--text)' } }) : null);
}

// One stream block. s = { label, sub, actual, target, sp, over, elapsed, tickLabel, tip, need, left, avgSale, annual: { actual, target, sp }, hint }
function _pacerStream(s, o) {
  const v = pacerVerdict(s);
  const phone = o.phone, big = phone ? '34px' : '36px';
  const pct = s.target > 0 ? s.actual / s.target : 0;
  const barColor = v.kind === 'none' ? 'var(--text-subtle)' : v.color;
  // Second number + what it means.
  let gapEl = null, gapNote = '';
  if (v.kind === 'hit') { gapEl = _pacerSigned(v.gap); gapNote = 'over the ' + _pacerUsd(s.target) + ' goal'; }
  else if (v.kind === 'missed') { gapEl = _pacerSigned(v.gap); gapNote = 'to the ' + _pacerUsd(s.target) + ' goal'; }
  else if (v.kind === 'start') { gapNote = _pacerUsd(s.target) + ' goal for ' + (o.rangeLabel || 'the range').toLowerCase(); }
  else if (v.kind !== 'none') { gapEl = _pacerSigned(v.gap); gapNote = (v.gap >= 0 ? 'over ' : 'to ') + (o.rangeLabel ? o.rangeLabel.toLowerCase() + '’s ' : '') + _pacerUsd(v.expected) + ' pace'; }
  // The quiet line under the bar: left = where the tick is; right = what it takes from here.
  const leftTxt = v.kind === 'none' ? (s.hint || '') : v.kind === 'hit' ? (s.left > 0 ? 'Goal hit · anything from here is upside' : 'Goal hit') : v.kind === 'missed' ? 'Range over' : v.kind === 'start' ? 'Nothing elapsed yet' : Math.round(pct * 100) + '% of goal' + (s.tickLabel ? ' · tick = ' + s.tickLabel : '');
  let rightTxt = '';
  if (v.kind === 'behind' || v.kind === 'pace' || v.kind === 'ahead' || v.kind === 'start') {
    const toGo = Math.max(0, s.target - s.actual);
    if (s.left > 1 && s.need > 0) rightTxt = _pacerUsd(s.need) + ' / work day · ' + s.left + ' left';
    else if (s.left === 1 && toGo > 0) rightTxt = s.avgSale > 0 ? '≈ ' + Math.max(1, Math.ceil(toGo / s.avgSale)) + ' more at ' + _pacerShort(s.avgSale) + ' avg' : _pacerUsd(toGo) + ' to go today';
    else if (s.left === 0) rightTxt = 'No work days left';
  }
  // The year strip: ytd of the annual goal, with the projection where the caller allows it.
  let annual = null;
  const A = s.annual;
  if (A && A.target > 0) {
    const ap = A.actual / A.target;
    const proj = (o.projection && A.sp > 0.03 && A.actual > 0) ? Math.max(A.actual, A.actual / A.sp) : null;
    const projOk = proj != null && proj >= A.target;
    annual = el('div', { class: 'flex items-center justify-between gap-3', style: { paddingTop: '10px', borderTop: '1px solid var(--border)', marginTop: '2px' },
      title: _pacerUsd(A.actual) + ' of the ' + _pacerUsd(A.target) + ' annual goal so far this year' + (A.sp > 0 ? ' · ' + Math.round(A.sp * 100) + '% of it should be in by today' : '') + (proj != null ? ' · projection = year to date ÷ the share of the year that should be in' : '') },
      el('div', { class: 'flex items-baseline gap-2 text-[11px] tabular-nums min-w-0 flex-wrap', style: { color: 'var(--text-muted)' } },
        el('span', { class: 'uppercase font-bold', style: { fontSize: '9px', letterSpacing: '.08em', color: 'var(--text-subtle)' } }, 'Year'),
        el('strong', { style: { color: 'var(--text)' } }, phone ? _pacerShort(A.actual) : _pacerUsd(A.actual)),
        el('span', {}, 'of ' + _pacerShort(A.target) + ' · ' + Math.round(ap * 100) + '%'),
        proj != null ? el('span', { class: 'font-semibold', style: { color: projOk ? PACER_SAGE : '#A9441F' } }, (phone ? '' : '· ') + (projOk ? 'on track for' : 'tracking to') + ' ~' + _pacerShort(proj)) : null),
      el('div', { class: 'shrink-0', style: { width: phone ? '96px' : '180px' } }, _pacerBar(ap, A.sp > 0 ? A.sp : null, ap >= 1 ? PACER_SAGE : (proj != null ? (projOk ? PACER_SAGE : PACER_ORANGE) : 'var(--text-subtle)'), 5)));
  }
  return el('div', { class: 'flex flex-col min-w-0', style: { gap: '10px' } },
    el('div', { class: 'flex items-center justify-between gap-2 min-w-0' },
      el('div', { class: 'flex items-center gap-2 min-w-0' },
        el('span', { style: { width: '9px', height: '9px', background: barColor, flexShrink: 0 }, 'aria-hidden': 'true' }),
        el('span', { class: 'font-bold whitespace-nowrap', style: { fontSize: phone ? '13px' : '14px' } }, s.label),
        s.sub ? el('span', { class: 'text-[11px] truncate', style: { color: 'var(--text-muted)' } }, s.sub) : null),
      _pacerChip(v)),
    el('div', { class: 'flex items-baseline gap-3 flex-wrap min-w-0' },
      el('span', { class: 'font-black tabular-nums', style: { fontSize: big, lineHeight: '1', letterSpacing: '-.01em' } }, _pacerUsd(s.actual)),
      gapEl ? el('span', { class: 'font-bold tabular-nums', style: { fontSize: '15px', color: v.color } }, gapEl) : null,
      gapNote ? el('span', { class: 'text-[12px]', style: { color: 'var(--text-muted)' } }, gapNote) : null),
    el('div', { class: 'flex flex-col', style: { gap: '5px' }, title: s.tip || '' },
      _pacerBar(pct, s.target > 0 && v.kind !== 'hit' && v.kind !== 'missed' ? s.sp : null, barColor, phone ? 14 : 12, s.target > 0 ? 'Where you should be by now: ' + _pacerUsd(v.expected) : '', s.parts && s.actual > 0 ? (Number(s.parts[0].value) || 0) / s.actual : null),
      // Breakout (Loyalty — per Isaac, Nov 6): the Total bar is renewals + the overflow new sales they take.
      s.parts ? el('div', { class: 'flex items-center gap-3 text-[11px] tabular-nums flex-wrap', style: { color: 'var(--text-muted)' } },
        ...s.parts.map((pt, i) => el('span', { class: 'inline-flex items-center gap-1.5' },
          el('span', { style: { width: '8px', height: '8px', background: barColor, opacity: i === 0 ? '1' : '.55', flexShrink: 0 }, 'aria-hidden': 'true' }),
          el('span', {}, pt.label + ' '), el('strong', { style: { color: 'var(--text)' } }, _pacerUsd(pt.value)))),
        el('span', {}, '= ' + s.label.toLowerCase())) : null,
      el('div', { class: 'flex items-center justify-between gap-3 text-[11px] tabular-nums', style: { color: 'var(--text-muted)' } },
        el('span', { class: 'truncate', style: v.kind === 'none' ? { color: 'var(--accent)', fontWeight: '600' } : {} }, leftTxt),
        rightTxt ? el('span', { class: 'shrink-0' }, rightTxt) : null)),
    annual);
}
// Side panel (admin dept pacer: offices; team pacer: reps). rows = [{ label, pct, tick, gap, text }]
function _pacerSide(side, o) {
  if (!side || !side.rows || !side.rows.length) return null;
  const phone = o.phone;
  return el('div', { class: 'flex flex-col min-w-0', style: { gap: '8px', ...(phone ? { paddingTop: '12px', borderTop: '1px solid var(--border)' } : { paddingLeft: '28px', borderLeft: '1px solid var(--border)' }) } },
    el('div', { class: 'uppercase font-bold', style: { fontSize: '9px', letterSpacing: '.08em', color: 'var(--text-subtle)' } }, side.title),
    el('div', { class: 'grid items-center text-[12px]', style: { gridTemplateColumns: (phone ? '92px' : '116px') + ' minmax(0, 1fr) ' + (side.textW || 68) + 'px', gap: '6px 10px' } },
      ...side.rows.flatMap(r => [
        el('div', { class: 'font-semibold truncate', title: r.label }, r.label),
        _pacerBar(r.pct, r.tick, r.color || 'var(--text)', 8, r.tickTip || ''),
        el('div', { class: 'font-bold tabular-nums text-right whitespace-nowrap', style: { color: r.color || 'var(--text)' } }, r.text)])),
    side.more ? el('div', { class: 'text-[11px] font-semibold', style: { color: 'var(--text-muted)' } }, side.more) : null);
}
// Today / Week / Year inside the card (per Isaac, Nov 5): it IS the page's date picker — the whole dashboard follows —
// one tap away instead of under Filters.
function _pacerRangeToggle(pre) {
  const opts = [['today', 'Today'], ['this_week', 'Week'], ['this_year', 'Year']];
  return el('div', { class: 'inline-flex border overflow-hidden shrink-0', style: { borderColor: 'var(--border-2)' }, role: 'group', 'aria-label': 'Pacer range' },
    ...opts.map(([v, l]) => el('button', { type: 'button', class: 'font-semibold', style: { padding: '5px 10px', fontSize: '11px', minHeight: '28px', border: 0, cursor: 'pointer', background: pre === v ? 'var(--accent)' : 'var(--card)', color: pre === v ? 'var(--accent-text)' : 'var(--text)' },
      onclick: () => { state.indicatorsView = 'range'; state.indicatorsRangePreset = v; state.indicatorsCustomStart = null; state.indicatorsCustomEnd = null; mountApp(); } }, l)));
}
// opts = { title, subtitle, note, streams, side, rangeToggle (preset key or null), projection }
function pacerCard(opts) {
  const phone = (() => { try { return window.matchMedia('(max-width: 640px)').matches; } catch (e) { return false; } })();
  const wide = (() => { try { return window.matchMedia('(min-width: 900px)').matches; } catch (e) { return false; } })();
  const o = { phone, rangeLabel: opts.rangeLabel, projection: !!opts.projection };
  const streams = (opts.streams || []).map(s => _pacerStream(s, o));
  const side = _pacerSide(opts.side, o);
  const two = streams.length === 2 && wide;
  const body = side
    ? el('div', { class: 'grid', style: { gridTemplateColumns: wide ? 'minmax(0, 1.6fr) minmax(0, 1fr)' : 'minmax(0, 1fr)', gap: wide ? '0 28px' : '12px' } }, streams[0], side)
    : el('div', { class: 'grid', style: { gridTemplateColumns: two ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)', columnGap: '32px', rowGap: '18px' } }, ...streams);
  return el('div', { class: 'card rev-goal-card', style: { padding: phone ? '14px' : '18px 20px' } },
    el('div', { class: 'flex items-center justify-between gap-2 flex-wrap', style: { marginBottom: '12px' } },
      // No descriptions on the card (per Isaac, Nov 7): the title, and the range toggle where there is one. The
      // subtitle and the goal formula live in the card's tooltip instead.
      el('div', { class: 'flex items-baseline gap-2 min-w-0 flex-wrap', title: [opts.subtitle, opts.note].filter(Boolean).join(' \u00b7 ') },
        el('span', { class: 'uppercase font-bold', style: { fontSize: '10px', letterSpacing: '.1em', color: 'var(--text)' } }, opts.title || 'Revenue Pacer')),
      opts.rangeToggle ? _pacerRangeToggle(opts.rangeToggle) : null),
    body);
}
