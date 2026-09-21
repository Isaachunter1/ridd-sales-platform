// ┌─ ops-stats-background ──────────────────────────────────────────────────
// │ Operations weekly stats for the COO tab (per Isaac, Sep 2026) — the
// │ "OPS 26" sheet, from the RevHawk mirror instead of hand entry:
// │   per office × Sun–Sat week (this year):
// │     appointments completed / scheduled (service types only — Tech Follow
// │     Up, Meeting Day and uncategorised types excluded), reservices
// │     (completed, by reservice type), production serviced (ticket
// │     production, reservices excluded), routes run (distinct route-days
// │     with a completed stop), on-site minutes, technician time-clock hours
// │     (FieldRoutesTimeClock, paid categories, technicians only),
// │     FieldRoutes reviews.
// │ Published as indicators/ops-stats.json (small). Gross pay and Google
// │ reviews are not in FieldRoutes — the tab takes those by hand.
// └────────────────────────────────────────────────────────────────────────
const { createClient } = require('@supabase/supabase-js');
const { requireSyncSecret } = require('../lib/sync-gate.js');
const { _bq } = require('./revhawk-sync-background.js');

const OFFICE_NAMES = {
  '1': 'Salt Lake', '6': 'Charleston', '7': 'Myrtle Beach', '10': 'Destin',
  '13': 'Atlanta', '15': 'Virginia Beach', '16': 'Raleigh', '18': 'Detroit', '19': 'Joplin', '20': 'Little Rock',
};
// Sun–Sat week start for an ISO date.
function weekStartOf(iso) {
  const d = new Date(iso + 'T12:00:00Z'); const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - dow); return d.toISOString().slice(0, 10);
}

exports.handler = async (event) => {
  const started = Date.now();
  const _gate = requireSyncSecret(event); if (_gate) return _gate;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE) return { statusCode: 500, body: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required' };
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  try {
    const token = await _bq.getAccessToken();
    const T = (n) => '`' + _bq.PROJECT + '.' + _bq.DATASET + '.' + n + '`';
    const yr = new Date().getFullYear();
    // Start on the Sunday on/before Jan 1 so the first week is whole.
    const start = weekStartOf(yr + '-01-01');
    const end = new Date().toISOString().slice(0, 10);
    const apptSql = `
WITH a AS (
  SELECT rawImportedDataFromFieldsRoutesId AS import_id, fieldRoutes_appointmentID AS appt_id, fieldRoutes_routeID AS route_id,
         TRIM(fieldRoutes_type) AS type_id, SUBSTR(fieldRoutes_date, 1, 10) AS d, fieldRoutes_status AS st, fieldRoutes_officeID AS office_id,
         SAFE.PARSE_DATETIME('%Y-%m-%d %H:%M:%S', fieldRoutes_checkIn) AS cin, SAFE.PARSE_DATETIME('%Y-%m-%d %H:%M:%S', fieldRoutes_checkOut) AS cout
  FROM ${T('FieldRoutesAppointment')}
  WHERE SUBSTR(fieldRoutes_date, 1, 10) BETWEEN '${start}' AND '${end}'
),
s AS (
  SELECT TRIM(fieldRoutes_typeID) AS type_id, MAX(fieldRoutes_reservice) = '1' AS is_reservice, ANY_VALUE(fieldRoutes_description) AS name, ANY_VALUE(fieldRoutes_category) AS cat
  FROM ${T('FieldRoutesServiceType')} GROUP BY type_id
),
tix AS (
  SELECT fieldRoutes_appointmentID AS appt_id,
         SUM(CASE WHEN SAFE_CAST(fieldRoutes_productionValue AS FLOAT64) = -1 THEN SAFE_CAST(fieldRoutes_subTotal AS FLOAT64) ELSE SAFE_CAST(fieldRoutes_productionValue AS FLOAT64) END) AS production
  FROM ${T('FieldRoutesTicket')} WHERE fieldRoutes_templateType = 'NA' AND fieldRoutes_active != '-1' GROUP BY appt_id
),
j AS (
  SELECT a.*, s.name, s.is_reservice, COALESCE(x.production, 0) AS production,
         NOT (s.name IN ('Tech Follow Up', 'Meeting Day') OR s.cat IS NULL OR s.cat = '' OR s.cat = 'General') AS svc,
         CASE WHEN a.cin IS NOT NULL AND a.cout IS NOT NULL AND a.cout > a.cin THEN DATETIME_DIFF(a.cout, a.cin, MINUTE) ELSE NULL END AS mins
  FROM a LEFT JOIN s USING (type_id) LEFT JOIN tix x ON x.appt_id = a.appt_id
)
SELECT office_id, d,
  COUNTIF(st = '1' AND svc) AS done, COUNTIF(st != '-1' AND svc) AS sch,
  COUNTIF(st = '1' AND is_reservice) AS resvc,
  ROUND(SUM(IF(st = '1' AND svc AND NOT is_reservice, production, 0))) AS prod,
  COUNT(DISTINCT IF(st = '1' AND svc, route_id, NULL)) AS routes,
  SUM(IF(st = '1' AND svc, mins, NULL)) AS mins, COUNTIF(st = '1' AND svc AND mins IS NOT NULL) AS minsn,
  STRING_AGG(IF(st = '1' AND is_reservice, REGEXP_REPLACE(name, r'^Reservice\\s*-\\s*', ''), NULL), '|') AS rtypes
FROM j WHERE office_id IS NOT NULL GROUP BY office_id, d`;
    const clockSql = `
SELECT t.fieldRoutes_officeID AS office_id, SUBSTR(t.fieldRoutes_timeIn, 1, 10) AS d,
  ROUND(SUM(TIMESTAMP_DIFF(SAFE.PARSE_TIMESTAMP('%Y-%m-%d %H:%M:%S', t.fieldRoutes_timeOut), SAFE.PARSE_TIMESTAMP('%Y-%m-%d %H:%M:%S', t.fieldRoutes_timeIn), MINUTE)) / 60, 2) AS hours,
  COUNT(DISTINCT t.fieldRoutes_employeeID) AS people
FROM ${T('FieldRoutesTimeClock')} t
LEFT JOIN (SELECT fieldRoutes_employeeID AS eid, ANY_VALUE(fieldRoutes_type) AS etype FROM ${T('FieldRoutesEmployee')} GROUP BY 1) e ON e.eid = t.fieldRoutes_employeeID
WHERE SUBSTR(t.fieldRoutes_timeIn, 1, 10) BETWEEN '${start}' AND '${end}' AND t.fieldRoutes_paid = '1' AND e.etype = '1'
  AND t.fieldRoutes_timeOut IS NOT NULL AND t.fieldRoutes_timeOut != ''
GROUP BY 1, 2`;
    const reviewSql = `
SELECT fieldRoutes_officeIDs AS office_id, SUBSTR(fieldRoutes_date, 1, 10) AS d, COUNT(*) AS n, COUNTIF(SAFE_CAST(fieldRoutes_starRating AS INT64) >= 4) AS good
FROM ${T('FieldRoutesReview')} WHERE SUBSTR(fieldRoutes_date, 1, 10) BETWEEN '${start}' AND '${end}' GROUP BY 1, 2`;
    const [appt, clock, reviews] = await Promise.all([
      _bq.runQuery(token, apptSql, { compact: true }),
      _bq.runQuery(token, clockSql, { compact: true }).catch(e => { console.warn('[ops-stats] timeclock skipped:', e.message); return []; }),
      _bq.runQuery(token, reviewSql, { compact: true }).catch(e => { console.warn('[ops-stats] reviews skipped:', e.message); return []; }),
    ]);
    // Roll days up to office × week.
    const cells = {};
    const cell = (o, w) => { const k = o + '|' + w; return cells[k] || (cells[k] = { done: 0, sch: 0, resvc: 0, prod: 0, routes: 0, mins: 0, minsn: 0, rtypes: {}, hours: 0, people: 0, fr_reviews: 0, fr_reviews_good: 0 }); };
    for (const r of appt) {
      const c = cell(String(r.office_id), weekStartOf(r.d));
      c.done += +r.done || 0; c.sch += +r.sch || 0; c.resvc += +r.resvc || 0; c.prod += +r.prod || 0; c.routes += +r.routes || 0;
      c.mins += +r.mins || 0; c.minsn += +r.minsn || 0;
      String(r.rtypes || '').split('|').filter(Boolean).forEach(t => { c.rtypes[t] = (c.rtypes[t] || 0) + 1; });
    }
    for (const r of clock) { const c = cell(String(r.office_id), weekStartOf(r.d)); c.hours += +r.hours || 0; c.people = Math.max(c.people, +r.people || 0); }
    for (const r of reviews) { const c = cell(String(r.office_id), weekStartOf(r.d)); c.fr_reviews += +r.n || 0; c.fr_reviews_good += +r.good || 0; }
    for (const k of Object.keys(cells)) { cells[k].hours = Math.round(cells[k].hours * 10) / 10; }
    const weeks = []; for (let d = new Date(start + 'T12:00:00Z'); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 7)) weeks.push(d.toISOString().slice(0, 10));
    const payload = { generatedAt: new Date().toISOString(), year: yr, start, end, weeks, officeNames: OFFICE_NAMES, cells,
      definitions: {
        done: 'Completed appointments in the week (service types only; Tech Follow Up, Meeting Day and uncategorised types excluded)',
        sch: 'Appointments not cancelled (same type rule) — completed + still pending',
        resvc: 'Completed appointments whose service type is flagged Reservice',
        prod: 'Ticket production ($) on completed non-reservice appointments',
        routes: 'Distinct route-days with at least one completed service stop',
        mins: 'Check-in → check-out minutes on completed stops (minsn = stops with both stamps)',
        hours: 'FieldRoutes time clock, paid categories, technicians only (management hours are entered by hand)',
        fr_reviews: 'Reviews logged in FieldRoutes (Google reviews are entered by hand)',
      } };
    const body = Buffer.from(JSON.stringify(payload));
    const { error } = await supabase.storage.from('reporting').upload('indicators/ops-stats.json', body, { contentType: 'application/json', upsert: true });
    if (error) throw new Error('upload failed: ' + error.message);
    const msg = '[ops-stats] ' + Object.keys(cells).length + ' office-weeks · ' + weeks.length + ' weeks · ' + (Date.now() - started) + 'ms';
    console.log(msg);
    return { statusCode: 200, body: msg };
  } catch (e) {
    console.error('[ops-stats]', e);
    return { statusCode: 500, body: String((e && e.message) || e) };
  }
};
