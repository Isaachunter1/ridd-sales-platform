// RevHawk → snapshot sync (BACKGROUND function, 15-min budget).
//
// Pulls the FieldRoutes subscription dataset LIVE from RevHawk's BigQuery
// mirror, maps it into the exact row shape the app's CSV parser produces
// (parseReportingCsv), gzips it, and writes it into Supabase the SAME way a
// manual CSV upload does — a `reporting_uploads` envelope + a gzipped JSON
// blob in the `reporting` storage bucket. The app then auto-loads it as the
// newest snapshot, so Overview / Audit / Cancellations / Inside Sales all show
// fresh CRM data with no manual upload.
//
// WHY A BACKGROUND FUNCTION: the file name ends in `-background`, which gives
// Netlify's 15-minute budget (a normal function is 10s). The daily scheduler
// (revhawk-sync-scheduled.js) fires this; it can also be POSTed manually.
//
// ───────────────────────────── SETUP (one-time) ─────────────────────────────
// In Netlify → Site settings → Environment variables add a Google Cloud
// service account that has BigQuery read access to the RevHawk dataset:
//   GCP_SA_EMAIL        = the service account's client_email
//   GCP_SA_PRIVATE_KEY  = its private_key (paste the whole -----BEGIN…END----- ,
//                         newlines may be pasted literally or as \n)
//   REVHAWK_PROJECT_ID  = revhawkdataconnect            (job-billing project)
//   REVHAWK_DATASET     = org_ridd_pest_control_3f4149  (the org's dataset)
// Plus (already present for the app):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional shared secret so only the scheduler / an admin can trigger it:
//   REVHAWK_SYNC_SECRET = <any random string>
//
// Ask RevHawk (or your GCP admin) for a read-only service account on the
// dataset above — that's the only new credential this needs.

const crypto = require('crypto');
const zlib = require('zlib');
const { createClient } = require('@supabase/supabase-js');

// DATA project + dataset = where RevHawk's tables live (your service account was
// granted read access here). JOB project = your OWN GCP project, where the query
// runs and is billed (your service account has BigQuery Job User there). These
// differ: the SA reads RevHawk's data from inside your project's job.
const PROJECT = process.env.REVHAWK_PROJECT_ID || 'revhawkdataconnect';
const DATASET = process.env.REVHAWK_DATASET || 'org_ridd_pest_control_3f4149';
const JOB_PROJECT = process.env.GCP_JOB_PROJECT || PROJECT;

// Office id → branch name. RevHawk only stores the numeric office id, so this
// map supplies the names the rest of the app groups by. Confirm / edit these.
const OFFICE_NAMES = {
  '1': 'Salt Lake', '6': 'Charleston', '7': 'Myrtle Beach', '10': 'Destin',
  '13': 'Atlanta', '15': 'Virginia Beach', '16': 'Raleigh', '18': 'Detroit',
  '19': 'Joplin',   // opened Jul 2026 — appeared in the warehouse 2026-07-08
};
const officeCase = Object.entries(OFFICE_NAMES)
  .map(([id, name]) => `WHEN '${id}' THEN '${name.replace(/'/g, "''")}'`).join(' ');

// The mapping query — every column aliased to the EXACT field name
// parseReportingCsv emits, and numeric columns SAFE_CAST so the result schema
// types let us coerce to JS numbers. Validated against the live data.
const SQL = `
WITH flags AS (
  -- Customer flags drive the Auditing tab + Spring Cleaning / Last Man Standing
  -- audit gates (Passed Audit / No Audit / Failed Audit). The denormalized
  -- FieldRoutesCustomerFlags table is INCOMPLETE — it misses a meaningful chunk
  -- of audit flags that exist in the raw generic-flag assignments (verified:
  -- a recent Spring Cleaning round dropped from 258 "pending" to 181 once the
  -- assignment table was included). So union both sources: the legacy customer
  -- flags PLUS every CUST-type generic flag resolved to its code via the
  -- assignment → definition join. STRING_AGG(DISTINCT ...) dedupes the overlap.
  SELECT cid, STRING_AGG(DISTINCT flag, ', ') AS flags FROM (
    SELECT fieldRoutes_customerID AS cid, fieldRoutes_flag AS flag
    FROM \`${PROJECT}.${DATASET}.FieldRoutesCustomerFlags\`
    WHERE fieldRoutes_flag IS NOT NULL AND fieldRoutes_flag != ''
    UNION DISTINCT
    SELECT a.fieldRoutes_entityID AS cid, g.code AS flag
    FROM \`${PROJECT}.${DATASET}.FieldRoutesGenericFlagAssignment\` a
    JOIN (
      SELECT DISTINCT fieldRoutes_genericFlagID AS gid, fieldRoutes_code AS code
      FROM \`${PROJECT}.${DATASET}.FieldRoutesGenericFlags\`
      WHERE fieldRoutes_type = 'CUST' AND fieldRoutes_code IS NOT NULL AND fieldRoutes_code != ''
    ) g ON g.gid = a.fieldRoutes_genericFlagID
  )
  GROUP BY cid
),
emp AS (
  SELECT fieldRoutes_employeeID AS eid, ANY_VALUE(fieldRoutes_lname) AS lname,
         ANY_VALUE(fieldRoutes_fname) AS fname, ANY_VALUE(fieldRoutes_type) AS type
  FROM \`${PROJECT}.${DATASET}.FieldRoutesEmployee\` GROUP BY 1
),
cust AS (
  SELECT fieldRoutes_customerID AS cid,
    ANY_VALUE(fieldRoutes_lname) AS lname, ANY_VALUE(fieldRoutes_fname) AS fname,
    ANY_VALUE(fieldRoutes_county) AS county, ANY_VALUE(fieldRoutes_state) AS state,
    ANY_VALUE(fieldRoutes_zip) AS zip, ANY_VALUE(fieldRoutes_phone1) AS phone,
    ANY_VALUE(fieldRoutes_email) AS email, ANY_VALUE(fieldRoutes_aPay) AS apay,
    ANY_VALUE(fieldRoutes_responsibleBalanceAge) AS dpd,
    ANY_VALUE(fieldRoutes_responsibleBalance) AS resp_balance,
    ANY_VALUE(fieldRoutes_customerSource) AS csource
  FROM \`${PROJECT}.${DATASET}.FieldRoutesCustomer\` GROUP BY 1
),
cxl AS (
  SELECT sid, TRIM(reason) AS reason FROM (
    SELECT fieldRoutesSubscriptionId AS sid, fieldRoutes_cancellationReason AS reason,
      ROW_NUMBER() OVER (PARTITION BY fieldRoutesSubscriptionId ORDER BY fieldRoutes_date DESC) rn
    FROM \`${PROJECT}.${DATASET}.FieldRoutesCancellationNote\`
    WHERE fieldRoutes_cancellationReason IS NOT NULL AND fieldRoutes_cancellationReason != ''
  ) WHERE rn = 1
),
appt AS (
  -- Completion date of each subscription's INITIAL appointment — i.e. when the
  -- account was first serviced. Drives the Spring Cleaning / Last Man Standing
  -- "serviced by the deadline" rule. One row per appointment id.
  SELECT fieldRoutes_appointmentID AS aid,
         MIN(NULLIF(LEFT(fieldRoutes_dateCompleted,10),'0000-00-00')) AS serviced_date
  FROM \`${PROJECT}.${DATASET}.FieldRoutesAppointment\`
  WHERE fieldRoutes_dateCompleted IS NOT NULL AND fieldRoutes_dateCompleted NOT LIKE '0000%' AND fieldRoutes_dateCompleted != ''
  GROUP BY 1
)
SELECT
  s.fieldRoutes_customerID AS customer_id,
  cust.lname AS last_name,
  cust.fname AS first_name,
  NULLIF(LEFT(s.fieldRoutes_dateAdded,10),'0000-00-00') AS sold_date,
  CASE WHEN s.fieldRoutes_dateAdded IS NULL OR s.fieldRoutes_dateAdded LIKE '0000%' THEN NULL ELSE LEFT(s.fieldRoutes_dateAdded,19) END AS sold_at,
  cust.apay AS customer_auto_pay,
  flags.flags AS customer_flags,
  SAFE_CAST(s.fieldRoutes_annualRecurringValue AS FLOAT64) AS annual_recurring_value,
  s.fieldRoutes_soldBy AS sold_by_id,
  NULLIF(CONCAT(COALESCE(emp.lname,''), ', ', COALESCE(emp.fname,'')), ', ') AS sold_by,
  CASE emp.type WHEN '0' THEN 'Office Staff' WHEN '1' THEN 'Technician' WHEN '2' THEN 'Sales Rep' END AS sold_by_type,
  CASE WHEN s.fieldRoutes_completedAppointmentIDs IS NULL OR s.fieldRoutes_completedAppointmentIDs=''
       THEN 0 ELSE ARRAY_LENGTH(SPLIT(s.fieldRoutes_completedAppointmentIDs, ',')) END AS subscription_completed_services,
  cust.county AS county,
  s.fieldRoutes_serviceType AS subscription,
  cxl.reason AS subscription_cancellation_reason,
  CASE WHEN s.fieldRoutes_dateCancelled IS NULL OR s.fieldRoutes_dateCancelled LIKE '0000%'
       THEN NULL ELSE LEFT(s.fieldRoutes_dateCancelled,10) END AS subscription_date_canceled,
  s.fieldRoutes_activeText AS subscription_status,
  s.fieldRoutes_initialStatusText AS initial_status,
  CASE WHEN s.fieldRoutes_initialStatusText='Completed'
       THEN NULLIF(LEFT(s.fieldRoutes_dateAdded,10),'0000-00-00') END AS initial_service,
  appt.serviced_date AS initial_serviced_date,
  s.fieldRoutes_source AS subscription_source,
  CAST(NULL AS STRING) AS country,
  cust.state AS state,
  cust.zip AS zip_code,
  SAFE_CAST(cust.dpd AS INT64) AS days_past_due,
  SAFE_CAST(cust.resp_balance AS FLOAT64) AS responsible_balance,
  CASE s.fieldRoutes_officeID ${officeCase} ELSE CONCAT('Office ', s.fieldRoutes_officeID) END AS office_name,
  SAFE_CAST(s.fieldRoutes_agreementLength AS INT64) AS agreement_length,
  SAFE_CAST(s.fieldRoutes_contractValue AS FLOAT64) AS subscription_contract_value,
  SAFE_CAST(s.fieldRoutes_initialServiceTotal AS FLOAT64) AS initial_price,
  s.fieldRoutes_frequency AS recurring_frequency,
  cust.phone AS phone,
  cust.email AS email,
  NULLIF(COALESCE(NULLIF(s.fieldRoutes_leadSource,''), cust.csource), '') AS lead_source
FROM \`${PROJECT}.${DATASET}.FieldRoutesSubscription\` s
LEFT JOIN cust  ON cust.cid  = s.fieldRoutes_customerID
LEFT JOIN emp   ON emp.eid   = s.fieldRoutes_soldBy
LEFT JOIN flags ON flags.cid = s.fieldRoutes_customerID
LEFT JOIN cxl   ON cxl.sid   = s.id
LEFT JOIN appt  ON appt.aid  = s.fieldRoutes_initialAppointmentID
WHERE s.fieldRoutes_customerID IS NOT NULL AND s.fieldRoutes_customerID != ''
  -- Phantom offices lingering in the CRM (negative office IDs, e.g. -1 / -7).
  -- These aren't real branches we sold from — exclude them from the snapshot
  -- entirely so they never touch revenue, subs, or any downstream metric.
  AND COALESCE(s.fieldRoutes_officeID, '') NOT IN ('-1', '-7')
  -- Orphaned subscriptions: the rep created a card, then DELETED the customer
  -- (e.g. couldn't close it), but the subscription lingers in the warehouse.
  -- FieldRoutes doesn't propagate the delete, so these would show "pending"
  -- forever. If the customer no longer exists in the customer table, drop it —
  -- EXCEPT recent sales: subscriptions replicate live but CUSTOMERS only batch
  -- nightly, so a brand-new customer sold today has no customer row until
  -- tomorrow morning. Dropping those wiped ~98% of same-day revenue off the
  -- NRLA live board. Keep anything sold in the last 2 DAYS (covers the
  -- nightly batch + one missed run); past that, a sale with no customer row
  -- is a DELETED account's ghost — its subscription row froze in its last
  -- replicated state ("Active/Pending") when the customer vanished from the
  -- API, and it must fall off every board. (Was 7 days — deleted accounts
  -- haunted comps for a week; verified against real deletions 2026-07-08:
  -- customers 164676/164795 deleted in the CRM yet still counting.)
  AND (cust.cid IS NOT NULL
       OR LEFT(s.fieldRoutes_dateAdded,10) >= FORMAT_DATE('%Y-%m-%d', DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY)))`;

// Employee roster — one entry per PERSON. FieldRoutes stores an employee row
// PER OFFICE and links them via fieldRoutes_linkedEmployeeIDs (a base account).
// But a "roaming" person can ALSO have several base/master accounts that aren't
// linked to each other (e.g. Dan Farah has masters 10915 and 18528). The one
// thing that unifies them is their email. So we group by:
//   gkey = email           (when present — merges all of a person's masters)
//        = base_eid         (when there's no email; base_eid = linkedEmployeeIDs
//                            or the row's own id, so single-office no-email reps
//                            and linked groups still collapse correctly)
// employee_id = the roaming MASTER = the lowest base id in the group (the
// account created first — what FieldRoutes shows as "Roaming Master").
// employee_ids = every branch id (used to match the rep's CRM sales).
// Scalar fields prefer the MASTER record (where the username/contact live), then
// the most-recently-updated. Validated: 936 people, Dan→10915, Aby→11328.
const EMP_SQL = `
WITH src AS (
  SELECT
    fieldRoutes_employeeID AS eid,
    CASE WHEN fieldRoutes_linkedEmployeeIDs IS NULL OR fieldRoutes_linkedEmployeeIDs IN ('', '0')
         THEN fieldRoutes_employeeID ELSE fieldRoutes_linkedEmployeeIDs END AS base_eid,
    NULLIF(LOWER(fieldRoutes_email), '') AS email_l,
    fieldRoutes_dateUpdated AS date_updated,
    fieldRoutes_fname AS fname, fieldRoutes_lname AS lname, fieldRoutes_nickname AS nickname,
    fieldRoutes_username AS username, fieldRoutes_email AS email, fieldRoutes_phone AS phone,
    fieldRoutes_officeID AS office_id, fieldRoutes_type AS type,
    fieldRoutes_active AS active, fieldRoutes_lastLogin AS last_login
  FROM \`${PROJECT}.${DATASET}.FieldRoutesEmployee\`
  WHERE fieldRoutes_employeeID IS NOT NULL AND fieldRoutes_employeeID != ''
    AND (fieldRoutes_active = '1' OR LOWER(fieldRoutes_active) = 'true')
    -- Drop FieldRoutes' internal/system accounts (FieldRoutes Admin, FR-System,
    -- Test users, integrations, etc.) so the roster is real people only. Also
    -- stops system accounts that reuse a real person's email from polluting them.
    AND NOT REGEXP_CONTAINS(LOWER(CONCAT(COALESCE(fieldRoutes_fname,''),' ',COALESCE(fieldRoutes_lname,''))),
        r'\\badmin\\b|\\bsystem\\b|fieldroutes|fr-system|\\btest\\b|\\breferral\\b|sellify|pest routes|ridd account|ridd sales|pro products|mosquito joe|clicki|pest ai|pest booker|applause')
),
g AS (
  SELECT *, COALESCE(email_l, base_eid) AS gkey,
         SAFE_CAST(base_eid AS INT64) AS base_num, SAFE_CAST(eid AS INT64) AS id_num
  FROM src
)
SELECT
  CAST(MIN(base_num) AS STRING) AS employee_id,
  ARRAY_AGG(NULLIF(fname,'')     IGNORE NULLS ORDER BY IF(eid=base_eid,0,1), base_num ASC, date_updated DESC, id_num DESC LIMIT 1)[SAFE_OFFSET(0)] AS fname,
  ARRAY_AGG(NULLIF(lname,'')     IGNORE NULLS ORDER BY IF(eid=base_eid,0,1), base_num ASC, date_updated DESC, id_num DESC LIMIT 1)[SAFE_OFFSET(0)] AS lname,
  ARRAY_AGG(NULLIF(nickname,'')  IGNORE NULLS ORDER BY IF(eid=base_eid,0,1), base_num ASC, date_updated DESC, id_num DESC LIMIT 1)[SAFE_OFFSET(0)] AS nickname,
  ARRAY_AGG(NULLIF(username,'')  IGNORE NULLS ORDER BY IF(eid=base_eid,0,1), base_num ASC, date_updated DESC, id_num DESC LIMIT 1)[SAFE_OFFSET(0)] AS username,
  ARRAY_AGG(NULLIF(email,'')     IGNORE NULLS ORDER BY IF(eid=base_eid,0,1), base_num ASC, date_updated DESC, id_num DESC LIMIT 1)[SAFE_OFFSET(0)] AS email,
  ARRAY_AGG(NULLIF(phone,'')     IGNORE NULLS ORDER BY IF(eid=base_eid,0,1), base_num ASC, date_updated DESC, id_num DESC LIMIT 1)[SAFE_OFFSET(0)] AS phone,
  ARRAY_AGG(NULLIF(office_id,'') IGNORE NULLS ORDER BY IF(eid=base_eid,0,1), base_num ASC, date_updated DESC, id_num DESC LIMIT 1)[SAFE_OFFSET(0)] AS office_id,
  STRING_AGG(DISTINCT office_id, ',') AS office_ids,
  STRING_AGG(DISTINCT eid, ',')       AS employee_ids,
  ARRAY_AGG(NULLIF(type,'')      IGNORE NULLS ORDER BY IF(eid=base_eid,0,1), base_num ASC, date_updated DESC, id_num DESC LIMIT 1)[SAFE_OFFSET(0)] AS type,
  MAX(active)                AS active,
  MAX(NULLIF(last_login,'')) AS last_login
FROM g
GROUP BY gkey`;

// FieldRoutes source master list (visible AND hidden). Grouped by name because
// the CRM can hold duplicate names under different IDs (e.g. two "Termite
// Upsell" rows) — one app row per name, visible if ANY of its IDs is visible.
const SRC_SQL = `
SELECT
  ARRAY_AGG(TRIM(fieldRoutes_source) ORDER BY SAFE_CAST(fieldRoutes_sourceID AS INT64) LIMIT 1)[SAFE_OFFSET(0)] AS name,
  STRING_AGG(DISTINCT fieldRoutes_sourceID, ',' ORDER BY fieldRoutes_sourceID) AS source_ids,
  MAX(CASE WHEN fieldRoutes_visible = '1' OR LOWER(fieldRoutes_visible) = 'true' THEN 1 ELSE 0 END) AS visible
FROM \`${PROJECT}.${DATASET}.FieldRoutesCustomerSource\`
WHERE fieldRoutes_source IS NOT NULL AND TRIM(fieldRoutes_source) != ''
GROUP BY LOWER(TRIM(fieldRoutes_source))`;

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Service-account creds: prefer the whole JSON file in GCP_SA_JSON (JSON.parse
// decodes the private_key newlines correctly), else fall back to the split vars.
function getCreds() {
  const raw = process.env.GCP_SA_JSON;
  if (raw && raw.trim()) { const o = JSON.parse(raw); return { email: o.client_email, key: o.private_key }; }
  const email = process.env.GCP_SA_EMAIL;
  const key = (process.env.GCP_SA_PRIVATE_KEY || '').replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
  return { email, key };
}
// Mint a Google OAuth access token from the service account (JWT bearer flow).
async function getAccessToken() {
  const { email, key } = getCreds();
  if (!email || !key) throw new Error('Set GCP_SA_JSON (whole key file) OR GCP_SA_EMAIL + GCP_SA_PRIVATE_KEY');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/bigquery.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }));
  const input = `${header}.${claim}`;
  const sig = b64url(crypto.createSign('RSA-SHA256').update(input).sign(key));
  const assertion = `${input}.${sig}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${assertion}`,
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error('token exchange failed: ' + JSON.stringify(j).slice(0, 300));
  return j.access_token;
}

// Run a query and page through every result row.
async function runQuery(token, sql) {
  const base = `https://bigquery.googleapis.com/bigquery/v2/projects/${JOB_PROJECT}`;
  const auth = { Authorization: `Bearer ${token}` };
  let res = await fetch(`${base}/queries`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, useLegacySql: false, maxResults: 20000, timeoutMs: 60000 }),
  });
  let j = await res.json();
  if (!res.ok) throw new Error('BigQuery query failed: ' + JSON.stringify(j.error || j).slice(0, 400));

  const jobId = j.jobReference.jobId;
  const location = j.jobReference.location || '';
  const schema = (j.schema && j.schema.fields) || [];
  let rows = j.rows || [];
  let pageToken = j.pageToken;

  // Job may not be complete on the first call; poll the same job.
  while (!j.jobComplete) {
    await new Promise((r) => setTimeout(r, 1000));
    res = await fetch(`${base}/queries/${jobId}?location=${location}&maxResults=20000`, { headers: auth });
    j = await res.json();
    if (!res.ok) throw new Error('BigQuery getResults failed: ' + JSON.stringify(j.error || j).slice(0, 400));
    rows = j.rows || rows;
    pageToken = j.pageToken;
  }

  while (pageToken) {
    res = await fetch(`${base}/queries/${jobId}?location=${location}&maxResults=20000&pageToken=${encodeURIComponent(pageToken)}`, { headers: auth });
    j = await res.json();
    if (!res.ok) throw new Error('BigQuery paging failed: ' + JSON.stringify(j.error || j).slice(0, 400));
    rows = rows.concat(j.rows || []);
    pageToken = j.pageToken;
  }
  return { schema, rows };
}

// BigQuery returns every value as a string under row.f[i].v — coerce numeric
// columns back to JS numbers (or null) so the snapshot matches the CSV parser.
function toObjects(schema, rows) {
  const numeric = schema.map((f) => f.type === 'INTEGER' || f.type === 'FLOAT' || f.type === 'NUMERIC');
  return (rows || []).map((row) => {
    const o = {};
    const cells = row.f || [];
    for (let i = 0; i < schema.length; i++) {
      const v = cells[i] ? cells[i].v : null;
      o[schema[i].name] = v == null ? null : (numeric[i] ? Number(v) : v);
    }
    return o;
  });
}

exports.handler = async (event) => {
  // Optional shared-secret gate (skipped if REVHAWK_SYNC_SECRET isn't set).
  const need = process.env.REVHAWK_SYNC_SECRET;
  if (need) {
    const got = (event && event.headers && (event.headers['x-sync-secret'] || event.headers['X-Sync-Secret'])) || '';
    if (got !== need) return { statusCode: 401, body: 'unauthorized' };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE) return { statusCode: 500, body: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required' };

  try {
    const started = Date.now();
    const token = await getAccessToken();
    const { schema, rows } = await runQuery(token, SQL);
    const objects = toObjects(schema, rows);
    if (!objects.length) return { statusCode: 200, body: JSON.stringify({ ok: false, note: 'query returned 0 rows — nothing written' }) };

    // Slim the payload before shipping: drop null/empty values (readers all
    // use `r.field ||` / `== null` patterns, so a missing key behaves exactly
    // like null) and compress at max level. Same rows, same fields when
    // present — just fewer bytes for every browser that downloads it.
    for (const o of objects) {
      for (const k of Object.keys(o)) {
        if (o[k] === null || o[k] === undefined || o[k] === '') delete o[k];
      }
    }
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(objects)), { level: 9 });
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    const path = 'snapshots/revhawk-' + Date.now() + '.json.gz';
    const { error: upErr } = await supabase.storage.from('reporting')
      .upload(path, gz, { contentType: 'application/gzip', upsert: true });
    if (upErr) throw new Error('storage upload failed: ' + upErr.message);

    const { data: envRow, error: envErr } = await supabase.from('reporting_uploads').insert({
      filename: 'RevHawk live sync — ' + new Date().toISOString().slice(0, 10),
      row_count: objects.length,
      uploaded_by: null,
      storage_path: path,
    }).select('id, uploaded_at').single();
    if (envErr) throw new Error('envelope insert failed: ' + envErr.message);

    // ── Server-side Indicators derive ──────────────────────────────────
    // THE server is the one writer of the shared indicators dataset now.
    // Browsers used to derive + push this blob themselves, which meant any
    // stale open tab could clobber everyone (and phones stuck on month-old
    // caches were "current" as far as they knew). Deriving here, from the
    // exact rows just snapshotted, gives one authoritative copy per sync.
    // Failure is non-fatal: clients keep their auto-derive as a fallback.
    let indicatorsError = null;
    try {
      // Shared module lives OUTSIDE the functions dir (netlify/lib) — a
      // subfolder inside netlify/functions gets treated as a function entry
      // by the bundler and breaks the build.
      const { deriveIndicatorsPayload } = require('../lib/indicators-derive.js');
      const uploadedAt = (envRow && envRow.uploaded_at) || new Date().toISOString();
      const payload = deriveIndicatorsPayload(objects, uploadedAt,
        'RevHawk sync — ' + new Date(uploadedAt).toLocaleDateString('en-US', { timeZone: 'America/New_York' }));
      const indGz = zlib.gzipSync(Buffer.from(JSON.stringify(payload)), { level: 9 });
      const { error: indErr } = await supabase.storage.from('reporting')
        .upload('indicators/latest.json.gz', indGz, { contentType: 'application/gzip', upsert: true });
      if (indErr) throw new Error(indErr.message);
      console.log('[revhawk-sync] indicators derived server-side: ' + payload.rawSales.length + ' sales, ' + payload.indicatorsData.length + ' agg rows, ' + indGz.length + ' bytes gz');

      // ── 📚 MONTHLY METRIC ARCHIVE (best-effort) ──────────────────────
      // Every CLOSED month missing from snapshots/ gets written as
      // metrics-YYYY-MM.json.gz: company / per-office / per-department /
      // per-rep rollups for that month. The first run backfills every month
      // in the 3-year dataset; after that it's one new file per month.
      // These blobs are never pruned — history survives the app's data
      // fence, so year-over-year comparisons keep working forever.
      try {
        const { data: _snapList } = await supabase.storage.from('reporting').list('snapshots', { limit: 1000 });
        const _have = new Set((_snapList || []).map(f => f.name));
        const _parseDay = (ds) => { const p = String(ds || '').split(' ')[0].split('/'); if (p.length !== 3) return null; let y = Number(p[2]); if (y < 100) y += 2000; const d = new Date(y, Number(p[0]) - 1, Number(p[1])); return isNaN(d) ? null : d; };
        const _nowNY = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const _curPeriod = _nowNY.getFullYear() + '-' + String(_nowNY.getMonth() + 1).padStart(2, '0');
        // Bucket the derived sales by month in one pass.
        const _byMonth = {};
        for (const r of payload.rawSales) {
          const d = _parseDay(r.dateSold);
          if (!d) continue;
          const per = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
          if (per >= _curPeriod) continue;                       // only CLOSED months
          (_byMonth[per] = _byMonth[per] || []).push(r);
        }
        const DEPT = { 'sales rep': 'Sales Rep', 'technician': 'Technician' };
        let _written = 0;
        for (const per of Object.keys(_byMonth).sort()) {
          const fname = 'metrics-' + per + '.json.gz';
          if (_have.has(fname)) continue;
          const rows = _byMonth[per];
          const mk = () => ({ sales: 0, revenue: 0, initSum: 0, multi: 0, twelve: 0, autoPay: 0, cancelsRaw: 0, reps: new Set() });
          const agg = { company: mk(), byOffice: {}, byDept: {}, byRep: {} };
          for (const r of rows) {
            const office = r.office || 'UNKNOWN';
            const dept = DEPT[String(r.repType || '').toLowerCase()] || 'Office Staff';
            const rep = r.rep || 'Unknown';
            const cv = Number(r.contractValue) || 0;
            for (const t of [agg.company, (agg.byOffice[office] = agg.byOffice[office] || mk()), (agg.byDept[dept] = agg.byDept[dept] || mk())]) {
              t.sales++; t.revenue += cv; t.initSum += Number(r.initialPrice) || 0;
              if (Number(r.contract) >= 18) t.multi++;
              if (Number(r.contract) === 12) t.twelve++;
              if (r.autoPay && r.autoPay !== 'No') t.autoPay++;
              if (r.cancelDate) t.cancelsRaw++;
              t.reps.add(rep);
            }
            const rr = agg.byRep[rep] = agg.byRep[rep] || { sales: 0, revenue: 0, office };
            rr.sales++; rr.revenue += cv;
          }
          const fin = (t) => ({ sales: t.sales, revenue: Math.round(t.revenue), acv: t.sales ? +(t.revenue / t.sales).toFixed(2) : 0, avgInitial: t.sales ? +(t.initSum / t.sales).toFixed(2) : 0, myPct: (t.multi + t.twelve) ? +(t.multi / (t.multi + t.twelve)).toFixed(4) : 0, autoPayPct: t.sales ? +(t.autoPay / t.sales).toFixed(4) : 0, cancelsRaw: t.cancelsRaw, reps: t.reps.size });
          const snap = {
            period: per, generatedAt: new Date().toISOString(),
            note: 'cancelsRaw = rows carrying any cancel date as of snapshot time; attrition matures after the month closes.',
            company: fin(agg.company),
            byOffice: Object.fromEntries(Object.entries(agg.byOffice).map(([k, v]) => [k, fin(v)])),
            byDept: Object.fromEntries(Object.entries(agg.byDept).map(([k, v]) => [k, fin(v)])),
            byRep: agg.byRep,
          };
          const snapGz = zlib.gzipSync(Buffer.from(JSON.stringify(snap)), { level: 9 });
          const { error: snapErr } = await supabase.storage.from('reporting')
            .upload('snapshots/' + fname, snapGz, { contentType: 'application/gzip', upsert: false });
          if (snapErr && !/exists|duplicate/i.test(snapErr.message || '')) throw new Error(snapErr.message);
          _written++;
        }
        if (_written) console.log('[revhawk-sync] monthly archive: wrote ' + _written + ' snapshot(s)');
      } catch (snapE) {
        console.error('[revhawk-sync] monthly archive skipped:', String((snapE && snapE.message) || snapE));
      }
    } catch (ie) {
      indicatorsError = String((ie && ie.message) || ie);
      console.error('[revhawk-sync] server-side indicators derive failed (clients will fall back):', indicatorsError);
    }

    // ── Prune old auto-sync snapshots (best-effort) ──
    // At the every-30-min cadence the bucket would otherwise grow by ~48
    // blobs/day. Keep the most recent 12 RevHawk snapshots (≈6 hours of
    // history) and drop the rest. Manual CSV uploads are untouched — they
    // don't use the 'RevHawk live sync' filename.
    try {
      const KEEP = 12;
      const { data: _allSnaps } = await supabase.from('reporting_uploads')
        .select('id, storage_path, uploaded_at')
        .like('filename', 'RevHawk live sync%')
        .order('uploaded_at', { ascending: false });
      const _stale = (_allSnaps || []).slice(KEEP);
      if (_stale.length) {
        const _paths = _stale.map(r => r.storage_path).filter(Boolean);
        if (_paths.length) await supabase.storage.from('reporting').remove(_paths);
        await supabase.from('reporting_uploads').delete().in('id', _stale.map(r => r.id));
      }
    } catch (pruneErr) { console.warn('[revhawk-sync] snapshot prune failed', pruneErr); }

    // ── Employee roster → fieldroutes_employees (best-effort) ──
    // Mirror every CRM employee so the app can show "in CRM, not in app yet"
    // and provision a profile pre-filled with their email/phone. A failure
    // here must NOT fail the snapshot, so it's wrapped on its own.
    let rosterCount = 0, rosterError = null;
    try {
      const TYPE_LABEL = { '0': 'Office Staff', '1': 'Technician', '2': 'Sales Rep' };
      const runStamp = new Date().toISOString();   // one timestamp for the whole batch
      const emp = await runQuery(token, EMP_SQL);
      const empObjects = toObjects(emp.schema, emp.rows);
      const officeNames = (ids) => (ids ? String(ids).split(',').map(s => OFFICE_NAMES[s.trim()] || ('Office ' + s.trim())) : []);
      const roster = empObjects.filter(e => e.employee_id).map(e => ({
        employee_id: String(e.employee_id),
        fname: e.fname || null, lname: e.lname || null, nickname: e.nickname || null,
        username: (e.username || '').trim() || null,
        email: (e.email || '').trim() || null, phone: (e.phone || '').trim() || null,
        office_id: e.office_id || null,
        office_ids: e.office_ids || null,
        employee_ids: e.employee_ids || null,
        // Representative office name; for multi-office people, list them all.
        office_name: officeNames(e.office_ids).join(', ') || OFFICE_NAMES[e.office_id] || (e.office_id ? 'Office ' + e.office_id : null),
        type: e.type || null, type_label: TYPE_LABEL[e.type] || null,
        active: (e.active === '1' || String(e.active).toLowerCase() === 'true'),
        last_login: e.last_login || null,
        synced_at: runStamp,
      }));
      for (let i = 0; i < roster.length; i += 500) {
        const { error } = await supabase.from('fieldroutes_employees')
          .upsert(roster.slice(i, i + 500), { onConflict: 'employee_id' });
        if (error) throw new Error(error.message);
      }
      // Purge stale rows from a previous grouping scheme (e.g. old max-ID keys):
      // anything not touched by THIS run is no longer a current person.
      if (roster.length) {
        const { error: delErr } = await supabase.from('fieldroutes_employees').delete().lt('synced_at', runStamp);
        if (delErr) console.warn('[revhawk-sync] stale roster purge failed:', delErr.message);
      }
      rosterCount = roster.length;

      // ── Auto-revoke app access for CRM-inactive people (best-effort) ──
      // A rep who quits gets deactivated in FieldRoutes; the next sync moves
      // their app profile (rep roles ONLY — admins/auditors are never
      // touched) to role='disabled'. The client shows an access-ended screen
      // for that role. Re-enable from Settings → Users by assigning a role.
      try {
        const inactiveIds = new Set();
        roster.forEach(e => {
          if (e.active) return;
          String(e.employee_ids || e.employee_id || '').split(',').forEach(id => { const t = id.trim(); if (t) inactiveIds.add(t); });
        });
        if (inactiveIds.size) {
          const { data: profs, error: pErr } = await supabase.from('profiles')
            .select('id, role, full_name, fieldroutes_employee_id')
            .like('role', 'rep%');
          if (pErr) throw new Error(pErr.message);
          const toDisable = (profs || []).filter(p => p.fieldroutes_employee_id && inactiveIds.has(String(p.fieldroutes_employee_id)));
          for (const p of toDisable) {
            const { error: uErr } = await supabase.from('profiles').update({ role: 'disabled' }).eq('id', p.id);
            if (uErr) console.warn('[revhawk-sync] revoke failed for', p.full_name, uErr.message);
            else console.log('[revhawk-sync] access revoked (CRM-inactive):', p.full_name);
          }
        }
      } catch (rvErr) {
        console.error('[revhawk-sync] access revoke skipped:', String((rvErr && rvErr.message) || rvErr));
      }

      // ── 🪄 INSIDE SALES AUTO-ADD (best-effort) ──────────────────────────
      // Office-staff-sold SUBSCRIPTIONS flow straight from FieldRoutes into
      // the Inside Sales queue as PENDING — reps stop double-logging; only
      // UPSELLS stay manual (they deduct from an original contract, which
      // the CRM can't express). One row PER SUBSCRIPTION (multi-sub accounts
      // create multiple rows). Cutoff-forward only; deduped against manual
      // logs (exact key + the auto-verify's ±7-day/±$1 revenue match) and
      // against prior runs. Auto rows: logged_by NULL + a notes marker, and
      // they arrive pre-CRM-verified since they're born from the CRM.
      try {
        const START = process.env.INSIDE_AUTOADD_START || '2026-07-14';
        const EXCLUDED_SVCS = new Set(['ACH Chargeback', 'Early Cancellation Fee', 'German Roach Initial', 'Rodent Station Removal']);
        const masterOf = new Map();
        roster.forEach(e => String(e.employee_ids || e.employee_id || '').split(',').forEach(id => { const t = id.trim(); if (t) masterOf.set(t, String(e.employee_id)); }));
        const { data: profs2 } = await supabase.from('profiles').select('id, fieldroutes_employee_id, office_id').not('fieldroutes_employee_id', 'is', null);
        const profByMaster = new Map((profs2 || []).map(p => [String(p.fieldroutes_employee_id), p]));
        const pool = objects.filter(r =>
          String(r.sold_by_type || '').trim() === 'Office Staff'
          && r.customer_id && r.sold_date && String(r.sold_date).slice(0, 10) >= START
          && !EXCLUDED_SVCS.has(String(r.subscription || '').trim()));
        if (pool.length) {
          const [exQ, offQ, svcQ, srcQ, ctQ] = await Promise.all([
            supabase.from('sales').select('customer_number, revenue_amount, sold_date, crm_subscription').gte('sold_date', START),
            supabase.from('offices').select('id, name'),
            supabase.from('service_types').select('id, name'),
            supabase.from('sources').select('id, name'),
            supabase.from('contract_types').select('id, name'),
          ]);
          const norm = (x) => String(x || '').trim().toLowerCase();
          const haveKey = new Set();
          const haveRevenue = [];
          (exQ.data || []).forEach(x => {
            haveKey.add(norm(x.customer_number) + '|' + norm(x.crm_subscription) + '|' + String(x.sold_date).slice(0, 10));
            haveRevenue.push({ cust: norm(x.customer_number), rev: Number(x.revenue_amount) || 0, t: Date.parse(String(x.sold_date)) || 0 });
          });
          const officeByName = new Map((offQ.data || []).map(o => [norm(o.name), o.id]));
          const svcByName = new Map((svcQ.data || []).map(o => [norm(o.name), o.id]));
          const srcByName = new Map((srcQ.data || []).map(o => [norm(o.name), o.id]));
          const ctByName = new Map((ctQ.data || []).map(o => [norm(o.name), o.id]));
          let added = 0, skippedDup = 0, skippedNoRep = 0, svcCreated = 0;
          for (const r of pool) {
            if (added >= 300) break;                                        // sanity cap per run
            const soldIso = String(r.sold_date).slice(0, 10);
            const sub = String(r.subscription || '').trim() || 'Unknown';
            const cv = Number(r.subscription_contract_value) || 0;
            const key = norm(r.customer_id) + '|' + norm(sub) + '|' + soldIso;
            if (haveKey.has(key)) { skippedDup++; continue; }
            const soldT = Date.parse(soldIso) || 0;
            if (haveRevenue.some(h => h.cust === norm(r.customer_id) && Math.abs(h.rev - cv) <= 1 && Math.abs(h.t - soldT) <= 7 * 86400000)) { skippedDup++; continue; }
            const master = masterOf.get(String(r.sold_by_id || '').trim());
            const prof = master ? profByMaster.get(master) : null;
            if (!prof) { skippedNoRep++; continue; }                        // seller has no app account — nothing to attribute to
            let svcId = svcByName.get(norm(sub));
            if (!svcId) {
              // Auto-create the service type so the pipeline never silently
              // stalls on a new CRM subscription name.
              const ins = await supabase.from('service_types').insert({ name: sub }).select('id').maybeSingle();
              if (ins.data && ins.data.id) { svcId = ins.data.id; svcCreated++; }
              else { const again = await supabase.from('service_types').select('id').ilike('name', sub).maybeSingle(); svcId = again.data && again.data.id; }
              if (svcId) svcByName.set(norm(sub), svcId);
            }
            if (!svcId) continue;
            const months = Number(r.agreement_length) || 12;
            const initial = Number(r.initial_price) || 0;
            const monthly = Math.max(0, Math.round(((cv - initial) / 11) * 100) / 100);   // inverse of the app's revenue = initial + monthly×11
            const { error: insErr } = await supabase.from('sales').insert({
              rep_id: prof.id,
              logged_by: null,                                              // origin marker: auto-added
              customer_name: [String(r.first_name || '').trim(), String(r.last_name || '').trim()].filter(Boolean).join(' ') || ('Customer ' + r.customer_id),
              customer_number: String(r.customer_id),
              office_id: officeByName.get(norm(r.office_name)) ?? prof.office_id ?? null,
              service_type_id: svcId,
              source_id: srcByName.get(norm(r.subscription_source)) ?? null,
              contract_type_id: ctByName.get(norm(months + ' Months')) ?? null,
              contract_months: months,
              initial_amount: initial,
              monthly_amount: monthly,
              num_services: null,
              pay_per_service: false,
              paid_in_full: cv > 0 && initial >= 0.9 * cv,   // initial invoice covers the year -> PIF
              is_commercial: false,
              revenue_amount: cv,
              sold_date: soldIso,
              commission_date: null,
              notes: 'Auto-added from FieldRoutes sync',
              audit_status: 'pending',
              created_at: new Date().toISOString(),
              crm_status: 'verified', crm_contract_value: cv, crm_subscription: sub, crm_checked_at: new Date().toISOString(),
            });
            if (insErr) { console.warn('[revhawk-sync] auto-add failed for cust ' + r.customer_id + ': ' + insErr.message); continue; }
            haveKey.add(key); haveRevenue.push({ cust: norm(r.customer_id), rev: cv, t: soldT });
            added++;
          }
          if (added || skippedNoRep || svcCreated) console.log('[revhawk-sync] inside-sales auto-add: +' + added + ' subscription(s), ' + skippedDup + ' already logged, ' + skippedNoRep + ' seller(s) with no app profile' + (svcCreated ? ', ' + svcCreated + ' service type(s) created' : ''));
        }
      } catch (aaErr) {
        console.error('[revhawk-sync] inside-sales auto-add skipped:', String((aaErr && aaErr.message) || aaErr));
      }
    } catch (re) {
      rosterError = String((re && re.message) || re);
      console.error('[revhawk-sync] roster upsert skipped:', rosterError);
    }

    // ── Source master list → public.sources (best-effort) ──
    // STRICT MIRROR — FieldRoutes is the only place sources are managed:
    //   • every CRM source is upserted with the CRM's visibility, every run
    //   • any app row NOT in the CRM list is auto-hidden (not deleted — past
    //     sales keep pointing at their source name)
    // Requires the fr_* columns (fieldroutes_sources.sql); if they're
    // missing this block just logs.
    let srcCount = 0, srcError = null;
    try {
      const srcRes = await runQuery(token, SRC_SQL);
      const frSources = toObjects(srcRes.schema, srcRes.rows)
        .filter(s => s.name)
        .map(s => ({ name: s.name, ids: String(s.source_ids || ''), visible: String(s.visible) === '1' }));
      if (frSources.length) {
        const { data: appSources, error: selErr } = await supabase
          .from('sources').select('id, name, is_active, fr_source_id, fr_visible');
        if (selErr) throw new Error(selErr.message);
        const stamp = new Date().toISOString();
        const byFrId = new Map(), byName = new Map();
        for (const r of (appSources || [])) {
          for (const fid of String(r.fr_source_id || '').split(',')) if (fid.trim()) byFrId.set(fid.trim(), r);
          if (r.name) byName.set(r.name.trim().toLowerCase(), r);
        }
        const touched = new Set();
        for (const fr of frSources) {
          const row = fr.ids.split(',').map(x => byFrId.get(x.trim())).find(Boolean)
                   || byName.get(fr.name.toLowerCase());
          if (!row) {
            const { error } = await supabase.from('sources').insert({
              name: fr.name,
              is_renewal: /renewal/i.test(fr.name),
              is_active: fr.visible,
              fr_source_id: fr.ids, fr_visible: fr.visible, fr_synced_at: stamp,
            });
            if (error) throw new Error('insert "' + fr.name + '": ' + error.message);
          } else {
            touched.add(row.id);
            const { error } = await supabase.from('sources').update({
              fr_source_id: fr.ids,
              fr_visible: fr.visible,
              fr_synced_at: stamp,
              is_active: fr.visible,   // CRM visibility is authoritative
            }).eq('id', row.id);
            if (error) throw new Error('update "' + fr.name + '": ' + error.message);
          }
          srcCount++;
        }
        // Anything the CRM doesn't know about gets hidden (kept for history).
        for (const r of (appSources || [])) {
          if (touched.has(r.id) || r.is_active === false) continue;
          const { error } = await supabase.from('sources')
            .update({ is_active: false, fr_synced_at: stamp }).eq('id', r.id);
          if (error) throw new Error('hide "' + r.name + '": ' + error.message);
        }
      }
    } catch (se) {
      srcError = String((se && se.message) || se);
      console.error('[revhawk-sync] source mirror skipped:', srcError);
    }

    // ── CRM auto-verify: rep-logged sales ↔ warehouse subscriptions ──
    // The app's Sales Log carries the FieldRoutes customer # on every sale.
    // Each sync re-checks recent sales against the snapshot ALREADY in memory:
    // match the customer, prefer subscriptions sold within ±7 days of the
    // logged sold date, compare contract value to the logged revenue.
    //   verified          → CRM contract value matches to the dollar
    //   revenue_mismatch  → account found but the $ differs (upsells can
    //                       legitimately do this — human takes a look)
    //   not_found         → customer # not in the warehouse (yet)
    // Best-effort: requires the crm_* columns (sales_crm_verify.sql).
    let verifyCount = 0, verifyError = null;
    try {
      const since = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
      let _lifecycleCols = true;   // flips off if sales_crm_lifecycle.sql hasn't been run
      let { data: appSales, error: asErr } = await supabase.from('sales')
        .select('id, customer_number, revenue_amount, sold_date, paid_in_full, crm_status, crm_contract_value, crm_serviced_at, crm_completed_services, crm_days_past_due, crm_balance')
        .gte('sold_date', since);
      if (asErr && /column|schema cache/i.test(asErr.message || '')) {
        _lifecycleCols = false;
        console.warn('[revhawk-sync] lifecycle columns missing - run sales_crm_lifecycle.sql to enable serviced/paid stamps');
        ({ data: appSales, error: asErr } = await supabase.from('sales')
          .select('id, customer_number, revenue_amount, sold_date, paid_in_full, crm_status, crm_contract_value')
          .gte('sold_date', since));
      }
      if (asErr) throw new Error(asErr.message);
      if (appSales && appSales.length) {
        const byCust = new Map();
        for (const r of objects) {
          const id = r.customer_id != null ? String(r.customer_id).trim() : '';
          if (!id) continue;
          if (!byCust.has(id)) byCust.set(id, []);
          byCust.get(id).push(r);
        }
        const stamp = new Date().toISOString();
        for (const s of appSales) {
          const cust = s.customer_number != null ? String(s.customer_number).trim() : '';
          const rev = Number(s.revenue_amount) || 0;
          let status = 'not_found', cv = null, subName = null;
          const lc = { serviced_at: null, completed: 0, dpd: null, balance: null, pif: false };
          const subs = cust ? byCust.get(cust) : null;
          if (subs && subs.length) {
            const soldT = Date.parse(s.sold_date || '') || 0;
            const near = soldT ? subs.filter(r => { const t = Date.parse(r.sold_date || ''); return t && Math.abs(t - soldT) <= 7 * 86400000; }) : [];
            let pool = near.length ? near : subs;
            // Re-keyed duplicates: when the rep's first entry was abandoned
            // (initial never happened) and a live twin exists, the REAL sub
            // is the Pending/Completed one — never verify against the ghost.
            const ps = pool.filter(r => ['pending', 'completed'].includes(String(r.initial_status || '').toLowerCase()));
            if (ps.length) pool = ps;
            let best = pool[0], bestDiff = Infinity;
            for (const r of pool) {
              const v = Number(r.subscription_contract_value) || 0;
              const d = Math.abs(v - rev);
              if (d < bestDiff) { bestDiff = d; best = r; }
            }
            cv = Number(best.subscription_contract_value) || 0;
            subName = best.subscription || null;
            // EXACT-value discipline (never over/under-pay): to-the-penny
            // match = verified; within $1 = near_match (amber — auditor
            // eyeballs the cents); beyond that = revenue_mismatch.
            status = bestDiff === 0 ? 'verified' : bestDiff <= 1 ? 'near_match' : 'revenue_mismatch';
            // Lifecycle from the warehouse: serviced yet? paid / current?
            lc.serviced_at = best.initial_serviced_date ? String(best.initial_serviced_date).slice(0, 10) : null;
            lc.completed = Number(best.subscription_completed_services) || 0;
            lc.dpd = (best.days_past_due === null || best.days_past_due === undefined || best.days_past_due === '') ? null : (Number(best.days_past_due) || 0);
            lc.balance = (best.responsible_balance === null || best.responsible_balance === undefined || best.responsible_balance === '') ? null : (Math.round((Number(best.responsible_balance) || 0) * 100) / 100);
            // PAID-IN-FULL auto-detect: initial invoice covers >=90% of the
            // contract value AND no balance owing — the customer paid the
            // year upfront. One-way stamp (never un-sets) so a later balance
            // blip can't flap commissions.
            lc.pif = cv > 0
              && (Number(best.initial_price) || 0) >= 0.9 * cv
              && (lc.balance == null || lc.balance <= 0.01);
          }
          // Only write rows whose verdict OR lifecycle actually changed —
          // keeps the pass near-free once things settle.
          const lcChanged = _lifecycleCols && (
            String(s.crm_serviced_at || '') !== String(lc.serviced_at || '') ||
            (Number(s.crm_completed_services) || 0) !== (lc.completed || 0) ||
            (s.crm_days_past_due == null ? null : Number(s.crm_days_past_due)) !== lc.dpd ||
            (s.crm_balance == null ? null : Number(s.crm_balance)) !== lc.balance);
          const pifChanged = lc.pif && !s.paid_in_full;
          if (s.crm_status === status && (Number(s.crm_contract_value) || 0) === (cv || 0) && !lcChanged && !pifChanged) continue;
          const upd = { crm_status: status, crm_contract_value: cv, crm_subscription: subName, crm_checked_at: stamp };
          if (_lifecycleCols) { upd.crm_serviced_at = lc.serviced_at; upd.crm_completed_services = lc.completed; upd.crm_days_past_due = lc.dpd; upd.crm_balance = lc.balance; }
          if (pifChanged) upd.paid_in_full = true;
          let { error } = await supabase.from('sales').update(upd).eq('id', s.id);
          if (error && _lifecycleCols && /column|schema cache/i.test(error.message || '')) {
            // sales_crm_lifecycle.sql not run yet — degrade to legacy stamp.
            _lifecycleCols = false;
            console.warn('[revhawk-sync] lifecycle columns missing — run sales_crm_lifecycle.sql to enable serviced/paid stamps');
            ({ error } = await supabase.from('sales').update({ crm_status: status, crm_contract_value: cv, crm_subscription: subName, crm_checked_at: stamp }).eq('id', s.id));
          }
          if (error) throw new Error(error.message);
          verifyCount++;
        }
      }
    } catch (ve) {
      verifyError = String((ve && ve.message) || ve);
      console.error('[revhawk-sync] sale CRM verify skipped:', verifyError);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, rows: objects.length, employees: rosterCount, rosterError, sources: srcCount, srcError, salesVerified: verifyCount, verifyError, storage_path: path, ms: Date.now() - started }),
    };
  } catch (e) {
    console.error('[revhawk-sync]', e);
    // Ring the bell: a dead sync on a comp Saturday must not be a silent
    // discovery. Set SLACK_SYNC_WEBHOOK in Netlify env (any Slack incoming
    // webhook URL) and failures post there; unset = logs only.
    try {
      // ADMIN-ONLY alerts: SLACK_SYNC_WEBHOOK pointed at the Inside Sales
      // channel, so every quota hiccup pinged the whole sales team. Failure
      // alerts now post ONLY to SLACK_ADMIN_WEBHOOK (set it to a private
      // admin channel's webhook when you want them back; unset = silent,
      // failures still land in the Netlify function logs).
      const hook = process.env.SLACK_ADMIN_WEBHOOK;
      if (hook) await fetch(hook, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '🚨 RIDD Sales App: RevHawk sync FAILED — ' + String((e && e.message) || e).slice(0, 300) + ' (boards stop updating until this recovers)' }),
      });
    } catch (se) { console.error('[revhawk-sync] slack alert failed', se); }
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
