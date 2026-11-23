-- Peak values (per Isaac + CSO, Oct 15 2026; definition set by Isaac Nov 23 2026 — see peakValues.js):
-- every 2026+ subscription with a change to its money fields, one row per (subscription, change, field), with
-- today's values, the selling rep, who made the change and the field's value before (o) and after (n).
-- Keys: recurringCharge, annualRecurringServices, billingFrequency, initialQuote, initialDiscount. A re-delivered
-- change (same changeID) counts once. History is whatever RevHawk has (backfilled to 2026-01-01 as of Nov 2026).
WITH ch AS (
  SELECT c.referenceID AS sid, c.changeID AS cid_, LEFT(c.dateChanged, 19) AS at_, c.employeeID AS emp,
    JSON_VALUE(e, '$.key') AS k, JSON_VALUE(e, '$.old') AS o, JSON_VALUE(e, '$.new') AS n
  FROM {{T:FieldRoutesChangelog}} c, UNNEST(JSON_QUERY_ARRAY(COALESCE(c.notesJson, SAFE.PARSE_JSON(c.notes)))) e
  WHERE c.classID = 7
    AND JSON_VALUE(e, '$.key') IN ('recurringCharge', 'annualRecurringServices', 'billingFrequency', 'initialQuote', 'initialDiscount')
  QUALIFY ROW_NUMBER() OVER (PARTITION BY c.referenceID, c.changeID, JSON_VALUE(e, '$.key') ORDER BY c.ingestedAt DESC) = 1
),
sub AS (
  SELECT fieldRoutes_subscriptionID AS sid, fieldRoutes_customerID AS cust, fieldRoutes_serviceType AS svc, fieldRoutes_soldBy AS rep,
    SAFE_CAST(fieldRoutes_recurringCharge AS FLOAT64) AS rec, SAFE_CAST(fieldRoutes_annualRecurringServices AS FLOAT64) AS ars,
    SAFE_CAST(fieldRoutes_billingFrequency AS FLOAT64) AS bf,
    SAFE_CAST(fieldRoutes_contractValue AS FLOAT64) AS cv, SAFE_CAST(fieldRoutes_initialServiceTotal AS FLOAT64) AS init,
    SAFE_CAST(fieldRoutes_initialQuote AS FLOAT64) AS iq, SAFE_CAST(fieldRoutes_initialDiscount AS FLOAT64) AS idisc
  FROM {{T:FieldRoutesSubscription}}
  WHERE fieldRoutes_subscriptionID IN (SELECT DISTINCT sid FROM ch) AND LEFT(fieldRoutes_dateAdded, 4) >= '2026'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY fieldRoutes_subscriptionID ORDER BY fieldRoutes_dateUpdated DESC, updatedAt DESC) = 1
)
SELECT sub.sid, sub.cust, sub.svc, sub.rep, sub.rec, sub.ars, sub.bf, sub.cv, sub.init, sub.iq, sub.idisc, ch.at_, ch.cid_, ch.emp, ch.k, ch.o, ch.n
FROM ch JOIN sub USING (sid)
ORDER BY sub.sid, ch.at_ DESC, ch.cid_ DESC
