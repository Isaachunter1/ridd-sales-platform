// Tiny JSON in the reporting bucket so the app's health sheet (which reads
// indicators/<name>-heartbeat.json today) keeps working unchanged until the
// browser reads job_runs instead. Best-effort; never fails a job.
import { supabase } from '../config/supabase.js';

export async function writeHeartbeat(file, obj) {
  try {
    await supabase.storage.from('reporting').upload(file,
      Buffer.from(JSON.stringify(Object.assign({ at: new Date().toISOString() }, obj))),
      { contentType: 'application/json', upsert: true });
  } catch (e) {
    console.warn(JSON.stringify({ severity: 'WARNING', msg: 'heartbeat write failed', file, error: String((e && e.message) || e) }));
  }
}
