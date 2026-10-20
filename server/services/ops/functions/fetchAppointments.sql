-- Appointments per office × day for the OPS 26 sheet (ported verbatim from
-- ops-stats-background.js, Sep 2026). Params: @start, @end ('YYYY-MM-DD').
--
-- Rules baked in, and where each came from:
--   · service types only: Tech Follow Up, Meeting Day and uncategorised /
--     'General' types are not stops (per Isaac, Sep 2026)
--   · production = ticket productionValue, except the CRM's -1 sentinel, which
--     means "use subTotal" (the -1 production incident)
--   · reservices counted separately and excluded from production
--   · on-site minutes only when both check-in and check-out exist and are ordered
WITH a AS (
  SELECT rawImportedDataFromFieldsRoutesId AS import_id, fieldRoutes_appointmentID AS appt_id, fieldRoutes_routeID AS route_id,
         TRIM(fieldRoutes_type) AS type_id, SUBSTR(fieldRoutes_date, 1, 10) AS d, fieldRoutes_status AS st, fieldRoutes_officeID AS office_id,
         SAFE.PARSE_DATETIME('%Y-%m-%d %H:%M:%S', fieldRoutes_checkIn) AS cin, SAFE.PARSE_DATETIME('%Y-%m-%d %H:%M:%S', fieldRoutes_checkOut) AS cout
  FROM {{T:FieldRoutesAppointment}}
  WHERE SUBSTR(fieldRoutes_date, 1, 10) BETWEEN @start AND @end
),
s AS (
  SELECT TRIM(fieldRoutes_typeID) AS type_id, MAX(fieldRoutes_reservice) = '1' AS is_reservice, ANY_VALUE(fieldRoutes_description) AS name, ANY_VALUE(fieldRoutes_category) AS cat
  FROM {{T:FieldRoutesServiceType}} GROUP BY type_id
),
tix AS (
  SELECT fieldRoutes_appointmentID AS appt_id,
         SUM(CASE WHEN SAFE_CAST(fieldRoutes_productionValue AS FLOAT64) = -1 THEN SAFE_CAST(fieldRoutes_subTotal AS FLOAT64) ELSE SAFE_CAST(fieldRoutes_productionValue AS FLOAT64) END) AS production
  FROM {{T:FieldRoutesTicket}} WHERE fieldRoutes_templateType = 'NA' AND fieldRoutes_active != '-1' GROUP BY appt_id
),
j AS (
  SELECT a.*, s.name, s.is_reservice, COALESCE(x.production, 0) AS production,
         NOT (s.name IN ('Tech Follow Up', 'Meeting Day') OR s.cat IS NULL OR s.cat = '' OR s.cat = 'General') AS svc,
         CASE WHEN a.cin IS NOT NULL AND a.cout IS NOT NULL AND a.cout > a.cin THEN DATETIME_DIFF(a.cout, a.cin, MINUTE) ELSE NULL END AS mins
  FROM a LEFT JOIN s USING (type_id) LEFT JOIN tix x ON x.appt_id = a.appt_id
)
SELECT office_id, d,
  COUNTIF(st = '1' AND svc) AS done, COUNTIF(st != '-1' AND svc) AS sch,
  COUNTIF(st = '1' AND is_reservice) AS resvc,
  ROUND(SUM(IF(st = '1' AND svc AND NOT is_reservice, production, 0))) AS prod,
  COUNT(DISTINCT IF(st = '1' AND svc, route_id, NULL)) AS routes,
  SUM(IF(st = '1' AND svc, mins, NULL)) AS mins, COUNTIF(st = '1' AND svc AND mins IS NOT NULL) AS minsn,
  STRING_AGG(IF(st = '1' AND is_reservice, REGEXP_REPLACE(name, r'^Reservice\s*-\s*', ''), NULL), '|') AS rtypes
FROM j WHERE office_id IS NOT NULL GROUP BY office_id, d
