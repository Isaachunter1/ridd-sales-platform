// ── RIDD Indicators Engine — extracted verbatim from src/40-dashboard-and-rep-data.js ──
// Shared by the app bundle (app.js) and the standalone engine build
// (engine/dist/ridd-engine.js). Edit HERE; both pick it up.

function sumRev(rows) { return rows.reduce((a, s) => a + Number(s.revenue_amount || 0), 0); }

// ──────────────────────────────────────────────────────────────────────────
// INDICATOR REP CARD — helpers + modal opener for the rep-leaderboard
// player card on the Indicators view. The Indicators page works off raw CSV
// sales (different shape than logged sales), so it has its own record/trend
// computation rather than reusing computeRepRecords.
// ──────────────────────────────────────────────────────────────────────────
// Memoized by the raw dateSold string — called per sale in the range-mode
// aggregations. The returned Date is only ever read (comparisons, getFullYear),
// never mutated, so sharing one instance per distinct date string is safe.
const _indDayCache = new Map();
function _parseIndicatorDay(s) {
  const raw = (s && s.dateSold) || '';
  const cached = _indDayCache.get(raw);
  if (cached !== undefined) return cached;
  let out = null;
  const k = raw.split(' ')[0].trim();
  if (k) {
    const parts = k.split('/').map(Number);
    if (parts.length === 3) {
      let [m, d, y] = parts;
      if (Number.isFinite(m) && Number.isFinite(d) && Number.isFinite(y)) {
        if (y < 100) y += 2000;
        out = new Date(y, m - 1, d);
      }
    }
  }
  if (_indDayCache.size < 200000) _indDayCache.set(raw, out);
  return out;
}

// ── Department classification (Indicators) ──────────────────────────────
// Splits sales into three departments off the Source column:
//   D2D    — Source "Door to Door"
//   Techs  — Source "Upsell - Service Pro" / "Upsell - Termite Pro"
//   Office — everything else (inside sales, web, renewals, etc.)
const _IND_TECH_SOURCES = new Set(['upsell - service pro', 'upsell - termite pro']);

// Rep type (Sales Rep / Office Staff / Technician) from the Customer Report
// cross-reference is the most accurate delineation, so it drives the dept
// buckets: Sales Rep → d2d, Office Staff → office, Technician → techs. Reps not
// found in the report fall back to classifying each sale by its Source. Cached
// per rep, reset whenever the config/upload changes (_indCfgRev).
const _repDeptCache = new Map(); let _repDeptCacheRev = -1;
function _indicatorDeptOf(s) {
  if (!s) return 'office';
  // Per-sale CRM employee type ("Sales Rep Type" — carried by the snapshot)
  // is AUTHORITATIVE: exactly the Emp. Type filter the FieldRoutes report
  // uses, so office staff can never leak into the Sales Rep view (or vice
  // versa). Older datasets without the column fall through to the map/source.
  const own = String(s.repType || '').trim().toLowerCase();
  if (own) return own === 'sales rep' ? 'd2d' : own === 'technician' ? 'techs' : 'office';
  const rep = s.rep || '';
  if (_repDeptCacheRev !== _indCfgRev) { _repDeptCache.clear(); _repDeptCacheRev = _indCfgRev; }
  let dept = _repDeptCache.get(rep);
  if (dept === undefined) {
    const t = (state._indicatorRepTypeBySig || {})[_repTypeNameSig(getCanonicalRepName(rep))];
    dept = t === 'Sales Rep' ? 'd2d' : t === 'Office Staff' ? 'office' : t === 'Technician' ? 'techs' : null;
    _repDeptCache.set(rep, dept); // null = rep not in the Customer Report
  }
  if (dept) return dept;
  // Fallback — rep has no type in the report; classify this sale by its Source.
  const src = (s.source ? String(s.source) : '').trim().toLowerCase();
  return src === 'door to door' ? 'd2d' : (_IND_TECH_SOURCES.has(src) ? 'techs' : 'office');
}

// The department-scoped raw sales — every on-screen indicators metric reads
// through this so the toggle re-runs the whole dashboard. Roster, PDF
// exports and scorecard periods intentionally use the full set instead.
let _indCfgRev = 0; // bumped on every settings save — invalidates sales caches

// FieldRoutes' "Global:" excluded service types (Sales Leaderboard report
// config) — chargebacks/fees, plus the two service types RIDD globally
// excludes from sales reporting. Stripped from every indicators metric so
// the app reconciles 1:1 with the CRM report.
const FR_GLOBAL_EXCLUDED_SERVICES = new Set([
  // Mirrors the CRM Sales Leaderboard's live "Global:" excluded services
  // (per Isaac's screenshot of the tool config, Jul 2026). Rodent Station
  // Removal used to be in this set but is NOT globally excluded in the CRM.
  'ACH Chargeback', 'Early Cancellation Fee', 'German Roach Initial',
]);

function frPendingServiced(s) {
  if (!s) return false;
  if (FR_GLOBAL_EXCLUDED_SERVICES.has(String(s.subscription || '').trim())) return false;
  // Manual-data mode: Isaac's prebuilt report carries the CRM's OWN Status
  // column, so the CRM's Pending/Serviced rule is applied directly from it —
  // Serviced + Pending count, Canceled / Not Serviced don't (verified Jul
  // 2026: Status-filtering his 19,835-row report reproduces the CRM's P/S
  // leaderboard to the dollar). Older P/S-prefiltered exports only contain
  // Pending/Serviced rows, so the same test passes everything, and a blank
  // Status counts by benefit of the doubt. This branch must stay TERMINAL:
  // "Services" in these exports is plan FREQUENCY (always > 0), so the
  // serviced-evidence shortcut below would wrongly accept every row.
  if (state._indManualMode) {
    const _mst = String(s.status || '').trim().toLowerCase();
    return !_mst || _mst === 'pending' || _mst === 'serviced';
  }
  // Evidence of ACTUAL service always wins: completed services, a serviced
  // date, or a Completed initial make the account "Serviced" in the CRM no
  // matter what stale appointment/cancellation data the RevHawk mirror
  // carries. Proven by the Jul 2026 row-level reconcile (#163269 Jenkins:
  // 6 services completed in the CRM, mirror still said Sold-Not-Started —
  // the sub was cancelled+rebooked and the old reason stuck around).
  if ((Number(s.services) || 0) > 0 || String(s.servicedDate || '').trim()) return true;
  // NO SERVICE YET → the subscription must still be ALIVE. FieldRoutes
  // files an unserviced account that got cancelled under "Canceled" /
  // "Not Serviced", and the CRM's Pending/Serviced ledger drops it no
  // matter the cancel reason (3-day ROR, finances, rep error, SNS…).
  // Verified Jul 30 2026 against the CRM roster tool: reps with a
  // cancelled unserviced sale were exactly that sale high in the app
  // (Karson +$968 etc). Serviced accounts that cancel LATER still count —
  // the serviced-evidence check above already returned for those.
  if (String(s.active || '').trim().toLowerCase() === 'no') return false;
  // Sold-Not-Started CANCELLATION REASON excludes — but only while the
  // subscription is actually dead. The Jul 2026 row-level reconcile caught
  // 12 accounts the CRM still counts whose mirror rows carry a stale SNS
  // reason from a cancel + rebook: if FieldRoutes says the sub is active
  // again, the old reason must not bury the sale. True SNS (cancelled, no
  // service) stays excluded. 3-day RORs are NOT excluded here — they count.
  if (_isSoldNotStarted(s) && String(s.active || '').trim().toLowerCase() !== 'yes') return false;
  if (_scInitialStatusHasData()) {
    const ist = String(s.initialStatus || '').trim().toLowerCase();
    // Pending/Serviced = the account has MADE IT TO THE SCHEDULE (initial
    // appt Pending) or beyond (Completed). "No Appointment" is merely
    // Subscription Added — the CRM's P/S report excludes it until the
    // office books the initial (per Isaac, Jul 30 2026: Kyson $8,017
    // Added vs $6,749 P/S — the app must report the P/S number). Fresh
    // sales start counting on the first sync after they're scheduled.
    return ist === 'pending' || ist === 'completed';
  }
  // Legacy snapshots without the Initial Status column.
  return !_scIsSoldNotStarted(s);
}

const _SNS_REASON_RE = /sold,?\s*not\s*started/i;

function _isSoldNotStarted(s) {
  return !!s && _SNS_REASON_RE.test(s.cancelReason || '');
}
