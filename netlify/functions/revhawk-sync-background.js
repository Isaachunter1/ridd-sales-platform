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

// Office id → branch name. Curated names win (they're what every report
// groups by), but each run DISCOVERS new branches from the warehouse's
// office table, so opening or buying a branch needs no code change — it
// shows up under its CRM name on the next sync. Discovery failure is
// non-fatal: this baseline keeps working exactly as before.
const OFFICE_NAMES = {
  '1': 'Salt Lake', '6': 'Charleston', '7': 'Myrtle Beach', '10': 'Destin',
  '13': 'Atlanta', '15': 'Virginia Beach', '16': 'Raleigh', '18': 'Detroit',
  '19': 'Joplin',   // opened Jul 2026 — appeared in the warehouse 2026-07-08
  '20': 'Little Rock', // added to RevHawk replication 2026-07-30 (per Isaac)
};
async function discoverOffices(token) {
  try {
    const q = `SELECT fieldRoutes_officeID AS id, fieldRoutes_officeName AS name
               FROM \`${PROJECT}.${DATASET}.FieldRoutesOffice\`
               WHERE fieldRoutes_officeID IS NOT NULL AND SAFE_CAST(fieldRoutes_officeID AS INT64) > 0`;
    const r = await runQuery(token, q);
    let added = 0;
    for (const o of toObjects(r.schema, r.rows)) {
      const id = String(o.id || '').trim(), nm = String(o.name || '').trim();
      if (id && nm && !OFFICE_NAMES[id]) { OFFICE_NAMES[id] = nm; added++; }
    }
    if (added) console.log('[revhawk-sync] office discovery: +' + added + ' new branch(es) from the warehouse');
  } catch (e) {
    console.warn('[revhawk-sync] office discovery skipped:', String((e && e.message) || e).slice(0, 200));
  }
}
const buildOfficeCase = () => Object.entries(OFFICE_NAMES)
  .map(([id, name]) => `WHEN '${id}' THEN '${name.replace(/'/g, "''")}'`).join(' ');

// The mapping query — every column aliased to the EXACT field name
// parseReportingCsv emits, and numeric columns SAFE_CAST so the result schema
// types let us coerce to JS numbers. Validated against the live data.
const buildSQL = () => `
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
  -- NEWEST copy per customer. When an account is transferred between
  -- branches (e.g. sold in Myrtle Beach, moved to Salt Lake) the warehouse
  -- keeps BOTH customer rows, and ANY_VALUE() used to pick the stale one —
  -- so the account stayed on the old office (custs 146807 / 156132 /
  -- 177915, per Isaac). Latest updatedAt wins.
  SELECT fieldRoutes_customerID AS cid,
    fieldRoutes_lname AS lname, fieldRoutes_fname AS fname,
    fieldRoutes_county AS county, fieldRoutes_state AS state, fieldRoutes_city AS city,
    fieldRoutes_zip AS zip, fieldRoutes_phone1 AS phone,
    fieldRoutes_email AS email, fieldRoutes_aPay AS apay,
    fieldRoutes_responsibleBalanceAge AS dpd,
    fieldRoutes_responsibleBalance AS resp_balance,
    fieldRoutes_customerSource AS csource,
    fieldRoutes_officeID AS office_id,
    -- Customer-card buttons (per Isaac): the "Paid In Full" button the reps
    -- press, and the Commercial Account toggle. Both '0'/'1'.
    fieldRoutes_paidInFull AS pif,
    fieldRoutes_commercialAccount AS commercial
  FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY fieldRoutes_customerID ORDER BY updatedAt DESC, createdAt DESC) AS rn
    FROM \`${PROJECT}.${DATASET}.FieldRoutesCustomer\`
    WHERE fieldRoutes_customerID IS NOT NULL AND fieldRoutes_customerID != ''
  ) WHERE rn = 1
),
sub AS (
  -- Same dedupe for subscriptions: a transferred account carries two rows
  -- for ONE subscription id (old office + old seller, new office + new
  -- seller). Without this the snapshot double-counts the sub AND files a
  -- copy under the branch it left. 58 subs / 116 rows as of Sep 2026.
  SELECT * EXCEPT (rn) FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY fieldRoutes_subscriptionID ORDER BY updatedAt DESC, createdAt DESC) AS rn
    FROM \`${PROJECT}.${DATASET}.FieldRoutesSubscription\`
    WHERE fieldRoutes_subscriptionID IS NOT NULL AND fieldRoutes_subscriptionID != ''
  ) WHERE rn = 1
),
-- Cancel reason = what FieldRoutes shows today (per Isaac, Sep 30):
--   · the most recently WRITTEN note wins (dateAdded), not the latest note
--     date — the 2025 re-tag of old cancels added new notes back-dated to the
--     cancel date, so "latest date" kept the retired label (Lost Job,
--     Financial, Bad Service, Out of Contract - …);
--   · a renamed reason (same ID, new label) shows its current label.
cxlNotes AS (
  SELECT fieldRoutesSubscriptionId AS sid, TRIM(fieldRoutes_cancellationReason) AS reason,
    NULLIF(fieldRoutes_cancellationReasonID, '') AS rid, fieldRoutes_date AS d,
    COALESCE(NULLIF(fieldRoutes_dateAdded, '0000-00-00 00:00:00'), fieldRoutes_date) AS written
  FROM \`${PROJECT}.${DATASET}.FieldRoutesCancellationNote\`
  WHERE fieldRoutes_cancellationReason IS NOT NULL AND fieldRoutes_cancellationReason != ''
),
cxlLabel AS (
  SELECT rid, reason FROM (
    SELECT rid, reason, ROW_NUMBER() OVER (PARTITION BY rid ORDER BY written DESC) rn FROM cxlNotes WHERE rid IS NOT NULL
  ) WHERE rn = 1
),
cxl AS (
  SELECT n.sid, COALESCE(l.reason, n.reason) AS reason FROM (
    SELECT sid, rid, reason, ROW_NUMBER() OVER (PARTITION BY sid ORDER BY written DESC, d DESC) rn FROM cxlNotes
  ) n LEFT JOIN cxlLabel l ON l.rid = n.rid WHERE n.rn = 1
),
-- Fallback reason (per Isaac, Oct 14): ~2,900 cancelled subs have no row in
-- FieldRoutesCancellationNote, but FieldRoutes still logged the cancel as a
-- "Subscription Cancel" note (type 16) carrying the reason — e.g. customer
-- 24543's Mosquito 12, cancelled 11/1/2021 as Combined Subscriptions, showed
-- blank. Candidates: notes naming the sub ("[Canceled: … Subscription - <id>]")
-- and notes on the same customer that name no other subscription; the one
-- written nearest the cancel date wins (see cxf).
n16 AS (
  SELECT fieldRoutes_customerID AS cid, TRIM(fieldRoutes_cancellationReason) AS reason,
    NULLIF(fieldRoutes_cancellationReasonID, '') AS rid, fieldRoutes_notes AS txt,
    SAFE.PARSE_DATETIME('%Y-%m-%d %H:%M:%S', fieldRoutes_dateAdded) AS written,
    -- the note's own date = the cancel it describes (a 2025 re-tag of a 2023 cancel is dated 2023)
    COALESCE(SAFE.PARSE_DATETIME('%Y-%m-%d %H:%M:%S', fieldRoutes_date), SAFE.PARSE_DATETIME('%Y-%m-%d %H:%M:%S', fieldRoutes_dateAdded)) AS dated
  FROM \`${PROJECT}.${DATASET}.FieldRoutesNote\`
  WHERE fieldRoutes_typeID = '16' AND fieldRoutes_cancellationReason IS NOT NULL AND TRIM(fieldRoutes_cancellationReason) != ''
),
cxfCand AS (
  SELECT s.id AS sid, COALESCE(l.reason, n.reason) AS reason, n.written, n.dated,
    REGEXP_CONTAINS(COALESCE(n.txt, ''), CONCAT(r'Subscription - ', s.fieldRoutes_subscriptionID, r'\]')) AS by_text,
    REGEXP_CONTAINS(COALESCE(n.txt, ''), r'Subscription - \d+\]') AS names_a_sub
  FROM sub s
  JOIN n16 n ON n.cid = s.fieldRoutes_customerID
  LEFT JOIN cxlLabel l ON l.rid = n.rid
  WHERE s.fieldRoutes_dateCancelled IS NOT NULL AND s.fieldRoutes_dateCancelled != '' AND s.fieldRoutes_dateCancelled NOT LIKE '0000%'
),
cxf AS (
  -- The reason in force (per Isaac, Oct 14): a note DATED at the cancel (-1 /
  -- +3 days) wins, and among those the most recently WRITTEN — FieldRoutes'
  -- 2025 re-tag of old cancels (e.g. #52154 "Paid Cancellation Fee" → Finances)
  -- adds new notes dated back to the cancel, same rule as the primary table.
  -- #40448 / #36303: a first-visit "Initial Appointment Canceled" note named
  -- the sub but was dated months earlier, so it loses to the real cancel. A
  -- note naming the sub but dated outside the window is used only when nothing
  -- is in it.
  SELECT sid, reason FROM (
    SELECT c.sid, c.reason,
      ROW_NUMBER() OVER (PARTITION BY c.sid ORDER BY
        IF(c.dated BETWEEN DATETIME_SUB(cx, INTERVAL 1 DAY) AND DATETIME_ADD(cx, INTERVAL 3 DAY), 0, 1),
        c.written DESC, IF(c.by_text, 0, 1)) AS rn
    FROM (SELECT c.*, SAFE.PARSE_DATETIME('%Y-%m-%d %H:%M:%S', LEFT(s.fieldRoutes_dateCancelled,19)) AS cx
          FROM cxfCand c JOIN sub s ON s.id = c.sid) c
    WHERE c.by_text OR (NOT c.names_a_sub AND c.dated BETWEEN DATETIME_SUB(cx, INTERVAL 1 DAY) AND DATETIME_ADD(cx, INTERVAL 3 DAY))
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
),
apptSched AS (
  -- SCHEDULED date of each appointment (any status but cancelled) — the
  -- Sales queues' "Service date" before the initial visit has happened.
  SELECT fieldRoutes_appointmentID AS aid, MIN(NULLIF(LEFT(fieldRoutes_date,10),'0000-00-00')) AS appt_date
  FROM \`${PROJECT}.${DATASET}.FieldRoutesAppointment\`
  WHERE fieldRoutes_status NOT IN ('-1', '-2')   -- cancelled / re-scheduled (per Isaac, Oct 15 — #183686)
    AND fieldRoutes_date IS NOT NULL AND fieldRoutes_date NOT LIKE '0000%'
  GROUP BY 1
),
apptAfter AS (
  -- Initial = the first appointment on the plan BOOKED AFTER the sale (per Isaac, Oct 15):
  -- any appointment (not cancelled) added at/after the subscription's dateAdded, earliest date wins.
  -- Covers plans whose initialAppointmentID was never set or was swapped.
  SELECT a.fieldRoutes_subscriptionID AS sid, MIN(NULLIF(LEFT(a.fieldRoutes_date,10),'0000-00-00')) AS appt_date
  FROM \`${PROJECT}.${DATASET}.FieldRoutesAppointment\` a
  JOIN sub ON sub.fieldRoutes_subscriptionID = a.fieldRoutes_subscriptionID
  WHERE a.fieldRoutes_status NOT IN ('-1', '-2') AND a.fieldRoutes_date IS NOT NULL AND a.fieldRoutes_date NOT LIKE '0000%'
    AND LEFT(a.fieldRoutes_dateAdded,19) >= LEFT(sub.fieldRoutes_dateAdded,19)
  GROUP BY 1
),
nextAppt AS (
  -- Next service actually on the schedule (Pending, today or later) per plan — a renewal's
  -- commissionable date is this or the next invoice, whichever comes first (per Isaac, Oct 15).
  SELECT fieldRoutes_subscriptionID AS sid, MIN(LEFT(fieldRoutes_date,10)) AS appt_date
  FROM \`${PROJECT}.${DATASET}.FieldRoutesAppointment\`
  WHERE fieldRoutes_status = '0' AND fieldRoutes_date IS NOT NULL AND fieldRoutes_date NOT LIKE '0000%'
    AND LEFT(fieldRoutes_date,10) >= FORMAT_DATE('%Y-%m-%d', CURRENT_DATE('America/Denver'))
  GROUP BY 1
),
pay AS (
  -- Successful payments (status 1, money actually applied) per customer —
  -- the commissionable-date rule (per Isaac) needs "first payment received
  -- on/after the sale". One row per customer per day.
  -- amt (per Isaac, Oct 15): the dollars applied that day, for Marketing's collected revenue.
  SELECT fieldRoutes_customerID AS cid, LEFT(fieldRoutes_date,10) AS paid_on, ROUND(SUM(SAFE_CAST(fieldRoutes_appliedAmount AS FLOAT64)), 2) AS amt
  FROM \`${PROJECT}.${DATASET}.FieldRoutesPayment\`
  WHERE fieldRoutes_status = '1' AND SAFE_CAST(fieldRoutes_appliedAmount AS FLOAT64) > 0
    AND fieldRoutes_date >= FORMAT_DATE('%Y-%m-%d', DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR))
  GROUP BY 1, 2
),
sig AS (
  -- Signed agreement (per Isaac): FieldRoutesContract rows are the e-sign
  -- documents. documentState COMPLETED = signed (dateSigned real); WIP = sent
  -- but not signed yet. Only ~1/3 of contracts carry a subscriptionID, so we
  -- key by subscription first and fall back to the customer (a COMPLETED
  -- contract signed on/after the sub was added).
  SELECT fieldRoutes_subscriptionID AS sid, fieldRoutes_customerID AS cid,
         fieldRoutes_documentState AS doc_state,
         SAFE.PARSE_DATE('%Y-%m-%d', NULLIF(LEFT(fieldRoutes_dateSigned,10),'0000-00-00')) AS signed_on
  FROM \`${PROJECT}.${DATASET}.FieldRoutesContract\`
  WHERE fieldRoutes_documentState IN ('COMPLETED','WIP')
),
sigsub AS (
  SELECT sid,
         MAX(IF(doc_state='COMPLETED', signed_on, NULL)) AS signed_on,
         COUNTIF(doc_state='WIP') AS wip
  FROM sig WHERE sid IS NOT NULL AND sid NOT IN ('','0') GROUP BY 1
),
sigcust AS (
  SELECT cid,
         MAX(IF(doc_state='COMPLETED', signed_on, NULL)) AS signed_on,
         COUNTIF(doc_state='WIP') AS wip
  FROM sig WHERE cid IS NOT NULL AND cid != '' GROUP BY 1
)
SELECT
  s.fieldRoutes_customerID AS customer_id,
  s.fieldRoutes_subscriptionID AS subscription_id,
  cust.lname AS last_name,
  cust.fname AS first_name,
  NULLIF(LEFT(s.fieldRoutes_dateAdded,10),'0000-00-00') AS sold_date,
  CASE WHEN s.fieldRoutes_dateAdded IS NULL OR s.fieldRoutes_dateAdded LIKE '0000%' THEN NULL ELSE LEFT(s.fieldRoutes_dateAdded,19) END AS sold_at,
  cust.apay AS customer_auto_pay,
  cust.pif AS customer_paid_in_full,
  cust.commercial AS customer_commercial,
  flags.flags AS customer_flags,
  -- No FieldRoutesCustomer row for this sub's customer id = the account was
  -- deleted in the CRM (the mirror never removes rows) — or, rarely, the
  -- customer feed is behind. The app auto-excludes these (Settings →
  -- Configurations → Deleted CRM accounts) and lists them for review.
  -- A sub added in the last 7 days with no customer row yet is the customer
  -- feed running behind the subscription feed (seen on same-day sales), not
  -- a deleted account — leave it unflagged until it has had time to land.
  IF(cust.cid IS NULL
     AND SAFE.PARSE_DATE('%Y-%m-%d', NULLIF(LEFT(s.fieldRoutes_dateAdded,10),'0000-00-00')) < DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY), 1, NULL) AS customer_missing,
  SAFE_CAST(s.fieldRoutes_annualRecurringValue AS FLOAT64) AS annual_recurring_value,
  s.fieldRoutes_soldBy AS sold_by_id,
  NULLIF(CONCAT(COALESCE(emp.lname,''), ', ', COALESCE(emp.fname,'')), ', ') AS sold_by,
  CASE emp.type WHEN '0' THEN 'Office Staff' WHEN '1' THEN 'Technician' WHEN '2' THEN 'Sales Rep' END AS sold_by_type,
  CASE WHEN s.fieldRoutes_completedAppointmentIDs IS NULL OR s.fieldRoutes_completedAppointmentIDs=''
       THEN 0 ELSE ARRAY_LENGTH(SPLIT(s.fieldRoutes_completedAppointmentIDs, ',')) END AS subscription_completed_services,
  cust.county AS county,
  s.fieldRoutes_serviceType AS subscription,
  COALESCE(cxl.reason, cxf.reason) AS subscription_cancellation_reason,
  CASE WHEN s.fieldRoutes_dateCancelled IS NULL OR s.fieldRoutes_dateCancelled LIKE '0000%'
       THEN NULL ELSE LEFT(s.fieldRoutes_dateCancelled,10) END AS subscription_date_canceled,
  -- Full cancel timestamp (company clock, like sold_at) — Retention's churn-by-hour/day view.
  CASE WHEN s.fieldRoutes_dateCancelled IS NULL OR s.fieldRoutes_dateCancelled LIKE '0000%'
       THEN NULL ELSE LEFT(s.fieldRoutes_dateCancelled,19) END AS canceled_at,
  s.fieldRoutes_activeText AS subscription_status,
  s.fieldRoutes_initialStatusText AS initial_status,
  CASE WHEN s.fieldRoutes_initialStatusText='Completed'
       THEN NULLIF(LEFT(s.fieldRoutes_dateAdded,10),'0000-00-00') END AS initial_service,
  appt.serviced_date AS initial_serviced_date,
  COALESCE(apptAfter.appt_date, apptSched.appt_date) AS initial_appt_date,
  -- Renewals (per Isaac, Oct 15): next scheduled service, next invoice date (plans billed on a
  -- schedule — per-service billing has none), and the last completed service on the plan.
  nextAppt.appt_date AS next_appt_date,
  CASE WHEN s.fieldRoutes_billingFrequency NOT IN ('-1', '0') AND LEFT(s.fieldRoutes_nextBillingDate,4) >= '2000'   -- 1969-01-01 = none
       THEN NULLIF(NULLIF(LEFT(s.fieldRoutes_nextBillingDate,10),''),'0000-00-00') END AS next_billing_date,
  NULLIF(NULLIF(LEFT(s.fieldRoutes_lastCompleted,10),''),'0000-00-00') AS last_completed_date,
  s.fieldRoutes_billingFrequency AS billing_frequency,
  -- First successful payment on/after the sale date (commissionable-date rule).
  (SELECT MIN(p.paid_on) FROM pay p WHERE p.cid = s.fieldRoutes_customerID AND p.paid_on >= LEFT(s.fieldRoutes_dateAdded,10)) AS first_paid_date,
  -- Collected revenue (per Isaac, Oct 15 — Marketing Pulse ROAS on cash): every successful payment applied to the
  -- CUSTOMER on/after this plan was sold (payments are customer-level in FieldRoutes, so a customer with two plans
  -- shows the same dollars on both — the app counts it once per customer). Last 2 years of payments.
  (SELECT ROUND(SUM(p.amt), 2) FROM pay p WHERE p.cid = s.fieldRoutes_customerID AND p.paid_on >= LEFT(s.fieldRoutes_dateAdded,10)) AS collected_since_sale,
  s.fieldRoutes_source AS subscription_source,
  CAST(NULL AS STRING) AS country,
  cust.state AS state,
  cust.city AS city,   -- per Isaac, Oct 9: spend reports that only give a city (DoLead) map to the branch serving it
  cust.zip AS zip_code,
  SAFE_CAST(cust.dpd AS INT64) AS days_past_due,
  SAFE_CAST(cust.resp_balance AS FLOAT64) AS responsible_balance,
  -- Branch = the CUSTOMER's office (per Isaac, Oct 14 — #127400 lives in
  -- Atlanta, but its cancelled Pest 4 carried Salt Lake's office id). The plan's
  -- own office is only the fallback when the customer record has none. This
  -- also covers phantom NEGATIVE ids on a plan ("-6", a corrupted copy of the
  -- customer's office). Still-negative after that = truly phantom.
  CASE COALESCE(IF(SAFE_CAST(cust.office_id AS INT64) > 0, cust.office_id, NULL), s.fieldRoutes_officeID)
    ${buildOfficeCase()}
    ELSE CONCAT('Office ', COALESCE(IF(SAFE_CAST(cust.office_id AS INT64) > 0, cust.office_id, NULL), s.fieldRoutes_officeID)) END AS office_name,
  SAFE_CAST(s.fieldRoutes_agreementLength AS INT64) AS agreement_length,
  SAFE_CAST(s.fieldRoutes_contractValue AS FLOAT64) AS subscription_contract_value,
  SAFE_CAST(s.fieldRoutes_initialServiceTotal AS FLOAT64) AS initial_price,
  SAFE_CAST(s.fieldRoutes_recurringCharge AS FLOAT64) AS recurring_charge,
  s.fieldRoutes_frequency AS recurring_frequency,
  cust.phone AS phone,
  cust.email AS email,
  NULLIF(COALESCE(NULLIF(s.fieldRoutes_leadSource,''), cust.csource), '') AS lead_source,
  -- Signed agreement: date the e-sign doc was COMPLETED (sub-level first,
  -- else a customer-level doc signed on/after the day the sub was added).
  -- FieldRoutes' own "Signed Agreement = Yes" (per Isaac, Sep 23) is the
  -- agreement attached to the subscription (contractAdded) — 44k of 44.6k
  -- active subs carry it, only 26k have an e-sign document.
  -- Oct 13 (per Isaac — #183728 Benita Elcock showed signed with four UNSIGNED
  -- Pest 6 agreements): contractAdded is stamped when an agreement is
  -- GENERATED, signed or not — every 2026 sub has one. E-sign moved into
  -- FieldRoutes in 2026 (88% of 2026 subs have an e-sign doc vs ~5% before), so
  -- from 2026 on only a COMPLETED e-sign document counts; contractAdded still
  -- stands in for the older (pre-e-sign) agreements.
  CAST(COALESCE(sigsub.signed_on,
           IF(sigcust.signed_on >= DATE_SUB(SAFE.PARSE_DATE('%Y-%m-%d', NULLIF(LEFT(s.fieldRoutes_dateAdded,10),'0000-00-00')), INTERVAL 1 DAY),
              sigcust.signed_on, NULL),
           IF(LEFT(s.fieldRoutes_dateAdded,10) < '2026-01-01', SAFE.PARSE_DATE('%Y-%m-%d', NULLIF(LEFT(s.fieldRoutes_contractAdded,10),'0000-00-00')), NULL)) AS STRING) AS contract_signed_at,
  CASE
    WHEN sigsub.signed_on IS NOT NULL
      OR sigcust.signed_on >= DATE_SUB(SAFE.PARSE_DATE('%Y-%m-%d', NULLIF(LEFT(s.fieldRoutes_dateAdded,10),'0000-00-00')), INTERVAL 1 DAY)
      OR (LEFT(s.fieldRoutes_dateAdded,10) < '2026-01-01'
          AND SAFE.PARSE_DATE('%Y-%m-%d', NULLIF(LEFT(s.fieldRoutes_contractAdded,10),'0000-00-00')) IS NOT NULL) THEN 'signed'
    WHEN COALESCE(sigsub.wip,0) > 0 OR COALESCE(sigcust.wip,0) > 0 THEN 'sent'
    ELSE 'none' END AS contract_state
FROM sub s
LEFT JOIN cust  ON cust.cid  = s.fieldRoutes_customerID
LEFT JOIN emp   ON emp.eid   = s.fieldRoutes_soldBy
LEFT JOIN flags ON flags.cid = s.fieldRoutes_customerID
LEFT JOIN cxl   ON cxl.sid   = s.id
LEFT JOIN cxf   ON cxf.sid   = s.id
LEFT JOIN appt  ON appt.aid  = s.fieldRoutes_initialAppointmentID
LEFT JOIN apptSched ON apptSched.aid = s.fieldRoutes_initialAppointmentID
LEFT JOIN apptAfter ON apptAfter.sid = s.fieldRoutes_subscriptionID
LEFT JOIN nextAppt ON nextAppt.sid = s.fieldRoutes_subscriptionID
LEFT JOIN sigsub  ON sigsub.sid  = s.fieldRoutes_subscriptionID
LEFT JOIN sigcust ON sigcust.cid = s.fieldRoutes_customerID
WHERE s.fieldRoutes_customerID IS NOT NULL AND s.fieldRoutes_customerID != ''
  -- Phantom offices lingering in the CRM (negative office IDs, e.g. -1 / -7).
  -- These aren't real branches we sold from — exclude them from the snapshot
  -- entirely so they never touch revenue, subs, or any downstream metric.
  AND SAFE_CAST(COALESCE(IF(SAFE_CAST(cust.office_id AS INT64) > 0, cust.office_id, NULL), s.fieldRoutes_officeID) AS INT64) > 0
  -- Orphaned subscriptions: the rep created a card, then DELETED the customer
  -- (e.g. couldn't close it), but the subscription lingers in the warehouse.
  -- FieldRoutes doesn't propagate the delete, so these would show "pending"
  -- forever. If the customer no longer exists in the customer table, drop it —
  -- EXCEPT recent sales: subscriptions replicate live but CUSTOMERS batch
  -- separately, and (verified Jul 30 2026) RevHawk's customer feed can run
  -- MANY DAYS behind or skip customers entirely — Ethan Beaird's whole 7/28
  -- selling day (plus ~$46K company-wide, 7/18-7/29) vanished off every board
  -- because the old 2-day grace expired before the customer rows ever landed.
  -- Grace is now 14 DAYS: real sales survive the feed gap; anything older
  -- with no customer row is treated as a deleted account's ghost and drops.
  -- Deleted accounts inside the window are handled by the admin-maintained
  -- "Deleted CRM accounts" list (Settings → Configurations), and the kept
  -- no-customer rows are logged below so RevHawk can be handed a ticket.
  AND (cust.cid IS NOT NULL
       OR LEFT(s.fieldRoutes_dateAdded,10) >= FORMAT_DATE('%Y-%m-%d', DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY)))`;

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
    -- Inactive employees stay IN the mirror (per Isaac, Sep 22 2026 — RevHawk
    -- now carries them): former reps keep their names on Manage Teams and
    -- the boards, and the auto-revoke below can see who left. The \`active\`
    -- column says which is which; the Users list only offers active people.
    -- Drop FieldRoutes' internal/system accounts (FieldRoutes Admin, FR-System,
    -- Test users, integrations, etc.) so the roster is real people only. Also
    -- stops system accounts that reuse a real person's email from polluting them.
    AND NOT REGEXP_CONTAINS(LOWER(CONCAT(COALESCE(fieldRoutes_fname,''),' ',COALESCE(fieldRoutes_lname,''))),
        r'\\badmin\\b|\\bsystem\\b|fieldroutes|fr-system|\\btest\\b|\\breferral\\b|sellify|pest routes|ridd account|ridd sales|pro products|mosquito joe|clicki|pest ai|pest booker|applause')
),
-- Group key (fixed Sep 22 2026): a record LINKED to a base employee joins the
-- base's group even when it has no email of its own. Before, a linked record
-- with a blank email keyed on the base id while the base keyed on its email —
-- two groups, the same employee_id, and the upsert kept only one (Pere's
-- Myrtle Beach login #10596 vanished from the roster, so 517 of his sales
-- had no app owner).
base_email AS (SELECT eid AS beid, email_l AS bemail FROM src),
g AS (
  SELECT s.*, COALESCE(b.bemail, s.email_l, s.base_eid) AS gkey,
         SAFE_CAST(s.base_eid AS INT64) AS base_num, SAFE_CAST(s.eid AS INT64) AS id_num
  FROM src s LEFT JOIN base_email b ON b.beid = s.base_eid
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

// Add-ons (per Isaac, Sep 2026) = TICKET ITEMS added to a subscription's
// Initial / Recurring invoice from FieldRoutes' "Available Items" list, at
// fixed prices, optionally assigned to a rep. They arrive in the warehouse as
// the ticket's `items` JSON. Which item names count as add-ons is configured
// in the app (app_settings.autolog.upsell_services); the SQL pulls every
// ticket with items since the start date and JS matches item by item.
const TICKET_SQL = (start) => `
SELECT
  t.fieldRoutes_ticketID       AS ticket_id,
  t.fieldRoutes_customerID     AS customer_id,
  t.fieldRoutes_subscriptionID AS subscription_id,
  LEFT(t.fieldRoutes_dateCreated, 10) AS created,
  t.fieldRoutes_createdBy      AS created_by,
  t.fieldRoutes_officeID       AS office_id,
  SAFE_CAST(t.fieldRoutes_total AS FLOAT64) AS total,
  t.fieldRoutes_items          AS items,
  st.fieldRoutes_description   AS service,
  cust.fieldRoutes_fname       AS first_name,
  cust.fieldRoutes_lname       AS last_name,
  emp.fieldRoutes_type         AS created_by_type
FROM \`${PROJECT}.${DATASET}.FieldRoutesTicket\` t
LEFT JOIN \`${PROJECT}.${DATASET}.FieldRoutesServiceType\` st ON st.fieldRoutes_typeID = t.fieldRoutes_serviceID
LEFT JOIN \`${PROJECT}.${DATASET}.FieldRoutesCustomer\` cust ON cust.fieldRoutes_customerID = t.fieldRoutes_customerID
LEFT JOIN \`${PROJECT}.${DATASET}.FieldRoutesEmployee\` emp ON emp.fieldRoutes_employeeID = t.fieldRoutes_createdBy
WHERE (t.fieldRoutes_active = '1' OR LOWER(t.fieldRoutes_active) = 'true')
  AND LEFT(t.fieldRoutes_dateCreated, 10) >= '${start}'
  AND t.fieldRoutes_items IS NOT NULL AND t.fieldRoutes_items NOT IN ('', '[]', 'null')
  AND t.fieldRoutes_subscriptionID IS NOT NULL AND t.fieldRoutes_subscriptionID NOT IN ('', '0')`;

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
// `opts.compact` (the big subscription pull): every page is parsed into
// plain objects the moment it lands and the raw BigQuery page is dropped,
// so peak memory is the compact rows, not the whole verbose REST payload.
// Sep 18 2026: the worker died silently right after 'query-complete:paging'
// with no error — the raw {f:[{v}]} rows for ~105k subs × 60 columns were
// being held in full (hundreds of MB of tiny objects) and the function was
// OOM-killed before it could write a heartbeat.
// Supabase/PostgREST caps a select at 1,000 rows. Every multi-row sales read below goes through
// this so nothing past row 1,000 is silently skipped (per Isaac, Oct 15 — #183686's initial
// never got its date: 1,442 sales in the 60-day verify window, only the first 1,000 were read).
async function selectAll(make) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().order('id').range(from, from + 999);
    if (error) return { data: null, error };
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return { data: out, error: null };
}
async function runQuery(token, sql, opts = {}) {
  const compact = !!opts.compact;
  const squash = (page, schema) => {
    const objs = toObjects(schema, page);
    for (const o of objs) for (const k of Object.keys(o)) if (o[k] === null || o[k] === undefined || o[k] === '') delete o[k];
    return objs;
  };
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
  let schema = (j.schema && j.schema.fields) || [];
  let rows = j.rows || [];
  let pageToken = j.pageToken;

  // Job may not be complete on the first call; poll the same job — but not
  // forever: a job that sits PENDING (slot contention, a quota hold) used to
  // spin here until Netlify's 15-minute kill, leaving no error behind. Cap
  // the wait and fail loudly with the job id so the heartbeat says why.
  if (globalThis.__syncStage) await globalThis.__syncStage('query-submitted:' + jobId);
  const pollStart = Date.now();
  let polls = 0;
  while (!j.jobComplete) {
    if (Date.now() - pollStart > 8 * 60000) throw new Error('BigQuery job ' + jobId + ' still not complete after 8 min (' + polls + ' polls) — check the job in the GCP console / quotas');
    await new Promise((r) => setTimeout(r, 1000));
    polls++;
    if (polls % 30 === 0 && globalThis.__syncStage) await globalThis.__syncStage('query-waiting:' + polls + 's:' + jobId);
    res = await fetch(`${base}/queries/${jobId}?location=${location}&maxResults=20000`, { headers: auth });
    j = await res.json();
    if (!res.ok) throw new Error('BigQuery getResults failed: ' + JSON.stringify(j.error || j).slice(0, 400));
    rows = j.rows || rows;
    schema = (j.schema && j.schema.fields) || schema;
    pageToken = j.pageToken;
  }
  if (globalThis.__syncStage) await globalThis.__syncStage('query-complete:paging');

  let out = compact ? squash(rows, schema) : rows;
  rows = null; j = null;
  let pages = 1;
  while (pageToken) {
    res = await fetch(`${base}/queries/${jobId}?location=${location}&maxResults=20000&pageToken=${encodeURIComponent(pageToken)}`, { headers: auth });
    const pj = await res.json();
    if (!res.ok) throw new Error('BigQuery paging failed: ' + JSON.stringify(pj.error || pj).slice(0, 400));
    const page = pj.rows || [];
    if (compact) { for (const o of squash(page, schema)) out.push(o); }
    else out = out.concat(page);
    pageToken = pj.pageToken;
    pages++;
    if (compact && globalThis.__syncStage) await globalThis.__syncStage('query-paging:' + pages + ':' + out.length + 'rows:' + Math.round(process.memoryUsage().rss / 1048576) + 'MB');
  }
  return compact ? { schema, objects: out } : { schema, rows: out };
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

// Streamed gzip of a JSON array — never materialises the full JSON string.
function _gzipJsonArray(arr, chunkRows = 2000) {
  return new Promise((resolve, reject) => {
    const g = zlib.createGzip({ level: 6 });
    const out = [];
    g.on('data', (c) => out.push(c));
    g.on('error', reject);
    g.on('end', () => resolve(Buffer.concat(out)));
    let i = 0;
    const pump = () => {
      while (i < arr.length) {
        const part = arr.slice(i, i + chunkRows).map(o => JSON.stringify(o)).join(',');
        const piece = (i === 0 ? '[' : ',') + part;
        i += chunkRows;
        if (!g.write(piece)) { g.once('drain', pump); return; }
      }
      g.end(arr.length ? ']' : '[]');
    };
    pump();
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

  // ── Heartbeat: tiny JSON in storage so /api/sync-status can show the last
  // run's outcome (started / ok / the exact error) without Netlify logs. ──
  const _hb = async (obj) => {
    try {
      const c = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
      await c.storage.from('reporting').upload('indicators/sync-heartbeat.json',
        Buffer.from(JSON.stringify(Object.assign({ at: new Date().toISOString() }, obj))),
        { contentType: 'application/json', upsert: true });
    } catch (hbErr) { console.warn('[revhawk-sync] heartbeat write failed', hbErr && hbErr.message); }
  };
  const _mb = () => Math.round(process.memoryUsage().rss / 1048576) + 'MB';
  const _stage = (name) => { console.log('[revhawk-sync] stage:', name, _mb()); return _hb({ stage: name, rss: _mb() }); };
  await _stage('started');

  try {
    const started = Date.now();
    const token = await getAccessToken();
    await _stage('token-ok');
    await discoverOffices(token);   // new branches join OFFICE_NAMES before the big pull
    await _stage('offices-discovered');
    // Sep 17 2026: the worker sat at "started" for hours with no error — a
    // stage between here and "queried" is what tells the next person WHERE.
    globalThis.__syncStage = _stage;
    // MEMORY: BigQuery's raw REST rows (~90k × verbose {f:[{v:..}]} cells)
    // are 2-3× the size of the parsed objects and were pinned for the WHOLE
    // run — the function sat at ~800MB before the derive even started and
    // got OOM-killed mid-flight. Parse, then drop the raw response so GC
    // reclaims it before the heavy stages.
    // ── One-time schema probe (harmless, ~1s): does the mirror carry a
    // DELETION marker? FieldRoutes-deleted customers leave orphan rows the
    // app must exclude by hand today (Settings → Configurations → Deleted
    // CRM accounts). If a column like is_deleted / _fivetran_deleted /
    // active exists on Customer/Subscription, the sync can filter orphans
    // automatically and the manual list dies. Check the function logs for
    // "[schema-probe]" after a run, then remove or act on it.
    try {
      const probe = await runQuery(token,
        `SELECT table_name, column_name FROM \`${PROJECT}.${DATASET}\`.INFORMATION_SCHEMA.COLUMNS ` +
        `WHERE table_name IN ('FieldRoutesCustomer','FieldRoutesSubscription') ` +
        `AND (LOWER(column_name) LIKE '%delet%' OR LOWER(column_name) LIKE '%active%' OR LOWER(column_name) LIKE '%status%' OR LOWER(column_name) LIKE '%updated%' OR LOWER(column_name) LIKE '%_synced%' OR LOWER(column_name) LIKE '%batch%')`);
      const cols = (probe.rows || []).map(r => r.f.map(c => c.v).join('.'));
      console.log('[schema-probe] deletion-marker candidates:', JSON.stringify(cols));
      // Full table inventory — tells us what ELSE the mirror carries that the
      // app doesn't use yet (tickets / ticket line items / payments / etc.).
      const tbls = await runQuery(token,
        `SELECT table_name FROM \`${PROJECT}.${DATASET}\`.INFORMATION_SCHEMA.TABLES ORDER BY table_name`);
      console.log('[schema-probe] dataset tables:', JSON.stringify((tbls.rows || []).map(r => r.f[0].v)));
    } catch (e) { console.warn('[schema-probe] failed (non-fatal):', e && e.message); }

    // ── TEMP PROBE (Jul 30 2026) — trace the exact customers the CRM shows
    // but the mirror lost (Ethan Beaird's whole 7/28 day + friends). For each
    // ID: does the SUBSCRIPTION row exist in RevHawk at all, what office id
    // does it carry (phantom offices -1/-7 get filtered), and does a CUSTOMER
    // row exist? One cheap IN-list lookup per sync; check the function logs
    // for "[cust-probe]". Remove once the RevHawk feed gap is closed.
    try {
      const PROBE_IDS = ['170761', '170726', '170653', '170635', '170475', '170800', '170794', '170778', '168408', '169417'];
      const pr = await runQuery(token,
        `SELECT s.fieldRoutes_customerID AS cid, s.fieldRoutes_officeID AS office_id, ` +
        `LEFT(s.fieldRoutes_dateAdded,19) AS added, s.fieldRoutes_serviceType AS svc, ` +
        `CAST(c.cid IS NOT NULL AS STRING) AS has_cust ` +
        `FROM \`${PROJECT}.${DATASET}.FieldRoutesSubscription\` s ` +
        `LEFT JOIN (SELECT DISTINCT fieldRoutes_customerID AS cid FROM \`${PROJECT}.${DATASET}.FieldRoutesCustomer\`) c ` +
        `ON c.cid = s.fieldRoutes_customerID ` +
        `WHERE s.fieldRoutes_customerID IN ('` + PROBE_IDS.join("','") + `')`);
      const hits = toObjects(pr.schema, pr.rows);
      const found = new Set(hits.map(h => String(h.cid)));
      console.warn('[cust-probe] found ' + hits.length + '/' + PROBE_IDS.length + ' subscription row(s): ' + JSON.stringify(hits));
      const absent = PROBE_IDS.filter(id => !found.has(id));
      if (absent.length) console.warn('[cust-probe] ABSENT from FieldRoutesSubscription entirely: ' + absent.join(', '));
    } catch (pe) { console.warn('[cust-probe] failed (non-fatal):', pe && pe.message); }

    // Parsed page by page (compact) — see runQuery. Null/empty values are
    // already dropped: readers all use `r.field ||` / `== null`, so a
    // missing key behaves exactly like null and the payload is smaller.
    let _q = await runQuery(token, buildSQL(), { compact: true });
    const objects = _q.objects;
    _q = null;
    if (global.gc) { try { global.gc(); } catch (e) { /* not exposed */ } }
    await _stage('parsed:' + objects.length + 'rows');
    if (!objects.length) return { statusCode: 200, body: JSON.stringify({ ok: false, note: 'query returned 0 rows — nothing written' }) };
    // Data-as-of (provenance audit): the newest FieldRoutes update in the
    // mirror, so the app can say "synced 10:05 AM · CRM data as of 2:10 AM"
    // instead of implying the numbers are live. One column, one row.
    let _dataAsOf = null;
    try {
      const aq = await runQuery(token, `SELECT FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', MAX(SAFE_CAST(updatedAt AS TIMESTAMP))) AS m FROM \`${PROJECT}.${DATASET}.FieldRoutesSubscription\``);
      const row = (aq.objects || toObjects(aq.schema, aq.rows) || [])[0];
      _dataAsOf = row && row.m ? String(row.m) : null;
    } catch (e) { console.warn('[revhawk-sync] data-as-of probe skipped:', String((e && e.message) || e).slice(0, 200)); }
    // ── OFFICE-DROP MONITOR ────────────────────────────────────────────
    // Compares this run's per-office row counts against the PREVIOUS run
    // (stored beside the heartbeat). A branch losing >35% of its rows
    // between syncs = replication broke for that office (how Little Rock
    // went dark, Jul 2026) → Slack alert + loud log. Costs nothing: counts
    // come from rows already pulled.
    try {
      const counts = {};
      for (const o of objects) { const k = o.office_name || '?'; counts[k] = (counts[k] || 0) + 1; }
      const sb2 = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
      let prev = null;
      try {
        const dl = await sb2.storage.from('reporting').download('indicators/office-counts.json');
        if (dl && dl.data) prev = JSON.parse(await dl.data.text());
      } catch { /* first run */ }
      const drops = [];
      if (prev && prev.counts) {
        for (const [office, was] of Object.entries(prev.counts)) {
          const now2 = counts[office] || 0;
          if (was >= 50 && now2 < was * 0.65) drops.push(office + ': ' + was + ' → ' + now2 + ' rows');
        }
      }
      if (drops.length) {
        const msg = '🚨 RIDD sync: office row-count DROP — possible replication gap.\n' + drops.join('\n');
        console.error('[office-drop] ' + msg);
        const hook = process.env.SLACK_ADMIN_WEBHOOK;
        if (hook) { try { await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: msg }) }); } catch { /* alert best-effort */ } }
      }
      await sb2.storage.from('reporting').upload('indicators/office-counts.json',
        Buffer.from(JSON.stringify({ at: new Date().toISOString(), counts })),
        { contentType: 'application/json', upsert: true });
    } catch (omErr) { console.warn('[office-drop] monitor failed (non-fatal)', omErr && omErr.message); }

    // RevHawk customer-feed gap monitor: rows kept WITHOUT a customer record
    // (no name from the cust join) are real sales the warehouse hasn't
    // delivered customers for yet — or deletions inside the grace window.
    // Log count + samples every run so a growing number is caught early and
    // RevHawk can be handed the exact customer IDs.
    try {
      const _noCust = objects.filter(o => !o.last_name && !o.first_name && o.customer_id);
      if (_noCust.length) {
        console.warn('[revhawk-sync] ' + _noCust.length + ' subscription row(s) kept with NO customer record (feed gap) — sample ids: '
          + _noCust.slice(0, 15).map(o => o.customer_id + (o.office_name ? '/' + o.office_name : '')).join(', '));
      }
    } catch (mErr) { console.warn('[revhawk-sync] no-cust monitor failed', mErr); }
    // Gzip the snapshot in row chunks: JSON.stringify of the whole 105k-row
    // array plus its Buffer copy peaked ~250MB on top of a ~700MB heap and
    // tripped Netlify's 1GB limit (Sep 21 — the run died silently right
    // after the no-customer monitor, twice). Streaming keeps the peak flat.
    const gz = await _gzipJsonArray(objects);
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    await _stage('queried:' + objects.length + 'rows');
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

    await _stage('snapshot-uploaded');

    // ── Completed jobs per branch per month → Putis Shid cost-per-job ─────
    // Every FieldRoutes appointment with a real completion date, counted by
    // the month it was completed and the office it belongs to. Stored in the
    // same server cache the QuickBooks ledger lives in (qbo:jobs) so
    // /api/qbo-spend?full=1 ships it beside the P&L and the tab can divide
    // COGS / tech wages / auto & fuel by jobs. Non-fatal: a failure here
    // leaves the last good copy in place.
    try {
      const { kvStore } = require('../lib/kv-store.js');
      const jobsStore = kvStore('qbo');
      if (jobsStore) {
        const since = String(new Date().getFullYear() - 2) + '-01';
        const jq = `SELECT LEFT(fieldRoutes_dateCompleted,7) AS ym, fieldRoutes_officeID AS office_id, COUNT(DISTINCT fieldRoutes_appointmentID) AS n
          FROM \`${PROJECT}.${DATASET}.FieldRoutesAppointment\`
          WHERE fieldRoutes_dateCompleted IS NOT NULL AND fieldRoutes_dateCompleted != '' AND fieldRoutes_dateCompleted NOT LIKE '0000%'
            AND fieldRoutes_dateCompleted >= '${since}' AND fieldRoutes_statusText = 'Completed'
          GROUP BY 1, 2`;
        const jr = await runQuery(token, jq);
        const months = {};
        let total = 0;
        for (const o of toObjects(jr.schema, jr.rows)) {
          const ym = String(o.ym || ''); if (!/^\d{4}-\d{2}$/.test(ym)) continue;
          const id = String(o.office_id || '').trim();
          const name = OFFICE_NAMES[id] || (id ? 'Office ' + id : '?');
          const n = Number(o.n) || 0; if (!n) continue;
          (months[ym] = months[ym] || {})[name] = (months[ym][name] || 0) + n;
          total += n;
        }
        await jobsStore.set('jobs', { months, total, pulledAt: new Date().toISOString(), source: 'revhawk' });
        console.log('[revhawk-sync] completed jobs cached:', Object.keys(months).length, 'months,', total, 'jobs');
      }
    } catch (jErr) { console.warn('[revhawk-sync] completed-jobs pull failed (non-fatal):', jErr && jErr.message); }

    // ── Server-side Indicators derive → DERIVE WORKER ───────────────────
    // Moved to its own background invocation with a FRESH ~1GB: stacking the
    // derive's JSON/gzip spike on this run's 90k-row memory OOM-killed the
    // process (heartbeat frozen at 'snapshot-uploaded', Netlify auto-retried,
    // dataset stale for days — Jul 2026 outage). Fire-and-forget kick; the
    // worker writes its own heartbeat (indicators/derive-heartbeat.json)
    // surfaced as lastDerive in /api/sync-status.
    let indicatorsError = null;
    try {
      const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
      if (!base) throw new Error('no site URL to reach the derive worker');
      const _uploadedAt = (envRow && envRow.uploaded_at) || new Date().toISOString();
      const kick = await fetch(base + '/.netlify/functions/derive-worker-background', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sync-secret': process.env.REVHAWK_SYNC_SECRET || '' },
        body: JSON.stringify({ path, uploadedAt: _uploadedAt }),
      });
      console.log('[revhawk-sync] derive worker kick -> HTTP', kick.status);
      if (!kick.ok && kick.status !== 202) throw new Error('worker kick HTTP ' + kick.status);
      await _stage('derive-worker-kicked');
    } catch (ie) {
      indicatorsError = String((ie && ie.message) || ie);
      console.error('[revhawk-sync] derive worker kick failed:', indicatorsError);
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
      // One row per employee_id — a duplicate inside a single upsert batch
      // makes Postgres refuse the whole statement ("ON CONFLICT DO UPDATE
      // command cannot affect row a second time"), which silently skipped
      // the roster AND everything after it (auto-log) on Sep 16.
      const _seenEmp = new Set();
      for (let i = roster.length - 1; i >= 0; i--) { const id = roster[i].employee_id; if (_seenEmp.has(id)) roster.splice(i, 1); else _seenEmp.add(id); }
      try {
        for (let i = 0; i < roster.length; i += 500) {
          const { error } = await supabase.from('fieldroutes_employees')
            .upsert(roster.slice(i, i + 500), { onConflict: 'employee_id' });
          if (error) throw new Error(error.message);
        }
      } catch (ue) { rosterError = String((ue && ue.message) || ue); console.error('[revhawk-sync] roster upsert failed (continuing with auto-log):', rosterError); }
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
        // Active ids too — so a CRM reactivation (re-hire) auto-RESTORES.
        const activeIds = new Set();
        roster.forEach(e => {
          if (!e.active) return;
          String(e.employee_ids || e.employee_id || '').split(',').forEach(id => { const t = id.trim(); if (t) activeIds.add(t); });
        });
        if (inactiveIds.size || activeIds.size) {
          const { data: profs, error: pErr } = await supabase.from('profiles')
            .select('id, role, previous_role, full_name, fieldroutes_employee_id')
            .or('role.like.rep%,role.eq.disabled');
          if (pErr) throw new Error(pErr.message);
          const toDisable = (profs || []).filter(p => p.role !== 'disabled'
            && p.fieldroutes_employee_id && inactiveIds.has(String(p.fieldroutes_employee_id))
            && !activeIds.has(String(p.fieldroutes_employee_id)));
          for (const p of toDisable) {
            // Remember the role we took away so reactivation restores it.
            // (previous_role/access_revoked_at may not exist pre-migration —
            // fall back to the bare update rather than skip the revoke.)
            let { error: uErr } = await supabase.from('profiles')
              .update({ role: 'disabled', previous_role: p.role, access_revoked_at: new Date().toISOString() }).eq('id', p.id);
            if (uErr) ({ error: uErr } = await supabase.from('profiles').update({ role: 'disabled' }).eq('id', p.id));
            if (uErr) console.warn('[revhawk-sync] revoke failed for', p.full_name, uErr.message);
            else console.log('[revhawk-sync] access revoked (CRM-inactive):', p.full_name);
          }
          // Auto-restore: disabled by us (previous_role set) + active again in CRM.
          const toRestore = (profs || []).filter(p => p.role === 'disabled' && p.previous_role
            && p.fieldroutes_employee_id && activeIds.has(String(p.fieldroutes_employee_id)));
          for (const p of toRestore) {
            const { error: rErr } = await supabase.from('profiles')
              .update({ role: p.previous_role, previous_role: null, access_revoked_at: null }).eq('id', p.id);
            if (rErr) console.warn('[revhawk-sync] restore failed for', p.full_name, rErr.message);
            else console.log('[revhawk-sync] access RESTORED (CRM re-activated):', p.full_name, '\u2192', p.previous_role);
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
        // AUTO-ADD DISABLED (Jul 2026 reversal): reps manually log every sale
        // again — the manual log is the commission record of the ORIGINAL
        // contract, and CRM subscriptions mutate later (technician upsells)
        // which would overpay commissions. The pipeline stays wired: set
        // INSIDE_AUTOADD_START (YYYY-MM-DD) in Netlify env to re-enable.
        // Sep 2026 (per Isaac): back ON, for EVERY rep type, driven by
        // app_settings.autolog (Settings → Configurations → Auto-log). The
        // revenue is frozen at first sight — later CRM mutations only touch
        // the crm_* lifecycle stamps, never revenue_amount — which answers
        // the Jul 2026 overpay concern.
        const { data: alRow } = await supabase.from('app_settings').select('value').eq('key', 'autolog').maybeSingle();
        const AL = Object.assign({ enabled: false, start: '2026-01-01', types: ['Office Staff', 'Sales Rep', 'Technician'], auto_approve: true, lock_days: 90, lock_min_services: 2, require_appt: true, require_billing: true, require_signed: true }, (alRow && alRow.value) || {});
        // ELIGIBILITY (per Isaac, Sep 2026): a sale only lands in the Sales
        // tabs once it could ever earn a payout — initial appointment on the
        // books (scheduled or done), billing on file (autopay), and a signed
        // agreement. Anything short of that is not logged yet; the next sync
        // picks it up the moment it qualifies (dedupe is by subscription id).
        const _hasAppt = (r) => ['pending', 'completed'].includes(String(r.initial_status || '').trim().toLowerCase());
        const _hasBilling = (r) => { const a = String(r.customer_auto_pay || '').trim().toLowerCase(); return !!a && !['no', '0', 'false', 'none', 'null'].includes(a); };
        const _isSigned = (r) => String(r.contract_state || '') === 'signed';
        // Charge-upfront tier (per Isaac, Sep 17 2026): the numerator is the
        // FieldRoutes customer flag named in Configurations → Auto-log
        // (default "Passed Audit"), not a hand-ticked checkbox — it covers
        // charged-upfront AND the other things the office audits for.
        const UPFRONT_FLAG = String(AL.upfront_flag == null ? 'Passed Audit' : AL.upfront_flag).trim().toLowerCase();
        const _hasFlag = (r) => !!UPFRONT_FLAG && String(r.customer_flags || '').split(',').some(f => f.trim().toLowerCase() === UPFRONT_FLAG);
        // Office audit state from the CRM flags: 'passed' / 'failed' / null.
        // A FAILED audit holds auto-approval for manual review; when the
        // office fixes it and re-flags Passed, the next sync resumes the flow.
        const FAIL_FLAG = String(AL.audit_fail_flag == null ? 'Failed Audit' : AL.audit_fail_flag).trim().toLowerCase();
        const _auditOf = (r) => { const fl = String(r.customer_flags || '').split(',').map(f => f.trim().toLowerCase()); return fl.includes(UPFRONT_FLAG) ? 'passed' : (FAIL_FLAG && fl.includes(FAIL_FLAG)) ? 'failed' : null; };
        const _eligible = (r) => (!AL.require_appt || _hasAppt(r)) && (!AL.require_billing || _hasBilling(r)) && (!AL.require_signed || _isSigned(r));
        const START = AL.enabled ? String(AL.start || '2026-01-01').slice(0, 10) : (process.env.INSIDE_AUTOADD_START || '');
        if (!START) throw Object.assign(new Error('auto-add disabled (app_settings.autolog.enabled = false)'), { _skip: true });
        const AL_TYPES = new Set(Array.isArray(AL.types) && AL.types.length ? AL.types : ['Office Staff', 'Sales Rep', 'Technician']);
        const QUEUE_OF = { 'Office Staff': 'office', 'Sales Rep': 'd2d', 'Technician': 'tech' };
        const EXCLUDED_SVCS = await require('../lib/rules.js').loadNonSaleServices(supabase);   // FieldRoutes global + admin-Hidden service types (one source of truth)
        const masterOf = new Map();
        roster.forEach(e => String(e.employee_ids || e.employee_id || '').split(',').forEach(id => { const t = id.trim(); if (t) masterOf.set(t, String(e.employee_id)); }));
        const { data: profs2 } = await supabase.from('profiles').select('id, fieldroutes_employee_id, office_id').not('fieldroutes_employee_id', 'is', null);
        // ONE HUMAN, MANY CRM ACCOUNTS: a profile may be linked to a BRANCH
        // id rather than the group master, so index the profile under its
        // stored id, its master, and EVERY id in its roster group — sales
        // under any of a person's accounts attribute to the same profile
        // (the Tyler Trump / Pere LeSueur class of split identities).
        const profByEmp = new Map();
        (profs2 || []).forEach(p => {
          const pid = String(p.fieldroutes_employee_id || '').trim();
          if (!pid) return;
          profByEmp.set(pid, p);
          const master = masterOf.get(pid) || pid;
          if (!profByEmp.has(master)) profByEmp.set(master, p);
        });
        roster.forEach(e => {
          const ids = String(e.employee_ids || e.employee_id || '').split(',').map(x => x.trim()).filter(Boolean);
          const hit = ids.map(id => profByEmp.get(id)).find(Boolean);
          if (hit) ids.forEach(id => { if (!profByEmp.has(id)) profByEmp.set(id, hit); });
        });
        const pool = objects.filter(r =>
          AL_TYPES.has(String(r.sold_by_type || '').trim())
          && r.customer_id && r.sold_date && String(r.sold_date).slice(0, 10) >= START
          && !EXCLUDED_SVCS.has(String(r.subscription || '').trim()));
        // (Every subscription lands — per Isaac; eligibility is SHOWN on the
        // row and gates auto-approval, it no longer gates logging.)
        if (pool.length) {
          const [exQ, offQ, svcQ, srcQ, ctQ] = await Promise.all([
            supabase.from('sales').select('customer_number, revenue_amount, sold_date, crm_subscription, crm_subscription_id').gte('sold_date', START),
            supabase.from('offices').select('id, name'),
            supabase.from('service_types').select('id, name'),
            supabase.from('sources').select('id, name'),
            supabase.from('contract_types').select('id, name'),
          ]);
          const norm = (x) => String(x || '').trim().toLowerCase();
          const haveKey = new Set();
          const haveRevenue = [];
          const haveSub = new Set();
          (exQ.data || []).forEach(x => {
            if (x.crm_subscription_id) haveSub.add(String(x.crm_subscription_id));
            haveKey.add(norm(x.customer_number) + '|' + norm(x.crm_subscription) + '|' + String(x.sold_date).slice(0, 10));
            haveRevenue.push({ cust: norm(x.customer_number), rev: Number(x.revenue_amount) || 0, t: Date.parse(String(x.sold_date)) || 0 });
          });
          const officeByName = new Map((offQ.data || []).map(o => [norm(o.name), o.id]));
          const svcByName = new Map((svcQ.data || []).map(o => [norm(o.name), o.id]));
          const srcByName = new Map((srcQ.data || []).map(o => [norm(o.name), o.id]));
          const ctByName = new Map((ctQ.data || []).map(o => [norm(o.name), o.id]));
          let added = 0, skippedDup = 0, skippedNoRep = 0, svcCreated = 0;
          // Unlinked-seller rows need 20261015_sales_unlinked_sellers.sql (rep_id nullable + crm_seller_*).
          let _unlinkedOk = true;
          try { const { error: ue } = await supabase.from('sales').select('crm_seller_id').limit(1); if (ue) _unlinkedOk = false; } catch (e) { _unlinkedOk = false; }
          const batch = [];
          const flush = async () => {
            if (!batch.length) return;
            const rows = batch.splice(0, batch.length);
            let { error: insErr } = await supabase.from('sales').insert(rows);
            if (insErr && /crm_initial_status|crm_autopay|crm_contract_state|crm_contract_signed_at/i.test(insErr.message || '')) {
              console.warn('[revhawk-sync] eligibility/agreement columns missing — run migrations/20260916_sales_eligibility.sql (+ sales_crm_agreement.sql); inserting without them');
              rows.forEach(x => { delete x.crm_initial_status; delete x.crm_autopay; delete x.crm_contract_state; delete x.crm_contract_signed_at; });
              ({ error: insErr } = await supabase.from('sales').insert(rows));
            }
            if (insErr && /upfront_collected|crm_audit/i.test(insErr.message || '')) {
              // 20260917_audit_flag_and_pay_adjustments.sql / upfront_collected column not run yet — never let a missing
              // stamp column stop the sales from landing (this exact miss silenced the auto-log Sep 17–23).
              console.warn('[revhawk-sync] audit-flag columns missing — run migrations/20260923_sales_upfront_collected.sql; inserting without them');
              rows.forEach(x => { delete x.upfront_collected; delete x.crm_audit; });
              ({ error: insErr } = await supabase.from('sales').insert(rows));
            }
            if (insErr) console.warn('[revhawk-sync] auto-add batch failed: ' + insErr.message);
          };
          for (const r of pool) {
            if (added >= 4000) break;                                       // per-run cap; a backfill finishes over a few runs
            const soldIso = String(r.sold_date).slice(0, 10);
            const sub = String(r.subscription || '').trim() || 'Unknown';
            const cv = Number(r.subscription_contract_value) || 0;
            const subId = String(r.subscription_id || '').trim();
            if (subId && haveSub.has(subId)) { skippedDup++; continue; }
            const key = norm(r.customer_id) + '|' + norm(sub) + '|' + soldIso;
            if (haveKey.has(key)) { skippedDup++; continue; }
            const soldT = Date.parse(soldIso) || 0;
            if (haveRevenue.some(h => h.cust === norm(r.customer_id) && Math.abs(h.rev - cv) <= 1 && Math.abs(h.t - soldT) <= 7 * 86400000)) { skippedDup++; continue; }
            const soldById = String(r.sold_by_id || '').trim();
            const prof = profByEmp.get(soldById) || profByEmp.get(masterOf.get(soldById) || '') || null;
            // No app account yet → logged anyway under the FieldRoutes seller (per Isaac, Oct 15); the live pull
            // hands it to the rep once their account is linked. Off with autolog.log_unlinked = false.
            if (!prof) { skippedNoRep++; if (!soldById || AL.log_unlinked === false || !_unlinkedOk) continue; }
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
            batch.push({
              rep_id: prof ? prof.id : null,
              ...(prof ? {} : { crm_seller_id: masterOf.get(soldById) || soldById, crm_seller_name: (String(r.sold_by || '').trim() || null) }),
              queue_type: QUEUE_OF[String(r.sold_by_type || '').trim()] || 'office',
              crm_subscription_id: subId || null,
              logged_by: null,                                              // origin marker: auto-added
              customer_name: [String(r.first_name || '').trim(), String(r.last_name || '').trim()].filter(Boolean).join(' ') || ('Customer ' + r.customer_id),
              customer_number: String(r.customer_id),
              office_id: officeByName.get(norm(r.office_name)) ?? (prof ? prof.office_id : null) ?? null,
              service_type_id: svcId,
              source_id: srcByName.get(norm(r.subscription_source)) ?? null,
              contract_type_id: ctByName.get(norm(months + ' Months')) ?? null,
              contract_months: months,
              initial_amount: initial,
              monthly_amount: monthly,
              num_services: null,
              pay_per_service: false,
              paid_in_full: String(r.customer_paid_in_full || '') === '1',   // the Paid In Full button on the customer card (per Isaac)
              is_commercial: String(r.customer_commercial || '') === '1',      // Commercial Account toggle on the customer card
              revenue_amount: cv,
              sold_date: soldIso,
              commission_date: null,
              notes: 'Auto-added from FieldRoutes sync',
              audit_status: 'pending',
              created_at: new Date().toISOString(),
              crm_status: 'verified', crm_contract_value: cv, crm_subscription: sub, crm_checked_at: new Date().toISOString(),
              crm_initial_status: String(r.initial_status || '').trim() || 'None',
              crm_autopay: _hasBilling(r),
              upfront_collected: _hasFlag(r),
              crm_audit: _auditOf(r),
              crm_contract_state: String(r.contract_state || 'none'),
              crm_contract_signed_at: r.contract_signed_at ? String(r.contract_signed_at).slice(0, 10) : null,
            });
            if (batch.length >= 500) await flush();
            haveKey.add(key); if (subId) haveSub.add(subId); haveRevenue.push({ cust: norm(r.customer_id), rev: cv, t: soldT });
            added++;
          }
          await flush();
          if (added || skippedNoRep || svcCreated) console.log('[revhawk-sync] auto-log: +' + added + ' subscription(s), ' + skippedDup + ' already logged, ' + skippedNoRep + ' seller(s) with no app profile' + (svcCreated ? ', ' + svcCreated + ' service type(s) created' : ''));
        }
      } catch (aaErr) {
        if (!(aaErr && aaErr._skip)) console.error('[revhawk-sync] inside-sales auto-add skipped:', String((aaErr && aaErr.message) || aaErr));
      }

      // ── 🧩 UPSELL AUTO-LOG (per Isaac, Sep 2026) ───────────────────────
      // Only when app_settings.autolog.upsells === 'auto'. One sale per
      // add-on ticket (sale_kind 'upsell'), revenue = ticket total, seller =
      // the employee who created the ticket, queue by that person's type.
      // Deduped on crm_ticket_id, so reruns are idempotent.
      try {
        const { data: alRow3 } = await supabase.from('app_settings').select('value').eq('key', 'autolog').maybeSingle();
        const AL3 = Object.assign({ enabled: false, start: '2026-01-01', upsells: 'manual', upsell_services: [] }, (alRow3 && alRow3.value) || {});
        if (AL3.enabled && AL3.upsells !== 'off') {   // always automatic (per Isaac, Sep 23)
          const START3 = String(AL3.start || '2026-01-01').slice(0, 10);
          // Ticket line → candidate → sales row lives in lib/upsell-record.js
          // (pure, fixture-tested by tools/upsell-test.js) so the upsell
          // build can't drift the shape silently.
          const { makeIsAddOn, upsellCandidates, upsellSaleRow } = require('../lib/upsell-record.js');
          const isAddOn = makeIsAddOn(AL3.upsell_services, AL3.addon_items, require('../lib/rules.js').notAddOnDefault);   // same fallback as the add-ons sync
          const tq = await runQuery(token, TICKET_SQL(START3));
          const tickets = [];
          for (const t of toObjects(tq.schema, tq.rows)) tickets.push(...upsellCandidates({ ...t, items: String(t.items || '[]') }, isAddOn));
          if (tickets.length) {
            const masterOf3 = new Map();
            roster.forEach(e => String(e.employee_ids || e.employee_id || '').split(',').forEach(id => { const t = id.trim(); if (t) masterOf3.set(t, String(e.employee_id)); }));
            const { data: profs4 } = await supabase.from('profiles').select('id, fieldroutes_employee_id, office_id').not('fieldroutes_employee_id', 'is', null);
            const profByEmp3 = new Map();
            (profs4 || []).forEach(p => { const pid = String(p.fieldroutes_employee_id || '').trim(); if (pid) { profByEmp3.set(pid, p); const m = masterOf3.get(pid) || pid; if (!profByEmp3.has(m)) profByEmp3.set(m, p); } });
            roster.forEach(e => { const ids = String(e.employee_ids || e.employee_id || '').split(',').map(x => x.trim()).filter(Boolean); const hit = ids.map(id => profByEmp3.get(id)).find(Boolean); if (hit) ids.forEach(id => { if (!profByEmp3.has(id)) profByEmp3.set(id, hit); }); });
            const [haveQ, svcQ3, offQ3] = await Promise.all([
              supabase.from('sales').select('crm_ticket_id').not('crm_ticket_id', 'is', null),
              supabase.from('service_types').select('id, name'),
              supabase.from('offices').select('id, name'),
            ]);
            const haveT = new Set((haveQ.data || []).map(r => String(r.crm_ticket_id)));
            const norm3 = (x) => String(x || '').trim().toLowerCase();
            const svcByName3 = new Map((svcQ3.data || []).map(o => [norm3(o.name), o.id]));
            const officeByName3 = new Map((offQ3.data || []).map(o => [norm3(o.name), o.id]));
            let added3 = 0, skipNoRep3 = 0; const batch3 = [];
            for (const t of tickets) {
              const tid = String(t.ticket_id || '').trim(); if (!tid || haveT.has(tid)) continue;
              const by = String(t.created_by || '').trim();
              const prof = profByEmp3.get(by) || profByEmp3.get(masterOf3.get(by) || '') || null;
              if (!prof) { skipNoRep3++; continue; }
              const svcName = String(t.service || '').trim() || 'Add-on';
              let svcId = svcByName3.get(norm3(svcName));
              if (!svcId) { const ins = await supabase.from('service_types').insert({ name: svcName }).select('id').maybeSingle(); if (ins.data && ins.data.id) { svcId = ins.data.id; svcByName3.set(norm3(svcName), svcId); } }
              batch3.push(upsellSaleRow(t, {
                repId: prof.id,
                officeId: officeByName3.get(norm3(OFFICE_NAMES[String(t.office_id)] || '')) ?? prof.office_id ?? null,
                serviceTypeId: svcId || null,
              }));
              haveT.add(tid); added3++;
            }
            for (let i = 0; i < batch3.length; i += 500) {
              const { error } = await supabase.from('sales').insert(batch3.slice(i, i + 500));
              if (error) { console.warn('[revhawk-sync] upsell auto-log batch failed: ' + error.message); break; }
            }
            console.log('[revhawk-sync] upsell auto-log: ' + tickets.length + ' add-on ticket(s) since ' + START3 + ' · +' + added3 + ' logged · ' + skipNoRep3 + ' creator(s) with no app account');
          }
        }
      } catch (upErr) {
        console.error('[revhawk-sync] upsell auto-log skipped:', String((upErr && upErr.message) || upErr));
      }

      // ── 👻 UNLOGGED SALES ("ghost" rows, per Isaac) ─────────────────────
      // A subscription the CRM says an inside-sales rep sold, with a SIGNED
      // e-sign agreement, that the rep never logged in the app. Instead of
      // auto-logging it (the Jul 2026 reversal stands — the manual log is the
      // commission record), it lands in public.unlogged_sales and shows on
      // that rep's Sales log as a ghost row with a Claim button. Claiming
      // opens the normal Log Sale form pre-filled; the sale then goes through
      // audit like any other. Keyed by subscription + customer + sold date so
      // reruns are idempotent; a ghost the rep later logs by hand flips to
      // 'logged' automatically. Requires unlogged_sales.sql (best-effort).
      try {
        // Per Isaac (Sep 17 2026): reps should never have to Claim — sales
        // match up by FieldRoutes sales-rep id through the auto-log pass
        // above. So when auto-log is ON, this pass only RESOLVES: every open
        // ghost that now has a sale (same customer + subscription, any date,
        // or the ±7-day / ±$1 revenue match) flips to 'logged', and no new
        // ghosts are created. The strip stays as a safety net only when
        // auto-log is switched off.
        const _alGh = await supabase.from('app_settings').select('value').eq('key', 'autolog').maybeSingle();
        const AUTOLOG_ON = !!(((_alGh.data && _alGh.data.value) || {}).enabled);
        if (AUTOLOG_ON) {
          const { data: openGh } = await supabase.from('unlogged_sales').select('id, customer_number, crm_subscription, revenue_amount, sold_date').eq('status', 'open');
          if (openGh && openGh.length) {
            const custs = [...new Set(openGh.map(g => String(g.customer_number || '').trim()).filter(Boolean))];
            const found = [];
            for (let i = 0; i < custs.length; i += 300) {
              const { data } = await supabase.from('sales').select('id, customer_number, crm_subscription, revenue_amount, sold_date').in('customer_number', custs.slice(i, i + 300));
              if (data) found.push(...data);
            }
            const normG = (x) => String(x || '').trim().toLowerCase();
            const stampG = new Date().toISOString();
            let resolved = 0;
            for (const g of openGh) {
              const cands = found.filter(x => normG(x.customer_number) === normG(g.customer_number));
              const hit = cands.find(x => normG(x.crm_subscription) === normG(g.crm_subscription))
                || cands.find(x => Math.abs((Number(x.revenue_amount) || 0) - (Number(g.revenue_amount) || 0)) <= 1 && Math.abs((Date.parse(String(x.sold_date)) || 0) - (Date.parse(String(g.sold_date)) || 0)) <= 7 * 86400000);
              if (!hit) continue;
              await supabase.from('unlogged_sales').update({ status: 'logged', sale_id: hit.id, resolved_at: stampG, last_seen_at: stampG }).eq('id', g.id);
              resolved++;
            }
            console.log('[revhawk-sync] unlogged sales: auto-log is ON — ' + resolved + ' of ' + openGh.length + ' open ghost(s) resolved as logged; no new ghosts created');
          }
          throw Object.assign(new Error('ghost creation skipped — auto-log is on'), { _skip: true });
        }
        const lookback = Number(process.env.INSIDE_GHOST_LOOKBACK_DAYS) || 45;
        const START = (process.env.INSIDE_GHOST_START || '').trim()
          || new Date(Date.now() - lookback * 86400000).toISOString().slice(0, 10);
        const EXCLUDED_SVCS = await require('../lib/rules.js').loadNonSaleServices(supabase);   // FieldRoutes global + admin-Hidden service types (one source of truth)
        const masterOf = new Map();
        roster.forEach(e => String(e.employee_ids || e.employee_id || '').split(',').forEach(id => { const t = id.trim(); if (t) masterOf.set(t, String(e.employee_id)); }));
        const { data: profs3 } = await supabase.from('profiles').select('id, fieldroutes_employee_id, role').not('fieldroutes_employee_id', 'is', null);
        const profByEmp = new Map();
        (profs3 || []).forEach(p => {
          const pid = String(p.fieldroutes_employee_id || '').trim();
          if (!pid) return;
          profByEmp.set(pid, p);
          const master = masterOf.get(pid) || pid;
          if (!profByEmp.has(master)) profByEmp.set(master, p);
        });
        roster.forEach(e => {
          const ids = String(e.employee_ids || e.employee_id || '').split(',').map(x => x.trim()).filter(Boolean);
          const hit = ids.map(id => profByEmp.get(id)).find(Boolean);
          if (hit) ids.forEach(id => { if (!profByEmp.has(id)) profByEmp.set(id, hit); });
        });
        const norm = (x) => String(x || '').trim().toLowerCase();
        // Only subscriptions the CRM attributes to an inside-sales seller,
        // with a COMPLETED e-sign document, inside the lookback window.
        const pool = objects.filter(r =>
          String(r.sold_by_type || '').trim() === 'Office Staff'
          && String(r.contract_state || '') === 'signed'
          && r.customer_id && r.sold_date && String(r.sold_date).slice(0, 10) >= START
          && !EXCLUDED_SVCS.has(String(r.subscription || '').trim()));
        if (pool.length) {
          const [exQ, ghQ] = await Promise.all([
            supabase.from('sales').select('id, customer_number, revenue_amount, sold_date, crm_subscription').gte('sold_date', START),
            supabase.from('unlogged_sales').select('id, customer_number, crm_subscription, sold_date, status, sale_id').gte('sold_date', START),
          ]);
          if (ghQ.error) throw new Error(ghQ.error.message);   // table missing → logged below, nothing else affected
          const haveKey = new Map();
          const haveRevenue = [];
          (exQ.data || []).forEach(x => {
            haveKey.set(norm(x.customer_number) + '|' + norm(x.crm_subscription) + '|' + String(x.sold_date).slice(0, 10), x.id);
            haveRevenue.push({ id: x.id, cust: norm(x.customer_number), rev: Number(x.revenue_amount) || 0, t: Date.parse(String(x.sold_date)) || 0 });
          });
          const ghostByKey = new Map((ghQ.data || []).map(g => [norm(g.customer_number) + '|' + norm(g.crm_subscription) + '|' + String(g.sold_date).slice(0, 10), g]));
          const stamp = new Date().toISOString();
          let created = 0, refreshed = 0, autoLogged = 0, skippedNoRep = 0;
          const seenKeys = new Set();
          for (const r of pool) {
            const soldIso = String(r.sold_date).slice(0, 10);
            const sub = String(r.subscription || '').trim() || 'Unknown';
            const cv = Number(r.subscription_contract_value) || 0;
            const key = norm(r.customer_id) + '|' + norm(sub) + '|' + soldIso;
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);
            const soldT = Date.parse(soldIso) || 0;
            // Already logged (exact key, or the ±7-day / ±$1 revenue match the
            // verifier uses)? Then it's not a ghost — and if a ghost row exists
            // for it, mark it logged so it leaves the rep's board.
            let loggedId = haveKey.get(key) || null;
            if (!loggedId) {
              const m = haveRevenue.find(h => h.cust === norm(r.customer_id) && Math.abs(h.rev - cv) <= 1 && Math.abs(h.t - soldT) <= 7 * 86400000);
              if (m) loggedId = m.id;
            }
            const existing = ghostByKey.get(key);
            if (loggedId) {
              if (existing && existing.status === 'open') {
                await supabase.from('unlogged_sales').update({ status: 'logged', sale_id: loggedId, resolved_at: stamp, last_seen_at: stamp }).eq('id', existing.id);
                autoLogged++;
              }
              continue;
            }
            const soldById = String(r.sold_by_id || '').trim();
            const prof = profByEmp.get(soldById) || profByEmp.get(masterOf.get(soldById) || '') || null;
            if (!prof || !/^rep/.test(String(prof.role || 'rep'))) { skippedNoRep++; continue; }
            const months = Number(r.agreement_length) || 12;
            const initial = Number(r.initial_price) || 0;
            const monthly = Math.max(0, Math.round(((cv - initial) / 11) * 100) / 100);
            const row = {
              rep_id: prof.id,
              customer_number: String(r.customer_id),
              customer_name: [String(r.first_name || '').trim(), String(r.last_name || '').trim()].filter(Boolean).join(' ') || ('Customer ' + r.customer_id),
              office_name: r.office_name || null,
              crm_subscription: sub,
              subscription_source: r.subscription_source || null,
              contract_months: months,
              initial_amount: initial,
              monthly_amount: monthly,
              revenue_amount: cv,
              sold_date: soldIso,
              contract_signed_at: r.contract_signed_at ? String(r.contract_signed_at).slice(0, 10) : null,
              last_seen_at: stamp,
            };
            if (existing) {
              // Keep the CRM picture fresh on open rows; never reopen a
              // claimed/dismissed one.
              if (existing.status === 'open') { await supabase.from('unlogged_sales').update(row).eq('id', existing.id); refreshed++; }
              continue;
            }
            const { error: gErr } = await supabase.from('unlogged_sales').insert(Object.assign({ status: 'open', first_seen_at: stamp }, row));
            if (gErr) { console.warn('[revhawk-sync] ghost insert failed for cust ' + r.customer_id + ': ' + gErr.message); continue; }
            created++;
          }
          if (created || autoLogged) console.log('[revhawk-sync] unlogged sales: +' + created + ' ghost(s), ' + refreshed + ' refreshed, ' + autoLogged + ' resolved as logged, ' + skippedNoRep + ' seller(s) without a rep account');
        }
      } catch (ghErr) {
        if (!(ghErr && ghErr._skip)) console.warn('[revhawk-sync] unlogged-sales pass skipped (run unlogged_sales.sql?):', String((ghErr && ghErr.message) || ghErr).slice(0, 200));
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
    // ── OFFICES MIRROR (best-effort) ─────────────────────────────────
    // The app's `offices` table feeds the Sales Log office dropdown (and
    // office pickers everywhere) but was hand-maintained — Joplin opened
    // and never appeared. Every office name present in THIS run's data
    // auto-inserts when missing, so new/bought branches just show up.
    await _stage('archive-done');
    let officeCount = 0, officeError = null;
    try {
      const seen = new Set();
      for (const r of objects) {
        const nm = String(r.office_name || '').split(',')[0].trim();
        if (nm && !/^Office \d+$/i.test(nm)) seen.add(nm);
      }
      Object.values(OFFICE_NAMES).forEach(nm => seen.add(String(nm).trim()));
      if (seen.size) {
        const { data: appOffices, error: offSelErr } = await supabase.from('offices').select('id, name');
        if (offSelErr) throw new Error(offSelErr.message);
        const have = new Set((appOffices || []).map(o => String(o.name || '').trim().toLowerCase()));
        for (const nm of seen) {
          if (have.has(nm.toLowerCase())) continue;
          const { error } = await supabase.from('offices').insert({ name: nm });
          if (error) throw new Error('insert office "' + nm + '": ' + error.message);
          officeCount++;
        }
        if (officeCount) console.log('[revhawk-sync] offices mirror: +' + officeCount + ' new office(s)');
      }
    } catch (oe) {
      officeError = String((oe && oe.message) || oe);
      console.error('[revhawk-sync] offices mirror skipped:', officeError);
    }

    await _stage('offices-mirrored');
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
      let _paidCol = true;         // flips off if 20260917_sales_first_paid.sql hasn't been run
      const _alV = await supabase.from('app_settings').select('value').eq('key', 'autolog').maybeSingle();
      const _flagV = String(((_alV.data && _alV.data.value) || {}).upfront_flag ?? 'Passed Audit').trim().toLowerCase();
      const _hasFlagV = (r) => !!_flagV && !!r && String(r.customer_flags || '').split(',').some(f => f.trim().toLowerCase() === _flagV);
      const _failV = String(((_alV.data && _alV.data.value) || {}).audit_fail_flag ?? 'Failed Audit').trim().toLowerCase();
      const _auditV = (r) => { if (!r) return null; const fl = String(r.customer_flags || '').split(',').map(f => f.trim().toLowerCase()); return fl.includes(_flagV) ? 'passed' : (_failV && fl.includes(_failV)) ? 'failed' : null; };
      let { data: appSales, error: asErr } = await selectAll(() => supabase.from('sales')
        .select('id, customer_number, revenue_amount, sold_date, paid_in_full, is_commercial, crm_status, crm_contract_value, crm_serviced_at, crm_completed_services, crm_days_past_due, crm_balance, crm_contract_signed_at, crm_contract_state, crm_initial_status, crm_autopay, crm_subscription_id, upfront_collected, crm_audit, crm_first_paid_at, payroll_processed_at')
        .gte('sold_date', since));
      // Scheduled initial appointment (20260921_sales_initial_appt.sql) — read
      // separately so the select chain above stays as it is; off if the column
      // isn't there yet.
      let _apptCol = true; const _apptNow = new Map();
      // Add-on sales (sale_kind 'upsell') get their OWN initial from the add-ons sync — the plan's snapshot
      // dates (its original initial, serviced date) are not theirs (per Isaac, Oct 15 — #143268's Mole read ⚠ 4/7/26).
      const _upsellIds = new Set();
      try { const { data: uk } = await selectAll(() => supabase.from('sales').select('id').eq('sale_kind', 'upsell').gte('sold_date', since)); (uk || []).forEach(x => _upsellIds.add(x.id)); } catch (e) { /* none */ }
      try {
        const { data: ap, error: apErr } = await selectAll(() => supabase.from('sales').select('id, crm_initial_appt_at').gte('sold_date', since));
        if (apErr) { _apptCol = false; console.warn('[revhawk-sync] crm_initial_appt_at missing — run migrations/20260921_sales_initial_appt.sql for the Service date column'); }
        else (ap || []).forEach(x => _apptNow.set(x.id, x.crm_initial_appt_at ? String(x.crm_initial_appt_at).slice(0, 10) : null));
      } catch (e) { _apptCol = false; }
      let _agreementCols = true;   // flips off if sales_crm_agreement.sql hasn't been run
      let _eligCols = true;        // flips off if 20260916_sales_eligibility.sql hasn't been run
      if (asErr && /crm_first_paid_at/i.test(asErr.message || '')) {
        _paidCol = false;
        console.warn('[revhawk-sync] crm_first_paid_at missing — run migrations/20260917_sales_first_paid.sql to enable the commissionable-date rule');
        ({ data: appSales, error: asErr } = await selectAll(() => supabase.from('sales')
          .select('id, customer_number, revenue_amount, sold_date, paid_in_full, is_commercial, crm_status, crm_contract_value, crm_serviced_at, crm_completed_services, crm_days_past_due, crm_balance, crm_contract_signed_at, crm_contract_state, crm_initial_status, crm_autopay, crm_subscription_id, upfront_collected, crm_audit')
          .gte('sold_date', since)));
      }
      if (asErr && /crm_initial_status|crm_autopay/i.test(asErr.message || '')) {
        _eligCols = false;
        ({ data: appSales, error: asErr } = await selectAll(() => supabase.from('sales')
          .select('id, customer_number, revenue_amount, sold_date, paid_in_full, is_commercial, crm_status, crm_contract_value, crm_serviced_at, crm_completed_services, crm_days_past_due, crm_balance, crm_contract_signed_at, crm_contract_state')
          .gte('sold_date', since)));
      }
      if (asErr && /crm_contract_signed_at|crm_contract_state/i.test(asErr.message || '')) {
        _agreementCols = false;
        console.warn('[revhawk-sync] agreement columns missing - run sales_crm_agreement.sql to enable signed-agreement stamps');
        ({ data: appSales, error: asErr } = await selectAll(() => supabase.from('sales')
          .select('id, customer_number, revenue_amount, sold_date, paid_in_full, is_commercial, crm_status, crm_contract_value, crm_serviced_at, crm_completed_services, crm_days_past_due, crm_balance')
          .gte('sold_date', since)));
      }
      if (asErr && /column|schema cache/i.test(asErr.message || '')) {
        _lifecycleCols = false;
        console.warn('[revhawk-sync] lifecycle columns missing - run sales_crm_lifecycle.sql to enable serviced/paid stamps');
        ({ data: appSales, error: asErr } = await selectAll(() => supabase.from('sales')
          .select('id, customer_number, revenue_amount, sold_date, paid_in_full, is_commercial, crm_status, crm_contract_value')
          .gte('sold_date', since)));
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
          const lc = { serviced_at: null, first_paid_at: null, completed: 0, dpd: null, balance: null, pif: false, signed_at: null, contract_state: null, appt_at: null };
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
            // A sale that knows its own subscription verifies against THAT plan (per Isaac, Oct 15 — #183686
            // has a Pest 4 and a Sentricon sold the same morning; both rows had been matched to the Pest 4).
            const own = s.crm_subscription_id ? subs.find(r => String(r.subscription_id || '') === String(s.crm_subscription_id)) : null;
            if (own) { best = own; bestDiff = Math.abs((Number(own.subscription_contract_value) || 0) - rev); }
            // Sold date follows FieldRoutes (per Isaac, Oct 15 — #22281 was keyed 11/3, fixed in the CRM to 10/15):
            // a corrected date on the sale's own plan flows to the row, until upfront payroll has paid it.
            const _frDay = own && own.sold_date ? String(own.sold_date).slice(0, 10) : '';
            if (_frDay && /^\d{4}-\d{2}-\d{2}$/.test(_frDay) && _frDay !== String(s.sold_date || '').slice(0, 10) && !s.payroll_processed_at) lc.soldFix = _frDay;
            cv = Number(best.subscription_contract_value) || 0;
            subName = best.subscription || null;
            // EXACT-value discipline (never over/under-pay): to-the-penny
            // match = verified; within $1 = near_match (amber — auditor
            // eyeballs the cents); beyond that = revenue_mismatch.
            status = bestDiff === 0 ? 'verified' : bestDiff <= 1 ? 'near_match' : 'revenue_mismatch';
            // Lifecycle from the warehouse: serviced yet? paid / current?
            lc.serviced_at = best.initial_serviced_date ? String(best.initial_serviced_date).slice(0, 10) : null;
            // Renewal: serviced = a service completed on the plan on/after the save (per Isaac, Oct 15).
            if (/renew/i.test(String(best.subscription_source || '') + ' ' + String(best.lead_source || ''))) {
              const _lcd = best.last_completed_date ? String(best.last_completed_date).slice(0, 10) : '';
              lc.serviced_at = _lcd && _lcd >= String(s.sold_date || '').slice(0, 10) ? _lcd : null;
            }
            lc.appt_at = best.initial_appt_date ? String(best.initial_appt_date).slice(0, 10) : null;
            lc.first_paid_at = best.first_paid_date ? String(best.first_paid_date).slice(0, 10) : null;
            lc.completed = Number(best.subscription_completed_services) || 0;
            lc.dpd = (best.days_past_due === null || best.days_past_due === undefined || best.days_past_due === '') ? null : (Number(best.days_past_due) || 0);
            lc.balance = (best.responsible_balance === null || best.responsible_balance === undefined || best.responsible_balance === '') ? null : (Math.round((Number(best.responsible_balance) || 0) * 100) / 100);
            // Signed agreement (per Isaac) — from FieldRoutesContract via the
            // snapshot query: 'signed' (+ date) / 'sent' (e-sign out, unsigned) / 'none'.
            lc.best = best;
            lc.signed_at = best.contract_signed_at ? String(best.contract_signed_at).slice(0, 10) : null;
            lc.contract_state = best.contract_state ? String(best.contract_state) : 'none';
            // PAID-IN-FULL = the "Paid In Full" button on the FieldRoutes
            // customer card (per Isaac) — the card is the source of truth,
            // so this follows it both ways. Same for Commercial Account.
            lc.pif = String(best.customer_paid_in_full || '') === '1';
            lc.commercial = String(best.customer_commercial || '') === '1';
            lc.cardKnown = true;
          }
          // Only write rows whose verdict OR lifecycle actually changed —
          // keeps the pass near-free once things settle.
          const lcChanged = _lifecycleCols && (
            String(s.crm_serviced_at || '') !== String(lc.serviced_at || '') ||
            (_paidCol && String(s.crm_first_paid_at || '') !== String(lc.first_paid_at || '')) ||
            (Number(s.crm_completed_services) || 0) !== (lc.completed || 0) ||
            (s.crm_days_past_due == null ? null : Number(s.crm_days_past_due)) !== lc.dpd ||
            (s.crm_balance == null ? null : Number(s.crm_balance)) !== lc.balance);
          const apptChanged = _apptCol && !!lc.appt_at && !_upsellIds.has(s.id) && (_apptNow.get(s.id) || null) !== lc.appt_at;   // a snapshot without the appointment yet never blanks a date the live pull stamped
          const pifChanged = !!lc.cardKnown && (!!s.paid_in_full) !== lc.pif;
          const commChanged = !!lc.cardKnown && (!!s.is_commercial) !== !!lc.commercial;
          const flagNow = _hasFlagV(lc.best);
          const flagChanged = !!s.crm_subscription_id && (!!s.upfront_collected) !== flagNow;
          const auditNow = _auditV(lc.best);
          const auditChanged = !!s.crm_subscription_id && (s.crm_audit || null) !== auditNow;
          const sigChanged = _agreementCols && (
            String(s.crm_contract_signed_at || '') !== String(lc.signed_at || '') ||
            String(s.crm_contract_state || '') !== String(lc.contract_state || ''));
          const eligChanged = _eligCols && lc.best && (
            String(s.crm_initial_status || '') !== (String(lc.best.initial_status || '').trim() || 'None')
            || (s.crm_autopay == null || !!s.crm_autopay) !== (() => { const a = String(lc.best.customer_auto_pay || '').trim().toLowerCase(); return !!a && !['no', '0', 'false', 'none', 'null'].includes(a); })());
          if (!lc.soldFix && s.crm_status === status && (Number(s.crm_contract_value) || 0) === (cv || 0) && !lcChanged && !pifChanged && !commChanged && !sigChanged && !eligChanged && !flagChanged && !auditChanged && !apptChanged) continue;
          const upd = { crm_status: status, crm_contract_value: cv, crm_subscription: subName, crm_checked_at: stamp };
          if (lc.soldFix) upd.sold_date = lc.soldFix;
          if (_lifecycleCols) { if (!_upsellIds.has(s.id)) upd.crm_serviced_at = lc.serviced_at; upd.crm_completed_services = lc.completed; upd.crm_days_past_due = lc.dpd; upd.crm_balance = lc.balance; }
          if (_lifecycleCols && _paidCol) upd.crm_first_paid_at = lc.first_paid_at;
          if (_apptCol && lc.appt_at && !_upsellIds.has(s.id)) upd.crm_initial_appt_at = lc.appt_at;
          if (_eligCols && lc.best) { if (!_upsellIds.has(s.id)) upd.crm_initial_status = String(lc.best.initial_status || '').trim() || 'None'; upd.crm_autopay = (() => { const a = String(lc.best.customer_auto_pay || '').trim().toLowerCase(); return !!a && !['no', '0', 'false', 'none', 'null'].includes(a); })(); }
          if (_agreementCols) { upd.crm_contract_signed_at = lc.signed_at; upd.crm_contract_state = lc.contract_state; }
          if (pifChanged) upd.paid_in_full = lc.pif;
          if (commChanged) upd.is_commercial = !!lc.commercial;
          if (flagChanged) upd.upfront_collected = flagNow;
          if (auditChanged) upd.crm_audit = auditNow;
          let { error } = await supabase.from('sales').update(upd).eq('id', s.id);
          if (error && _eligCols && /crm_initial_status|crm_autopay/i.test(error.message || '')) {
            _eligCols = false;
            console.warn('[revhawk-sync] eligibility columns missing — run migrations/20260916_sales_eligibility.sql');
            delete upd.crm_initial_status; delete upd.crm_autopay;
            ({ error } = await supabase.from('sales').update(upd).eq('id', s.id));
          }
          if (error && _agreementCols && /crm_contract_signed_at|crm_contract_state/i.test(error.message || '')) {
            // sales_crm_agreement.sql not run yet — drop the agreement stamps and retry.
            _agreementCols = false;
            console.warn('[revhawk-sync] agreement columns missing — run sales_crm_agreement.sql to enable signed-agreement stamps');
            delete upd.crm_contract_signed_at; delete upd.crm_contract_state;
            ({ error } = await supabase.from('sales').update(upd).eq('id', s.id));
          }
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

    // ── 🤖 AUTO-STAGE (per Isaac, Sep 2026): CRM-born sales move through
    // the queues on their own. Reads app_settings.autolog for the rules.
    //   Upfront   → approved  when serviced + signed agreement (or no agreement
    //                         required) + not past due            [auto_approve]
    //             → cancelled when the CRM cancelled it before any service
    //   Backend   → chargeback when the subscription is cancelled
    //             → lock       when lock_days have passed since the sale and
    //                          lock_min_services are completed
    // Payroll runs (upfront + backend) stay the admin's click — they are what
    // graduate rows to History. Manual (upsell) rows are never touched.
    let stageCount = 0, stageError = null;
    try {
      const { data: alRow2 } = await supabase.from('app_settings').select('value').eq('key', 'autolog').maybeSingle();
      const AL2 = Object.assign({ enabled: false, auto_approve: true, lock_days: 90, lock_min_services: 2 }, (alRow2 && alRow2.value) || {});
      if (AL2.enabled) {
        const bySub = new Map();
        for (const r of objects) { const id = String(r.subscription_id || '').trim(); if (id) bySub.set(id, r); }
        const _upFlag = String(AL2.upfront_flag ?? 'Passed Audit').trim().toLowerCase();
        const _upfrontOf = (r) => !!_upFlag && !!r && String(r.customer_flags || '').split(',').some(f => f.trim().toLowerCase() === _upFlag);
        const { data: crmSales, error: csErr } = await selectAll(() => supabase.from('sales')
          .select('id, crm_subscription_id, sold_date, audit_status, lock_status, payroll_processed_at, backend_payroll_processed_at, contract_months, notes, crm_audit, queue_type, crm_contract_state, rep_id')
          .not('crm_subscription_id', 'is', null)
          .or('audit_status.eq.pending,lock_status.eq.pending'));
        if (csErr) throw new Error(csErr.message);
        const stamp = new Date().toISOString();
        const today = Date.now();
        // Auto-approve scope (per Isaac, Oct 14): Office Staff only, sales from Oct 12 on, while
        // the flow is built out — then Sales Reps and Technicians get their own rules.
        // autolog.auto_approve_queues (['office', 'd2d', 'tech']) + auto_approve_from (YYYY-MM-DD)
        // govern when set; otherwise the old company-wide auto_approve switch applies.
        const _aaQ = Array.isArray(AL2.auto_approve_queues) ? new Set(AL2.auto_approve_queues.map(String)) : null;
        const _aaFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(AL2.auto_approve_from || '')) ? String(AL2.auto_approve_from) : '';
        const _autoApproveOn = (s) => (_aaQ ? _aaQ.has(String(s.queue_type || 'office')) : !!AL2.auto_approve)
          && (!_aaFrom || String(s.sold_date || '').slice(0, 10) >= _aaFrom);
        // Inside Sales backend lock (per Isaac, Oct 14): N paid invoices on the subscription
        // (the initial's invoice counts), and nothing else. Counted from RevHawk tickets
        // mapped to the plan (netlify/lib/invoice-map.js) and stamped on the sale as
        // crm_paid_invoices once a day per sale (each count scans the ticket tables).
        const OFFICE_PAID_N = Math.max(1, parseInt((((AL2.backend || {}).office) || {}).paid_invoices, 10) || 4);
        const paidBySale = new Map();
        try {
          const offIds = (crmSales || []).filter(s => (s.queue_type || 'office') === 'office' && (s.lock_status || 'pending') === 'pending' && s.payroll_processed_at).map(s => s.id);
          const cached = [];
          for (let i = 0; i < offIds.length; i += 500) {
            const { data: pc, error: pe } = await supabase.from('sales').select('id, crm_subscription_id, sold_date, crm_paid_invoices, crm_paid_invoices_at').in('id', offIds.slice(i, i + 500));
            if (pe) throw new Error(pe.message);
            cached.push(...(pc || []));
          }
          const DAY = 20 * 3600000;
          const due = cached.filter(x => !x.crm_paid_invoices_at || (today - Date.parse(x.crm_paid_invoices_at)) > DAY);
          cached.forEach(x => { if (x.crm_paid_invoices != null) paidBySale.set(x.id, Number(x.crm_paid_invoices)); });
          if (due.length) {
            const { ticketsForSubsSql, paidCountFrom } = require('../lib/invoice-map.js');
            const tokP = await getAccessToken();
            const TT = (n) => '`' + PROJECT + '.' + DATASET + '.' + n + '`';
            const minSold = due.map(x => String(x.sold_date || '').slice(0, 10)).filter(Boolean).sort()[0] || '2026-01-01';
            for (let i = 0; i < due.length; i += 2000) {
              const part = due.slice(i, i + 2000);
              const r = await runQuery(tokP, ticketsForSubsSql(TT, part.map(x => x.crm_subscription_id), minSold), { compact: true });
              const bySubT = new Map();
              for (const t of ((r && r.objects) || [])) { const k = String(t.sub_id); (bySubT.get(k) || bySubT.set(k, []).get(k)).push(t); }
              for (const x of part) {
                const n = paidCountFrom(bySubT.get(String(x.crm_subscription_id)) || [], x.sold_date);
                paidBySale.set(x.id, n);
                await supabase.from('sales').update({ crm_paid_invoices: n, crm_paid_invoices_at: stamp }).eq('id', x.id);
              }
            }
            console.log('[revhawk-sync] paid invoices counted for ' + due.length + ' Inside Sales sale(s)');
          }
        } catch (pe) { console.warn('[revhawk-sync] paid-invoice count skipped (run migrations/20261014c_sales_paid_invoices.sql?):', String((pe && pe.message) || pe).slice(0, 200)); }
        // ── 💳 Paid since the sale (per Isaac, Oct 15). The only question is whether the customer
        // has PAID since this sale / add-on / re-sign happened — an NSF months ago doesn't matter
        // if they're current and were upsold. Customer-level FieldRoutes payments dated on/after
        // the sale day: a successful one (status 1, real money — not a coupon, write-off or
        // credit memo) = paid; only declines (status 0) = declined; nothing yet = waiting.
        // Stamped on every open sale (crm_paid_since_sale / crm_paid_at / crm_declined_at);
        // within the auto-approve scope a declined-and-never-paid Pending sale goes to NSF,
        // and an auto-NSF that later pays goes back to Pending. A manual NSF is never undone.
        const paidSince = new Map();   // sale id → { paid, paidAt, declinedAt }
        const nsfNow = new Set();      // set to NSF this run — the approval pass below must not overwrite it
        try {
          const _from = (/^\d{4}-\d{2}-\d{2}$/.test(String(AL2.auto_approve_from || '')) ? String(AL2.auto_approve_from) : '2026-10-12');
          const { data: pc, error: pe } = await selectAll(() => supabase.from('sales')
            .select('id, customer_number, sold_date, audit_status, notes, queue_type, sale_kind, rep_id, payroll_processed_at, crm_paid_since_sale, crm_payment_checked_at')
            .gte('sold_date', _from).is('payroll_processed_at', null).in('audit_status', ['pending', 'nsf', 'serviced', 'below_minimums']));
          if (pe) throw new Error(pe.message);
          const RECHECK = 20 * 60000;   // unpaid-yet sales re-checked every 20 min (was 3h — per Isaac, Oct 15: as fast as we can)
          // Declined / NSF rows are re-checked every run so they flip back as soon as the customer pays.
          const due = (pc || []).filter(x => x.customer_number && x.crm_paid_since_sale !== true
            && (x.audit_status === 'nsf' || x.crm_paid_since_sale === false || !x.crm_payment_checked_at || (today - Date.parse(x.crm_payment_checked_at)) > RECHECK));
          if (due.length) {
            const tokPay = await getAccessToken();
            const TP = '`' + PROJECT + '.' + DATASET + '.FieldRoutesPayment`';
            const cids = [...new Set(due.map(x => String(x.customer_number).replace(/[^0-9]/g, '')).filter(Boolean))];
            const minSold = due.map(x => String(x.sold_date || '').slice(0, 10)).sort()[0];
            const byCust = new Map();
            for (let i = 0; i < cids.length; i += 1000) {
              const part = cids.slice(i, i + 1000);
              const r = await runQuery(tokPay, `
SELECT fieldRoutes_customerID AS cid, LEFT(fieldRoutes_date, 10) AS d, fieldRoutes_status AS st, fieldRoutes_paymentMethod AS pm,
       SAFE_CAST(fieldRoutes_amount AS FLOAT64) AS amt, fieldRoutes_writeOff AS wo, fieldRoutes_creditMemo AS cm
FROM ${TP}
WHERE fieldRoutes_customerID IN (${part.map(c => "'" + c + "'").join(',')}) AND LEFT(fieldRoutes_date, 10) >= '${minSold}'
QUALIFY ROW_NUMBER() OVER (PARTITION BY fieldRoutes_paymentID ORDER BY updatedAt DESC) = 1`, { compact: true });
              for (const t of ((r && r.objects) || [])) { const k = String(t.cid); (byCust.get(k) || byCust.set(k, []).get(k)).push(t); }
            }
            const isOk = (t) => String(t.st) === '1' && String(t.pm) !== '0' && (Number(t.amt) || 0) > 0 && String(t.wo || '0') !== '1' && String(t.cm || '0') !== '1';
            const isDecl = (t) => String(t.st) === '0';
            for (const x of due) {
              const day = String(x.sold_date || '').slice(0, 10);
              const mine = (byCust.get(String(x.customer_number).replace(/[^0-9]/g, '')) || []).filter(t => String(t.d || '') >= day);
              const ok = mine.filter(isOk).map(t => t.d).sort();
              const dec = mine.filter(isDecl).map(t => t.d).sort();
              const v = { paid: ok.length > 0, paidAt: ok[0] || null, declinedAt: ok.length ? null : (dec[dec.length - 1] || null) };
              paidSince.set(x.id, v);
              const upd = { crm_paid_since_sale: v.paid ? true : (v.declinedAt ? false : null), crm_paid_at: v.paidAt, crm_declined_at: v.declinedAt, crm_payment_checked_at: stamp };
              const inScope = _autoApproveOn(x);
              const autoNsf = /Auto: NSF/.test(String(x.notes || ''));
              if (inScope && x.audit_status === 'pending' && !v.paid && v.declinedAt) {
                upd.audit_status = 'nsf'; upd.audited_at = stamp; nsfNow.add(x.id);
                upd.notes = ((x.notes || '') + ' · Auto: NSF — card declined ' + v.declinedAt + ', no payment since the sale').trim();
              } else if (x.audit_status === 'nsf' && v.paid && (autoNsf || inScope)) {   // per Isaac: NSF flips back as soon as they pay
                upd.audit_status = 'pending'; upd.audited_at = null;
                upd.notes = ((x.notes || '') + ' · Auto: paid ' + v.paidAt + ' — back to Pending').trim();
              }
              const { error: ue } = await supabase.from('sales').update(upd).eq('id', x.id);
              if (ue) throw new Error(ue.message);
              if (upd.audit_status) stageCount++;
            }
            console.log('[revhawk-sync] paid-since-sale checked for ' + due.length + ' sale(s)');
          }
          (pc || []).forEach(x => { if (x.crm_paid_since_sale === true && !paidSince.has(x.id)) paidSince.set(x.id, { paid: true }); });
        } catch (pe) { console.warn('[revhawk-sync] paid-since-sale skipped (run migrations/20261015d_sales_paid_since_sale.sql?):', String((pe && pe.message) || pe).slice(0, 200)); }
        // ── Pricing minimums (per Isaac, Oct 15): a base plan is Below Minimums when EITHER its
        // initial or its recurring charge is even a cent under the minimum in Configurations →
        // Pricing minimums (autolog.pricing). The new lineup only: Pest / Rodent / Mole / Mosquito
        // 4 · 6 · 12 and Termite (annual). Legacy bundles, Sentricon, one-time services, add-ons
        // and renewals aren't checked — an auditor decides those.
        const PR = Object.assign({ initial_min: 39, fee: 4.87 }, AL2.pricing || {});
        PR.auto = PR.auto !== false;   // on unless switched off (per Isaac, Oct 15: under the minimum = the status IS Below Minimums)
        const PR_PLANS = Object.assign({ pest: [49, 69, 119], rodent: [49, 69, 119], mole: [69, 89, 139], mosquito: [69, 89, 139] }, PR.plans || {});
        const PR_TERM = Object.assign({ initial: 399, recurring: 29 }, PR.termite || {});
        // Renewals (per Isaac, Oct 15): initial minimum $0, recurring from the Loyalty pricing sheet.
        const PR_REN = Object.assign({ initial_min: 0 }, PR.renewal || {});
        const PR_REN_PLANS = Object.assign({ pest: [29, 49, 99], rodent: [29, 49, 99], mole: [49, 69, 119], mosquito: [49, 69, 119] }, PR_REN.plans || {});
        const PR_REN_TERM = Object.assign({ initial: 399, recurring: 29 }, PR_REN.termite || {});
        const belowMinReason = (r) => {
          const name = String((r && r.subscription) || '').trim();
          const renewal = /renew/i.test(String(r.subscription_source || '') + ' ' + String(r.lead_source || ''));
          // $4.87 service fee rides on the recurring charge (per Isaac, Oct 15) — not part of the plan price.
          // Taken off only when the charge carries it (same cents), so a fee-less $49.00 still reads $49.
          const _fee = Number(PR.fee) || 0, _rc = Number(r.recurring_charge) || 0;
          const _hasFee = _fee > 0 && _rc >= _fee && Math.round(_rc * 100) % 100 === Math.round(_fee * 100) % 100;
          const init = Number(r.initial_price), rec = _hasFee ? _rc - _fee : _rc;
          const money = (n) => '$' + (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '');
          let mInit, mRec, m;
          if ((m = name.match(/^(pest|rodent|mole|mosquito)\s+(4|6|12)\b/i))) {
            mInit = Number(renewal ? PR_REN.initial_min : PR.initial_min) || 0;
            mRec = Number(((renewal ? PR_REN_PLANS : PR_PLANS)[m[1].toLowerCase()] || [])[{ 4: 0, 6: 1, 12: 2 }[m[2]]]) || 0;
          } else if (/^termite\b/i.test(name)) { const T = renewal ? PR_REN_TERM : PR_TERM; mInit = Number(T.initial) || 0; mRec = Number(T.recurring) || 0; }
          else if (/^one[\s-]*time\b/i.test(name)) {
            // One-time services (per Isaac, Oct 15): the cheaper Current Customer price is only
            // allowed when the customer had a completed service (any kind) before this sale.
            const ot = oneTimeMin(name);
            if (!ot) return null;
            if (!isFinite(init) || init >= ot.nw - 0.001) return '';
            if (init >= ot.cur - 0.001) return priorDone.has(String(r.customer_id)) ? '' : 'Current-customer price ' + money(init) + ' but no completed service before the sale (new customer ' + money(ot.nw) + ')';
            return 'One-time ' + money(init) + ' < ' + money(ot.cur);
          }
          else return null;
          const out = [];
          if (mInit > 0 && isFinite(init) && init < mInit - 0.001) out.push('Initial ' + money(init) + ' < ' + money(mInit));
          if (mRec > 0 && rec < mRec - 0.001) out.push('Recurring ' + money(rec) + ' < ' + money(mRec));
          return out.length ? out.join(' · ') : '';
        };
        const belowMin = new Map();   // sale id → reason ('' = at/above minimum)
        // One-time minimums: [new customer, current customer], matched on the service name.
        const PR_OT = Object.assign({ 'mosquito': [199, 99], 'pest': [199, 99], 'termite inspection': [199, 99], 'rodent': [249, 149],
          'german roach': [299, 199], 'interior flea': [299, 199], 'vehicle': [199, 199] }, PR.one_time || {});
        const oneTimeMin = (name) => {
          const n = String(name || '').toLowerCase();
          const k = Object.keys(PR_OT).sort((a, b) => b.length - a.length).find(t => n.includes(t));
          const v = k && PR_OT[k];
          return v ? { nw: Number(v[0]) || 0, cur: Number(v[1]) || 0 } : null;
        };
        // Customers with a completed service BEFORE their one-time sale (current-customer price check).
        const priorDone = new Set();
        try {
          const cand = (crmSales || []).filter(x => x.audit_status === 'pending' && !x.payroll_processed_at).map(x => ({ x, r: bySub.get(String(x.crm_subscription_id)) }))
            .filter(({ r }) => r && /^one[\s-]*time\b/i.test(String(r.subscription || '')) && oneTimeMin(r.subscription) && Number(r.initial_price) < oneTimeMin(r.subscription).nw - 0.001);
          if (cand.length) {
            const tokO = await getAccessToken();
            const pairs = cand.map(({ x, r }) => "STRUCT('" + String(r.customer_id).replace(/[^0-9]/g, '') + "' AS cid, '" + String(x.sold_date || '').slice(0, 10).replace(/[^0-9-]/g, '') + "' AS sold)");
            const r2 = await runQuery(tokO, `
WITH c AS (SELECT * FROM UNNEST([${pairs.join(',')}]))
SELECT DISTINCT c.cid FROM c JOIN \`${PROJECT}.${DATASET}.FieldRoutesAppointment\` a ON a.fieldRoutes_customerID = c.cid
WHERE a.fieldRoutes_statusText = 'Completed' AND a.fieldRoutes_dateCompleted NOT LIKE '0000%' AND a.fieldRoutes_dateCompleted != ''
  AND LEFT(a.fieldRoutes_dateCompleted, 10) < c.sold`, { compact: true });
            ((r2 && r2.objects) || []).forEach(o => priorDone.add(String(o.cid)));
          }
        } catch (oe) { console.warn('[revhawk-sync] one-time prior-service check skipped:', String((oe && oe.message) || oe).slice(0, 200)); }
        const lockDays = Math.max(0, Number(AL2.lock_days) || 90);
        const minSvc = Math.max(0, Number(AL2.lock_min_services) || 0);
        for (const s of (crmSales || [])) {
          const r = bySub.get(String(s.crm_subscription_id));
          if (!r) continue;                                     // not in this snapshot — leave it alone
          const cancelled = !!r.subscription_date_canceled || /cancel|inactive/i.test(String(r.subscription_status || ''));
          // Serviced = the initial's completion date, or FieldRoutes' own 'Completed' initial status while the
          // appointment row still lags in RevHawk (per Isaac, Oct 15 — #183686 completed, row still Pending).
          // Renewals (per Isaac, Oct 15): no new initial — commissionable on their next service (completed on/after
          // the save) or their next paid invoice (the paid-since-sale check → upfront below). No appointment needed.
          const _isRenewal = /renew/i.test(String(r.subscription_source || '') + ' ' + String(r.lead_source || ''));
          const serviced = _isRenewal
            ? ((!!r.initial_serviced_date && String(r.initial_serviced_date).slice(0, 10) >= String(s.sold_date || '').slice(0, 10))
              || (!!r.last_completed_date && String(r.last_completed_date).slice(0, 10) >= String(s.sold_date || '').slice(0, 10)))
            : (!!r.initial_serviced_date || /^completed$/i.test(String(r.initial_status || '').trim()));
          const completed = Number(r.subscription_completed_services) || 0;
          const dpd = Number(r.days_past_due) || 0;
          // Signed = the snapshot's e-sign document OR the sale row's own stamp, which the
          // 15-minute live pull sets from FieldRoutes' "signed contract" note (per Isaac,
          // Oct 14 — the e-sign document lags same-day, the note doesn't).
          const signed = String(r.contract_state || 'none') === 'signed' || String(s.crm_contract_state || '') === 'signed';
          const oneTime = (Number(s.contract_months) || 0) <= 0;
          const hasAppt = ['pending', 'completed'].includes(String(r.initial_status || '').trim().toLowerCase()) || /renew/i.test(String(r.subscription_source || '') + ' ' + String(r.lead_source || ''));
          const hasBilling = (() => { const a = String(r.customer_auto_pay || '').trim().toLowerCase(); return !!a && !['no', '0', 'false', 'none', 'null'].includes(a); })();
          // Guard rails per rep type (Configurations → Commission Rules →
          // Upfront Commission Approval): AL2.approval[office|d2d|tech] =
          // { appt, autopay, signed }; the old company-wide require_* flags
          // are the fallback for a type with nothing set.
          const _ap = ((AL2.approval || {})[String(s.queue_type || 'office')]) || {};
          const needAppt = _ap.appt != null ? !!_ap.appt : AL2.require_appt !== false;
          const needPay  = _ap.autopay != null ? !!_ap.autopay : AL2.require_billing !== false;
          const needSign = _ap.signed != null ? !!_ap.signed : AL2.require_signed !== false;
          const eligible = (!needAppt || hasAppt) && (!needPay || hasBilling) && (!needSign || signed || oneTime);
          // Charged upfront (the configured customer flag) — per Isaac:
          // commissionable on the sale date, no need to wait for service;
          // and if it cancels while still pending it goes to Archived.
          // Charged upfront = the configured customer flag, OR a real payment since the sale (per Isaac, Oct 15).
          const upfront = _upfrontOf(r) || !!(paidSince.get(s.id) || {}).paid;
          // Checked from the new-flow start (sales before it were sold on the old pricing).
          const _pmFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(AL2.auto_approve_from || '')) ? String(AL2.auto_approve_from) : '2026-10-12';
          if (['pending', 'serviced', 'below_minimums'].includes(s.audit_status) && !s.payroll_processed_at && String(s.sold_date || '') >= _pmFrom) { const bm = belowMinReason(r); if (bm != null) belowMin.set(s.id, bm); }
          const upd = {};
          if (s.audit_status === 'pending' && !s.payroll_processed_at) {
            if (cancelled && (!serviced || upfront)) { upd.audit_status = 'cancelled'; upd.audited_at = stamp; upd.notes = ((s.notes || '') + (upfront && serviced ? ' · Auto: cancelled in CRM (charged upfront)' : ' · Auto: cancelled in CRM before service')).trim(); }
            else if (!nsfNow.has(s.id) && _autoApproveOn(s) && s.rep_id && eligible && (serviced || upfront) && dpd <= 0 && s.crm_audit !== 'failed') {
              // Below the pricing minimum → approved as Below Minimums (when that switch is on).
              const bm = belowMin.get(s.id);
              upd.audit_status = (PR.auto && bm) ? 'below_minimums' : 'serviced'; upd.audited_at = stamp;
              if (upd.audit_status === 'below_minimums') upd.notes = ((s.notes || '') + ' · Auto: Below Minimums — ' + bm).trim();
            }
          }
          // Already approved, not paid yet: Commissionable under a minimum → Below Minimums; an auto Below Minimums
          // that's back at/above the minimums (pricing changed) → Commissionable. A manual call is left alone.
          if (PR.auto && !s.payroll_processed_at && !upd.audit_status && belowMin.has(s.id) && _autoApproveOn(s)) {
            const bm = belowMin.get(s.id);
            if (s.audit_status === 'serviced' && bm) { upd.audit_status = 'below_minimums'; upd.notes = ((s.notes || '') + ' · Auto: Below Minimums — ' + bm).trim(); }
            else if (s.audit_status === 'below_minimums' && !bm && /Auto: Below Minimums/.test(String(s.notes || ''))) { upd.audit_status = 'serviced'; upd.notes = ((s.notes || '') + ' · Auto: back at/above the pricing minimums').trim(); }
          }
          const lock = s.lock_status || 'pending';
          if (lock === 'pending' && s.payroll_processed_at && ['approved', 'serviced', 'below_minimums'].includes(upd.audit_status || s.audit_status)) {   // Below Minimums locks the same way (it was stuck before)
            const ageDays = (today - (Date.parse(String(s.sold_date || '')) || today)) / 86400000;
            if (cancelled) { upd.lock_status = 'chargeback'; upd.audit_2_at = stamp; }
            else if (s.queue_type === 'd2d') {
              // Sales Reps (per Isaac, Sep 23): every account sold in a year locks on
              // Jan 31 of the FOLLOWING year, always. Plus (Sep 30) any indications
              // set in the Sales Reps column of Backend lock — AL2.backend.d2d;
              // all default OFF, so the Jan 31 rule alone applies until set.
              const sy = Number(String(s.sold_date || '').slice(0, 4)) || new Date(today).getFullYear();
              const _bd = (AL2.backend || {}).d2d || {};
              const dDays = Math.max(0, Number(_bd.min_days) || 0), dSvc = Math.max(0, Number(_bd.min_services) || 0), dDpd = Math.max(0, Number(_bd.max_dpd) || 0);
              const dAfter = Math.max(0, completed - (serviced ? 1 : 0));
              const dOk = ageDays >= dDays && dAfter >= dSvc && !(dDpd > 0 && dpd >= dDpd) && (!_bd.autopay || hasBilling) && (!_bd.signed || signed || oneTime);
              if (today >= Date.UTC(sy + 1, 0, 31) && dOk) { upd.lock_status = 'lock'; upd.audit_2_at = stamp; }
            }
            else if ((s.queue_type || 'office') === 'office') {
              // Inside Sales (per Isaac, Oct 14): locks at N paid invoices (initial included), nothing else.
              const n = paidBySale.get(s.id);
              if (n != null && n >= OFFICE_PAID_N) { upd.lock_status = 'lock'; upd.audit_2_at = stamp; }
            }
            else {
              // Technicians backend (per Isaac, Sep 23 — Inside Sales moved to paid invoices Oct 14): the
              // account stays PENDING until every configured indication
              // holds — Configurations → Commission Rules → Backend lock,
              // AL2.backend[office|tech] = { min_days, min_services (completed
              // AFTER the initial), max_dpd (a balance past due this many days
              // blocks), autopay, signed }. Old lock_days / lock_min_services
              // are the fallback.
              const _bk = ((AL2.backend || {})[s.queue_type === 'tech' ? 'tech' : 'office']) || {};
              const bDays = _bk.min_days != null ? Math.max(0, Number(_bk.min_days) || 0) : lockDays;
              const bSvc = _bk.min_services != null ? Math.max(0, Number(_bk.min_services) || 0) : Math.max(0, minSvc - 1);
              const bDpd = _bk.max_dpd != null ? Math.max(0, Number(_bk.max_dpd) || 0) : 7;
              const bPay = _bk.autopay != null ? !!_bk.autopay : true;
              const bSign = _bk.signed != null ? !!_bk.signed : true;
              const afterInitial = Math.max(0, completed - (serviced ? 1 : 0));
              const ok = ageDays >= bDays && afterInitial >= bSvc && !(bDpd > 0 && dpd >= bDpd) && (!bPay || hasBilling) && (!bSign || signed || oneTime);
              if (ok) { upd.lock_status = 'lock'; upd.audit_2_at = stamp; }
            }
          }
          if (!Object.keys(upd).length) continue;
          const { error: uErr } = await supabase.from('sales').update(upd).eq('id', s.id);
          if (uErr) { console.warn('[revhawk-sync] auto-stage failed for sale ' + s.id + ': ' + uErr.message); continue; }
          stageCount++;
        }
        // Add-on sales already paid upfront: the plan they ride on cancelled → Chargeback (per Isaac, Oct 15 —
        // non-commissionable for any reason). They stay on Pending Backend Lock until the quarterly backend run.
        try {
          const { data: upsP } = await selectAll(() => supabase.from('sales').select('id, parent_subscription_id, lock_status')
            .eq('sale_kind', 'upsell').not('payroll_processed_at', 'is', null).is('backend_payroll_processed_at', null)
            .not('parent_subscription_id', 'is', null).or('lock_status.is.null,lock_status.eq.pending'));
          for (const u of (upsP || [])) {
            const r = bySub.get(String(u.parent_subscription_id));
            if (!r || !(r.subscription_date_canceled || /cancel|inactive/i.test(String(r.subscription_status || '')))) continue;
            const { error: ue } = await supabase.from('sales').update({ lock_status: 'chargeback', audit_2_at: stamp }).eq('id', u.id);
            if (!ue) stageCount++;
          }
        } catch (ue) { console.warn('[revhawk-sync] add-on chargeback check skipped:', String((ue && ue.message) || ue).slice(0, 200)); }
        if (stageCount) console.log('[revhawk-sync] auto-stage: ' + stageCount + ' sale(s) moved');
        // Stamp the Below Minimums reason on the row (shown on the Sales tab) — only when it changed.
        if (belowMin.size) {
          try {
            const ids = [...belowMin.keys()], cur = new Map();
            for (let i = 0; i < ids.length; i += 500) {
              const { data: bmRows, error: be } = await supabase.from('sales').select('id, crm_below_min').in('id', ids.slice(i, i + 500));
              if (be) throw new Error(be.message);
              (bmRows || []).forEach(x => cur.set(x.id, x.crm_below_min || null));
            }
            let n = 0;
            for (const [id, why] of belowMin) {
              const v = why || null;
              if (cur.get(id) === v) continue;
              const { error: ue } = await supabase.from('sales').update({ crm_below_min: v }).eq('id', id);
              if (ue) throw new Error(ue.message);
              n++;
            }
            if (n) console.log('[revhawk-sync] below-minimum reasons updated on ' + n + ' sale(s)');
          } catch (be) { console.warn('[revhawk-sync] below-minimum stamp skipped (run migrations/20261015e_sales_below_min.sql?):', String((be && be.message) || be).slice(0, 200)); }
        }
      }
    } catch (stErr) {
      stageError = String((stErr && stErr.message) || stErr);
      console.error('[revhawk-sync] auto-stage skipped:', stageError);
    }

    // ── 📈 Peak values (per Isaac + CSO, Oct 15): each account's value from AFTER its initial service was
    // completed, before any later change — a rate lowered to save the customer, a plan adjusted down. Edits before
    // the initial is done (setting up the sale) don't count. Published as a small map (customer # | current plan
    // name → peak contract value), only for accounts whose peak beats today's value, to
    // indicators/peak-values.json; the player card's "Peak" revenue reads it. Breadcrumb: FieldRoutes' subscription
    // changelog (RevHawk, captured since 9/14/26) — every recurringCharge change after the initial's completion,
    // with its old value; the highest recurring charge in effect since then rescales the recurring part of today's
    // contract value (the initial stays as is).
    try {
      // Once a day is plenty (the query scans ~2 GB of change history) — skip when the file is under 20 hours old.
      let _pkFresh = false;
      const AL_PK_FORCE = false;   // flip to true for one deploy to rebuild immediately (e.g. right after a backfill)
      try { const { data: pf } = await supabase.storage.from('reporting').download('indicators/peak-values.json'); if (pf) { const j = JSON.parse(await pf.text()); _pkFresh = !!j.at && (Date.now() - Date.parse(j.at)) < 20 * 3600000 && (!AL_PK_FORCE); } } catch (e) { /* first run */ }
      if (_pkFresh) throw new Error('fresh');
      const tokPk = await getAccessToken();
      const TP = (n) => '`' + PROJECT + '.' + DATASET + '.' + n + '`';
      // Ready for RevHawk's 2026 backfill of the change log (per Isaac, Oct 15): nothing here assumes a start date —
      // whatever history is in the table is used, older rows that only carry the text `notes` are parsed too, and a
      // re-delivered change (same changeID) counts once. The earliest change on file is published with the map.
      // Timeline per plan, walked BACKWARDS from today's values: each change's "old" restores the earlier state.
      // Value tracked = recurring charge × services per year (so a frequency downgrade — bi-monthly → quarterly at
      // the same charge — is a reduction too). Only states in effect AFTER the initial service was completed count.
      const r = await runQuery(tokPk, `
WITH done AS (
  SELECT fieldRoutes_subscriptionID AS sid, MIN(LEFT(fieldRoutes_dateCompleted, 19)) AS done_at FROM ${TP('FieldRoutesAppointment')}
  WHERE fieldRoutes_statusText = 'Completed' AND fieldRoutes_dateCompleted NOT LIKE '0000%' AND fieldRoutes_dateCompleted != ''
    AND fieldRoutes_subscriptionID NOT IN ('', '0')
  GROUP BY 1
),
ch AS (
  SELECT c.referenceID AS sid, c.changeID AS cid_, LEFT(c.dateChanged, 19) AS at, JSON_VALUE(e, '$.key') AS k, JSON_VALUE(e, '$.old') AS o
  FROM ${TP('FieldRoutesChangelog')} c, UNNEST(JSON_QUERY_ARRAY(COALESCE(c.notesJson, SAFE.PARSE_JSON(c.notes)))) e
  JOIN done ON done.sid = c.referenceID
  WHERE c.classID = 7 AND JSON_VALUE(e, '$.key') IN ('recurringCharge', 'annualRecurringServices') AND LEFT(c.dateChanged, 19) > done.done_at
  QUALIFY ROW_NUMBER() OVER (PARTITION BY c.referenceID, c.changeID, JSON_VALUE(e, '$.key') ORDER BY c.ingestedAt DESC) = 1
),
sub AS (
  SELECT fieldRoutes_subscriptionID AS sid, fieldRoutes_customerID AS cust, fieldRoutes_serviceType AS svc,
    SAFE_CAST(fieldRoutes_recurringCharge AS FLOAT64) AS rec, SAFE_CAST(fieldRoutes_annualRecurringServices AS FLOAT64) AS ars,
    SAFE_CAST(fieldRoutes_contractValue AS FLOAT64) AS cv, SAFE_CAST(fieldRoutes_initialServiceTotal AS FLOAT64) AS init
  FROM ${TP('FieldRoutesSubscription')} WHERE fieldRoutes_subscriptionID IN (SELECT DISTINCT sid FROM ch)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY fieldRoutes_subscriptionID ORDER BY fieldRoutes_dateUpdated DESC, updatedAt DESC) = 1
)
SELECT sub.sid, sub.cust, sub.svc, sub.rec, sub.ars, sub.cv, sub.init, ch.at, ch.cid_, ch.k, ch.o
FROM ch JOIN sub USING (sid)
ORDER BY sub.sid, ch.at DESC, ch.cid_ DESC`, { compact: true });
      const r2 = await runQuery(tokPk, `SELECT CAST(MIN(dateChangedDate) AS STRING) AS since, COUNT(*) AS n FROM ${TP('FieldRoutesChangelog')} WHERE classID = 7`, { compact: true });
      const histSince = (((r2 && r2.objects) || [])[0] || {}).since || null;
      const peaks = {};
      const put = (k, v) => { v = Math.round(v * 100) / 100; if (v > (peaks[k] || 0)) peaks[k] = v; };
      const bySid = new Map();
      for (const x of ((r && r.objects) || [])) { const k = String(x.sid); (bySid.get(k) || bySid.set(k, []).get(k)).push(x); }
      for (const rows of bySid.values()) {
        const h = rows[0];
        const cv = Number(h.cv) || 0, init = Math.max(0, Number(h.init) || 0);
        let rec = Number(h.rec) || 0, ars = Number(h.ars) || 0;
        if (cv <= 0 || rec <= 0) continue;
        if (!(ars > 0)) ars = 1;   // unknown frequency: compare the charge alone
        const nowAnnual = rec * ars;
        let peakAnnual = nowAnnual;
        for (const c of rows) {   // newest → oldest: undo each change
          const o = Number(c.o);
          if (!isFinite(o) || o <= 0) continue;
          if (c.k === 'recurringCharge') rec = o; else if (c.k === 'annualRecurringServices') ars = o;
          peakAnnual = Math.max(peakAnnual, rec * ars);
        }
        if (peakAnnual <= nowAnnual + 0.01) continue;
        const peak = init + Math.max(0, cv - init) * (peakAnnual / nowAnnual);
        if (peak > cv + 0.5) put(String(h.cust) + '|' + String(h.svc || '').trim().toLowerCase(), peak);
      }
      // (The value frozen at sale isn't used: that's before the initial — per Isaac, peak starts at completion.)
      const sbP = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
      await sbP.storage.from('reporting').upload('indicators/peak-values.json',
        Buffer.from(JSON.stringify({ at: new Date().toISOString(), changelog_since: histSince, peaks })),
        { contentType: 'application/json', upsert: true });
      console.log('[revhawk-sync] peak values: ' + Object.keys(peaks).length + ' account(s) below their peak');
    } catch (pkErr) { if (String((pkErr && pkErr.message) || '') !== 'fresh') console.warn('[revhawk-sync] peak values skipped:', String((pkErr && pkErr.message) || pkErr).slice(0, 200)); }

    // Service-type changes vs contract length (per Isaac, Oct 15) — an Auditing task. Changing a plan's service in
    // FieldRoutes often moves its agreement length too (Package 6 12-mo → Pest 4 24-mo), so a rep can end up paid on
    // a term the account no longer has (or the term is changed by mistake). From the subscription change log: every
    // serviceID change, the agreementLength change made within an hour of it (if any), the plan's first recorded
    // length, and the plan as it is today. Published to auditing/service-changes.json; the app compares it to the
    // term each sale was paid on. Every 6 hours; no start date assumed (ready for RevHawk's 2026 backfill).
    try {
      let _scFresh = false;
      try { const { data: sf } = await supabase.storage.from('reporting').download('auditing/service-changes.json'); if (sf) { const j = JSON.parse(await sf.text()); _scFresh = !!j.at && (Date.now() - Date.parse(j.at)) < 6 * 3600000; } } catch (e) { /* first run */ }
      if (_scFresh) throw new Error('fresh');
      const tokSc = await getAccessToken();
      const TS = (n) => '`' + PROJECT + '.' + DATASET + '.' + n + '`';
      const PT = (c) => "SAFE.PARSE_TIMESTAMP('%Y-%m-%d %H:%M:%S', " + c + ")";
      const rq = await runQuery(tokSc, `
WITH e AS (
  SELECT c.referenceID sid, c.changeID cid, LEFT(c.dateChanged,19) ts, JSON_VALUE(x,'$.key') k, JSON_VALUE(x,'$.old') o, JSON_VALUE(x,'$.new') nw
  FROM ${TS('FieldRoutesChangelog')} c, UNNEST(JSON_QUERY_ARRAY(COALESCE(c.notesJson, SAFE.PARSE_JSON(c.notes)))) x
  WHERE c.classID = 7 AND JSON_VALUE(x,'$.key') IN ('serviceID','agreementLength')
  QUALIFY ROW_NUMBER() OVER (PARTITION BY c.referenceID, c.changeID, JSON_VALUE(x,'$.key') ORDER BY c.ingestedAt DESC) = 1),
svc AS (SELECT * FROM e WHERE k = 'serviceID' AND IFNULL(o,'') NOT IN ('','0') AND o != IFNULL(nw,'')),
len AS (SELECT * FROM e WHERE k = 'agreementLength' AND IFNULL(o,'') != IFNULL(nw,'')),
subAll AS (SELECT * FROM ${TS('FieldRoutesSubscription')} WHERE fieldRoutes_subscriptionID IN (SELECT DISTINCT sid FROM svc)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY fieldRoutes_subscriptionID ORDER BY updatedAt DESC) = 1),
names AS (SELECT fieldRoutes_serviceID id, ANY_VALUE(fieldRoutes_serviceType) name FROM ${TS('FieldRoutesSubscription')} GROUP BY 1),
j AS (SELECT svc.sid, svc.cid, svc.ts, svc.o, svc.nw,
  ARRAY_AGG(IF(l.sid IS NULL, NULL, STRUCT(l.o AS lo, l.nw AS ln)) IGNORE NULLS ORDER BY ABS(TIMESTAMP_DIFF(${PT('l.ts')}, ${PT('svc.ts')}, SECOND)) LIMIT 1)[SAFE_OFFSET(0)] lc
  FROM svc LEFT JOIN len l ON l.sid = svc.sid AND ABS(TIMESTAMP_DIFF(${PT('l.ts')}, ${PT('svc.ts')}, MINUTE)) <= 60
  GROUP BY 1, 2, 3, 4, 5),
fl AS (SELECT sid, ARRAY_AGG(o ORDER BY ts LIMIT 1)[OFFSET(0)] first_len FROM len GROUP BY sid)
SELECT j.sid, s.fieldRoutes_customerID cust, j.ts, n1.name old_svc, n2.name new_svc, j.lc.lo len_old, j.lc.ln len_new, fl.first_len,
  LEFT(s.fieldRoutes_dateAdded,19) added, s.fieldRoutes_serviceType cur_svc, s.fieldRoutes_agreementLength cur_len, s.fieldRoutes_contractValue cv, s.fieldRoutes_activeText act
FROM j JOIN subAll s ON s.fieldRoutes_subscriptionID = j.sid
LEFT JOIN names n1 ON n1.id = j.o LEFT JOIN names n2 ON n2.id = j.nw LEFT JOIN fl ON fl.sid = j.sid
ORDER BY j.ts DESC`, { compact: true });
      const r3 = await runQuery(tokSc, `SELECT CAST(MIN(dateChangedDate) AS STRING) AS since FROM ${TS('FieldRoutesChangelog')} WHERE classID = 7`, { compact: true });
      const rows = ((rq && rq.objects) || []).map(x => [String(x.sid), String(x.cust || ''), String(x.ts || ''), x.old_svc || '', x.new_svc || '',
        x.len_old == null ? null : Number(x.len_old), x.len_new == null ? null : Number(x.len_new), x.first_len == null ? null : Number(x.first_len),
        String(x.added || ''), x.cur_svc || '', x.cur_len == null ? null : Number(x.cur_len), Math.round((Number(x.cv) || 0) * 100) / 100, x.act || '']);
      const sbSc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
      await sbSc.storage.from('reporting').upload('auditing/service-changes.json',
        Buffer.from(JSON.stringify({ at: new Date().toISOString(), changelog_since: (((r3 && r3.objects) || [])[0] || {}).since || null,
          cols: ['sid', 'cust', 'at', 'oldSvc', 'newSvc', 'lenOld', 'lenNew', 'firstLen', 'added', 'curSvc', 'curLen', 'cv', 'status'], rows })),
        { contentType: 'application/json', upsert: true });
      console.log('[revhawk-sync] service changes: ' + rows.length + ' service-type change(s) on file');
    } catch (scErr) { if (String((scErr && scErr.message) || '') !== 'fresh') console.warn('[revhawk-sync] service changes skipped:', String((scErr && scErr.message) || scErr).slice(0, 200)); }

    await _hb({ stage: 'finished', ok: true, rows: objects.length, ms: Date.now() - started, dataAsOf: _dataAsOf || undefined, indicatorsError: indicatorsError || undefined, officeError: officeError || undefined, srcError: srcError || undefined, verifyError: verifyError || undefined });
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, rows: objects.length, employees: rosterCount, rosterError, sources: srcCount, srcError, officesAdded: officeCount, officeError, salesVerified: verifyCount, verifyError, salesStaged: stageCount, stageError, storage_path: path, ms: Date.now() - started }),
    };
  } catch (e) {
    console.error('[revhawk-sync]', e);
    await _hb({ stage: 'failed', ok: false, error: String((e && e.message) || e).slice(0, 500) });
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

// Shared BigQuery plumbing for sibling workers (tech-stats-background).
// Plain-object rows for the side workers (ops-stats, tech-stats, deleted
// scan): runQuery returns { schema, rows|objects } — iterating that directly
// was the "appt is not iterable" crash that kept those blobs from ever
// being written.
async function queryObjects(token, sql) { const r = await runQuery(token, sql, { compact: true }); return (r && r.objects) || []; }
exports._bq = { getAccessToken, runQuery, queryObjects, PROJECT, DATASET };
