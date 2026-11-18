// ┌─ eodReport ──────────────────────────────────────────────────────────────
// │ The end-of-day rep report (per Isaac, Nov 18): what each Inside Sales /
// │ Loyalty rep sold today and how they are pacing, DM'd to them on Slack when
// │ the day closes. Pure: rows in, a metrics object and Slack blocks out — the
// │ job (jobs/rep-eod.js) does the reading and the sending.
// │
// │ Numbers follow the app, so a rep's DM and their Revenue Pacer agree:
// │  · sales = the indicators payload's rawSales (same rows the pacer reads),
// │    matched to the rep by FieldRoutes employee id (any of their branch ids,
// │    from fieldroutes_employees.employee_ids) and, failing that, by name;
// │  · revenue = contract value; subscriptions = rows;
// │  · ACV = revenue ÷ subscriptions with renewals and one-time services out
// │    (the TV board's rule); multi-year % = 18 mo+ ÷ (18 mo+ and 12 mo) with
// │    Sentricon and renewals out (the Indicators rule);
// │  · pacing = the annual goal spread over the rep's work days (Mon–Fri,
// │    company holidays off — indicators.js goalWorkDays/goalPlan, copied here),
// │    inside their selling window (profiles.year_goals.goal_start/goal_end);
// │  · close rate = Plaibook's sold ÷ qualified for the matching TV window
// │    (app_settings.close_rates_tv), with the pull time so a stale rate says so.
// │ Calendar: America/Denver — the office is in Salt Lake and the TV board
// │ already reads Mountain (functions/tvWindows.js).
// └─────────────────────────────────────────────────────────────────────────
import { localParts, BOARD_TZ } from '../../pay/functions/tvWindows.js';

export const EOD_DEFAULTS = {
  enabled: false,
  send_hour: 18,            // local hour (Mountain) the DMs go out; the job runs hourly and sends once a day
  acv_min: 700,             // "ACV should be above $700" (per Isaac, Nov 18)
  my_min: 60,               // "Multi-year % should be above 60%" (per Isaac, Nov 18)
  include: { revenue: true, subs: true, pace: true, acv: true, my: true, close: true },
  channel_webhook: '',      // optional: a team roll-up to a channel as well
};

// ── Calendar helpers (Mountain) ────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
const dayUTC = (y, m, d) => new Date(Date.UTC(y, m, d));   // a calendar day, timezone-free

// Company holidays — the same list as app/src/competitions/competitions.js (_companyHolidays).
const holidayCache = {};
function companyHolidays(year) {
  if (holidayCache[year]) return holidayCache[year];
  const nth = (month, weekday, n) => { const d = dayUTC(year, month, 1); let c = 0; for (;;) { if (d.getUTCDay() === weekday && ++c === n) return d; d.setUTCDate(d.getUTCDate() + 1); } };
  const last = (month, weekday) => { const d = dayUTC(year, month + 1, 0); while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() - 1); return d; };
  const observe = (d) => { const o = new Date(d); if (o.getUTCDay() === 6) o.setUTCDate(o.getUTCDate() - 1); else if (o.getUTCDay() === 0) o.setUTCDate(o.getUTCDate() + 1); return o; };
  const tg = nth(10, 4, 4), bf = new Date(tg); bf.setUTCDate(tg.getUTCDate() + 1);
  const list = [observe(dayUTC(year, 0, 1)), last(4, 1), observe(dayUTC(year, 6, 4)), nth(8, 1, 1), tg, bf, observe(dayUTC(year, 11, 24)), observe(dayUTC(year, 11, 25))];
  const map = {};
  for (let d of list) { let k = isoOf(d); while (map[k]) { const nd = new Date(d); nd.setUTCDate(nd.getUTCDate() - (nd.getUTCDay() === 1 ? 3 : 1)); d = nd; k = isoOf(d); } map[k] = true; }
  return (holidayCache[year] = map);
}
export function isWorkDay(iso) {   // Office Staff rule: Mon–Fri, company holidays off
  const d = new Date(iso + 'T00:00:00Z'), w = d.getUTCDay();
  if (w === 0 || w === 6) return false;
  const y = d.getUTCFullYear();
  return !(companyHolidays(y)[iso] || companyHolidays(y + 1)[iso]);
}
export function workDays(a, b) {   // inclusive iso range
  let n = 0; const d = new Date(a + 'T00:00:00Z'), e = new Date(b + 'T00:00:00Z');
  while (d <= e) { if (isWorkDay(isoOf(d))) n++; d.setUTCDate(d.getUTCDate() + 1); }
  return n;
}

// The four windows for an instant on the Mountain calendar: today, Sun–Sat week to date, month to date, year to date.
export function eodWindows(now, tz = BOARD_TZ) {
  const { y, m, d, w } = localParts(now, tz);
  const today = isoOf(dayUTC(y, m, d));
  // start..end = what has happened (to date); periodEnd = where the goal period really ends (Sat, month end, Dec 31),
  // so "needed per day" counts the days still to come, not just the ones already gone.
  return {
    today: { id: 'today', start: today, end: today, periodEnd: today, label: 'Today' },
    week: { id: 'this_week', start: isoOf(dayUTC(y, m, d - w)), end: today, periodEnd: isoOf(dayUTC(y, m, d - w + 6)), label: 'This week' },
    month: { id: 'this_month', start: isoOf(dayUTC(y, m, 1)), end: today, periodEnd: isoOf(dayUTC(y, m + 1, 0)), label: 'This month' },
    year: { id: 'this_year', start: y + '-01-01', end: today, periodEnd: y + '-12-31', label: 'This year' },
  };
}

// rawSales dateSold is "MM/DD/YY[YY] ..." (the RevHawk mirror's stamp) → iso.
export function saleIso(s) {
  const p = String((s && s.dateSold) || '').split(' ')[0].split('/');
  if (p.length !== 3) return '';
  let [m, d, y] = p.map(Number); if (!m || !d || !y) return '';
  if (y < 100) y += 2000;
  return y + '-' + pad(m) + '-' + pad(d);
}

const isRenewal = (s, renewalSources) => renewalSources ? renewalSources.has(String(s.source || '').trim()) : /renewal|\bror\b/i.test(String(s.source || ''));
const isOneTime = (s) => (Number(s.contract) || 0) <= 1 && !/sentricon/i.test(String(s.subscription || '')) || /one[\s-]*time/i.test(String(s.subscription || ''));
const isSentricon = (s) => /sentricon/i.test(String(s.subscription || ''));
const sig = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');

// The rep's own sales: by any of their FieldRoutes ids first, by name as the fallback (older rows carry no repId).
export function repSales(rawSales, prof, rosterRow) {
  const ids = new Set();
  if (prof && prof.fieldroutes_employee_id) ids.add(String(prof.fieldroutes_employee_id).trim());
  if (rosterRow) { ids.add(String(rosterRow.employee_id)); String(rosterRow.employee_ids || '').split(',').forEach(x => { const t = x.trim(); if (t) ids.add(t); }); }
  const nm = sig(prof && prof.full_name);
  return (rawSales || []).filter(s => (s.repId && ids.has(String(s.repId).trim())) || (!s.repId && nm && sig(s.rep) === nm));
}

// Goal share and plan for a window — indicators.js shareOf + goalPlan, inside the rep's selling window.
export function goalFor(prof, win, todayIso) {
  const annual = Number(prof && prof.annual_revenue_goal) || 0;
  if (!(annual > 0)) return null;
  const y = todayIso.slice(0, 4), yg = (prof && prof.year_goals) || {};
  const ok = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && String(v).slice(0, 4) === y;
  let ws = ok(yg.goal_start) ? yg.goal_start : y + '-01-01', we = ok(yg.goal_end) ? yg.goal_end : y + '-12-31';
  if (we < ws) we = ws;
  const total = workDays(ws, we); if (!total) return null;
  const pe = win.periodEnd || win.end;
  const cs = win.start > ws ? win.start : ws, ce = pe < we ? pe : we;   // the goal period clipped to the selling window
  if (cs > ce) return null;
  const inWin = workDays(cs, ce);
  const goal = annual * inWin / total;
  // Pace: work days already done (before today) ÷ the window's work days; need per remaining work day.
  const yesterday = isoOf(new Date(new Date(todayIso + 'T00:00:00Z').getTime() - 86400000));
  const done = todayIso <= cs ? 0 : workDays(cs, yesterday < ce ? yesterday : ce);
  const left = todayIso > ce ? 0 : workDays(todayIso < cs ? cs : todayIso, ce);
  return { annual, goal, total: inWin, done, left, sp: inWin ? done / inWin : 0 };
}

// One rep's numbers for every window + the verdicts the DM colors.
export function buildRepEod({ prof, rosterRow, rawSales, closeTv, renewalSources, now, cfg }) {
  const C = Object.assign({}, EOD_DEFAULTS, cfg || {});
  const W = eodWindows(now);
  const todayIso = W.today.end;
  const mine = repSales(rawSales, prof, rosterRow).map(s => Object.assign({ _d: saleIso(s) }, s)).filter(s => s._d);
  const out = { name: prof.full_name, date: todayIso, windows: {}, acv_min: Number(C.acv_min) || 700, my_min: Number(C.my_min) || 60, close_stale: null, close_pulled_at: closeTv && closeTv.pulled_at || null };
  const closeKey = String(prof.full_name || '').trim().toLowerCase();
  const closeAlias = closeTv && closeTv.aliases && closeTv.aliases[closeKey];
  for (const k of Object.keys(W)) {
    const win = W[k];
    const rows = mine.filter(s => s._d >= win.start && s._d <= win.end);
    const rev = rows.reduce((a, s) => a + (Number(s.contractValue) || 0), 0);
    const renew = rows.filter(s => isRenewal(s, renewalSources));
    const acvRows = rows.filter(s => !isRenewal(s, renewalSources) && !isOneTime(s));
    const acv = acvRows.length ? acvRows.reduce((a, s) => a + (Number(s.contractValue) || 0), 0) / acvRows.length : null;
    const myRows = rows.filter(s => !isSentricon(s) && !isRenewal(s, renewalSources));
    const multi = myRows.filter(s => (Number(s.contract) || 0) >= 18).length, twelve = myRows.filter(s => Number(s.contract) === 12).length;
    const my = (multi + twelve) ? multi / (multi + twelve) * 100 : null;
    const g = goalFor(prof, win, todayIso);
    let pace = null;
    if (g) {
      const expected = g.goal * (k === 'today' ? 1 : g.sp);   // today: the whole day's share once it's over
      const diff = rev - expected;
      pace = { goal: g.goal, expected, diff, pct: g.goal ? rev / g.goal * 100 : null, left: g.left, need: g.left > 0 && rev < g.goal ? (g.goal - rev) / g.left : 0, status: g.done === 0 && k !== 'today' ? 'start' : diff >= 0 ? 'ahead' : 'behind' };
    }
    let close = null;
    const blk = closeTv && closeTv.windows && closeTv.windows[win.id];
    if (blk) { const r = blk.reps && (blk.reps[closeKey] || (closeAlias ? blk.reps[String(closeAlias).toLowerCase()] : null)); if (r) close = { rate: r.rate == null ? null : r.rate * 100, sold: r.sold || 0, qualified: r.qualified || 0 }; }
    out.windows[k] = { label: win.label, start: win.start, end: win.end, revenue: rev, subs: rows.length, renewals: renew.length, acv, acv_n: acvRows.length, my, my_n: multi + twelve, multi, pace, close };
  }
  if (out.close_pulled_at) { const age = (now.getTime() - Date.parse(out.close_pulled_at)) / 3600000; out.close_stale = age > 6 ? Math.round(age) : null; }
  return out;
}

// ── Slack rendering ────────────────────────────────────────────────────────
const usd = (v) => '$' + Math.round(Number(v) || 0).toLocaleString('en-US');
const pct1 = (v) => v == null ? '—' : (Math.round(v * 10) / 10) + '%';
const dot = (ok) => ok == null ? '▫️' : ok ? '🟢' : '🔴';

export function renderEodBlocks(m, cfg) {
  const C = Object.assign({}, EOD_DEFAULTS, cfg || {}); const inc = Object.assign({}, EOD_DEFAULTS.include, C.include || {});
  const T = m.windows.today, first = (m.name || '').split(' ')[0] || 'there';
  const pretty = new Date(m.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const head = T.subs ? `${first} — ${T.subs} sub${T.subs === 1 ? '' : 's'} · ${usd(T.revenue)} today` : `${first} — no sales landed today`;
  const paceLine = (w) => {
    const p = w.pace; if (!p) return `*${w.label}:* ${usd(w.revenue)} · ${w.subs} sub${w.subs === 1 ? '' : 's'} _(no goal set)_`;
    const tail = p.status === 'start' ? `goal ${usd(p.goal)}` : `${p.status === 'ahead' ? '▲' : '▼'} ${usd(Math.abs(p.diff))} ${p.status === 'ahead' ? 'ahead of' : 'behind'} pace · ${Math.round(p.pct)}% of ${usd(p.goal)}`;
    const need = p.left > 1 && p.need > 0 ? ` · ${usd(p.need)}/day needed, ${p.left} days left` : p.left === 1 && p.need > 0 && w.label !== 'Today' ? ` · ${usd(p.need)} to go` : '';
    return `${dot(p.status === 'start' ? null : p.status === 'ahead')} *${w.label}:* ${usd(w.revenue)} · ${w.subs} sub${w.subs === 1 ? '' : 's'} · ${tail}${need}`;
  };
  const rows = [];
  if (inc.pace || inc.revenue || inc.subs) rows.push(['today', 'week', 'month', 'year'].map(k => paceLine(m.windows[k])).join('\n'));
  const q = [];
  if (inc.acv) { const a = m.windows.month; q.push(`${dot(a.acv == null ? null : a.acv >= m.acv_min)} *ACV (month):* ${a.acv == null ? '—' : usd(a.acv)} · target ${usd(m.acv_min)}+` + (T.acv != null ? ` · today ${usd(T.acv)}` : '')); }
  if (inc.my) { const a = m.windows.month; q.push(`${dot(a.my == null ? null : a.my >= m.my_min)} *Multi-year % (month):* ${pct1(a.my)} (${a.multi} of ${a.my_n}) · target ${m.my_min}%+` + (T.my != null ? ` · today ${pct1(T.my)}` : '')); }
  if (inc.close) {
    const a = m.windows.month, c = a.close;
    q.push(c ? `${c.rate == null ? '▫️' : '📞'} *Close rate (month, Plaibook):* ${pct1(c.rate)} · ${c.sold} of ${c.qualified} qualified` + (T.close && T.close.qualified ? ` · today ${pct1(T.close.rate)} (${T.close.sold}/${T.close.qualified})` : '') + (m.close_stale ? ` _(Plaibook last pulled ${m.close_stale}h ago)_` : '') : '▫️ *Close rate:* no Plaibook seat found');
  }
  if (q.length) rows.push(q.join('\n'));
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: head.slice(0, 150), emoji: true } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `${pretty} · end-of-day report · all times Mountain` }] },
    ...rows.map(t => ({ type: 'section', text: { type: 'mrkdwn', text: t } })),
  ];
  const text = head + ' · ' + ['week', 'month', 'year'].map(k => `${m.windows[k].label} ${usd(m.windows[k].revenue)}`).join(' · ');
  return { blocks, text };
}

// Team roll-up for the optional channel post: one line per rep, sorted by today's revenue.
export function renderTeamBlocks(all, dateIso) {
  const pretty = new Date(dateIso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const sorted = all.slice().sort((a, b) => b.windows.today.revenue - a.windows.today.revenue);
  const tot = sorted.reduce((a, m) => ({ rev: a.rev + m.windows.today.revenue, n: a.n + m.windows.today.subs }), { rev: 0, n: 0 });
  const line = (m) => { const t = m.windows.today, mo = m.windows.month; return `*${m.name}* — ${usd(t.revenue)} · ${t.subs} sub${t.subs === 1 ? '' : 's'}` + (mo.pace ? ` · month ${mo.pace.status === 'ahead' ? '▲' : mo.pace.status === 'behind' ? '▼' : '·'} ${Math.round(mo.pace.pct)}%` : '') + (mo.acv != null ? ` · ACV ${usd(mo.acv)}` : '') + (mo.my != null ? ` · MY ${pct1(mo.my)}` : ''); };
  return { text: `End of day · ${pretty} · ${tot.n} subs · ${usd(tot.rev)}`, blocks: [
    { type: 'header', text: { type: 'plain_text', text: `🌙 End of day — ${usd(tot.rev)} · ${tot.n} subs`, emoji: true } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `${pretty} · Inside Sales & Loyalty · month = pace vs goal, ACV and multi-year month to date` }] },
    { type: 'section', text: { type: 'mrkdwn', text: sorted.map(line).join('\n') || '_No sellers with a Slack ID._' } },
  ] };
}
