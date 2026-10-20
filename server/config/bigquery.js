// BigQuery (RevHawk mirror) — READ-ONLY to every job.
//
// Ported from netlify/functions/revhawk-sync-background.js (_bq) with two
// changes in shape, none in behaviour:
//   1. SQL lives in a .sql file beside the function that runs it, loaded with
//      sql(import.meta.url, 'fetchAppointments'). Inside the file,
//      {{T:FieldRoutesAppointment}} expands to `project.dataset.FieldRoutesAppointment`.
//   2. Date ranges go in as NAMED PARAMETERS (@start, @end) instead of string
//      interpolation — same query plan, no quoting.
//
// The token exchange, the polling cap, the paging and the compact parse are
// the Netlify code verbatim; the comments naming the incidents came with them.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import env from './env.js';

export const PROJECT = env.REVHAWK_PROJECT_ID;     // DATA project (RevHawk's tables)
export const DATASET = env.REVHAWK_DATASET;
export const JOB_PROJECT = env.GCP_JOB_PROJECT;    // where the query runs + bills

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function getCreds() {
  if (env.GCP_SA_JSON && env.GCP_SA_JSON.trim()) {
    const o = JSON.parse(env.GCP_SA_JSON);
    return { email: o.client_email, key: o.private_key };
  }
  const key = (env.GCP_SA_PRIVATE_KEY || '').replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
  return { email: env.GCP_SA_EMAIL, key };
}

// Mint a Google OAuth access token from the service account (JWT bearer flow).
export async function getAccessToken() {
  const { email, key } = getCreds();
  if (!email || !key) throw new Error('Set GCP_SA_JSON (whole key file) OR GCP_SA_EMAIL + GCP_SA_PRIVATE_KEY');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/bigquery.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }));
  const input = `${header}.${claim}`;
  const sig = b64url(crypto.createSign('RSA-SHA256').update(input).sign(key));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${input}.${sig}`,
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error('token exchange failed: ' + JSON.stringify(j).slice(0, 300));
  return j.access_token;
}

// BigQuery returns every value as a string under row.f[i].v — coerce numeric
// columns back to JS numbers (or null) so results match what the app expects.
export function toObjects(schema, rows) {
  const numeric = schema.map((f) => f.type === 'INTEGER' || f.type === 'FLOAT' || f.type === 'NUMERIC');
  return (rows || []).map((row) => {
    const o = {};
    const cells = row.f || [];
    for (let i = 0; i < schema.length; i++) {
      const v = cells[i] ? cells[i].v : null;
      o[schema[i].name] = v == null ? null : (numeric[i] ? Number(v) : v);
    }
    return o;
  });
}

// Named parameters → BigQuery REST shape. Strings, numbers, booleans only;
// that is all the jobs need (dates travel as 'YYYY-MM-DD' strings and the
// SQL compares them to SUBSTR(...) exactly as it did before).
function toQueryParameters(params) {
  return Object.entries(params || {}).map(([name, value]) => {
    const type = typeof value === 'number' ? (Number.isInteger(value) ? 'INT64' : 'FLOAT64')
      : typeof value === 'boolean' ? 'BOOL' : 'STRING';
    return { name, parameterType: { type }, parameterValue: { value: String(value) } };
  });
}

// Run a query and page through every result row.
// opts.compact: parse each page into plain objects the moment it lands and
// drop the raw BigQuery page (Sep 18 2026 — the sync worker was OOM-killed
// holding ~105k raw {f:[{v}]} rows). opts.stage: optional progress callback.
export async function runQuery(token, sqlText, params = {}, opts = {}) {
  const compact = !!opts.compact;
  const stage = typeof opts.stage === 'function' ? opts.stage : null;
  const squash = (page, schema) => {
    const objs = toObjects(schema, page);
    for (const o of objs) for (const k of Object.keys(o)) if (o[k] === null || o[k] === undefined || o[k] === '') delete o[k];
    return objs;
  };
  const base = `https://bigquery.googleapis.com/bigquery/v2/projects/${JOB_PROJECT}`;
  const auth = { Authorization: `Bearer ${token}` };
  const body = { query: sqlText, useLegacySql: false, maxResults: 20000, timeoutMs: 60000 };
  const qp = toQueryParameters(params);
  if (qp.length) { body.parameterMode = 'NAMED'; body.queryParameters = qp; }
  let res = await fetch(`${base}/queries`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let j = await res.json();
  if (!res.ok) throw new Error('BigQuery query failed: ' + JSON.stringify(j.error || j).slice(0, 400));

  const jobId = j.jobReference.jobId;
  const location = j.jobReference.location || '';
  let schema = (j.schema && j.schema.fields) || [];
  let rows = j.rows || [];
  let pageToken = j.pageToken;

  // A job that sits PENDING (slot contention, a quota hold) used to spin until
  // the 15-minute kill with no error. Cap the wait and fail with the job id.
  if (stage) await stage('query-submitted:' + jobId);
  const pollStart = Date.now();
  let polls = 0;
  while (!j.jobComplete) {
    if (Date.now() - pollStart > 8 * 60000) throw new Error('BigQuery job ' + jobId + ' still not complete after 8 min (' + polls + ' polls) — check the job in the GCP console / quotas');
    await new Promise((r) => setTimeout(r, 1000));
    polls++;
    if (polls % 30 === 0 && stage) await stage('query-waiting:' + polls + 's:' + jobId);
    res = await fetch(`${base}/queries/${jobId}?location=${location}&maxResults=20000`, { headers: auth });
    j = await res.json();
    if (!res.ok) throw new Error('BigQuery getResults failed: ' + JSON.stringify(j.error || j).slice(0, 400));
    rows = j.rows || rows;
    schema = (j.schema && j.schema.fields) || schema;
    pageToken = j.pageToken;
  }
  if (stage) await stage('query-complete:paging');

  let out = compact ? squash(rows, schema) : rows;
  rows = null; j = null;
  let pages = 1;
  while (pageToken) {
    res = await fetch(`${base}/queries/${jobId}?location=${location}&maxResults=20000&pageToken=${encodeURIComponent(pageToken)}`, { headers: auth });
    const pj = await res.json();
    if (!res.ok) throw new Error('BigQuery paging failed: ' + JSON.stringify(pj.error || pj).slice(0, 400));
    const page = pj.rows || [];
    if (compact) { for (const o of squash(page, schema)) out.push(o); }
    else out = out.concat(page);
    pageToken = pj.pageToken;
    pages++;
    if (compact && stage) await stage('query-paging:' + pages + ':' + out.length + 'rows:' + Math.round(process.memoryUsage().rss / 1048576) + 'MB');
  }
  return compact ? { schema, objects: out } : { schema, rows: out };
}

// Plain-object rows — what every side job (ops-stats, tech-stats, …) wants.
export async function queryObjects(token, sqlText, params = {}, opts = {}) {
  const r = await runQuery(token, sqlText, params, { ...opts, compact: true });
  return (r && r.objects) || [];
}

// Load fetchX.sql from beside the calling fetchX.js and expand {{T:Table}}.
//   const APPT_SQL = sql(import.meta.url, 'fetchAppointments');
const T = (name) => '`' + PROJECT + '.' + DATASET + '.' + name + '`';
export function sql(importMetaUrl, name) {
  const dir = path.dirname(fileURLToPath(importMetaUrl));
  const text = fs.readFileSync(path.join(dir, name + '.sql'), 'utf8');
  return text.replace(/\{\{T:([A-Za-z0-9_]+)\}\}/g, (_, t) => T(t));
}

// One object the job wrapper hands to every job as ctx.bq.
export const bq = { getAccessToken, runQuery, queryObjects, toObjects, sql, PROJECT, DATASET, JOB_PROJECT };
