-- What the database spent its time on during the load test (pg_stat_statements was reset
-- just before k6 started).
\pset footer off
\echo '== Top statements by total time'
SELECT round(total_exec_time::numeric) AS total_ms, calls, round(mean_exec_time::numeric, 2) AS mean_ms,
       round(max_exec_time::numeric, 1) AS max_ms, rows,
       left(regexp_replace(query, '\s+', ' ', 'g'), 160) AS statement
  FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 15;
\echo '== Slowest statements on average (called at least 20 times)'
SELECT round(mean_exec_time::numeric, 2) AS mean_ms, calls, round(total_exec_time::numeric) AS total_ms,
       left(regexp_replace(query, '\s+', ' ', 'g'), 160) AS statement
  FROM pg_stat_statements WHERE calls >= 20 ORDER BY mean_exec_time DESC LIMIT 10;
\echo '== Tables read by sequential scan (candidates for an index)'
SELECT relname, seq_scan, seq_tup_read, idx_scan, n_live_tup
  FROM pg_stat_user_tables WHERE seq_scan > 0 AND n_live_tup > 1000
 ORDER BY seq_tup_read DESC LIMIT 10;
\echo '== Locks, deadlocks and cache'
SELECT datname, xact_commit, xact_rollback, deadlocks, conflicts,
       round(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2) AS cache_hit_pct,
       temp_files, pg_size_pretty(temp_bytes) AS temp
  FROM pg_stat_database WHERE datname = current_database();
\echo '== Background jobs: notification outbox during the test'
SELECT count(*) AS events,
       count(*) FILTER (WHERE status = 'PROCESSED') AS processed,
       count(*) FILTER (WHERE status = 'PENDING') AS pending,
       round(EXTRACT(EPOCH FROM percentile_cont(0.5) WITHIN GROUP (ORDER BY processed_at - created_at))::numeric, 2) AS p50_s,
       round(EXTRACT(EPOCH FROM percentile_cont(0.95) WITHIN GROUP (ORDER BY processed_at - created_at))::numeric, 2) AS p95_s,
       round(EXTRACT(EPOCH FROM max(processed_at - created_at))::numeric, 2) AS max_s
  FROM notification_events WHERE created_at >= :'since';
\echo '== Orders placed during the test'
SELECT payment_method, status, count(*) FROM orders WHERE placed_at >= :'since' GROUP BY 1, 2 ORDER BY 1, 2;
