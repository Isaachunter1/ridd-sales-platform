-- Contact details of every customer sold in the window — Account Integrity
-- duplicate and "rep's own contact" checks (per Isaac, Oct 20 + Oct 27).
-- Params: @start ('YYYY-MM-DD') — customers with a subscription sold on/after it.
--
--   · link_group: FieldRoutes' own link between properties of one customer —
--     masterAccount when set, else billToAccountID when it points elsewhere,
--     else the customer itself. Accounts in the same link_group are linked and
--     are never a duplicate of each other.
--   · the seller = soldBy on the customer's most recent subscription in the
--     window (leads and service rounds excluded).
--   · card = last four + expiry of the most recent card FieldRoutes saw; the full
--     number is never in the warehouse.
WITH subs AS (
  SELECT fieldRoutes_customerID AS customer_id, fieldRoutes_soldBy AS sold_by_id, SUBSTR(fieldRoutes_dateAdded, 1, 10) AS sold_on
  FROM {{T:FieldRoutesSubscription}}
  WHERE IFNULL(fieldRoutes_active, '') != '-3' AND IFNULL(fieldRoutes_parentID, '0') IN ('0', '')
    AND SUBSTR(fieldRoutes_dateAdded, 1, 10) >= @start
  QUALIFY ROW_NUMBER() OVER (PARTITION BY fieldRoutes_customerID ORDER BY fieldRoutes_dateAdded DESC) = 1
),
emp AS (
  SELECT fieldRoutes_employeeID AS id, ANY_VALUE(TRIM(CONCAT(IFNULL(fieldRoutes_fname, ''), ' ', IFNULL(fieldRoutes_lname, '')))) AS name
  FROM {{T:FieldRoutesEmployee}} GROUP BY id
)
SELECT c.fieldRoutes_customerID AS customer_id,
       COALESCE(NULLIF(NULLIF(c.fieldRoutes_masterAccount, ''), '0'),
                IF(IFNULL(c.fieldRoutes_billToAccountID, '0') NOT IN ('', '0', c.fieldRoutes_customerID), c.fieldRoutes_billToAccountID, NULL),
                c.fieldRoutes_customerID) AS link_group,
       TRIM(IFNULL(c.fieldRoutes_fname, '')) AS fname, TRIM(IFNULL(c.fieldRoutes_lname, '')) AS lname,
       c.fieldRoutes_officeID AS office_id, c.fieldRoutes_status AS status,
       c.fieldRoutes_phone1 AS phone1, c.fieldRoutes_phone2 AS phone2, c.fieldRoutes_email AS email,
       c.fieldRoutes_address AS address, c.fieldRoutes_zip AS zip,
       c.fieldRoutes_mostRecentCreditCardLastFour AS card_last4, c.fieldRoutes_mostRecentCreditCardExpirationDate AS card_exp,
       s.sold_on, s.sold_by_id, e.name AS sold_by_name
FROM {{T:FieldRoutesCustomer}} c
JOIN subs s ON s.customer_id = c.fieldRoutes_customerID
LEFT JOIN emp e ON e.id = s.sold_by_id
-- The customer table can hold more than one row per customer (one per sync split): keep the newest.
QUALIFY ROW_NUMBER() OVER (PARTITION BY c.fieldRoutes_customerID ORDER BY c.updatedAt DESC) = 1
