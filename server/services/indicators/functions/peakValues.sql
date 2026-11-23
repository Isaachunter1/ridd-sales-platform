-- Peak values (per Isaac + CSO, Oct 15 2026; ported from netlify/functions/revhawk-sync-background.js, Nov 19):
-- every subscription whose initial service has been completed, with today's values and every change made to
-- its money fields AT OR AFTER the initial's completion (per Isaac, Nov 23: peak = the rep's contract just before
-- the initial was completed) — walked backwards in JS, each change's "old" restores the
-- earlier state. Only subscriptions that changed are returned; an untouched one is worth exactly what it is today.
--   done_at    = the initial's completion (first completed appointment on the subscription), 'YYYY-MM-DD HH:MM:SS'
--   at_        = when the change happened; k / o = the field and its value BEFORE the change
-- Keys: recurringCharge, annualRecurringServices, billingFrequency, initialQuote, initialDiscount — what the
-- subscription's value is made of. A re-delivered change (same changeID) counts once. Whatever history RevHawk
-- has is used (backfilled to 2026-01-01 as of Nov 2026); the earliest change on file is published with the map.
WITH done AS (
  SELECT fieldRoutes_subscriptionID AS sid, MIN(LEFT(fieldRoutes_dateCompleted, 19)) AS done_at
  FROM {{T:FieldRoutesAppointment}}
  WHERE fieldRoutes_statusText = 'Completed' AND fieldRoutes_dateCompleted NOT LIKE '0000%' AND fieldRoutes_dateCompleted != ''
    AND fieldRoutes_subscriptionID NOT IN ('', '0')
  GROUP BY 1
),
ch AS (
  SELECT c.referenceID AS sid, c.changeID AS cid_, LEFT(c.dateChanged, 19) AS at_, JSON_VALUE(e, '$.key') AS k, JSON_VALUE(e, '$.old') AS o
  FROM {{T:FieldRoutesChangelog}} c, UNNEST(JSON_QUERY_ARRAY(COALESCE(c.notesJson, SAFE.PARSE_JSON(c.notes)))) e
  JOIN done ON done.sid = c.referenceID
  WHERE c.classID = 7
    AND JSON_VALUE(e, '$.key') IN ('recurringCharge', 'annualRecurringServices', 'billingFrequency', 'initialQuote', 'initialDiscount')
    AND LEFT(c.dateChanged, 19) >= done.done_at
  QUALIFY ROW_NUMBER() OVER (PARTITION BY c.referenceID, c.changeID, JSON_VALUE(e, '$.key') ORDER BY c.ingestedAt DESC) = 1
),
sub AS (
  SELECT fieldRoutes_subscriptionID AS sid, fieldRoutes_customerID AS cust, fieldRoutes_serviceType AS svc,
    SAFE_CAST(fieldRoutes_recurringCharge AS FLOAT64) AS rec, SAFE_CAST(fieldRoutes_annualRecurringServices AS FLOAT64) AS ars,
    SAFE_CAST(fieldRoutes_billingFrequency AS FLOAT64) AS bf,
    SAFE_CAST(fieldRoutes_contractValue AS FLOAT64) AS cv, SAFE_CAST(fieldRoutes_initialServiceTotal AS FLOAT64) AS init,
    SAFE_CAST(fieldRoutes_initialQuote AS FLOAT64) AS iq, SAFE_CAST(fieldRoutes_initialDiscount AS FLOAT64) AS idisc
  FROM {{T:FieldRoutesSubscription}} WHERE fieldRoutes_subscriptionID IN (SELECT DISTINCT sid FROM ch)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY fieldRoutes_subscriptionID ORDER BY fieldRoutes_dateUpdated DESC, updatedAt DESC) = 1
)
SELECT sub.sid, sub.cust, sub.svc, sub.rec, sub.ars, sub.bf, sub.cv, sub.init, sub.iq, sub.idisc, done.done_at, ch.at_, ch.cid_, ch.k, ch.o
FROM ch JOIN sub USING (sid) JOIN done USING (sid)
ORDER BY sub.sid, ch.at_ DESC, ch.cid_ DESC
