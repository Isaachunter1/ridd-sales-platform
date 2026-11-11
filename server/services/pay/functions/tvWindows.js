// ┌─ tvWindows ──────────────────────────────────────────────────────────────
// │ The TV Display's date ranges (app/src/competitions/tv-board.js → rangeOf),
// │ computed on the board's own calendar (America/Denver — "every time on the
// │ board reads Mountain", per Isaac) so the close rates the job pulls per range
// │ line up with the sales the board shows for that range (per Isaac, Nov 11:
// │ "follow the same date range that we have tied in the tv display").
// │ Current periods run to today; past ones are whole periods. Sun–Sat weeks.
// └────────────────────────────────────────────────────────────────────────
export const TV_RANGE_IDS = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_year'];
export const BOARD_TZ = 'America/Denver';

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => { const t = new Date(Date.UTC(y, m, d)); return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()); };   // Date.UTC normalises overflow (day 0, month -1)

// The board's local Y/M/D and weekday for an instant.
export function localParts(now, tz = BOARD_TZ) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(now).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month) - 1, d: Number(p.day), w: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function tvWindow(id, now = new Date(), tz = BOARD_TZ) {
  const { y, m, d, w } = localParts(now, tz);
  const today = iso(y, m, d);
  switch (id) {
    case 'today':      return { id, start: today, end: today, label: 'Today' };
    case 'yesterday':  return { id, start: iso(y, m, d - 1), end: iso(y, m, d - 1), label: 'Yesterday' };
    case 'this_week':  return { id, start: iso(y, m, d - w), end: today, label: 'This week' };
    case 'last_week':  return { id, start: iso(y, m, d - w - 7), end: iso(y, m, d - w - 1), label: 'Last week' };
    case 'this_month': return { id, start: iso(y, m, 1), end: today, label: MONTHS[m] };
    case 'last_month': return { id, start: iso(y, m - 1, 1), end: iso(y, m, 0), label: MONTHS[(m + 11) % 12] };
    case 'this_year':  return { id, start: y + '-01-01', end: today, label: String(y) };
    default: throw new Error('tvWindow: unknown range ' + id);
  }
}

export const tvWindows = (now = new Date(), tz = BOARD_TZ) => TV_RANGE_IDS.map(id => tvWindow(id, now, tz));
