# MIGRATION.md — live status of the port

**Read this before every task.** When the last row moves, delete this file.

The port is additive and migrate-first: `server/` is built beside `netlify/`; each piece is ported, verified, switched, and only then deleted from Netlify. **A frozen file is never edited in place** — port it first, then change it in its new home, in two commits. `docs/ARCHITECTURE.md` has the target shape; `CLAUDE.md` has the recipes.

Started Oct 20, 2026.

## Backend

| Netlify today | Server home | Status | Verified by |
| --- | --- | --- | --- |
| `functions/sync-status.js` | `services/misc` → `GET /api/sync-status` | **moved** · Oct 20 | health sheet reads through Cloud Run; response shape unchanged (+ `jobs`) |
| `functions/ops-stats-background.js` + `-now` + `-scheduled` | `services/ops/jobs/ops-stats.js` | **moved** · Oct 20 — ⏳ *awaiting first scheduled run before Netlify delete* | `npm run job -- ops-stats --dry` diffed against `indicators/ops-stats.json` from Netlify, same window |
| `lib/auth-gate.js` | `middleware/auth.js` | **moved** · Oct 20 | same status codes and messages |
| `lib/sync-gate.js` | `middleware/apiToken.js` | **moved** · Oct 20 | now always closed (was open when the secret was unset) |
| `revhawk-sync-background.js` — `_bq` | `config/bigquery.js` | **moved** · Oct 20 | token flow, polling cap, paging verbatim; SQL now in `.sql` files with named params |
| `derive-worker-background.js` | `services/indicators/jobs/derive.js` | frozen — next | |
| `revhawk-sync-background.js` — snapshot | `services/sync/jobs/snapshot.js` | frozen | |
| — office-drop / no-customer / data-as-of monitors | `services/sync/jobs/monitors.js` | frozen | |
| — roster upsert, access revoke/restore | `services/sync/jobs/roster.js` | frozen | |
| — offices + sources mirror | `services/sync/jobs/mirrors.js` | frozen | |
| — auto-add, upsell auto-log, ghost sales | `services/sync/jobs/autolog.js` | frozen | |
| — 60-day CRM verify | `services/sync/jobs/verify.js` | frozen | |
| — auto-stage, paid-since-sale, minimums, peak values, service changes | `services/sync/jobs/staging.js` | frozen — *note: peak-values and service-changes are their own files inside the worker today; decide on read whether they are separate jobs* | |
| `tech-stats-background.js` + `-scheduled` | `services/ops/jobs/tech-stats.js` | frozen | |
| `fieldroutes-addons-sync-background.js`, `addon-reconcile-background.js`, `addons-scheduled.js`, `addons-dryrun.js` | `services/addons` | frozen | |
| `crm-deleted-scan-*`, `fieldroutes-live-sync-*` | `services/crm` | frozen | |
| `ghl-*` | `services/ghl` | frozen | |
| `qbo-*` | `services/qbo` | frozen | |
| `ad-spend.js`, `marketing-spend.js`, `marketing-refresh-scheduled.js` | `services/marketing` | frozen | |
| `slack-dm.js`, `slack-paystub.js`, `commission-email.js`, `teamlead-digest-scheduled.js` | `services/slack` | frozen | |
| `auth-forgot.js`, `admin-set-password.js` | `services/auth` | frozen | |
| `feedback.js`, `client-error.js`, `integrations-admin.js`, `ask-data.js`, `revhawk-test.js` | `services/misc` | frozen | |
| `lib/kv-store.js` | `config/cache.js` (`server_cache` only) | frozen — **its own commit**; verify both stores hold every key before the switch | |
| `lib/indicators-derive.js` | `services/indicators/functions/` | frozen | |
| `lib/add-on-streak.js`, `upsell-record.js`, `rules.js`, `invoice-map.js` | `services/addons/functions/` | frozen | |
| `lib/integrations.js` | `services/misc/functions/` | frozen | |

Port order after `ops-stats`: `derive`, then `sync/` split in this order — snapshot, monitors, roster + mirrors, autolog, verify, staging — then the rest.

### Open items from the POC

- [x] App change for ops-stats: **none** — the Reporting → Operations "Refresh now" button was retired Sep 21 (`src/89-reporting-ops.js`); the tab only reads `indicators/ops-stats.json`. `POST /api/jobs/ops-stats` exists for an admin kick if one is ever wanted back.
- [ ] `netlify.toml`: `/api/sync-status` and `/api/jobs/*` redirects → Cloud Run (`server/README.md` step 8). Delete `[functions."ops-stats-scheduled"]` and the `/api/ops-stats-now` redirect when the three Netlify files go.
- [ ] `GET /api/sync-status` is **open** (no JWT), as it was on Netlify, because the health sheet calls it without headers. Closing it = change the caller + `requireRole()` in one commit, after the port.
- [ ] `CORS_ORIGINS=*` on Cloud Run for the POC; set it to the Netlify production + preview origins before the next endpoint moves.
- [ ] Health sheet still reads `indicators/sync-heartbeat.json`; `job_runs` is already in the `sync-status` response under `jobs`. Switch the sheet when `snapshot` ports.

## Frontend

**Window: not yet set** (Isaac + TJ; weekend start preferred). No merges to `main` during the window; everything merged before is in; branches are rebased onto the new layout afterward.

Prep that can land any time before the window, on `main`:

- [ ] `tools/bundle.js` reads `src/bundle.order.js` instead of sorting by filename, with the order file listing today's numbered files in today's order. `app.js` byte-identical.
- [ ] Decide the Netlify base-directory question: `netlify/functions/` stays at the repo root until the last job ports, so `netlify.toml` either stays at the root (publish pointing into `app/`) or Netlify is confirmed to accept a functions directory outside `base`. Record in `docs/DECISIONS.md`.

The window itself, each its own commit: move `src/` into feature folders per `docs/ARCHITECTURE.md` and update `bundle.order.js` · split `10-core.js` by section banner · `engine/` → `packages/engine/` + the two redirects for Cam · `index.html`/assets/fonts (+ licences) → `app/public/` and `window.RIDD_CONFIG` → `config.js` · inline `<style>` → `app/src/styles/app.css` · **Tailwind rebuild** (not byte-checkable; verified by opening every screen on a phone and a desktop) · `docs/`, `db/`, `archive/` moves · README/CONTRIBUTING rewrites.

## Frozen means

Not edited in place. A bug in a frozen file is fixed by porting the file and fixing it in `server/` (two commits). If that is not possible today, say so in the PR and the fix waits.
