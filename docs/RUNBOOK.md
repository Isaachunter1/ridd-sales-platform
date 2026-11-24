# RUNBOOK.md — what goes wrong and where to look

Each row: the symptom as a person sees it, the question to ask Claude, and the one place to look first. Seeded from the incidents named in the code; add a row every time something new breaks.

| Symptom | Ask | Look first |
| --- | --- | --- |
| Slack: "🚨 ops-stats FAILED …" | "Why did ops-stats fail at &lt;time&gt;?" | Cloud Logging, filter `jsonPayload.job="ops-stats"`; the stack is on the `failed` line. `job_runs` has the same error text. |
| Reporting → Operations shows old numbers, no Slack line at all | "When did ops-stats last run?" | `select job, status, started_at, error from job_runs where job='ops-stats' order by started_at desc limit 5`. No rows in 6h → Cloud Scheduler → `ridd-ops-stats` → last attempt status (401 = token, 5xx = job). |
| `POST /api/jobs/<name>` answers 409 "already in progress", for a long time | "Is <name> stuck?" | `job_runs where status='running'`. Started >90 min ago = the process died mid-run; the 5 a.m. kill switch will release it, or `update job_runs set status='stale' where id=…` now. |
| Reps did not get the end-of-day DM | "Why no rep-eod tonight?" | `job_runs where job='rep-eod'` — the summary says why it skipped (`off`, `before send hour`, `already sent`, `SLACK_BOT_TOKEN not set`, `not a work day`). `app_settings.eod_report_state` has the last day sent and per-rep Slack errors (`not_in_channel`, `channel_not_found` = bad Member ID). Settings → Notifications → "Send me a preview" reproduces it for one person. |
| TV board close rate frozen / "Plaibook last pulled N days ago" | "Is Plaibook updating?" | `select started_at, summary from job_runs where job='plaibook-close-rates' order by started_at desc limit 3`. `summary.configured=false` = `PLAIBOOK_MCP_TOKEN` missing on Cloud Run (Nov 13–18 2026 after the key rotation). No rows at all = Cloud Scheduler `ridd-plaibook-close-rates` paused or 401. |
| Marketing → Dashboard LTV / CAC tile shows — or "LTV file not published" | "Did ltv-cohorts run?" | `job_runs where job='ltv-cohorts'` (nightly 4:20am ET). The drill's "Rebuild now" is `POST /api/jobs/ltv-cohorts`; ~2.7 GB billed, 1–2 min. A rebuilt file lands at `reporting/marketing/ltv.json`. |
| Sales export comes back with empty note columns + a toast | "Why no notes on the export?" | `POST /api/crm/customer-notes` answered non-200 — Cloud Logging `jsonPayload.path="/api/crm/customer-notes"`. 400 = more than 400 ids in one call (the client batches; a stale bundle would not). 5xx = BigQuery credential / FieldRoutesNote. The export still downloads without the two columns. |
| Health sheet: "Could not reach /api/sync-status" | "Is the server up?" | `https://<service-url>/health`. `configured:false` → Cloud Run → Variables & Secrets; missing names are in the response. Unreachable → Cloud Run → Revisions → is the latest one serving. |
| `/health` ok but the app's call fails in the browser console with CORS | "Is the Netlify origin allowed?" | Cloud Run env `CORS_ORIGINS`; the Netlify redirect in `netlify.toml` (a 200 proxy redirect is same-origin to the browser, so CORS only matters for direct calls). |
| Scheduler attempt: 401 | — | `X-API-TOKEN` header on the Scheduler job ≠ the `API_TOKEN` secret. Re-run `npm run schedules -- --apply`. |
| Scheduler attempt: 409 | — | Previous run overlapped. Lengthen the schedule or shorten the job; it is not an error in the job. |
| BigQuery error "still not complete after 8 min" | "Is RevHawk's project under quota?" | GCP console → BigQuery → Job history in `GCP_JOB_PROJECT`, the job id is in the error. |
| Numbers changed and nobody deployed anything | "What version produced this?" | `job_runs.version` (commit SHA) + `summary`; compare to the previous row. Same version, different numbers = the data moved (`data_as_of`). |
| **Netlify-side (until ported)** sync stalled over a weekend / boards stale | "What stage did the sync die at?" | `indicators/sync-heartbeat.json` in the reporting bucket (`stage`, `at`); health sheet → Sync worker row. |
| **Netlify-side (until ported)** auto-log silently stopped (Sep 17–23 2026) | "Did a migration not get run?" | Netlify function log for `columns missing — run migrations/…`; the worker degrades instead of failing. Run the named migration in the Supabase SQL editor. |

## Where things live

| Thing | Place |
| --- | --- |
| Server logs | GCP → Cloud Logging → resource `Cloud Run Revision`, service `ridd-server`; filter `jsonPayload.job="<name>"` or `jsonPayload.path="/api/…"` |
| Run history + lock | Supabase table `job_runs` |
| Published files | Supabase Storage bucket `reporting` (`indicators/…`, `snapshots/…`) |
| Config + secrets | Cloud Run → `ridd-server` → Edit & deploy → Variables & Secrets; values in Secret Manager |
| Cron table | the `schedule` field on each job; `server/infra/scheduler.yaml` is generated |
| Deploys | Cloud Build → History (server) · Netlify → Deploys (app) |
| Player card Peak / leaderboard Peak Rev looks wrong or stale | `job_runs` for `peak-values` (daily 4:40am ET); `indicators/peak-values-v2.json` → `at`, `rule`, `changelog_since`. Peak below today = someone other than the rep upsold the account (expected — peak is as sold + the rep's own changes + the $4.87 fee, Nov 23). No file → Peak reads as today's value. Rebuild: `POST /api/jobs/peak-values`. Rule + fixture: `server/test/peak-values.test.js`. |

## GoHighLevel "opportunity created" webhook (Nov 24 2026)
Traffic by hour needs the stage each card was BORN in (reps move call cards within minutes; the hourly sync misses it).
1. Run db/migrations/20261124_ghl_opp_created.sql.
2. Netlify env: GHL_WEBHOOK_SECRET = a long random string (never put it in the repo or chat).
3. Pest AI adds a workflow in the RIDD GoHighLevel account: Trigger "Opportunity Created" (Sales Pipeline, no filters) →
   Action "Webhook", Method POST, URL https://<app domain>/api/ghl-opp-webhook?key=<GHL_WEBHOOK_SECRET>. Publish.
4. Check: app_settings.ghl_webhook_status shows the last payload's field names and whether the opportunity id + stage
   parsed. The next GHL sync folds the birth stage into reporting/ghl/leads.json.gz (opps [8]).
Stores ids, stage, source and times only. Events before the workflow went live stay "first stage the sync saw".
