# DECISIONS.md

One dated paragraph per decision. Read before proposing to undo one. Add to the top.

**2026-10-20 · The health route is `/health`, not `/healthz`.** Google's front end in front of Cloud Run answers its own 404 for `/healthz`; the request never reaches the container (verified on the first deploy: `/` and `/api/sync-status` got through, `/healthz` did not). `/api/health` is the same handler so the Netlify `/api/*` redirect covers it.

**2026-10-20 · `GET /api/sync-status` stays open through the port.** The Netlify function had no auth and the app's health sheet calls it without an `Authorization` header. It returns timestamps only. Closing it is a two-sided change (caller + `requireRole()`), which is a behaviour change, so it waits until after the port and ships in one commit.

**2026-10-20 · Admin "Refresh now" goes to `POST /api/jobs/<name>`.** The server also answers `POST /jobs/<name>` (what Cloud Scheduler calls), but putting the admin kick under `/api/` means the app's single Netlify `/api/*` redirect covers it and the browser never needs the Cloud Run URL. Same handler; two paths.

**2026-10-20 · Cloud Scheduler schedules stay in UTC by default.** The Netlify crons were UTC and "schedules are carried over as-is". A job that needs a local wall-clock time sets `tz` on itself (the kill switch is `America/New_York`); `scripts/schedules.js` honours it. The 8am–11pm ET gating that some Netlify kickers did inside the function is preserved inside those jobs when they port, not moved into the cron.

**2026-10-20 · The lock is a partial unique index on `job_runs`.** One `running` row per job name, enforced by Postgres. A second kick inserts, gets 23505, answers 409. No advisory locks, no separate lock table, nothing to leak when a process dies; the 5 a.m. kill switch marks abandoned rows stale. Same table is the history and the health source.

**2026-10-20 · `DRY_RUN` means compute everything, write nothing, publish to disk.** `ctx.publish()` is the one path for published files; in a dry run it writes `server/dryrun/<path>`. That file is the port's proof: diffed against the Netlify output for the same window. Table writes check `ctx.dryRun` themselves. A dry run takes no lock, posts nothing to Slack, and writes no heartbeat.

**2026-10-20 · A missing env var does not crash the container.** `config/env.js` names the missing variables; `index.js` answers 503 on every route except `/health`, which lists them. Reason: in the Cloud Run console a revision has to exist before secrets can be attached to it, so the first deploy is always unconfigured. The doc's "exits with a one-line message" became "answers with a one-line message"; the information is the same.

**2026-10-20 · The old `x-sync-secret` gate's open-when-unset behaviour is gone.** `API_TOKEN` is required. A fresh environment without it answers 503, not "anyone may kick a job".

**2026-10-20 · SQL in `.sql` files with BigQuery named parameters.** Every query the Netlify worker built as a template literal becomes a file beside the function that runs it, with `{{T:Table}}` for the dataset prefix and `@start`/`@end` as parameters. Same query text, same plan; no string-built dates. Incident comments move with the SQL.

**2026-10-20 · One Express service on Cloud Run, Scheduler → HTTP.** Over Supabase Edge Functions (Deno, time limits, compute inside the system we least want to be bound to), over Cloud Run Jobs from day one (per-job switch later if any job passes an hour), over Cloud Run for the app too (Netlify previews are the human checkpoint). See `docs/ARCHITECTURE.md` → Considered and not chosen.

**2026-10-20 · Fixture test per pure function.** `rollupOfficeWeeks` has one; every `functions/*.js` that computes gets one when it ports. Ten rows in, known output out. The model makes tests pass reliably and notices silent breakage unreliably.

**2026-10-13 · (from the architecture doc)** No TypeScript on the app, no Kubernetes, no message queue, no GraphQL, no microservices, no ORM, no validation framework, no logging framework. None solves a problem this system has; each adds a layer the person running it day to day cannot see through.
