// The three RevHawk pulls behind ops-stats, run in parallel. Timeclock and
// reviews are best-effort (a missing table or column skips that column of
// the sheet, exactly as before); appointments are not.
import { sql, getAccessToken, queryObjects } from '../../../config/bigquery.js';

const APPT_SQL   = sql(import.meta.url, 'fetchAppointments');
const CLOCK_SQL  = sql(import.meta.url, 'fetchTimeClock');
const REVIEW_SQL = sql(import.meta.url, 'fetchReviews');

export async function fetchOpsRows({ start, end, log }) {
  const token = await getAccessToken();
  const params = { start, end };
  const [appt, clock, reviews] = await Promise.all([
    queryObjects(token, APPT_SQL, params),
    queryObjects(token, CLOCK_SQL, params).catch(e => { log.warn('timeclock skipped: ' + e.message); return []; }),
    queryObjects(token, REVIEW_SQL, params).catch(e => { log.warn('reviews skipped: ' + e.message); return []; }),
  ]);
  return { appt, clock, reviews };
}
