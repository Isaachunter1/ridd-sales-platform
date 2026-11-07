-- The prices behind the open base-plan sales — pricing-floors (per Isaac, Nov 7 2026).
-- Params: @since ('YYYY-MM-DD') — the earliest sold date in the batch; the id list is
-- spliced in by the caller as {{IDS}} (digits only, quoted), the same way the sync does.
-- One row per subscription, latest warehouse copy. Only what the rules need: the plan
-- name, what the customer pays (initial + recurring), and the source (renewal or not).
SELECT
  s.fieldRoutes_subscriptionID                          AS subscription_id,
  s.fieldRoutes_serviceType                             AS subscription,
  SAFE_CAST(s.fieldRoutes_initialServiceTotal AS FLOAT64) AS initial_price,
  SAFE_CAST(s.fieldRoutes_recurringCharge AS FLOAT64)   AS recurring_charge,
  s.fieldRoutes_source                                  AS subscription_source,
  NULLIF(s.fieldRoutes_leadSource, '')                  AS lead_source,
  LEFT(s.fieldRoutes_dateAdded, 10)                     AS sold_date
FROM {{T:FieldRoutesSubscription}} s
WHERE s.fieldRoutes_subscriptionID IN ({{IDS}})
  AND LEFT(s.fieldRoutes_dateAdded, 10) >= @since
QUALIFY ROW_NUMBER() OVER (PARTITION BY s.fieldRoutes_subscriptionID ORDER BY s.updatedAt DESC) = 1
