// GoHighLevel → "opportunity created" webhook (per Isaac, Nov 24 2026). Pest AI's workflow (trigger: Opportunity
// Created → action: Webhook, POST to /api/ghl-opp-webhook?key=<GHL_WEBHOOK_SECRET>) tells us the stage each card was
// born in, before a rep dispositions it. Traffic by hour reads calls vs forms vs AI calls from this.
// Stores ids, stage, source and times only — no names, phones or emails (the contacts sync already has those).
// Env: GHL_WEBHOOK_SECRET (required — without it every call is refused), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const pick = (...v) => { for (const x of v) if (x != null && String(x).trim() !== '') return String(x).trim(); return ''; };
function sameKey(a, b) { const A = Buffer.from(String(a || '')), B = Buffer.from(String(b || '')); return A.length === B.length && A.length > 0 && crypto.timingSafeEqual(A, B); }

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };
  const need = process.env.GHL_WEBHOOK_SECRET;
  const q = event.queryStringParameters || {}, h = event.headers || {};
  if (!need || !sameKey(q.key || h['x-ridd-key'] || '', need)) return { statusCode: 401, body: 'unauthorized' };
  let b = {};
  try { b = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : (event.body || '{}')); } catch (e) { return { statusCode: 400, body: 'bad json' }; }
  // GoHighLevel's workflow webhook sends contact + opportunity fields flat (some under `opportunity` / `contact`,
  // depending on the action) — read every spelling it has used, including its own "pipleline_stage" typo.
  const O = (b.opportunity && typeof b.opportunity === 'object') ? b.opportunity : {};
  const C = (b.contact && typeof b.contact === 'object') ? b.contact : {};
  const contactId = pick(b.contact_id, b.contactId, C.id, O.contactId);
  const oppId = pick(b.opportunity_id, b.opportunityId, O.id, b.pipeline_id || b.pipelineId || O.pipelineId ? b.id : '');
  const stageId = pick(b.pipeline_stage_id, b.pipelineStageId, b.stage_id, O.pipelineStageId, O.pipeline_stage_id);
  const stageName = pick(b.pipleline_stage, b.pipeline_stage, b.pipelineStage, b.stage_name, b.stage, O.pipeline_stage, O.stageName);
  const created = pick(b.date_created, b.dateCreated, b.createdAt, O.createdAt, O.dateAdded) || new Date().toISOString();
  const createdIso = isNaN(Date.parse(created)) ? new Date().toISOString() : new Date(Date.parse(created)).toISOString();
  const row = {
    opp_id: oppId || (contactId ? 'c:' + contactId + ':' + Date.parse(createdIso) : ''),
    contact_id: contactId || null, created_at: createdIso,
    stage_id: stageId || null, stage_name: stageName || null,
    pipeline_id: pick(b.pipeline_id, b.pipelineId, O.pipelineId) || null,
    source: pick(b.opportunity_source, b.opportunitySource, O.source, b.source) || null,
  };
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  // Shape check for setup: the top-level keys of the last payload (never values), so we can confirm the fields map.
  try { await sb.from('app_settings').upsert({ key: 'ghl_webhook_status', value: { at: new Date().toISOString(), keys: Object.keys(b).slice(0, 80), opportunityKeys: Object.keys(O).slice(0, 40), parsed: { oppId: !!oppId, contactId: !!contactId, stageId: !!stageId, stageName: !!stageName } } }, { onConflict: 'key' }); } catch (e) { /* best effort */ }
  if (!row.opp_id || (!row.stage_id && !row.stage_name)) return { statusCode: 202, body: 'received, but no opportunity id / stage in the payload' };
  const { error } = await sb.from('ghl_opp_created').upsert(row, { onConflict: 'opp_id', ignoreDuplicates: true });
  if (error) { console.error('[ghl-opp-webhook]', error.message); return { statusCode: 500, body: 'store failed' }; }
  return { statusCode: 200, body: 'ok' };
};
