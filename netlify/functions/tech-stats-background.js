// ┌─ tech-stats-background ────────────────────────────────────────────────
// │ Technician route stats (per Isaac, Sep 2026): appointments scheduled,
// │ completed, production value, reservices, interior %, time on site — per
// │ technician per DAY, from the RevHawk mirror (FieldRoutesAppointment +
// │ Route + Ticket + ServiceType), this year through +60 days. Published as
// │ indicators/tech-stats.json.gz; the Technicians tab sums whatever range it
// │ shows client-side. Attribution follows FieldRoutes' own Technician
// │ Stats: the ROUTE owner gets every stop, falling back to the stop tech.
// └────────────────────────────────────────────────────────────────────────
const zlib = require('zlib');
const { createClient } = require('@supabase/supabase-js');
const { _bq } = require('./revhawk-sync-background.js');

exports.handler = async () => {
  const started = Date.now();
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE) return { statusCode: 500, body: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required' };
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  try {
    const token = await _bq.getAccessToken();
    const T = (n) => '`' + _bq.PROJECT + '.' + _bq.DATASET + '.' + n + '`';
    const yr = new Date().getFullYear();
    const start = yr + '-01-01';
    const end = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    const sql = `
WITH appts AS (
  SELECT rawImportedDataFromFieldsRoutesId AS import_id, fieldRoutes_appointmentID AS appt_id, fieldRoutes_routeID AS route_id,
         TRIM(fieldRoutes_type) AS type_id, SUBSTR(fieldRoutes_date, 1, 10) AS d, fieldRoutes_status AS status,
         fieldRoutes_isInitial = '1' AS is_initial, fieldRoutes_servicedInterior = '1' AS interior,
         fieldRoutes_signedByCustomer = '1' AS signed,
         COALESCE(SAFE_CAST(fieldRoutes_originalAppointmentID AS INT64), 0) > 0 AS rescheduled,
         fieldRoutes_officeID AS office_id,
         COALESCE(NULLIF(fieldRoutes_servicedBy, '0'), NULLIF(fieldRoutes_completedBy, '0'), NULLIF(fieldRoutes_assignedTech, '0')) AS stop_tech,
         SAFE.PARSE_DATETIME('%Y-%m-%d %H:%M:%S', fieldRoutes_checkIn) AS cin,
         SAFE.PARSE_DATETIME('%Y-%m-%d %H:%M:%S', fieldRoutes_checkOut) AS cout
  FROM ${T('FieldRoutesAppointment')}
  WHERE SUBSTR(fieldRoutes_date, 1, 10) BETWEEN '${start}' AND '${end}'
),
routes AS (
  SELECT rawImportedDataFromFieldsRoutesId AS import_id, fieldRoutes_routeID AS route_id, NULLIF(fieldRoutes_assignedTech, '0') AS owner
  FROM ${T('FieldRoutesRoute')}
),
svc AS (
  SELECT TRIM(fieldRoutes_typeID) AS type_id, MAX(fieldRoutes_reservice) AS is_reservice, ANY_VALUE(fieldRoutes_description) AS svc_name
  FROM ${T('FieldRoutesServiceType')} GROUP BY type_id
),
tix AS (
  SELECT fieldRoutes_appointmentID AS appt_id,
         SUM(CASE WHEN SAFE_CAST(fieldRoutes_productionValue AS FLOAT64) = -1 THEN SAFE_CAST(fieldRoutes_subTotal AS FLOAT64) ELSE SAFE_CAST(fieldRoutes_productionValue AS FLOAT64) END) AS production
  FROM ${T('FieldRoutesTicket')} WHERE fieldRoutes_templateType = 'NA' AND fieldRoutes_active != '-1' GROUP BY appt_id
),
emp AS (
  SELECT fieldRoutes_employeeID AS employee_id,
         TRIM(CONCAT(COALESCE(ANY_VALUE(fieldRoutes_fname), ''), ' ', COALESCE(ANY_VALUE(fieldRoutes_lname), ''))) AS name,
         ANY_VALUE(fieldRoutes_officeID) AS office_id
  FROM ${T('FieldRoutesEmployee')} GROUP BY employee_id
),
attributed AS (
  SELECT COALESCE(r.owner, a.stop_tech) AS tech, a.d, a.status, a.is_initial, a.interior, a.signed, a.rescheduled, a.office_id,
         COALESCE(x.production, 0) AS production, COALESCE(s.is_reservice, '0') = '1' AS is_reservice, s.svc_name,
         CASE WHEN a.cin IS NOT NULL AND a.cout IS NOT NULL AND a.cout > a.cin THEN DATETIME_DIFF(a.cout, a.cin, MINUTE) ELSE NULL END AS mins
  FROM appts a
  LEFT JOIN routes r ON r.import_id = a.import_id AND r.route_id = a.route_id
  LEFT JOIN tix x ON x.appt_id = a.appt_id
  LEFT JOIN svc s ON s.type_id = a.type_id
)
SELECT x.tech, COALESCE(NULLIF(e.name, ''), CONCAT('Tech #', x.tech)) AS name, ANY_VALUE(x.office_id) AS office_id, x.d,
  COUNTIF(x.status != '-1') AS sch,
  COUNTIF(x.status = '1') AS done,
  COUNTIF(x.status = '0') AS pend,
  COUNTIF(x.status = '-1') AS cxl,
  ROUND(SUM(IF(x.status = '1' AND x.production > 0 AND NOT x.is_reservice, x.production, 0))) AS prod,
  COUNTIF(x.status = '1' AND x.production > 0 AND NOT x.is_reservice) AS prodn,
  COUNTIF(x.status = '1' AND x.is_reservice) AS resvc,
  COUNTIF(x.status = '1' AND x.is_initial) AS init,
  COUNTIF(x.status = '1' AND x.interior) AS intr,
  COUNTIF(x.status = '1' AND x.signed) AS signed,
  COUNTIF(x.rescheduled) AS resched,
  SUM(IF(x.status = '1', x.mins, NULL)) AS mins,
  COUNTIF(x.status = '1' AND x.mins IS NOT NULL) AS minsn,
  STRING_AGG(IF(x.status = '1', x.svc_name, NULL), '|' LIMIT 40) AS svcs
FROM attributed x LEFT JOIN emp e ON e.employee_id = x.tech
WHERE x.tech IS NOT NULL
GROUP BY x.tech, name, x.d`;
    const rows = await _bq.runQuery(token, sql, { compact: true });
    // Office names for the office_id → branch label.
    const officeNames = {};
    try {
      const og = await _bq.runQuery(token, `SELECT DISTINCT fieldRoutes_officeID AS id, fieldRoutes_officeName AS name FROM ${T('FieldRoutesOffice')}`, { compact: true });
      og.forEach(o => { if (o.id) officeNames[String(o.id)] = o.name; });
    } catch (e) { console.warn('[tech-stats] office names skipped:', e.message); }
    const payload = { generatedAt: new Date().toISOString(), start, end, officeNames,
      rows: rows.map(r => ({ t: String(r.tech), n: r.name, o: r.office_id == null ? null : String(r.office_id), d: r.d, sch: +r.sch || 0, done: +r.done || 0, pend: +r.pend || 0, cxl: +r.cxl || 0, prod: +r.prod || 0, prodn: +r.prodn || 0, resvc: +r.resvc || 0, init: +r.init || 0, intr: +r.intr || 0, signed: +r.signed || 0, resched: +r.resched || 0, mins: r.mins == null ? null : +r.mins, minsn: +r.minsn || 0, svcs: r.svcs ? String(r.svcs).split('|').filter(Boolean) : [] })) };
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(payload)), { level: 6 });
    const { error } = await supabase.storage.from('reporting').upload('indicators/tech-stats.json.gz', gz, { contentType: 'application/gzip', upsert: true });
    if (error) throw new Error('upload failed: ' + error.message);
    const msg = '[tech-stats] ' + payload.rows.length + ' tech-days · ' + (Date.now() - started) + 'ms';
    console.log(msg);
    return { statusCode: 200, body: msg };
  } catch (e) {
    console.error('[tech-stats]', e);
    return { statusCode: 500, body: String((e && e.message) || e) };
  }
};
