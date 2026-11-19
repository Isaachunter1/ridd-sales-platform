// General + cancellation notes for a list of FieldRoutes customers (per Isaac, Nov 18 2026) — the Sales export's
// "what is going on with this account" columns. Pure plumbing around fetchCustomerNotes.sql; shapeNotes is the
// part a test can pin.
import { sql, getAccessToken, queryObjects } from '../../../config/bigquery.js';

const NOTES_SQL = sql(import.meta.url, 'fetchCustomerNotes');
export const NOTES_MAX_IDS = 400, NOTES_PER_KIND = 5;

export function shapeNotes(rows) {
  const notes = {};
  for (const r of rows || []) {
    if (!r || !r.cid) continue;
    const c = notes[r.cid] || (notes[r.cid] = { general: [], cancel: [] });
    const item = { d: String(r.d || '').slice(0, 10), type: r.type || '', who: r.who || '', text: r.text || '' };
    if (r.reason) item.reason = r.reason;
    (r.kind === 'cancel' ? c.cancel : c.general).push(item);
  }
  return notes;
}

export async function fetchCustomerNotes(ids) {
  const clean = [...new Set((ids || []).map(x => String(x || '').replace(/\D/g, '')).filter(Boolean))];
  if (!clean.length) return { notes: {}, count: 0 };
  if (clean.length > NOTES_MAX_IDS) throw Object.assign(new Error('Up to ' + NOTES_MAX_IDS + ' customers per request (got ' + clean.length + ').'), { status: 400 });
  const token = await getAccessToken();
  const rows = await queryObjects(token, NOTES_SQL, { ids: clean.join(','), each: NOTES_PER_KIND });
  const notes = shapeNotes(rows);
  return { notes, count: rows.length, customers: Object.keys(notes).length };
}
