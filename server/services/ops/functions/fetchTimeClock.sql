-- Technician time-clock hours per office × day: FieldRoutesTimeClock, paid
-- categories only, technicians only (employee type '1'); management hours
-- are entered by hand on the tab. Params: @start, @end.
SELECT t.fieldRoutes_officeID AS office_id, SUBSTR(t.fieldRoutes_timeIn, 1, 10) AS d,
  ROUND(SUM(TIMESTAMP_DIFF(SAFE.PARSE_TIMESTAMP('%Y-%m-%d %H:%M:%S', t.fieldRoutes_timeOut), SAFE.PARSE_TIMESTAMP('%Y-%m-%d %H:%M:%S', t.fieldRoutes_timeIn), MINUTE)) / 60, 2) AS hours,
  COUNT(DISTINCT t.fieldRoutes_employeeID) AS people
FROM {{T:FieldRoutesTimeClock}} t
LEFT JOIN (SELECT fieldRoutes_employeeID AS eid, ANY_VALUE(fieldRoutes_type) AS etype FROM {{T:FieldRoutesEmployee}} GROUP BY 1) e ON e.eid = t.fieldRoutes_employeeID
WHERE SUBSTR(t.fieldRoutes_timeIn, 1, 10) BETWEEN @start AND @end AND t.fieldRoutes_paid = '1' AND e.etype = '1'
  AND t.fieldRoutes_timeOut IS NOT NULL AND t.fieldRoutes_timeOut != ''
GROUP BY 1, 2
