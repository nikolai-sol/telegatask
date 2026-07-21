-- ============================================================
-- 010_seo_os_v1.sql
-- SEO OS read-model tables for ReportingDash MySQL
-- Style: canonical_* conventions (source_key, analytics_account_id, ingestion_run_id)
-- Write path: SEO OS exporter only (one-directional, idempotent upserts)
-- zaruku analytics_account_id (Metrika counter): 66624469
-- ============================================================

-- 1. Section dictionary: single source of section definitions (Chapter 6.2)
--    Lets the dashboard aggregate canonical_fact_site_analytics_daily (scope='page')
--    into the same sections SEO OS uses.
CREATE TABLE IF NOT EXISTS seo_section_patterns (
  id                     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_key             VARCHAR(64)  NOT NULL,
  analytics_account_id   BIGINT       NOT NULL,
  section                VARCHAR(128) NOT NULL,
  url_pattern            VARCHAR(255) NOT NULL,        -- e.g. '/melanoma/'
  priority               TINYINT      NOT NULL DEFAULT 3,  -- 1 = highest (Ch. 6.2)
  updated_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                         ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_section_pattern (analytics_account_id, section, url_pattern)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Weekly SERP positions per tracked cluster (RankHistory read model)
CREATE TABLE IF NOT EXISTS seo_positions_weekly (
  id                     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_key             VARCHAR(64)  NOT NULL,
  analytics_account_id   BIGINT       NOT NULL,
  week_key               CHAR(8)      NOT NULL,        -- ISO week, e.g. '2026-W28'
  section                VARCHAR(128) NOT NULL,
  cluster_id             VARCHAR(128) NOT NULL,
  query                  VARCHAR(512) NOT NULL,
  serp_position          DECIMAL(6,2) NULL,            -- NULL when not found
  matched_url            VARCHAR(1024) NULL,
  delta_prev             DECIMAL(6,2) NULL,            -- smoothed, per TASK-047 rules
  status                 ENUM('found','no_data') NOT NULL,
  checked_at             DATETIME     NULL,
  ingestion_run_id       VARCHAR(64)  NOT NULL,
  UNIQUE KEY uq_position (analytics_account_id, week_key, cluster_id),
  KEY idx_section_week   (section, week_key),
  KEY idx_week           (week_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Opportunities + human decisions per week
CREATE TABLE IF NOT EXISTS seo_opportunities (
  id                     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_key             VARCHAR(64)  NOT NULL,
  analytics_account_id   BIGINT       NOT NULL,
  week_key               CHAR(8)      NOT NULL,
  cluster_id             VARCHAR(128) NOT NULL,
  opportunity_type       VARCHAR(64)  NOT NULL,        -- ranking / ctr / section_ranking_gap / ...
  section                VARCHAR(128) NOT NULL,
  priority               VARCHAR(16)  NOT NULL,        -- high / medium / low
  confidence             TINYINT      NULL,            -- 0-100
  target_url             VARCHAR(1024) NULL,           -- NULL = new-content candidate
  decision               ENUM('pending','approved','rejected','carried_over') NOT NULL DEFAULT 'pending',
  reject_reason          VARCHAR(512) NULL,
  decided_at             DATETIME     NULL,
  ingestion_run_id       VARCHAR(64)  NOT NULL,
  UNIQUE KEY uq_opp (analytics_account_id, week_key, cluster_id, opportunity_type),
  KEY idx_decision (decision, week_key),
  KEY idx_section_week (section, week_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. Draft tasks created from approved decisions (producer: TASK-053; empty until then)
CREATE TABLE IF NOT EXISTS seo_tasks (
  task_id                VARCHAR(64)  NOT NULL PRIMARY KEY,   -- SEO OS task id
  source_key             VARCHAR(64)  NOT NULL,
  analytics_account_id   BIGINT       NOT NULL,
  week_key               CHAR(8)      NOT NULL,
  cluster_id             VARCHAR(128) NOT NULL,
  opportunity_type       VARCHAR(64)  NOT NULL,
  section                VARCHAR(128) NOT NULL DEFAULT '/',
  status                 ENUM('draft','awaiting_medical_review','needs_target_page','in_progress','done','cancelled')
                         NOT NULL DEFAULT 'draft',
  target_url             VARCHAR(1024) NULL,
  notion_url             VARCHAR(512) NULL,
  created_at             DATETIME     NOT NULL,
  updated_at             DATETIME     NULL,
  ingestion_run_id       VARCHAR(64)  NOT NULL,
  KEY idx_status (status),
  KEY idx_week (week_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @seo_tasks_section_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'seo_tasks'
    AND COLUMN_NAME = 'section'
);
SET @seo_tasks_section_sql := IF(
  @seo_tasks_section_exists = 0,
  'ALTER TABLE seo_tasks ADD COLUMN section VARCHAR(128) NOT NULL DEFAULT ''/'' AFTER opportunity_type',
  'SELECT 1'
);
PREPARE seo_tasks_section_stmt FROM @seo_tasks_section_sql;
EXECUTE seo_tasks_section_stmt;
DEALLOCATE PREPARE seo_tasks_section_stmt;

ALTER TABLE seo_tasks
  MODIFY status ENUM('draft','awaiting_medical_review','needs_target_page','in_progress','done','cancelled')
  NOT NULL DEFAULT 'draft';

-- 5. Weekly run telemetry (rhythm health for the ops panel)
CREATE TABLE IF NOT EXISTS seo_weekly_runs (
  id                     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_key             VARCHAR(64)  NOT NULL,
  analytics_account_id   BIGINT       NOT NULL,
  week_key               CHAR(8)      NOT NULL,        -- data week, e.g. '2026-W29'
  run_week_key           CHAR(8)      NOT NULL,        -- scheduler/run week, e.g. '2026-W30'
  status                 ENUM('completed','failed','noop') NOT NULL,
  stages_json            JSON         NULL,
  serp_requests          INT UNSIGNED NOT NULL DEFAULT 0,
  llm_tokens             INT UNSIGNED NOT NULL DEFAULT 0,
  digest_count           INT UNSIGNED NOT NULL DEFAULT 0,
  started_at             DATETIME     NULL,
  finished_at            DATETIME     NULL,
  ingestion_run_id       VARCHAR(64)  NOT NULL,
  UNIQUE KEY uq_run (analytics_account_id, run_week_key),
  KEY idx_run_data_week (week_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @seo_weekly_runs_run_week_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'seo_weekly_runs'
    AND COLUMN_NAME = 'run_week_key'
);
SET @seo_weekly_runs_run_week_sql := IF(
  @seo_weekly_runs_run_week_exists = 0,
  'ALTER TABLE seo_weekly_runs ADD COLUMN run_week_key CHAR(8) NULL AFTER week_key',
  'SELECT 1'
);
PREPARE seo_weekly_runs_run_week_stmt FROM @seo_weekly_runs_run_week_sql;
EXECUTE seo_weekly_runs_run_week_stmt;
DEALLOCATE PREPARE seo_weekly_runs_run_week_stmt;

UPDATE seo_weekly_runs
SET run_week_key = week_key
WHERE run_week_key IS NULL OR run_week_key = '';

SET @seo_weekly_runs_run_week_nullable := (
  SELECT IS_NULLABLE
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'seo_weekly_runs'
    AND COLUMN_NAME = 'run_week_key'
  LIMIT 1
);
SET @seo_weekly_runs_run_week_not_null_sql := IF(
  @seo_weekly_runs_run_week_nullable = 'YES',
  'ALTER TABLE seo_weekly_runs MODIFY run_week_key CHAR(8) NOT NULL',
  'SELECT 1'
);
PREPARE seo_weekly_runs_run_week_not_null_stmt FROM @seo_weekly_runs_run_week_not_null_sql;
EXECUTE seo_weekly_runs_run_week_not_null_stmt;
DEALLOCATE PREPARE seo_weekly_runs_run_week_not_null_stmt;

SET @seo_weekly_runs_uq_run_columns := (
  SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'seo_weekly_runs'
    AND INDEX_NAME = 'uq_run'
);
SET @seo_weekly_runs_drop_uq_run_sql := IF(
  @seo_weekly_runs_uq_run_columns IS NOT NULL
    AND @seo_weekly_runs_uq_run_columns <> 'analytics_account_id,run_week_key',
  'ALTER TABLE seo_weekly_runs DROP INDEX uq_run',
  'SELECT 1'
);
PREPARE seo_weekly_runs_drop_uq_run_stmt FROM @seo_weekly_runs_drop_uq_run_sql;
EXECUTE seo_weekly_runs_drop_uq_run_stmt;
DEALLOCATE PREPARE seo_weekly_runs_drop_uq_run_stmt;

SET @seo_weekly_runs_uq_run_columns_after_drop := (
  SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'seo_weekly_runs'
    AND INDEX_NAME = 'uq_run'
);
SET @seo_weekly_runs_add_uq_run_sql := IF(
  @seo_weekly_runs_uq_run_columns_after_drop IS NULL,
  'ALTER TABLE seo_weekly_runs ADD UNIQUE KEY uq_run (analytics_account_id, run_week_key)',
  'SELECT 1'
);
PREPARE seo_weekly_runs_add_uq_run_stmt FROM @seo_weekly_runs_add_uq_run_sql;
EXECUTE seo_weekly_runs_add_uq_run_stmt;
DEALLOCATE PREPARE seo_weekly_runs_add_uq_run_stmt;

SET @seo_weekly_runs_data_week_idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'seo_weekly_runs'
    AND INDEX_NAME = 'idx_run_data_week'
);
SET @seo_weekly_runs_data_week_idx_sql := IF(
  @seo_weekly_runs_data_week_idx_exists = 0,
  'ALTER TABLE seo_weekly_runs ADD KEY idx_run_data_week (week_key)',
  'SELECT 1'
);
PREPARE seo_weekly_runs_data_week_idx_stmt FROM @seo_weekly_runs_data_week_idx_sql;
EXECUTE seo_weekly_runs_data_week_idx_stmt;
DEALLOCATE PREPARE seo_weekly_runs_data_week_idx_stmt;

-- 6. AI visibility snapshots (manual WM Alisa SoV now; vendor/imports later)
CREATE TABLE IF NOT EXISTS seo_ai_visibility (
  id                     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_key             VARCHAR(64)  NOT NULL,
  analytics_account_id   BIGINT       NOT NULL,
  engine                 VARCHAR(64)  NOT NULL,        -- alisa_ai / google_aio / manual_probe surface
  period                 VARCHAR(32)  NOT NULL,        -- e.g. '2026-07'
  mentions               INT UNSIGNED NULL,
  citations              INT UNSIGNED NULL,
  presence_rate          DECIMAL(8,4) NULL,            -- 0..1 rate, not percentage
  provenance             VARCHAR(64)  NOT NULL,        -- wm_alisa_manual / manual_probe / vendor
  captured_at            DATETIME     NULL,
  raw_json               JSON         NULL,
  ingestion_run_id       VARCHAR(64)  NOT NULL,
  UNIQUE KEY uq_ai_visibility (analytics_account_id, engine, period, provenance),
  KEY idx_ai_period (period, engine)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. Weekly intra-host query SoV from Yandex Webmaster popular queries
CREATE TABLE IF NOT EXISTS seo_sov_weekly (
  id                     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_key             VARCHAR(64)  NOT NULL,
  analytics_account_id   BIGINT       NOT NULL,
  week_key               CHAR(8)      NOT NULL,
  snapshot_date          DATE         NOT NULL,
  date_start             DATE         NULL,
  date_end               DATE         NULL,
  cluster                VARCHAR(128) NOT NULL,
  query_count            INT UNSIGNED NOT NULL DEFAULT 0,
  impressions            INT UNSIGNED NOT NULL DEFAULT 0,
  clicks                 INT UNSIGNED NOT NULL DEFAULT 0,
  impression_share_pct   DECIMAL(8,2) NOT NULL DEFAULT 0,
  click_share_pct        DECIMAL(8,2) NOT NULL DEFAULT 0,
  ctr_pct                DECIMAL(8,2) NULL,
  average_position       DECIMAL(8,2) NULL,
  is_noise               TINYINT(1)   NOT NULL DEFAULT 0,
  is_medical             TINYINT(1)   NOT NULL DEFAULT 0,
  ingestion_run_id       VARCHAR(64)  NOT NULL,
  UNIQUE KEY uq_sov_weekly (analytics_account_id, week_key, cluster),
  KEY idx_sov_cluster (cluster, week_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 8. Async Hermes enrichment queue/state (producer: weekly exporter; consumer: Mac worker)
CREATE TABLE IF NOT EXISTS seo_advisory_jobs (
  id                     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_key             VARCHAR(64)  NOT NULL,
  analytics_account_id   BIGINT       NOT NULL,
  run_week_key           CHAR(8)      NOT NULL,
  data_week_key          CHAR(8)      NOT NULL,
  opportunity_id         VARCHAR(128) NOT NULL,
  cluster_id             VARCHAR(128) NOT NULL,
  opportunity_type       VARCHAR(64)  NOT NULL,
  status                 ENUM('advisory_pending','advisory_ready','advisory_skipped')
                         NOT NULL DEFAULT 'advisory_pending',
  opportunity_json       JSON         NOT NULL,
  digest_item_json       JSON         NULL,
  original_message_json  JSON         NOT NULL,
  telegram_chat_id       BIGINT       NOT NULL,
  telegram_message_id    BIGINT       NOT NULL,
  requested_at           DATETIME     NOT NULL,
  advisory_json          JSON         NULL,
  advisory_text          TEXT         NULL,
  input_tokens           INT UNSIGNED NOT NULL DEFAULT 0,
  output_tokens          INT UNSIGNED NOT NULL DEFAULT 0,
  total_tokens           INT UNSIGNED NOT NULL DEFAULT 0,
  attempt_count          INT UNSIGNED NOT NULL DEFAULT 0,
  last_attempt_at        DATETIME     NULL,
  last_error             VARCHAR(1024) NULL,
  ready_at               DATETIME     NULL,
  skipped_at             DATETIME     NULL,
  skip_reason            VARCHAR(255) NULL,
  telegram_edited_at     DATETIME     NULL,
  ingestion_run_id       VARCHAR(64)  NOT NULL,
  created_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_advisory_job (analytics_account_id, run_week_key, opportunity_id),
  KEY idx_advisory_work (status, run_week_key, requested_at),
  KEY idx_advisory_message (telegram_chat_id, telegram_message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- Example dashboard queries (Python side)
-- ============================================================

-- A. Position trend per section (was/became line chart)
-- SELECT week_key, section,
--        AVG(serp_position) AS avg_pos,
--        SUM(status='found') AS found_clusters,
--        COUNT(*) AS tracked_clusters
-- FROM seo_positions_weekly
-- WHERE analytics_account_id = 66624469
-- GROUP BY week_key, section
-- ORDER BY week_key;

-- B. Opportunity funnel for a week
-- SELECT decision, COUNT(*) FROM seo_opportunities
-- WHERE analytics_account_id = 66624469 AND week_key = '2026-W28'
-- GROUP BY decision;

-- C. SEO sections joined with Metrika traffic (one section definition)
-- SELECT sp.section, f.report_date, SUM(f.visits) AS visits
-- FROM canonical_fact_site_analytics_daily f
-- JOIN seo_section_patterns sp
--   ON f.analytics_account_id = sp.analytics_account_id
--  AND f.analytics_scope = 'page'
--  AND f.page_url LIKE CONCAT('%', sp.url_pattern, '%')
-- WHERE f.analytics_account_id = 66624469
-- GROUP BY sp.section, f.report_date;
