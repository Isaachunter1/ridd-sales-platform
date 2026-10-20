# RUNBOOK.md — what goes wrong and where to look

Each row: the symptom as a person sees it, the question to ask Claude, and the one place to look first. Seeded from the incidents named in the code; add a row every time something new breaks.

| Symptom | Ask | Look first |
| --- | --- | --- |
| Slack: "🚨 ops-stats FAILED …" | "Why did ops-stats fail at &lt;time&gt;?" | Cloud Logging, filter `jsonPayload.job="ops-stats"`; the stack is on the `failed` line. `job_runs` has the same error text. |
| Reporting → Operations shows old numbers, no Slack line at all | "When did ops-stats last run?" | `select job, status, started_at, error from job_runs where job='ops-stats' order by started_at desc limit 5`. No rows in 6h → Cloud Scheduler → `ridd-ops-stats` → last attempt status (401 = token, 5xx = job). |
| `POST /api/jobs/<name>` answers 409 "already in progress", for a long time | "Is <name> stuck?" | `job_runs where status='running'`. Started >90 min ago = the process died mid-run; the 5 a.m. kill switch will release it, or `update job_runs set status='stale' where id=…` now. |
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
