-- LTV cohorts (per Isaac, Nov 18 2026): every residential customer by the month their FIRST recurring
-- subscription was added, grouped five ways, with collected revenue and survival by month since start.
--   grp_kind / grp_key:  all | office:<id> | seller:office|other | office_seller:<id>|office|other | source:<FieldRoutes source>
--   k = -1 row:      the cohort itself — n customers, sum of first-subscription contract value (ACV numerator)
--   k >= 0 rows:     rev = successful payments (status 1) dated k months after the start month, over the whole cohort;
--                    alive = customers still active at the END of month k (no cancel, or cancelled after it)
-- Residential only (commercialAccount != 1); recurring only (frequency not -1/0 — one-time services are not accounts);
-- seller = the FieldRoutes employee type of whoever sold the first subscription (0 = Office Staff, the marketing
-- dashboard's department; everything else = D2D, techs, house). Cohorts start 2021-01 (@start); k runs to @maxk.
WITH emp AS (
  SELECT fieldRoutes_employeeID eid, ANY_VALUE(fieldRoutes_type) t FROM {{T:FieldRoutesEmployee}} GROUP BY 1
),
subs AS (
  SELECT s.fieldRoutes_customerID cid, s.fieldRoutes_officeID off,
    PARSE_DATETIME('%Y-%m-%d %H:%M:%S', s.fieldRoutes_dateAdded) added,
    SAFE_CAST(s.fieldRoutes_contractValue AS FLOAT64) cv, s.fieldRoutes_active active,
    CASE WHEN s.fieldRoutes_dateCancelled IS NULL OR s.fieldRoutes_dateCancelled LIKE '0000%' THEN NULL
         ELSE PARSE_DATETIME('%Y-%m-%d %H:%M:%S', s.fieldRoutes_dateCancelled) END canc,
    IF(e.t = '0', 'office', 'other') seller, TRIM(COALESCE(s.fieldRoutes_source, '')) src
  FROM {{T:FieldRoutesSubscription}} s
  JOIN {{T:FieldRoutesCustomer}} c ON c.fieldRoutes_customerID = s.fieldRoutes_customerID
  LEFT JOIN emp e ON e.eid = s.fieldRoutes_soldBy
  WHERE c.fieldRoutes_commercialAccount != '1' AND s.fieldRoutes_frequency NOT IN ('-1', '0')
    AND s.fieldRoutes_dateAdded IS NOT NULL AND s.fieldRoutes_dateAdded NOT LIKE '0000%'
),
cust AS (
  SELECT cid,
    ARRAY_AGG(off ORDER BY added LIMIT 1)[OFFSET(0)] off,
    ARRAY_AGG(seller ORDER BY added LIMIT 1)[OFFSET(0)] seller,
    ARRAY_AGG(src ORDER BY added LIMIT 1)[OFFSET(0)] src,
    ARRAY_AGG(cv ORDER BY added LIMIT 1)[OFFSET(0)] first_cv,
    MIN(added) first_added,
    DATE_TRUNC(DATE(MIN(added)), MONTH) cohort,
    LOGICAL_OR(active = '1') alive_now,
    MAX(canc) last_canc
  FROM subs GROUP BY cid
  HAVING MIN(added) >= PARSE_DATETIME('%Y-%m-%d', @start)
),
bigsrc AS (   -- sources with enough customers to have a curve of their own; the rest roll into 'Other'
  SELECT src FROM cust GROUP BY src HAVING COUNT(*) >= 200
),
grp AS (   -- every customer in each of its groups
  SELECT c.*, g.grp_kind, g.grp_key FROM cust c LEFT JOIN bigsrc b ON b.src = c.src, UNNEST([
    STRUCT('all' AS grp_kind, 'all' AS grp_key),
    STRUCT('office', CAST(c.off AS STRING)),
    STRUCT('seller', c.seller),
    STRUCT('office_seller', CONCAT(CAST(c.off AS STRING), '|', c.seller)),
    STRUCT('source', CASE WHEN b.src IS NULL THEN 'Other' WHEN c.src = '' THEN '(blank)' ELSE c.src END)
  ]) g
),
pay AS (
  SELECT c.cid, DATE_DIFF(DATE(PARSE_DATETIME('%Y-%m-%d %H:%M:%S', p.fieldRoutes_date)), c.cohort, MONTH) k,
    SUM(SAFE_CAST(p.fieldRoutes_amount AS FLOAT64)) amt
  FROM {{T:FieldRoutesPayment}} p JOIN cust c ON c.cid = p.fieldRoutes_customerID
  WHERE p.fieldRoutes_status = '1' AND p.fieldRoutes_date IS NOT NULL AND p.fieldRoutes_date NOT LIKE '0000%'
  GROUP BY 1, 2
),
ks AS (SELECT k FROM UNNEST(GENERATE_ARRAY(0, @maxk)) k),
sizes AS (
  SELECT grp_kind, grp_key, FORMAT_DATE('%Y-%m', cohort) cohort, -1 AS k, COUNT(*) AS n, ROUND(SUM(COALESCE(first_cv, 0)), 2) AS rev, COUNTIF(alive_now) AS alive
  FROM grp GROUP BY 1, 2, 3
),
alive AS (   -- survivors at the end of month k: never cancelled (and active now), or cancelled after month k closed
  SELECT g.grp_kind, g.grp_key, FORMAT_DATE('%Y-%m', g.cohort) cohort, ks.k, COUNT(*) AS alive
  FROM grp g CROSS JOIN ks
  WHERE DATE_ADD(g.cohort, INTERVAL ks.k + 1 MONTH) <= CURRENT_DATE()
    AND ((g.alive_now AND g.last_canc IS NULL) OR g.alive_now OR (g.last_canc IS NOT NULL AND DATE(g.last_canc) >= DATE_ADD(g.cohort, INTERVAL ks.k + 1 MONTH)))
  GROUP BY 1, 2, 3, 4
),
rev AS (
  SELECT g.grp_kind, g.grp_key, FORMAT_DATE('%Y-%m', g.cohort) cohort, p.k, ROUND(SUM(p.amt), 2) AS rev
  FROM grp g JOIN pay p ON p.cid = g.cid
  WHERE p.k BETWEEN 0 AND @maxk GROUP BY 1, 2, 3, 4
)
SELECT grp_kind, grp_key, cohort, k, n, rev, alive FROM sizes
UNION ALL
SELECT COALESCE(a.grp_kind, r.grp_kind) grp_kind, COALESCE(a.grp_key, r.grp_key) grp_key, COALESCE(a.cohort, r.cohort) cohort, COALESCE(a.k, r.k) k,
  NULL AS n, r.rev, a.alive
FROM alive a FULL OUTER JOIN rev r ON a.grp_kind = r.grp_kind AND a.grp_key = r.grp_key AND a.cohort = r.cohort AND a.k = r.k
