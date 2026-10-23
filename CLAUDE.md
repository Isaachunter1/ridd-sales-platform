# CLAUDE.md — how to work in this repo

This is the RIDD Sales Platform: a static PWA on Netlify that talks to Supabase directly, and one Express service on Cloud Run that runs the scheduled jobs and the few endpoints that need a secret. `docs/ARCHITECTURE.md` is the full picture and the target shape. This file is what to do on any given task.

**Read `MIGRATION.md` before every task while it exists.** It says which files are frozen, which have moved, and what is in flight. When it is gone, the port is done.

## The three rules

1. **RLS is the security boundary.** The browser holds the anon key and reads Supabase directly. The server never proxies ordinary reads. A read that needs restricting gets a policy, not middleware.
2. **The browser renders; the server computes.** No new aggregation in the browser. No BigQuery query from the browser, ever. A screen reads a result table or a published summary file.
3. **Jobs are small, locked, idempotent, and loud.** One job does one thing, takes a lock, can be re-run without harm, and reports to Slack in a sentence a non-technical reader can act on.

If a request would break one of these, say so and propose the version that doesn't. Don't quietly comply.

## Where things go

| You are adding or changing… | It lives in | Not in |
| --- | --- | --- |
| A scheduled job | `server/services/<domain>/jobs/<name>.js` wrapped in `job()` | `netlify/functions/` (frozen) |
| An HTTP endpoint that needs a secret, a service-role write or OAuth | `server/services/<domain>/index.js` on `router` | `netlify/functions/` (frozen) |
| A BigQuery query | `server/services/<domain>/functions/<name>.sql` beside the `.js` that runs it | a template literal in JS |
| Pure computation (rows in, rows out) | `server/services/<domain>/functions/<name>.js` + a fixture test in `server/test/` | inside the job file |
| A new env var or secret | one row in `server/config/env.js` + one line in `server/.env.example` | `process.env` anywhere else |
| A table or column | a new file in `db/migrations/` (timestamped; append-only) | an edit to an old migration |
| App code (screens, state, helpers) | `app/src/<feature>/` — shared helpers in `core/`, everything else in the feature it renders; the file goes in `app/src/bundle.order.js` where it runs | `app/public/app.js` (generated) |
| CSS the app owns (tokens, components, gap-fill utilities) | `app/src/styles/app.css` | `index.html` |
| A per-deployment value (Supabase URL, company name) | `app/public/config.js` (`window.RIDD_CONFIG`) | `index.html` |
| A build or CI script | `app/scripts/` | the repo root |
| A golden test for app code | `app/test/` (runs inside `app/scripts/ci-check.js`) | beside the code |
| Engine code (competition scorers, shared by app, server and Cam) | `packages/engine/src/` | `app/src/` |
| A design decision (done, not planned) | one dated paragraph in `docs/DECISIONS.md` | a comment nobody will find |
| A way something broke and where to look | a row in `docs/RUNBOOK.md` | only the Slack thread |

Shared Netlify helpers (`netlify/lib/*`) are frozen too. The server has its own: `middleware/auth.js` (was auth-gate), `middleware/apiToken.js` (was sync-gate), `config/bigquery.js` (was `_bq`).

## The migrate-first rule

While `netlify/` still exists: **if a task touches a frozen file, port it first, then make the change in its new home.** Never edit a frozen file in place, even for a one-line fix. The port is a separate commit from the change, so each can be reverted alone.

"Port" means: same output. For a job, `npm run job -- <name> --dry` writes to `server/dryrun/`; diff it against the Netlify output for the same window. For a screen, the branch preview is pixel-identical. For the bundle, `app.js` is byte-identical. The check is the artifact, not the diff.

## Recipes

### Add a job

1. `server/services/<domain>/jobs/<name>.js`:
   ```js
   import { job } from '../../../runtime/job.js';
   export default job('<name>', { schedule: '*/30 * * * *', description: '…', heartbeat: 'indicators/<name>-heartbeat.json' }, async (ctx) => {
     // ctx.log · ctx.bq · ctx.supabase · ctx.now · ctx.dryRun · ctx.stage('…') · ctx.publish(path, buffer, contentType)
     return { rows: 123 };   // small summary → Slack line + job_runs.summary
   });
   ```
2. Add it to `jobs` in that domain's `index.js`. The root mounts `POST /jobs/<name>` and `POST /api/jobs/<name>` for you.
3. Every published file goes through `ctx.publish()` — that is what makes `--dry` write to disk instead of the bucket. Every table write checks `ctx.dryRun` first.
4. Queries: `.sql` beside the function, `{{T:TableName}}` for RevHawk tables, `@start`/`@end` as named params, a comment naming the incident behind every cleanup rule.
5. `npm test --workspace server` for the pure parts. `npm run job -- <name> --dry` for the whole thing.
6. After merge: `npm run schedules -- --apply` (see `server/README.md` step 7).

No new domain folder without a reason in `docs/DECISIONS.md`. The domains are: `sync`, `indicators`, `ops`, `addons`, `slack`, `auth`, `qbo`, `ghl`, `marketing`, `crm`, `misc`.

### Add an endpoint

In `server/services/<domain>/index.js`:
```js
router.post('/thing', requireRole(['admin', 'admin_rep']), async (req, res, next) => { … });
```
`requireRole()` with no list = any signed-in, non-disabled user. The app reaches it at `/api/thing` through the Netlify redirect, sending the JWT via `_apiAuthHeaders`. Only endpoints that need a secret, a service-role write or an OAuth round-trip belong here — anything else is a Supabase read under RLS.

### Change the app

Edit `app/src/`, never `app/public/app.js` — it is generated. `npm run bundle` regenerates it; `npm run check` is the CI gate Netlify runs on every push (a failure keeps the previous version live). A new file must be added to `app/src/bundle.order.js` at the position it should run, or the bundle refuses. The bundle is one module scope stitched in that order: any function can call any other, but a `const`/`let` is only usable after its line has run. Open the deploy preview on a phone and a desktop before asking for a merge.

Utility classes come from `app/public/tailwind.css` (prebuilt, committed) plus the gap-fill rules at the end of `app/src/styles/app.css`; `npm run tailwind` rebuilds the sheet over `app/src/**/*.js`, but a rebuild is a visible change (MIGRATION.md) — do it as its own commit and look at every screen.

### Add a migration

`db/migrations/YYYYMMDD_<what>.sql`, idempotent (`create table if not exists`, `drop policy if exists … create policy …`). Every table gets RLS. Say in the PR that it needs running in the Supabase SQL editor — there is no deploy-time check yet (`docs/ARCHITECTURE.md` → Deferred).

## Deploy

- **Server:** a merge to `main` that touches `server/**` builds and deploys through the Cloud Build trigger. Nothing to do by hand. Config and secrets live in Cloud Run → Variables & Secrets, never in the image.
- **App:** Netlify, on every push: `netlify.toml` at the repo root publishes `app/public` and runs bundle → ci-check → engine build + smoke → build. The file stays at the root (not `app/`) because `netlify/functions/` is still served from there until the last function ports. Deploy previews are the human checkpoint.
- **Scheduler:** `npm run schedules -- --apply` after a job's `schedule` changes. Never edit Cloud Scheduler by hand.
- **You never merge.** Open the PR, point at the preview, stop.

## Conventions

- Server is ES modules, Node 22 (`.nvmrc`). No TypeScript, no ORM, no queue, no logging framework, no validation framework — `docs/ARCHITECTURE.md` says why.
- Logs are one JSON line per event (`middleware/log.js`); the `job` field is the Cloud Logging filter.
- Secrets never reach the browser. Netlify's secret scanner is the backstop.
- Comments say *why* and name the incident (`per Isaac, Oct 15 — #183686`). The existing code does this everywhere; keep doing it.
- No "the model decided": if a request is ambiguous and expensive to redo, ask. If it is cheap, do it and say what you assumed.

## When something is wrong

`docs/RUNBOOK.md` first. Then `job_runs` (status, error, version), then Cloud Logging filtered by `jsonPayload.job`. The Slack line is the summary; the stack is in the log.
