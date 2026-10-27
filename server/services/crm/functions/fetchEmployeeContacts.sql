-- Every employee's own phone and email — for "the rep's own contact info is on a
-- customer they sold" (per Isaac, Oct 20: 22 accounts on one rep's email).
-- One person can hold several FieldRoutes logins (one per office); the job
-- matches on the person's name as well as the login.
SELECT fieldRoutes_employeeID AS id, TRIM(CONCAT(IFNULL(fieldRoutes_fname, ''), ' ', IFNULL(fieldRoutes_lname, ''))) AS name,
       fieldRoutes_type AS type, fieldRoutes_phone AS phone, fieldRoutes_email AS email
FROM {{T:FieldRoutesEmployee}}
