# RevHawk → App live sync — setup guide

This wires the app's reporting straight to RevHawk's live FieldRoutes data, so
the snapshot refreshes itself **every morning** instead of needing a manual CSV
upload. Nothing on the app side changes — Overview, Audit, Cancellations, and
Inside Sales all keep reading "the latest snapshot," they just get a fresh one
daily.

## How it works

1. **`revhawk-sync-scheduled.js`** runs on a Netlify cron (12:00 UTC daily ≈
   6am MT / 8am ET) and fires the worker.
2. **`revhawk-sync-background.js`** (15-minute budget) authenticates to RevHawk's
   BigQuery with a Google service account, runs one mapping query that turns the
   FieldRoutes tables into the exact 30-field row shape the app's CSV parser
   produces, gzips it, and writes it to Supabase the same way an upload does:
   a `reporting_uploads` envelope row + a gzipped JSON blob in the `reporting`
   storage bucket.
3. The app auto-loads the newest `reporting_uploads` row on the next visit.

You can also trigger it on demand: `POST /api/revhawk-sync` with the
`x-sync-secret` header.

## One-time setup

### 1. Get a Google Cloud service account from RevHawk
Ask RevHawk (or your GCP admin) for a **read-only service account** with
BigQuery access to your dataset (`org_ridd_pest_control_3f4149` in project
`revhawkdataconnect`). It needs the roles **BigQuery Data Viewer** (on the
dataset) and **BigQuery Job User** (on the project). They'll give you a JSON key
file containing `client_email` and `private_key`.

### 2. Add environment variables in Netlify
Site settings → Environment variables:

| Variable | Value |
|---|---|
| `GCP_SA_EMAIL` | the service account's `client_email` |
| `GCP_SA_PRIVATE_KEY` | the `private_key` value (paste the whole `-----BEGIN PRIVATE KEY----- … -----END PRIVATE KEY-----`; literal `\n` is fine) |
| `REVHAWK_PROJECT_ID` | `revhawkdataconnect` |
| `REVHAWK_DATASET` | `org_ridd_pest_control_3f4149` |
| `REVHAWK_SYNC_SECRET` | any random string (protects the manual trigger) |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are already set for the app — the
sync reuses them to write the snapshot.

### 3. Deploy
Push the repo. Netlify registers the scheduled function automatically. To test
immediately without waiting for the cron, run from your machine:

```
curl -X POST https://YOUR-SITE.netlify.app/api/revhawk-sync \
  -H "x-sync-secret: YOUR_SECRET"
```

A success response looks like `{"ok":true,"rows":84000,"storage_path":"snapshots/revhawk-….json.gz","ms":…}`.
Then open the app → Reporting; the newest snapshot will say "RevHawk live sync — <date>".

## Things to confirm / tune

- **Branch names.** RevHawk only stores numeric office IDs, so the worker maps
  them to names (`OFFICE_NAMES` near the top of `revhawk-sync-background.js`):
  1 = Salt Lake, 6 = Charleston, 7 = Myrtle Beach, 10 = Destin, 13 = Atlanta,
  15 = Virginia Beach, 16 = Raleigh, 18 = Detroit. Edit these if your branch
  labels differ from what the rest of the app expects.
- **Refresh time.** Change the cron in `revhawk-sync-scheduled.js`
  (`'0 12 * * *'`) to re-time the daily run, or add more runs.
- **Initial-service date (v1 simplification).** "Serviced" is driven by the
  count of completed appointments already on each subscription, which is exact.
  The `initial_service` *date* is set to the sold date as a stand-in (the real
  per-appointment completion date lives in `FieldRoutesAppointment` and can be
  joined in later if you want true "days-to-first-service" timing). This does
  not affect any of the Sold / Serviced / Active / Cancelled counts.
- **Agreement length** maps straight from `fieldRoutes_agreementLength`; if the
  app's "agreement length mix" looks off after the first sync, that field's unit
  may differ from the old CSV's column and we can adjust the mapping.

## Field mapping (FieldRoutes → snapshot)

| Snapshot field | Source |
|---|---|
| customer_id | Subscription.customerID |
| last_name / first_name | Customer.lname / fname |
| sold_date | Subscription.dateAdded |
| customer_auto_pay | Customer.aPay |
| customer_flags | CustomerFlags (distinct flag names, joined) |
| annual_recurring_value | Subscription.annualRecurringValue |
| sold_by_id / sold_by | Subscription.soldBy → Employee (Last, First) |
| sold_by_type | Employee.type → 0 Office Staff / 1 Technician / 2 Sales Rep |
| subscription_completed_services | count of Subscription.completedAppointmentIDs |
| county / state / zip_code / phone / email | Customer |
| subscription | Subscription.serviceType |
| subscription_cancellation_reason | CancellationNote.cancellationReason (latest) |
| subscription_date_canceled | Subscription.dateCancelled (0000 → none) |
| subscription_status | Subscription.activeText (Active / Frozen) |
| initial_service | sold date when initialStatus = Completed (serviced flag) |
| subscription_source | Subscription.source |
| days_past_due | Customer.responsibleBalanceAge |
| office_name | Subscription.officeID → OFFICE_NAMES map |
| agreement_length | Subscription.agreementLength |
| subscription_contract_value | Subscription.contractValue |
| initial_price | Subscription.initialServiceTotal |
| recurring_frequency | Subscription.frequency |
| lead_source | Subscription.leadSource, else Customer.customerSource |
