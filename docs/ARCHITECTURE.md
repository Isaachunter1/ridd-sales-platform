# docs/ARCHITECTURE.md — RIDD Sales Platform

Oct 13, 2026 · TJ Ghinder

## The system in one paragraph

The RIDD Sales App is a static PWA (`app/`) that talks to Supabase directly; Supabase row-level security decides what each user can read and write. A single Express service on Cloud Run (`server/`) runs the scheduled jobs that pull CRM data from RevHawk's BigQuery mirror, clean it, and publish summaries and result tables that the app reads. The same service exposes the few HTTP endpoints that need a secret or a privileged write. DASHP (a separate platform) writes Door-to-Door and Technician commission results into the app's database on its own schedule. The competition engine (`packages/engine/`) is pure math that runs in the app, in the server, and on Cam's Riddmarket server, from one source.

Three rules that every change respects:

1. **RLS is the security boundary.** The browser holds the anon key and talks to Supabase directly. The server never proxies ordinary reads; if a read needs to be restricted, the restriction is a policy, not middleware.
2. **The browser renders; the server computes.** No new aggregation in the browser. No BigQuery query from the browser, ever. A screen reads a result table or a published summary file.
3. **Jobs are small, locked, idempotent, and loud.** One job does one thing, takes a lock before running, can be re-run without harm, and reports success or failure to Slack in a sentence a non-technical reader can act on.

## Repository layout

```
ridd-sales-platform/
├── CLAUDE.md                 # how to work in this repo: recipes + conventions
├── MIGRATION.md              # during the port only: what is frozen, moved, in flight; the frontend window dates
├── package.json              # npm workspaces: app, server, packages/*
├── .nvmrc                    # pinned Node version
├── app/                      # the PWA (Netlify static hosting)
│   ├── public/               # served as-is: index.html, manifest, icons, fonts, marks, img/
│   │   ├── config.js         # window.RIDD_CONFIG — per-deployment, out of index.html
│   │   └── vendor/supabase.js
│   ├── src/
│   │   ├── bundle.order.js   # explicit concatenation order (replaces sort-by-filename)
│   │   ├── main.js           # boot()
│   │   ├── core/             # config, supabase client + sandbox, state, dom (el/toast), fmt, roles, permissions,
│   │   │                     # auth, settings-store, health, telemetry, lifecycle, storage (IndexedDB/gzip), api (JWT fetch)
│   │   ├── shell/            # nav, header, notifications, search, mobile nav, auth screen
│   │   ├── sales/            # dashboard, rep data, sales queue, queues, calendar
│   │   ├── pay/              # pay, tech pay, commission engine/view/rates
│   │   ├── competitions/     # competitions, hall of fame, NRLA, TV board, riddcoin
│   │   ├── indicators/       # indicator persistence, config sync/CAS/history, rosters, metrics
│   │   ├── reporting/        # core, view, overview, config panels, inside sales, geo, ops, rep performance, retention
│   │   ├── integrations/     # marketing, attribution, ad platforms, GHL leads
│   │   ├── admin/            # manage teams, admin, scorecards, pricing, intel
│   │   ├── slack.js · demo-data.js
│   │   └── styles/           # app.css (was inline <style>), tailwind.in.css
│   ├── scripts/              # bundle.js, build.js, build-engine.js, ci-check.js
│   ├── test/                 # golden tests (was tools/*-test.js)
│   └── netlify.toml          # static hosting + headers + one /api/* redirect; no functions, no schedules
├── server/                   # one Express service on Cloud Run — ES modules
│   ├── index.js              # creates the app, mounts middleware, then every services/*/index.js (routes + /jobs/<name>)
│   ├── Dockerfile · cloudbuild.yaml · .env.example
│   ├── config/
│   │   ├── env.js            # reads + validates every env var on boot; the only place process.env is read
│   │   ├── supabase.js       # service-role client
│   │   ├── bigquery.js       # token + query(sqlPath, params); loads the .sql file next to the caller
│   │   └── engine.js         # createRequire() the UMD engine
│   ├── middleware/
│   │   ├── apiToken.js       # X-API-TOKEN for Scheduler + admin kicks
│   │   ├── auth.js           # verify Supabase JWT, attach profile + role
│   │   └── error.js · log.js
│   ├── runtime/              # shared job plumbing (the DASHP conventions, written once)
│   │   ├── job.js            # job(name, opts, fn): Slack wake-up, lock, run, heartbeat, Slack result
│   │   ├── lock.js           # job_runs row as the lock + run history
│   │   └── heartbeat.js · slack.js · killswitch.js
│   ├── services/             # one folder per domain; every domain has the same shape:
│   │   │                     #   index.js     the router (HTTP endpoints) + the jobs list; the root mounts both
│   │   │                     #   jobs/        scheduled jobs, one per file (omit if none)
│   │   │                     #   functions/   one function per file; fetchX.js + fetchX.sql side by side
│   │   ├── sync/             # the former revhawk-sync-background, split
│   │   │   ├── index.js      # routes: POST /jobs/sync-* admin kicks (role-checked)
│   │   │   ├── jobs/         # snapshot, monitors, roster, mirrors, autolog, verify, staging
│   │   │   └── functions/    # fetchSubscriptions.js + .sql, fetchCustomers.js + .sql, dedupeTransfers.js, …
│   │   ├── indicators/
│   │   │   ├── index.js
│   │   │   ├── jobs/         # derive.js (runs the engine, writes latest.json.gz + latest-rep.json.gz)
│   │   │   └── functions/
│   │   ├── ops/
│   │   │   ├── index.js
│   │   │   ├── jobs/         # ops-stats.js, tech-stats.js
│   │   │   └── functions/    # fetchAppointments.js + .sql, rollupOfficeWeeks.js, publishOpsStats.js, …
│   │   ├── addons/
│   │   │   ├── index.js      # routes: dryrun
│   │   │   ├── jobs/         # sync.js, reconcile.js
│   │   │   └── functions/    # add-on-streak, upsell-record, rules (from netlify/lib)
│   │   ├── slack/
│   │   │   ├── index.js      # routes: dm, paystub, commission-email
│   │   │   ├── jobs/         # teamlead-digest.js
│   │   │   └── functions/
│   │   ├── auth/
│   │   │   ├── index.js      # routes: forgot, admin-set-password
│   │   │   └── functions/
│   │   ├── qbo/
│   │   │   ├── index.js      # routes: connect, callback, spend
│   │   │   ├── jobs/         # spend-refresh.js
│   │   │   └── functions/
│   │   ├── ghl/
│   │   │   ├── index.js      # routes: leads, sync-now
│   │   │   ├── jobs/         # contacts-sync.js
│   │   │   └── functions/
│   │   ├── marketing/
│   │   │   ├── index.js      # routes: ad-spend, marketing-spend
│   │   │   ├── jobs/         # refresh.js
│   │   │   └── functions/
│   │   ├── crm/              # FieldRoutes API direct; until retired
│   │   │   ├── index.js
│   │   │   ├── jobs/         # deleted-scan.js, live-sync.js
│   │   │   └── functions/
│   │   └── misc/
│   │       ├── index.js      # routes: feedback, client-error, sync-status, integrations-admin, ask-data
│   │       └── functions/    # integrations (from netlify/lib)
│   └── test/
├── packages/
│   └── engine/               # unchanged: src/, dist/ridd-engine.js (UMD), test/smoke.js, package.json
├── db/
│   ├── migrations/           # append-only, timestamped; was migrations/
│   └── scripts/              # was migrations/one-off/
├── docs/
│   ├── ARCHITECTURE.md       # this file
│   ├── DECISIONS.md          # dated paragraphs, one per decision
│   ├── RUNBOOK.md            # what goes wrong and where to look
│   └── (existing docs)
└── archive/                  # mockups/, handoff/, geo/
```

During the port, the old tree (`netlify/functions/`, `netlify/lib/`, numbered `src/*.js`, `tools/`) sits beside the new one until each piece is moved. `MIGRATION.md` says which is which.

## Where every current file goes

The map for the move. Every path in the repo today lands in exactly one place; nothing is dropped without a row here.

| Today | Target | Note |
| --- | --- | --- |
| `index.html`, `manifest.json`, `favicon.svg` | `app/public/` |  |
| `vendor-supabase.js` | `app/public/vendor/supabase.js` |  |
| `kobe-snake.png`, `sweeper.png`, `plane.svg`, `ridd-logo.png`, `ridd-logo-dark.png` | `app/public/img/` |  |
| `icons/`, `marks/` | `app/public/icons/`, `app/public/marks/` |  |
| `fonts/` incl. `*-OFL.txt`, `MODIFICATIONS.txt` | `app/public/fonts/` | the licence files stay beside the fonts; they are an obligation |
| `in.css` | `app/src/styles/tailwind.in.css` |  |
| `tailwind.config.js` | `app/tailwind.config.js` | `content` becomes `src/**/*.js` + `public/*.html` |
| `tailwind.css` | deleted | build output; regenerated |
| `deno.lock` | deleted | Netlify edge artifact; no edge functions exist |
| `package-lock.json` | regenerated at root | workspaces |
| `AUDIT.md`, `PRODUCT_IMPROVEMENT_PLAN.md` | `docs/` |  |
| `README.md` | stays, rewritten | two paragraphs: what this is, read `CLAUDE.md` |
| `CONTRIBUTING.md` | stays, reduced to a pointer at `CLAUDE.md` | its content is now there |
| `docs/*` (all 11 files) | `docs/`, unchanged | `docs/README.md` added: one line per file, current or historical |
| `docs/revhawk_sync_setup.md`, `revhawk_service_account_setup.md` | updated when `sync/` ports | they describe the Netlify function |
| `docs/DEPLOY_NEW_COMPANY.md`, `GENERALIZATION.md` | `docs/`, ask Isaac | multi-tenant; confirm whether live or aspirational |
| `engine/` incl. `latest.json` | `packages/engine/` | Netlify redirects keep `/engine/latest.json` and `/engine/dist/ridd-engine.js` at their URLs for Cam |
| `migrations/*.sql`, `migrations/README.md` | `db/migrations/` |  |
| `migrations/one-off/` | `db/scripts/` |  |
| `tools/bundle.js`, `build.js`, `build-engine.js`, `ci-check.js` | `app/scripts/` |  |
| `tools/*-test.js` (incl. `semantic-test.js`) | `app/test/` | `derive-parity-test` compares browser derive to server derive; after the port it points at `server/services/indicators/` |
| `handoff/`, `mockups/`, `geo/` | `archive/` | unless Isaac says the pricing handoff or geo pages are live |
| `netlify.toml` | `app/netlify.toml` | loses all `[functions.*]` and `/api/*` redirects except `/api/*` → Cloud Run; keeps headers, engine redirects, SPA fallback |

`src/` → `app/src/`:

| Target folder | Files |
| --- | --- |
| `core/` | `10-core.js` (split by section banner), `12-crm-vocab.js`, `69-semantic.js`, `85-exceptions.js` |
| `shell/` | `30-shell-nav-mount.js` |
| `sales/` | `40-dashboard-and-rep-data.js`, `50-sales-queue.js`, `56-calendar.js`, `57-calendar-settings.js`, `78-queues.js`, `88-disposition.js` (confirm on read; may be `reporting/`) |
| `pay/` | `52-pay.js`, `90-tech-pay.js`, `92-commission-engine.js`, `94-commission-view.js`, `99-commission-rates-and-misc.js` |
| `competitions/` | `54-competitions.js`, `58-hall-of-fame-and-rep-names.js`, `60-nrla-and-comps.js`, `67-tv-board.js`, `74-riddcoin.js` |
| `indicators/` | `64-indicators.js`, `87-indicator-metrics.js` |
| `reporting/` | `20-reporting-auditing.js`, `70-reporting-core.js`, `76-reporting-view.js`, `82-reporting-overview.js`, `84-reporting-config-panels.js`, `86-reporting-inside-sales.js`, `88-reporting-geographic.js`, `89-reporting-ops.js`, `90-reporting-rep-performance.js`, `96-renewal-cohorts.js`, `96-retention.js`, `96-retention-insights.js` |
| `integrations/` | `72-marketing.js`, `73-attribution.js`, `85-ad-platforms.js`, `85-marketing-demand.js`, `86-ghl-leads.js`, `86-spend-qbo.js`, `86-spend-uploads.js` |
| `admin/` | `62-manage-teams.js`, `66-scorecards.js`, `95-pricing.js`, `97-intel.js`, `98-admin.js` |
| decide on read | `80-putis-shid.js` (rename to what it does); the "misc" half of `99-commission-rates-and-misc.js` |

The tree is a snapshot (49 files as of Oct 13); the model re-reads `src/` at the start of the window and files anything new by the same rule: shared helpers to `core/`, everything else to the feature it renders.

`netlify/` → `server/`:

| Today | Target |
| --- | --- |
| `lib/auth-gate.js` | `middleware/auth.js` |
| `lib/sync-gate.js` | `middleware/apiToken.js` |
| `lib/kv-store.js` | `config/cache.js` — `server_cache` only; the `app_settings` fallback is removed (it exposed QuickBooks P&L to every signed-in user) |
| `lib/indicators-derive.js` | `services/indicators/functions/` |
| `lib/add-on-streak.js`, `upsell-record.js`, `rules.js` | `services/addons/functions/` |
| `lib/integrations.js` | `services/misc/functions/` |
| `functions/*-background.js` | `services/<domain>/jobs/` per the job inventory |
| `functions/*-now.js`, `*-scheduled.js` | deleted; `/jobs/<name>` replaces both |
| `functions/ask-data.js` | `services/misc/index.js` — admin-only Anthropic chat over the on-screen snapshot; needs `ANTHROPIC_API_KEY`; keep or retire is Isaac's call |
| remaining `functions/*.js` | `services/<domain>/index.js` per the HTTP inventory |

## What "no behaviour change" means

The port may change where code lives, how it is built, and where it runs. It may not change what the code does. The check is the artifact, not the diff:

- After a frontend file move: `app.js` is byte-identical.
- After a job port: the `DRY_RUN=true` output is identical to the Netlify output for the same window.
- After a screen is touched: the branch preview is pixel-identical on a phone and a desktop.

Two steps in the port cannot be checked that way, so each is its own commit, revertable alone, and named in `MIGRATION.md`:

1. **Tailwind rebuilt over `src/**`.** The generated CSS differs in bytes because the class set is scanned fresh. Verified by opening every screen, not by diffing the file.
2. **`kv-store` fallback removed.** Same keys, same values, one store instead of two. Verified by reading both stores side by side before the switch and confirming `server_cache` holds every key.

Everything that changes output on purpose (incremental sync, server-built summaries, thinning the browser) is after the port, one change at a time, each with its own diff.

## Step zero: the browser reaches the server

Before any job moves, the app has to reach Cloud Run. Today `/api/*` is same-origin on Netlify; after the port it is a different origin. That means CORS on the server (allow the Netlify origin and branch-preview origins) and the Supabase JWT sent as an `Authorization` header on every call (the app already does this through `_apiAuthHeaders`). Prove it on `GET /api/sync-status` — the one endpoint that cannot hurt anything — then move the rest. This is the first server commit after the scaffold.

## Considered and not chosen

- **Cloud Run for the app too, dropping Netlify.** One platform, one pipeline. Rejected for Q1: Netlify branch previews are free and are the human checkpoint before merge; the engine URLs and the SPA fallback are already handled. Revisit after the port.
- **Supabase Edge Functions instead of Cloud Run.** Same shape as Netlify functions, no GCP wiring. Rejected: similar time limits, Deno runtime, and it puts compute inside the one system we least want to be bound to. All logic in one house.
- **Cloud Run Jobs from day one.** Cleaner batch semantics, no 60-minute ceiling. Deferred: Scheduler hitting HTTP endpoints on one service is simpler, and the switch is per job if ever needed.

## How things move

**A user opens a screen.** The browser reads from Supabase with the user's JWT (tables through PostgREST, summaries from the `reporting` bucket). RLS returns what that user may see. No server code runs. If the screen needs a privileged action (reset a password, DM a rep), the browser calls `POST /api/<thing>` on the server with the JWT; `middleware/auth.js` verifies it and checks the role.

**Cloud Scheduler fires a job.** It POSTs `/jobs/<name>` with the `X-API-TOKEN` header. `middleware/apiToken.js` checks the token. The route hands off to the job. `runtime/job.js` posts a wake-up line to Slack, takes the lock (`job_runs` row), runs the function, writes the heartbeat, posts the result or the failure, releases the lock, and responds. The job reads BigQuery and app config from Supabase, and writes result rows or a summary file. Scheduler waits for the response; the request timeout is 60 minutes.

**An admin clicks Refresh now.** Same `/jobs/<name>` route, but through `middleware/auth.js` with an admin role instead of the token. If the lock is held, the response says a run is already in progress.

**DASHP writes commissions.** On its own schedule, outside this repo, DASHP writes rows into `commission_results` with the service-role key. The app reads them like any other result table.

**Something goes wrong.** The Slack line says what, in plain English. The stack trace is in Cloud Logging, filtered by job name. `docs/RUNBOOK.md` says where to look for each kind of failure.

## The server

One Express service on Cloud Run, one container image, one deploy. HTTP endpoints and scheduled jobs share the image, the middleware and the config. Express handles concurrent requests, so a running snapshot does not block a Slack DM.

Cloud Run settings:

| Setting | Value | Why |
| --- | --- | --- |
| Request timeout | 60 min (the maximum) | Scheduler waits on the job; the snapshot takes about a minute today |
| Min instances | 1 | A scheduled kick never pays a cold start |
| Concurrency | 10 | Jobs are I/O-bound on BigQuery; a few at once is fine |
| Memory | 2 GB | Sized for the snapshot; raise per need |
| CPU | 1, always allocated | Jobs keep working between requests |

If a job ever needs more than an hour, that one job moves to Cloud Run Jobs (same image, `node jobs.js <name>` entrypoint, triggered by Scheduler). Nothing else changes.

**Authentication to `/jobs/*`:** Cloud Scheduler sends `X-API-TOKEN`; the value lives in Secret Manager and in the Scheduler job definition. Admin kicks from the app use the user's Supabase JWT and a role check instead. (Scheduler can send a Google OIDC token with no shared secret; that is a later swap if wanted.)

**Each domain's `index.js`** exports two things: `router` (an Express router with that domain's `/api/*` endpoints; empty if it has none) and `jobs` (an array of the domain's job definitions; empty if it has none). The root `server/index.js` imports every `services/*/index.js`, mounts each router, and registers a `POST /jobs/<name>` route for each job. Nothing is wired by hand.

**The job wrapper** (`runtime/job.js`) is the DASHP bot convention written once:

```js
export default job('snapshot', { schedule: '*/30 * * * *', memory: '2Gi' }, async (ctx) => {
  // ctx.log, ctx.range (incremental window), ctx.bq, ctx.supabase, ctx.now
  // return a small summary object; it becomes the Slack result line
});
```

What the wrapper does around the function: posts "snapshot started" to Slack; inserts a `job_runs` row with status `running` (fails fast if one is already running for this job); runs the function with a timer; on success writes `finished_at`, the summary, and the heartbeat, and posts one line; on failure writes the error, posts one plain-English line, logs the stack, and rethrows so Cloud Run records a 500. The `schedule` field is read by a script that generates the Cloud Scheduler entries, so the cron table lives in the code next to the job.

**Kill switch:** a 5 a.m. job marks any `job_runs` row still `running` after its expected duration as `stale`, releases its lock, and posts to Slack. This is the DASHP morning auto-kill, ported.

**`job_runs` table:** `id, job, status (running|ok|failed|stale), started_at, finished_at, duration_ms, summary jsonb, error text, data_as_of, version`. The lock, the history, and the sync-health sheet's data source, in one table.

## Job inventory

Every scheduled Netlify function today and where it lands. Schedules are carried over as-is for the port; the incremental 5-minute pull is a follow-on.

| Today (`netlify/functions/`) | New home (`server/services/`) | Schedule | Writes |
| --- | --- | --- | --- |
| `revhawk-sync-background` — snapshot part | `sync/jobs/snapshot.js` | */30, 8am–11pm ET | `reporting/indicators/latest.json.gz`, `snapshots/<id>.json.gz`, `reporting_uploads` |
| — office-drop, no-customer, data-as-of checks | `sync/jobs/monitors.js` | */30 | Slack alerts; `job_runs.summary` |
| — employee roster upsert, access revoke/restore | `sync/jobs/roster.js` | */30 | `fieldroutes_employees`, `profiles` |
| — offices + sources mirror | `sync/jobs/mirrors.js` | hourly | `fieldroutes_offices`, `fieldroutes_sources` |
| — inside-sales auto-add, upsell auto-log, ghost-sales | `sync/jobs/autolog.js` | */30 | `sales`, `unlogged_sales` |
| — 60-day CRM verify | `sync/jobs/verify.js` | hourly | `sales.crm_verified_*` |
| — auto-staging for payroll | `sync/jobs/staging.js` | */30 | `sales.stage` |
| `derive-worker-background` | `indicators/jobs/derive.js` | kicked after snapshot | `indicators/latest.json.gz` (derived), `latest-rep.json.gz` |
| `ops-stats-background` (+ `-now`, `-scheduled`) | `ops/jobs/ops-stats.js` | every 6h | `indicators/ops-stats.json` |
| `tech-stats-background` (+ `-scheduled`) | `ops/jobs/tech-stats.js` | hourly :20 | `indicators/tech-stats.json.gz` |
| `addons-scheduled` → `fieldroutes-addons-sync-background` | `addons/jobs/sync.js` | */15 | `add_ons` |
| `addon-reconcile-background` | `addons/jobs/reconcile.js` | ~3am ET | `add_ons` streak fields |
| `crm-deleted-scan-background` (+ `-now`, `-scheduled`) | `crm/jobs/deleted-scan.js` | 08:00 UTC | `app_settings.crm_deleted` |
| `fieldroutes-live-sync-background` (+ `-scheduled`) | `crm/jobs/live-sync.js` | */5 | `sales` (auto-logged) |
| `ghl-scheduled` → `ghl-contacts-sync-background` | `ghl/jobs/contacts-sync.js` | hourly :40 | `ghl_contacts`, `reporting/ghl/leads.json.gz` |
| `qbo-spend-refresh-background` | `qbo/jobs/spend-refresh.js` | nightly | QBO spend cache |
| `marketing-refresh-scheduled` | `marketing/jobs/refresh.js` | 10:00 UTC | warms Windsor/GHL/QBO feeds |
| `teamlead-digest-scheduled` | `slack/jobs/teamlead-digest.js` | 7:45pm ET daily (real cron now) | Slack DMs |
| (new) | `runtime` kill switch | 05:00 local | `job_runs` stale rows |

The three `crm/` jobs hit the FieldRoutes API directly. They are ported as-is and are the first candidates to retire once RevHawk or DASHP covers what they do; `deleted-scan` is the one RevHawk cannot replace.

Port order: `ops-stats` (proof), `derive` (engine on the server), then the `sync/` split in this order — snapshot, monitors, roster + mirrors, autolog, verify, staging — then the rest.

## HTTP inventory

Endpoints stay HTTP only when they need a secret the browser cannot hold, a service-role write, or an OAuth round-trip. Everything is under `/api/`; the app's existing `/api/*` calls keep working through a Netlify redirect to the Cloud Run URL. Each endpoint lives on the router in its domain's `index.js`.

| Endpoint | Service | Auth | Why it is on the server |
| --- | --- | --- | --- |
| `POST /api/admin-set-password` | `auth` | JWT, admin | service-role auth admin call |
| `POST /api/auth-forgot` | `auth` | none (rate-limited) | sends mail with the service key |
| `POST /api/slack-dm`, `/api/slack-paystub`, `/api/commission-email` | `slack` | JWT | Slack bot token |
| `GET /api/qbo-connect`, `/api/qbo-callback`, `/api/qbo-spend` (spend returns the full P&L incl. debt: admin only) | `qbo` | JWT, admin | OAuth secret + refresh tokens |
| `GET /api/ghl-leads`, `POST /api/ghl-sync-now` | `ghl` | JWT | GHL API key |
| `GET /api/ad-spend`, `/api/marketing-spend` | `marketing` | JWT, admin | Windsor key |
| `POST /api/feedback`, `/api/client-error` | `misc` | JWT / none | writes with attachments; telemetry sink |
| `GET /api/sync-status` | `misc` | JWT | reads `job_runs` + heartbeat |
| `POST /api/integrations-admin` | `misc` | JWT, admin | secrets management |
| `POST /api/ask-data` | `misc` | JWT, admin | chat over the on-screen snapshot via Anthropic; `ANTHROPIC_API_KEY` |
| `POST /api/addons-dryrun`, `/api/revhawk-test` | `addons`, `sync` | JWT, admin | diagnostics |
| `POST /jobs/<name>` | every service with jobs | `X-API-TOKEN` **or** JWT admin | Scheduler kick and admin Refresh now; replaces every `-now` and `-scheduled` file |

Not on the server, on purpose: any read the browser can do under RLS. If a screen needs data, it reads a table, a view, or a summary file.

## Data

**Supabase** is the app's database and the core database of the platform. Tables are created by migrations in `db/migrations/`, timestamped and append-only; a change to a table is a new migration, never an edit to an old one. Every table has RLS policies; a table without policies is not readable by the browser. The service-role key is used only by `server/` and by DASHP's commission writer.

**Result tables** are written by jobs or by DASHP and read by the app. Every result row carries three columns: `computed_at` (when the job ran), `data_as_of` (RevHawk's freshness stamp for the rows it used), and `source_version` (the job or engine version). When a number is wrong, these say whether the data, the rule, or the config was at fault. `commission_results` is the first; `job_runs` is the second.

**The `reporting` storage bucket** holds published files:

| Path | Written by | Read by |
| --- | --- | --- |
| `indicators/latest.json.gz` | `derive` | admins, office staff |
| `indicators/latest-rep.json.gz` | `derive` (customer key stripped) | reps (full blob is 403 to reps by bucket policy) |
| `snapshots/<id>.json.gz` | `snapshot` | Reporting (admins + office staff) |
| `indicators/ops-stats.json`, `tech-stats.json.gz` | `ops-stats`, `tech-stats` | Reporting → Operations |
| `ghl/leads.json.gz` | `ghl/contacts-sync` | GHL leads tab |
| `sync-heartbeat.json` | job wrapper | health sheet (until `job_runs` replaces it) |

**BigQuery (RevHawk)** is read-only to every job. Each query is a `.sql` file beside the function that runs it (`fetchAppointments.js` + `fetchAppointments.sql`), loaded by `config/bigquery.js` with named parameters for the date range. The cleanup rules the app has learned (transferred-account dedupe, cancel reason by write date, phantom `Office -1`, `-1` production values, roaming employees, 14-day customer grace) live in those files, with a comment naming the incident each came from. Query count per day is fixed by the schedule and does not grow with users; the browser never queries BigQuery.

**`market_feed`** is a Supabase schema that Cam's Riddmarket server reads. Its views and the engine file at `/engine/dist/ridd-engine.js` keep their names and shapes through the port.

## Frontend

The app is plain JavaScript with no framework. `app/scripts/bundle.js` concatenates `packages/engine/src/*.js` then the files listed in `app/src/bundle.order.js` into one `app.js`; everything shares one module scope, so any function can call any other. `app.js` is generated: edit `src/`, never `app.js`. `build.js` content-hashes and minifies it for deploy, without mangling top-level names (the golden tests look functions up by name).

What the reorganisation changes and what it does not:

- Files move into feature folders and lose their number prefixes; `bundle.order.js` holds the order explicitly.
- `10-core.js` is split into `core/*.js` by cut-and-paste. No code changes; it is still one scope.
- The inline `<style>` block moves to `src/styles/app.css`; Tailwind is rebuilt over `src/**/*.js` in the build command, and the hand-written gap-fill utilities are deleted.
- `public/config.js` holds `window.RIDD_CONFIG` so `index.html` is the same across deployments.
- `mountApp()` full re-render, the `state` object, the Supabase sandbox proxy, `el()`/`toast()`/`fmt`: unchanged.

Phase 3 (later, not in the port): real ES modules via esbuild. Each file gets import/export lines (generated from ESLint `no-undef`), the `typeof X === 'function'` guards go away, terser can mangle, and the golden tests import modules instead of regex-extracting from `app.js`.

Netlify keeps serving the app. `netlify.toml` loses every `[functions.*]` block and every `/api/*` redirect except one: `/api/*` → the Cloud Run service URL. Branch previews stay on.

## Environment and secrets

`server/config/env.js` is the only file that reads `process.env`. It validates every variable on boot and exits with a one-line message naming the missing one. `server/.env.example` lists each with a comment.

| Variable | Where it lives | Used by |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | public (`app/public/config.js`) | the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret Manager → Cloud Run | `config/supabase.js` |
| `API_TOKEN` | Secret Manager → Cloud Run + Cloud Scheduler | `middleware/apiToken.js` |
| `GOOGLE_APPLICATION_CREDENTIALS` / service account | Cloud Run identity | `config/bigquery.js` |
| `BQ_PROJECT`, `BQ_DATASET` | Cloud Run env | `config/bigquery.js` |
| `SLACK_BOT_TOKEN`, `SLACK_ALERTS_CHANNEL` | Secret Manager | `runtime/slack.js`, `services/slack` |
| `FIELDROUTES_SUBDOMAIN`, `_AUTH_KEY`, `_AUTH_TOKEN` | Secret Manager | `services/crm`, `services/addons` (until retired) |
| `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `GHL_API_KEY`, `WINDSOR_API_KEY`, `ANTHROPIC_API_KEY` | Secret Manager | their services |
| `SITE_URL` | Cloud Run env | links in Slack messages, OAuth callbacks |

Never in the browser: anything in the Secret Manager rows. Netlify's secret scanner stays on for the app build as a backstop.

## Deploy

**Server:** Cloud Build trigger on the repo, build context `server/`, on push to `main`. `server/cloudbuild.yaml` builds the Dockerfile, pushes to Artifact Registry, deploys to the Cloud Run service with the settings above and secrets mounted from Secret Manager. One-time setup by TJ: connect the repo, grant the Cloud Build service account `run.admin` and `secretmanager.secretAccessor`. After that, a merge to `main` is a deploy.

**App:** Netlify, unchanged. `app/netlify.toml` build command runs bundle → ci-check → engine build + smoke → build; a CI failure keeps the previous version live. Branch previews stay on.

**Scheduler:** `npm run schedules --workspace server` reads every job's `schedule` field and writes `server/infra/scheduler.yaml`; applying it is one `gcloud` command in the same script. The cron table in Cloud Scheduler is never edited by hand.

## The migration, while it lasts

The port is additive and migrate-first. `MIGRATION.md` at the repo root is the live status: which old files are frozen, which have moved, which are in flight today, and the dates of the frontend window. The model reads it before every task while it exists; when the last item moves, the file is deleted.

**Backend (from Oct 20):** no pause. `server/` is built beside `netlify/`. Each job is ported, run with `DRY_RUN=true`, diffed against the Netlify output for the same window, switched in Cloud Scheduler, and only then deleted from Netlify. Rule for every task that touches a frozen file: **migrate it first, then make the change in its new home.** Never edit a frozen file in place.

**Frontend (one dated week):** the concatenated bundle reads all of `src/` or none, so the move cannot be done piecewise. No merges to `main` for the work window; work continues on branches. Everything merged before the window is in; anything on a branch is rebased onto the new layout by the model afterward. The work is about two days (move files into feature folders, write `bundle.order.js`, split `10-core.js`, move the inline CSS, rebuild Tailwind, open every screen on a phone and a desktop); the rest of the week is buffer. Date set by Isaac and TJ; a weekend start is preferred.

## Deferred, and why each matters

The Q4 '26–Q1 '27 work is a port: same logic, new infrastructure, new layout. The items below are the agreed long-term shape and are not in the port. They are listed so the reason is not lost when the time comes.

| Item | What it is | Why it matters here |
| --- | --- | --- |
| Staging + production | A second Supabase project and Cloud Run service from a `staging` branch; the model works there; a human merges to `main` | Today every change ships straight to reps' phones. The Sep 17–23 auto-log outage is the cost of having no staging |
| Fixture tests per job | Ten rows in, known output out, for every `functions/*.js` that computes | The model makes tests pass reliably; it notices silent breakage unreliably. A test turns "looks right" into yes or no |
| The model never merges | Netlify branch previews stay on; a person opens the preview and clicks merge | The last human checkpoint before reps see a change |
| Deploy-time migration check | Fail the deploy if a file in `db/migrations/` is not applied to the target database | A missing column silenced payroll logic for a week |
| `docs/RUNBOOK.md` | The five things that go wrong, each with the question to ask the model and the one place to look | Seeded from the incident table in the integration doc |
| Pinned toolchain | `.nvmrc`, lockfile committed, `npm ci` in CI, Dockerfile base image by digest | Model-driven codebases drift; "it worked yesterday" has to be reproducible |
| ESLint + Prettier in CI | `no-undef`, `no-unused-vars`, `import/no-unresolved`; formatting is not a review topic | Catches the bug class the `typeof X === 'function'` guards exist to hide |
| `docs/DECISIONS.md` | One dated paragraph per decision: one service, ESM, RevHawk, D2D from DASHP, no ORM, no queue | The model reads it before proposing to undo one; a future contractor has somewhere to look |
| Frontend ESM (phase 3) | esbuild, generated imports, mangling, module-level tests | Real dependency graph; smaller bundle; the guards go away |
| Thin the browser | Leaderboards → Hall of Fame → Pay → Reporting → Retention → Geo read server-built summaries | Limit #2; starts once the back end is on Cloud Run |
| Incremental sync | Pull rows with `updatedAt` since the last run every 5 min; full rebuild nightly | Fresher data and roughly 50× less BigQuery scan; DASHP's pattern |

Deliberately not planned: TypeScript on the app, Kubernetes, a message queue, GraphQL, microservices, an ORM, a validation framework, a logging framework. None solves a problem this system has, and each adds a layer the person running the system day to day cannot see through.
