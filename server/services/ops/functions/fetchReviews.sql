-- FieldRoutes reviews per office × day (Google reviews are entered by hand).
-- Params: @start, @end.
SELECT fieldRoutes_officeIDs AS office_id, SUBSTR(fieldRoutes_date, 1, 10) AS d, COUNT(*) AS n, COUNTIF(SAFE_CAST(fieldRoutes_starRating AS INT64) >= 4) AS good
FROM {{T:FieldRoutesReview}} WHERE SUBSTR(fieldRoutes_date, 1, 10) BETWEEN @start AND @end GROUP BY 1, 2
