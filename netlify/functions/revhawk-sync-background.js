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
};
const officeCase = Object.entries(OFFICE_NAMES)
  .map(([id, name]) => `WHEN '${id}' THEN '${name.replace(/'/g, "''")}'`).join(' ');

// The mapping query — every column aliased to the EXACT field name
// parseReportingCsv emits, and numeric columns SAFE_CAST so the result schema
// types let us coerce to JS numbers. Validated against the live data.
const SQL = `
WITH flags AS (
  SELECT fieldRoutes_customerID AS cid, STRING_AGG(DISTINCT fieldRoutes_flag, ', ') AS flags
  FROM \`${PROJECT}.${DATASET}.FieldRoutesCustomerFlags\`
  WHERE fieldRoutes_flag IS NOT NULL AND fieldRoutes_flag != ''
  GROUP BY 1
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
)
SELECT
  s.fieldRoutes_customerID AS customer_id,
  cust.lname AS last_name,
  cust.fname AS first_name,
  NULLIF(LEFT(s.fieldRoutes_dateAdded,10),'0000-00-00') AS sold_date,
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
  CASE WHEN s.fieldRoutes_initialStatusText='Completed'
       THEN NULLIF(LEFT(s.fieldRoutes_dateAdded,10),'0000-00-00') END AS initial_service,
  s.fieldRoutes_source AS subscription_source,
  CAST(NULL AS STRING) AS country,
  cust.state AS state,
  cust.zip AS zip_code,
  SAFE_CAST(cust.dpd AS INT64) AS days_past_due,
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
WHERE s.fieldRoutes_customerID IS NOT NULL AND s.fieldRoutes_customerID != ''`;

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Mint a Google OAuth access token from the service account (JWT bearer flow).
async function getAccessToken() {
  const email = process.env.GCP_SA_EMAIL;
  let key = process.env.GCP_SA_PRIVATE_KEY || '';
  if (!email || !key) throw new Error('GCP_SA_EMAIL and GCP_SA_PRIVATE_KEY are required');
  key = key.replace(/\\n/g, '\n'); // env vars often store the PEM with literal \n
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

// Run the query and page through every result row.
async function runQuery(token) {
  const base = `https://bigquery.googleapis.com/bigquery/v2/projects/${JOB_PROJECT}`;
  const auth = { Authorization: `Bearer ${token}` };
  let res = await fetch(`${base}/queries`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: SQL, useLegacySql: false, maxResults: 20000, timeoutMs: 60000 }),
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
    const { schema, rows } = await runQuery(token);
    const objects = toObjects(schema, rows);
    if (!objects.length) return { statusCode: 200, body: JSON.stringify({ ok: false, note: 'query returned 0 rows — nothing written' }) };

    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(objects)));
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    const path = 'snapshots/revhawk-' + Date.now() + '.json.gz';
    const { error: upErr } = await supabase.storage.from('reporting')
      .upload(path, gz, { contentType: 'application/gzip', upsert: true });
    if (upErr) throw new Error('storage upload failed: ' + upErr.message);

    const { error: envErr } = await supabase.from('reporting_uploads').insert({
      filename: 'RevHawk live sync — ' + new Date().toISOString().slice(0, 10),
      row_count: objects.length,
      uploaded_by: null,
      storage_path: path,
    });
    if (envErr) throw new Error('envelope insert failed: ' + envErr.message);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, rows: objects.length, storage_path: path, ms: Date.now() - started }),
    };
  } catch (e) {
    console.error('[revhawk-sync]', e);
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
