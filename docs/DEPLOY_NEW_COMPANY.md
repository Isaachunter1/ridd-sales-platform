# Standing up the platform for a new pest-control company

One deployment per company (own Supabase project, own Netlify site, own data
feed). This gives each company hard data isolation and takes a few hours. Nothing
in this checklist changes RIDD's deployment.

## 0. Qualify
- **Data feed.** Do they have RevHawk (BigQuery mirror of FieldRoutes)? Today the
  sync only reads RevHawk. No RevHawk = the FieldRoutes-API adapter has to exist
  first (see `docs/GENERALIZATION.md` §D).
- **FieldRoutes.** Same CRM. Employee types, cancel reasons and lead sources can be
  spelled however they like — that is what the vocabulary step below is for.

## 1. Supabase (new project)
1. Create the project; note URL, publishable key, service-role key.
2. Run every file in `migrations/` in filename order (they are dated). Skip
   `migrations/one-off/`.
3. Auth: enable email, set Site URL to the Netlify URL; add the same URL to
   redirect allow-list.
4. Storage: create the `reporting` bucket (public read off) — the snapshot loader
   writes here (`storage_path` on `reporting_uploads`).
5. Create the first admin user (Auth → Users → invite), then set their profile
   role to `admin_owner`.

## 2. Netlify (new site from the same repo)
Environment variables:

| Var | Purpose |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | their project |
| `REVHAWK_PROJECT_ID`, `REVHAWK_DATASET` | their RevHawk dataset (`org_<company>_<hash>`) |
| `GCP_SA_EMAIL`, `GCP_SA_PRIVATE_KEY` (or `GCP_SA_JSON`), `GCP_JOB_PROJECT` | service account with BigQuery read on that dataset (`docs/revhawk_service_account_setup.md`) |
| `REVHAWK_SYNC_SECRET` | any long random string — protects the sync endpoints |
| `FIELDROUTES_SUBDOMAIN`, `FIELDROUTES_AUTH_KEY`, `FIELDROUTES_AUTH_TOKEN` | their FieldRoutes API creds (deleted-customer scan, pay runs) |
| `TZ` | their office timezone, e.g. `America/Chicago` |
| optional: `SLACK_*`, `WINDSOR_API_KEY`, `QBO_CLIENT_ID/SECRET` | integrations; absent = feature hidden |

Scheduled functions (`netlify.toml`) run per site automatically once deployed.

## 3. `index.html` → `window.RIDD_CONFIG`
```js
window.RIDD_CONFIG = {
  SUPABASE_URL: "https://<their-ref>.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_…",
  PUBLIC_URL: "https://<their-site>.netlify.app",
  COMPANY_NAME: "Acme Pest",          // header / menu
  COMPANY_TAGLINE: "…",
  COMPANY_EST: "2012",
  // Optional branding — omit any key to keep the RIDD default for it
  BRAND: {
    WORDMARK_TEXT: "ACME",            // text wordmark (login, TV board) …
    // WORDMARK_SVG: { viewBox: "0 0 300 40", paths: ["M…"] },   // … or an SVG one
    // MARK_SVG:     { viewBox: "0 0 100 100", paths: ["M…"] },  // menu button icon (RIDD = spider)
    EXTERNAL_LINK: null,              // null = no external link in the menu (RIDD = RIDDMADE → whyridd.com)
  },
  // Optional legal entities (RIDD has two: RPC / RPS). One company → leave out.
  // ENTITIES: { ACME: { name: "Acme Pest Control", color: "#2F7D32" } },
  // Feature switches — RIDD-specific programs. Unset = all on. A new company
  // usually starts with none of these; add as they adopt them.
  FEATURES: [],   // any of: 'pay', 'competitions', 'hall_of_fame', 'scorecards', 'calendar', 'pricing'
};
```
Accent colours are CSS variables in `index.html` (`--accent`, `--accent-text`, …);
change them there for the brand palette.

## 4. First sync + snapshot
1. Trigger `/.netlify/functions/revhawk-sync-background` (with the secret) and
   wait for it; then the reporting snapshot builds on the next scheduled pass
   (or trigger `reporting-snapshot`).
2. Sign in as the admin → Reporting should load their subscriptions.

## 5. Configure the CRM (the onboarding hour) — Reporting → Configurations
Do these in order; every list shows the distinct values from *their* data.
1. **CRM vocabulary** — tag cancel reasons (rescission / merged / renewal /
   sold-not-started), sold-by employee types (door-to-door rep / office staff /
   technician), lead sources (door-to-door / tech upsell / termite upsell /
   default-blank), and set the rescission window for their state(s). Untagged
   values fall back to the RIDD patterns, which usually match nothing for another
   company — so **tag everything that applies**.
2. **Service types** — lifecycle (recurring / one-time / retired) and hidden for
   every service type they sell.
3. **Lead sources** — exclusions and revenue class (new / renewal / upsell).
4. **Cancellation reasons** — which reasons count as retained (company-ended).
5. **Branches** — renames, exclusions; home states infer from the data.
6. **Holidays**, **Goals** (department + per-rep annual goals), **Teams**.
7. **Operations baseline** (optional): `adminRules.opsBaseline = { year, values }` gives the Operations tab its "vs <year>" column; without it the column shows —.
8. Settings → Users: invite reps; roles map from their FieldRoutes employee types
   via the vocabulary above.

## 6. Features
With `FEATURES: []` a company gets Sales (Dashboard + Sales) · Indicators ·
Reporting · Retention · Settings. `FEATURES` switches on the RIDD programs:
`pay` (commission calculator + pay runs), `competitions` (+ RIDDcoin, which lives
inside comps), `hall_of_fame`, `scorecards`, `calendar`, `pricing`. A switched-off
feature is simply absent from the nav and sub-tab bars.

## 7. Verify before hand-off
- Retention → Attrition Steps: every step has a sensible count; the ROR step is
  catching *their* rescission reason; "Reset to official" shows no what-ifs.
- Needs attention (Marketing): the CRM checks aren't flagging every account
  (that means a vocabulary bucket is untagged).
- Leaderboard / Sales tabs scope to the right people (employee-type tags).
- `npm run check` green on the branch you deployed from.
