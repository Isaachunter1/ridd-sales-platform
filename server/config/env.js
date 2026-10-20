// The ONLY file that reads process.env. Every variable is declared here with
// whether it is required; boot fails with one line naming the missing one.
// Add a variable: one row below + one line in .env.example. Nothing else.

const SPEC = {
  // ── Core ───────────────────────────────────────────────────────────────
  PORT:                       { required: false, default: '8080' },
  NODE_ENV:                   { required: false, default: 'production' },
  SITE_URL:                   { required: false, default: '' },          // links in Slack lines
  CORS_ORIGINS:               { required: false, default: '*' },         // comma list, or * (POC)

  // ── Supabase (service-role: server only, never the browser) ───────────
  SUPABASE_URL:               { required: true },
  SUPABASE_ANON_KEY:          { required: true },                        // verifies user JWTs
  SUPABASE_SERVICE_ROLE_KEY:  { required: true, secret: true },

  // ── Jobs ──────────────────────────────────────────────────────────────
  API_TOKEN:                  { required: true, secret: true },          // X-API-TOKEN from Cloud Scheduler
  DRY_RUN:                    { required: false, default: 'false' },     // 'true' = compute, write nothing
  JOB_VERSION:                { required: false, default: 'dev' },       // stamped on job_runs; Cloud Build sets the commit SHA

  // ── BigQuery (RevHawk mirror) ─────────────────────────────────────────
  GCP_SA_JSON:                { required: false, secret: true },         // whole key file (preferred) …
  GCP_SA_EMAIL:               { required: false },                       // … or the split pair
  GCP_SA_PRIVATE_KEY:         { required: false, secret: true },
  REVHAWK_PROJECT_ID:         { required: false, default: 'revhawkdataconnect' },
  REVHAWK_DATASET:            { required: false, default: 'org_ridd_pest_control_3f4149' },
  GCP_JOB_PROJECT:            { required: false, default: '' },          // where queries run + bill; defaults to REVHAWK_PROJECT_ID

  // ── Slack ─────────────────────────────────────────────────────────────
  SLACK_ADMIN_WEBHOOK:        { required: false, secret: true },         // job wake-up / result / failure lines; unset = logs only
  SLACK_SYNC_WEBHOOK:         { required: false, secret: true },         // the sales channel — NOT for job lines (it pinged the whole team); kept for services/slack when it ports

  // ── Not used yet — declared so Cloud Run can hold them ahead of each port ──
  // (services/crm + services/addons) FieldRoutes API direct, until retired
  FIELDROUTES_SUBDOMAIN:      { required: false },
  FIELDROUTES_AUTH_KEY:       { required: false, secret: true },
  FIELDROUTES_AUTH_TOKEN:     { required: false, secret: true },
  // (services/ghl) GoHighLevel — the real names, not the doc's GHL_API_KEY
  GHL_PRIVATE_TOKEN:          { required: false, secret: true },
  GHL_LOCATION_ID:            { required: false },
  // (services/qbo) QuickBooks OAuth
  QBO_CLIENT_ID:              { required: false },
  QBO_CLIENT_SECRET:          { required: false, secret: true },
  QBO_ENV:                    { required: false, default: 'production' },
  // (services/marketing) Windsor ad-spend feed
  WINDSOR_API_KEY:            { required: false, secret: true },
  // (services/misc → ask-data) keep or retire is Isaac's call
  ANTHROPIC_API_KEY:          { required: false, secret: true },
};

const env = {};
const missing = [];
for (const [key, rule] of Object.entries(SPEC)) {
  const raw = process.env[key];
  const val = raw == null || raw === '' ? rule.default : raw;
  if (rule.required && (val == null || val === '')) missing.push(key);
  env[key] = val == null ? '' : String(val);
}
// Missing variables do NOT crash the process: Cloud Run needs a revision that
// starts before you can attach secrets to it in the console (README step 5).
// Instead index.js answers 503 "not configured: X, Y" on every route except
// /health, and the boot log names them. Locally, `npm run dev` says the same.
if (missing.length) {
  console.error(JSON.stringify({ severity: 'ERROR', msg: 'NOT CONFIGURED — missing required variable(s): ' + missing.join(', ') + ' (see server/.env.example)' }));
}
// SUPABASE_URL set but not a real URL (the .env.example placeholder, a typo) is as good as missing.
if (env.SUPABASE_URL && !/^https?:\/\/[^<>\s]+$/.test(env.SUPABASE_URL)) {
  missing.push('SUPABASE_URL (malformed: ' + env.SUPABASE_URL + ')');
  console.error(JSON.stringify({ severity: 'ERROR', msg: 'SUPABASE_URL is not a valid URL: ' + env.SUPABASE_URL }));
}
export const MISSING = Object.freeze(missing);
// One place for the BigQuery credential rule so bigquery.js stays dumb.
if (!env.GCP_SA_JSON && !(env.GCP_SA_EMAIL && env.GCP_SA_PRIVATE_KEY)) {
  console.warn('[env] no BigQuery credential (GCP_SA_JSON or GCP_SA_EMAIL+GCP_SA_PRIVATE_KEY) — jobs that query RevHawk will fail at run time');
}
if (!env.GCP_JOB_PROJECT) env.GCP_JOB_PROJECT = env.REVHAWK_PROJECT_ID;

export const DRY_RUN = env.DRY_RUN === 'true';
export const isProd = env.NODE_ENV === 'production';
export default Object.freeze(env);
