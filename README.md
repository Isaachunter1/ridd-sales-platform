# RIDD Sales Platform

The sales app for RIDD Pest Control: reps log and track sales, see their pay, and compete on live leaderboards; office staff and leadership get reporting, auditing, marketing and operations views over the same data. A static PWA (`app/`) on Netlify talks to Supabase directly under row-level security; one Express service (`server/`) on Cloud Run runs the scheduled jobs that pull from RevHawk's BigQuery mirror and the few endpoints that need a secret. `docs/ARCHITECTURE.md` is the full picture.

**Working in this repo: read `CLAUDE.md` first**, then `MIGRATION.md` for what is in flight. `npm run check` is the gate every push has to pass; `docs/RUNBOOK.md` says where to look when something is wrong.

## The layout changed on Oct 20, 2026 — same code, new places

Nothing about how the app works changed (`app/public/app.js` is byte-identical to the bundle shipped before the move). What changed is where things live and therefore what you type. The `npm run …` commands are the same; the paths under them are not.

| You used to… | Now… |
| --- | --- |
| edit `src/NN-name.js` | edit `app/src/<feature>/name.js` — same files, number prefix gone, sorted into `core/ shell/ sales/ pay/ competitions/ indicators/ reporting/ integrations/ admin/` |
| rely on filename order for the bundle | the order is `app/src/bundle.order.js` — a new file must be added there, in the position it should run, or the bundle refuses |
| `node tools/bundle.js` / `npm run bundle` | `npm run bundle` (the script is `app/scripts/bundle.js`; it writes `app/public/app.js`) |
| `node tools/ci-check.js` / `npm run check` | `npm run check` (unchanged; the scripts are in `app/scripts/`, the golden tests in `app/test/`) |
| `npx vite` or `python -m http.server` from the root, open `localhost:5173` | `npx vite app/public` or `cd app/public && python -m http.server 5173` — the site is the `app/public` folder now |
| edit CSS in the `<style>` block of `index.html` | edit `app/src/styles/app.css` (the build copies it to `app/public/app.css`) |
| edit `window.RIDD_CONFIG` in `index.html` | edit `app/public/config.js` |
| rebuild Tailwind: `npx tailwindcss -c tailwind.config.js -i in.css -o tailwind.css` | `npm run tailwind` (config in `app/tailwind.config.js`, input `app/src/styles/tailwind.in.css`, output `app/public/tailwind.css`) — but see `MIGRATION.md` before you do: the committed sheet is stale and a rebuild is a visible change |
| put a migration in `migrations/` | `db/migrations/` (one-offs: `db/scripts/`) |
| edit the engine in `engine/src/` | `packages/engine/src/` (built into `packages/engine/dist` and served from `app/public/engine/` at the same URLs) |
| look in `geo/`, `handoff/`, `mockups/` | `archive/` |
| find `AUDIT.md`, `PRODUCT_IMPROVEMENT_PLAN.md` at the root | `docs/` |
| read `CONTRIBUTING.md` | `CLAUDE.md` (CONTRIBUTING is a pointer at it) |

Unchanged: `netlify/functions/` and `netlify/lib/` (frozen — being ported to `server/`, see `MIGRATION.md`), `netlify.toml` at the root (it now publishes `app/public`), `index.html`'s markup, the Netlify deploy, the Supabase project, every URL the app or Cam's server uses.

## New: `server/` — the Cloud Run service

The app now has a second backend. Two routes already go there instead of to Netlify functions, via `force = true` redirects in `netlify.toml`: `GET /api/sync-status` (the health sheet) and `POST /api/jobs/<name>` (admin job kicks). If Cloud Run is down, the health sheet's server row fails and everything else keeps working. The rest of `/api/*` is still Netlify until each piece is ported (`MIGRATION.md`).

- Its configuration is in **GCP → Cloud Run → `ridd-server` → Variables & Secrets**, not in Netlify. Netlify's variables are unchanged and still feed the Netlify functions.
- Locally: `copy server\.env.example server\.env`, fill it from the Netlify environment variables (same names), then `npm run server` → `http://localhost:8080/health`. `server/.env` is gitignored; never commit it.
- Deploying it today is an upload from Cloud Shell (`server/README.md`); once the Cloud Build GitHub app is installed on the repo, a merge to `main` that touches `server/**` deploys itself.
- `server/README.md` has the full walkthrough; `CLAUDE.md` has the recipes for adding a job or an endpoint.