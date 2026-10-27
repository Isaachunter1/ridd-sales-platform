-- Customer-record edits worth an audit look — Account Integrity (per Isaac, Oct 27).
-- Params: @start ('YYYY-MM-DD') — first day of the window.
--
-- Rules baked in, and where each came from:
--   · FieldRoutes change log, Customer record type (classID 8). RevHawk turned
--     it on in Oct 2026; history starts 2026-01-01. notesJson is either one
--     {key, old, new} object or an array of them — both shapes are unnested.
--   · Only edits of a value that already existed (old not blank / not 0).
--     Creating an account fills email, phone and name from blank — that is
--     setup, not an edit (first pass Oct 20: 64k "edits" were new accounts).
--   · aPay codes: 0 = off, 1 = credit card, 2 = ACH. "Autopay turned off" =
--     1 or 2 → 0. Autopay CARD swaps (autoPayPaymentProfileID) are NOT pulled:
--     swapping the card on file is normal (per Isaac, Oct 27).
--   · The sale an edit is measured against = the customer's most recent
--     subscription sold on or before the edit (leads excluded, service rounds
--     excluded), so "days after sale" and "edited by the seller" are honest
--     for a customer who bought twice.
WITH ch AS (
  SELECT referenceID AS customer_id, employeeID AS changed_by_id, dateChangedAt AS changed_at, notesJson AS j
  FROM {{T:FieldRoutesChangelog}}
  WHERE classID = 8 AND dateChangedDate >= DATE(@start)
),
e AS (
  SELECT customer_id, changed_by_id, changed_at, JSON_VALUE(x, '$.key') AS field,
         IFNULL(JSON_VALUE(x, '$.old'), '') AS old_value, IFNULL(JSON_VALUE(x, '$.new'), '') AS new_value
  FROM ch, UNNEST(IF(JSON_TYPE(j) = 'array', JSON_QUERY_ARRAY(j), [j])) AS x
),
cand AS (
  SELECT * FROM e
  WHERE old_value != new_value
    AND ((field IN ('email', 'phone1', 'phone2', 'fname', 'lname') AND TRIM(old_value) NOT IN ('', '0'))
      OR (field = 'aPay' AND old_value IN ('1', '2') AND new_value = '0'))
),
subs AS (
  SELECT fieldRoutes_customerID AS customer_id, SAFE.PARSE_DATETIME('%Y-%m-%d %H:%M:%S', fieldRoutes_dateAdded) AS sold_at, fieldRoutes_soldBy AS sold_by_id
  FROM {{T:FieldRoutesSubscription}}
  WHERE IFNULL(fieldRoutes_active, '') != '-3' AND IFNULL(fieldRoutes_parentID, '0') IN ('0', '')
),
withSale AS (
  SELECT c.*, s.sold_at, s.sold_by_id
  FROM cand c LEFT JOIN subs s ON s.customer_id = c.customer_id AND s.sold_at <= DATETIME(c.changed_at)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY c.customer_id, c.changed_at, c.field, c.old_value ORDER BY s.sold_at DESC) = 1
),
emp AS (
  SELECT fieldRoutes_employeeID AS id, ANY_VALUE(TRIM(CONCAT(IFNULL(fieldRoutes_fname, ''), ' ', IFNULL(fieldRoutes_lname, '')))) AS name
  FROM {{T:FieldRoutesEmployee}} GROUP BY id
),
cust AS (
  SELECT fieldRoutes_customerID AS customer_id, ANY_VALUE(TRIM(CONCAT(IFNULL(fieldRoutes_fname, ''), ' ', IFNULL(fieldRoutes_lname, '')))) AS customer_name,
         ANY_VALUE(fieldRoutes_officeID) AS office_id
  FROM {{T:FieldRoutesCustomer}} GROUP BY customer_id
)
SELECT w.customer_id, cu.customer_name, cu.office_id, w.field, w.old_value, w.new_value,
       FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', w.changed_at) AS changed_at,
       w.changed_by_id, ce.name AS changed_by_name,
       FORMAT_DATETIME('%Y-%m-%d', w.sold_at) AS sold_on, w.sold_by_id, se.name AS sold_by_name,
       IF(w.sold_at IS NULL, NULL, DATETIME_DIFF(DATETIME(w.changed_at), w.sold_at, DAY)) AS days_after_sale
FROM withSale w
LEFT JOIN cust cu ON cu.customer_id = w.customer_id
LEFT JOIN emp ce ON ce.id = w.changed_by_id
LEFT JOIN emp se ON se.id = w.sold_by_id
