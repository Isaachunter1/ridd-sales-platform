-- Customer notes for the Sales export (per Isaac, Nov 18 2026): what is going on with an account, in the office's
-- own words. Two kinds, newest first, capped per customer so a chatty account cannot blow the response up:
--   general — Notes (0), Salesman Notes (5), Red Note (8), Billing Notes (20), Subscription Notes (32)
--   cancel  — Cancellation Notes (7), Subscription Cancel (16), Cancel Request (18)
-- System traffic (SMS / email / hook logs) is never returned. @ids is a comma-joined list of customer ids; @each
-- is the cap per customer per kind.
WITH want AS (SELECT TRIM(id) AS cid FROM UNNEST(SPLIT(@ids, ',')) id WHERE TRIM(id) != ''),
n AS (
  SELECT n.fieldRoutes_customerID cid,
    CASE WHEN n.fieldRoutes_typeID IN ('7', '16', '18') THEN 'cancel' ELSE 'general' END kind,
    n.fieldRoutes_type type, n.fieldRoutes_date d, n.fieldRoutes_dateAdded added, n.fieldRoutes_employeeName who,
    n.fieldRoutes_cancellationReason reason, SUBSTR(TRIM(COALESCE(n.fieldRoutes_notes, '')), 1, 600) text
  FROM {{T:FieldRoutesNote}} n JOIN want w ON w.cid = n.fieldRoutes_customerID
  WHERE n.fieldRoutes_typeID IN ('0', '5', '8', '20', '32', '7', '16', '18')
    AND (TRIM(COALESCE(n.fieldRoutes_notes, '')) != '' OR COALESCE(n.fieldRoutes_cancellationReason, '') != '')
),
ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY cid, kind ORDER BY COALESCE(d, added) DESC, added DESC) rn FROM n)
SELECT cid, kind, type, COALESCE(d, added) d, who, reason, text FROM ranked WHERE rn <= @each ORDER BY cid, kind, d DESC
