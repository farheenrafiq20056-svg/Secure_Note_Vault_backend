-- ==============================================================================
-- ASSIGNMENT TASK 5: SQL Clause Precedence & Execution Order
-- Query demonstrating: WHERE, GROUP BY, HAVING, and ORDER BY
-- ==============================================================================

/**
 * SQL Execution Order vs Lexical Syntax Order:
 * 
 * Written Lexical Order:
 * 1. SELECT
 * 2. FROM / JOIN
 * 3. WHERE
 * 4. GROUP BY
 * 5. HAVING
 * 6. ORDER BY
 * 7. LIMIT / OFFSET
 * 
 * Logical / Query Engine Execution Order:
 * 1. FROM & JOIN     -> Identifies and combines target tables (Cartesian product / row filtering on ON conditions)
 * 2. WHERE           -> Filters individual source rows before aggregation
 * 3. GROUP BY        -> Partitions the filtered rows into distinct grouped subsets
 * 4. HAVING          -> Filters grouped rows based on aggregate metrics (e.g. COUNT, SUM, AVG)
 * 5. SELECT          -> Evaluates expressions, aliases, and selects the final column projections
 * 6. DISTINCT        -> Eliminates duplicate projected rows (if specified)
 * 7. ORDER BY        -> Sorts the resulting records (can use aliases defined in SELECT)
 * 8. LIMIT / OFFSET  -> Truncates the returned row set to the requested pagination slice
 */

-- Query: Find active users who have created more than 2 high-priority (favorite) notes in the last 30 days,
-- sorted by their total note count descending.
SELECT 
    u.id AS user_id,
    u.email,
    COUNT(n.id) AS favorite_note_count,
    MAX(n.created_at) AS last_note_created_at
FROM users u
INNER JOIN notes n ON u.id = n.user_id
-- [Step 2: WHERE] Filters rows prior to grouping (only favorite notes in past 30 days)
WHERE n.is_favorite = TRUE 
  AND n.created_at >= (CURRENT_TIMESTAMP - INTERVAL '30 days')
-- [Step 3: GROUP BY] Aggregates rows per distinct user
GROUP BY u.id, u.email
-- [Step 4: HAVING] Filters grouped buckets based on aggregate function
HAVING COUNT(n.id) >= 2
-- [Step 6: ORDER BY] Sorts final output
ORDER BY favorite_note_count DESC, last_note_created_at DESC
-- [Step 7: LIMIT] Returns top 10 users
LIMIT 10;
