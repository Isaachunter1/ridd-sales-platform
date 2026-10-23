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

**Done · Oct 20, 2026**, on branch `server-app-architecture`, as five commits each verifiable on its own — `app/public/app.js` is byte-identical to the pre-port bundle after every one (sha256 `42781b05…`; the shipped file is still `app-42781b05.immutable.js`), and `npm run check` passes:

1. `app/src/bundle.order.js` — explicit concatenation order; the bundler refuses an unlisted, missing or duplicated file.
2. `src/NN-*.js` → `app/src/<feature>/name.js` (53 files; the five that arrived after the Oct 13 map placed by their banners; `80-putis-shid` is `reporting/executive-pnl.js`).
3. `core.js` and `commission-rates-and-misc.js` split at their own section banners into 29 files (binary cut, CRLF kept).
4. `app/public` (site), `app/scripts`, `app/test`, `packages/engine` (a workspace), `db/migrations` + `db/scripts`, `archive/` (geo, handoff, mockups), `docs/` (AUDIT, PRODUCT_IMPROVEMENT_PLAN); `deno.lock` deleted. `netlify.toml` stays at the root and publishes `app/public`.
5. `index.html` without CSS (→ `app/src/styles/app.css`, copied to `app/public/app.css` by the bundler) and without config (→ `app/public/config.js`). 1,331 → 111 lines.

Deviations from the Oct 13 map, each so that `app.js` stays byte-identical (`docs/DECISIONS.md`):
- images and `vendor-supabase.js` stay at the public **root** (not `img/`, `vendor/`): `app.js` names them by root path;
- the engine build writes to `packages/engine/dist` **and** `app/public/engine/dist`, so `/engine/dist/ridd-engine.js` and `/engine/latest.json` keep their URLs with no redirect;
- the file banners inside `app/src/**` still say `src/NN-*.js` — a comment-only commit fixes them (changes `app.js` bytes, so it is proven by a comment-stripped diff instead).

Still open, for the deploy preview on a phone and a desktop:
- [ ] **Tailwind rebuild** (`npm run tailwind`): the committed `tailwind.css` is stale (+83 / −40 selectors against a rebuild); the app leans on the hand-written gap-fill rules at the end of `app.css` for classes like `.h-8`, `.mt-6`, `.opacity-50`. Rebuild → open every screen → delete the gap-fill rules that Tailwind now defines. Its own commit; not byte-checkable.
- [ ] Ask Isaac whether `archive/geo/*.html` (the service-area tools) or `archive/handoff/` were live on the site; if so, restore them under `app/public/`.
- [ ] Comment-only commit: file banners to the new paths.
- [ ] Phase 3 (ESM via esbuild) is not started and is not in the port: `docs/ARCHITECTURE.md` → Deferred.

## Frozen means

Not edited in place. A bug in a frozen file is fixed by porting the file and fixing it in `server/` (two commits). If that is not possible today, say so in the PR and the fix waits.
