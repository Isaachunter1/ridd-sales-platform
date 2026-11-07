# DECISIONS.md

One dated paragraph per decision. Read before proposing to undo one. Add to the top.

**2026-10-28 · FieldRoutes call diet, edited in place in `netlify/` (Isaac's call).** We kept hitting FieldRoutes' rate limits; the app made ~15–18k calls a day. Isaac approved fixing the two big workers where they are instead of porting first, since the limit is hurting now. Changes: the live pull runs every 5 min (was 2) with a one-at-a-time lock; `subscription/search` uses `includeData=1` (a record missing any field the worker reads is still fetched with `get`); the add-ons sync reads plans changed since its last finished run (calendar day in Pacific time, 3-hour margin, marker never moves on a failed run) instead of the last 3 days, plus any plan whose sale row was logged since; the office list is cached a day in `app_settings.fr_office_cache`; a rate-limit response stops the run (no retries) and a stopped run never publishes the TV feeds; the nightly full sweep and reconcile run once (`minute < 5`), not three times. Expected: ~2–3k calls a day. The port to `server/` still happens on the normal schedule and carries these rules with it.

**2026-10-28 · Renewals are exempt from the audit flag.** A renewal's account still carries the Passed / Failed Audit flag from the original sale, so the flag says nothing about the renewal (per Isaac). Auto-approval (`server/services/sync/functions/stageRules.js`) no longer holds a renewal on a Failed Audit flag; it is approved on its next treatment (completed on/after the save) or its next paid bill, as before. The app hides the flag on renewals (Sales tab, Pay) and pay math already exempted them (`passedAuditExempt`). To pull it forward, `staging` was ported out of the sync worker ahead of the port order.

**2026-10-20 · The Tailwind rebuild is not part of the port.** `tailwind.css` as committed is stale: a rebuild over `app/src/**/*.js` adds 83 selectors and drops 40, and the app has been relying on hand-written gap-fill rules (now at the end of `app/src/styles/app.css`) for the missing ones. Swapping hand-written definitions for Tailwind's can move pixels, so it is its own commit after the port, verified on a deploy preview, with the gap-fill rules deleted one by one as Tailwind covers them. `npm run tailwind` and the repointed `app/tailwind.config.js` are ready for it.

**2026-10-20 · Images and `vendor-supabase.js` stay at the public root.** The architecture doc puts them in `app/public/img/` and `vendor/`; `app.js` names them by their root path (`'kobe-snake.png'`, `import './vendor-supabase.js'`). Moving them means editing code, which breaks the byte-identical check that the port rests on. They move in the ESM phase, when the import lines are rewritten anyway.

**2026-10-20 · The engine build writes two copies.** `packages/engine/dist/ridd-engine.js` is the package's `main` (what `smoke.js` and an `npm install` of the package load); `app/public/engine/dist/ridd-engine.js` + `latest.json` are what Netlify serves at the URLs Cam's server already uses. Two writes of the same bytes beat a redirect, which would have needed a publish-dir target anyway.

**2026-10-20 · `netlify.toml` stays at the repo root during the port.** Netlify resolves `netlify/functions` relative to the base directory, and the functions stay there until the last one ports. The file publishes `app/public` and runs the build from the root; it moves into `app/` when `netlify/` is deleted.

**2026-10-20 · One scope, explicit order.** The app bundle stays one concatenated module scope (no ESM yet); the concatenation order moved from filename numbers to `app/src/bundle.order.js`. Folders now say what a file is; the order file says when it runs. The bundler fails on a file that is on disk but unlisted, listed but missing, or listed twice.

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
