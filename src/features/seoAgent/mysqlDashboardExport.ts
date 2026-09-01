import { readFileSync } from "fs";
import { join } from "path";

export type SeoMysqlDashboardTables = {
  positionsWeekly: string;
  opportunities: string;
  tasks: string;
  weeklyRuns: string;
  sectionPatterns: string;
  aiVisibility: string;
  sovWeekly: string;
  advisoryJobs: string;
};

export type SeoMysqlDashboardExportConfig = {
  sourceKey: string;
  analyticsAccountId: string | number;
  ingestionRunId: string;
  tables: SeoMysqlDashboardTables;
  sectionPatterns: Array<{
    section: string;
    urlPattern: string;
    priority: number;
  }>;
};

export type SeoMysqlDashboardTask = {
  taskId: string;
  weekKey: string;
  clusterId: string;
  opportunityType: string;
  section?: string | null;
  status: "draft" | "awaiting_medical_review" | "needs_target_page" | "in_progress" | "done" | "cancelled";
  targetUrl?: string | null;
  notionUrl?: string | null;
  createdAt: string;
  updatedAt?: string | null;
};

export type SeoAiVisibilityRecord = {
  engine: string;
  period: string;
  mentions: number | null;
  citations: number | null;
  presenceRate: number | null;
  provenance: string;
  capturedAt: string;
  raw?: unknown;
};

export type SeoSovWeeklyRecord = {
  weekKey: string;
  snapshotDate: string;
  dateStart: string | null;
  dateEnd: string | null;
  cluster: string;
  queryCount: number;
  impressions: number;
  clicks: number;
  impressionSharePct: number;
  clickSharePct: number;
  ctrPct: number | null;
  averagePosition: number | null;
  isNoise: boolean;
  isMedical: boolean;
};

export type MysqlDashboardExportPlan = {
  sql: string;
  summary: {
    weekKey: string;
    positions: number;
    opportunities: number;
    tasks: number;
    weeklyRuns: number;
    sectionPatterns: number;
    aiVisibility: number;
    sovWeekly: number;
    advisoryJobs: number;
  };
};

export type MysqlDashboardExportExecutor = (sql: string) => Promise<void>;

export type MysqlDashboardExportResult = {
  status: "exported" | "export_pending";
  error: string | null;
  plan: MysqlDashboardExportPlan;
};

function repoRoot(): string {
  return join(__dirname, "../../..");
}

export function buildSeoMysqlDashboardDdl(_tables: SeoMysqlDashboardTables): string {
  return readFileSync(join(repoRoot(), "010_seo_os_v1.sql"), "utf8");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value: unknown): string | null {
  const cleaned = cleanString(value);
  return cleaned || null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function boolNumber(value: boolean): string {
  return value ? "1" : "0";
}

function confidenceToScore(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.min(100, Math.round(value)));
  if (value === "high") return 80;
  if (value === "medium") return 60;
  if (value === "low") return 40;
  return null;
}

function sqlString(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

function sqlNumber(value: number | string | null): string {
  if (value === null) return "NULL";
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? String(number) : "NULL";
}

function sqlJson(value: unknown): string {
  return sqlString(JSON.stringify(value ?? null));
}

function mysqlDateTime(value: unknown): string | null {
  const cleaned = cleanString(value);
  if (!cleaned) return null;
  const date = new Date(cleaned);
  if (Number.isNaN(date.getTime())) {
    return cleaned.replace("T", " ").replace(/\.\d{3}Z$/, "").replace(/Z$/, "");
  }
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function quoteIdent(name: string): string {
  const cleaned = cleanString(name);
  if (!/^[a-zA-Z0-9_]+$/.test(cleaned)) {
    throw new Error(`Unsafe MySQL identifier: ${name}`);
  }
  return `\`${cleaned}\``;
}

function sectionFromOpportunity(opportunity: Record<string, unknown>): string {
  for (const evidence of array(opportunity.evidence)) {
    const item = record(evidence);
    if (item.metric === "section") {
      return cleanString(item.value) || "/";
    }
  }
  return "/";
}

function pathFromUrl(value: unknown): string {
  const url = cleanString(value);
  if (!url) return "";
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function patternPrefix(pattern: string): string {
  return cleanString(pattern).replace(/%+$/g, "");
}

function sectionFromUrlPatterns(
  url: unknown,
  patterns: SeoMysqlDashboardExportConfig["sectionPatterns"]
): string {
  const path = pathFromUrl(url);
  if (!path) return "/";
  const matches = patterns
    .map((pattern) => ({
      section: pattern.section,
      prefix: patternPrefix(pattern.urlPattern),
      priority: pattern.priority,
    }))
    .filter((pattern) => pattern.prefix && path.startsWith(pattern.prefix))
    .sort((a, b) => {
      const lengthDiff = b.prefix.length - a.prefix.length;
      if (lengthDiff) return lengthDiff;
      return a.priority - b.priority;
    });
  return cleanString(matches[0]?.section) || "/";
}

function sectionForTask(
  task: SeoMysqlDashboardTask,
  opportunity: Record<string, unknown>,
  patterns: SeoMysqlDashboardExportConfig["sectionPatterns"]
): string {
  const explicit = cleanString(task.section);
  if (explicit && explicit !== "/") return explicit;
  const opportunitySection = sectionFromOpportunity(opportunity);
  if (opportunitySection && opportunitySection !== "/") return opportunitySection;
  return sectionFromUrlPatterns(task.targetUrl, patterns);
}

function clusterFromOpportunity(opportunity: Record<string, unknown>, index: number): string {
  const findingId = cleanString(opportunity.sourceFindingId);
  if (findingId.startsWith("rank_gap_")) return findingId.replace(/^rank_gap_/, "");
  return findingId || `opportunity_${index + 1}`;
}

function decisionByCluster(report: Record<string, unknown>): Map<string, Record<string, unknown>> {
  const decisions = array(record(record(report.layers).systemWork).decisions);
  const byCluster = new Map<string, Record<string, unknown>>();
  for (const decision of decisions) {
    const item = record(decision);
    const clusterId = cleanString(item.clusterId);
    if (clusterId) byCluster.set(clusterId, item);
  }
  return byCluster;
}

function opportunityByCluster(report: Record<string, unknown>): Map<string, Record<string, unknown>> {
  const opportunities = array(record(record(report.layers).systemWork).opportunities);
  const byCluster = new Map<string, Record<string, unknown>>();
  opportunities.forEach((value, index) => {
    const opportunity = record(value);
    const clusterId = clusterFromOpportunity(opportunity, index);
    if (clusterId) byCluster.set(clusterId, opportunity);
  });
  return byCluster;
}

function advisoryJobRows(input: {
  report: Record<string, unknown>;
  sourceKey: string;
  analyticsAccountId: string | number;
  runWeekKey: string;
  dataWeekKey: string;
  ingestionRunId: string;
  generatedAt: string | null;
}): string[][] {
  const weeklyArtifact = record(input.report.sourceWeeklyArtifact);
  const gapDigest = record(weeklyArtifact.gapDigestArtifact);
  const digest = record(gapDigest.digest);
  const messages = array(digest.messages);
  const digestItems = array(digest.items);
  const messageIds = array(weeklyArtifact.digestMessageIds);
  const chatId = nullableNumber(weeklyArtifact.digestChatId);
  if (chatId === null) return [];

  const opportunities = opportunityByCluster(input.report);
  return messages.flatMap((messageValue, index) => {
    const message = record(messageValue);
    const evidence = record(record(message.metadata).evidence);
    const opportunityId = cleanString(evidence.opportunityId);
    const clusterId = cleanString(evidence.clusterId);
    const messageId = nullableNumber(messageIds[index]);
    const opportunity = opportunities.get(clusterId) || {};
    if (!opportunityId || !clusterId || messageId === null) return [];
    return [[
      sqlString(input.sourceKey),
      sqlNumber(input.analyticsAccountId),
      sqlString(input.runWeekKey),
      sqlString(input.dataWeekKey),
      sqlString(opportunityId),
      sqlString(clusterId),
      sqlString(cleanString(opportunity.opportunityType) || cleanString(evidence.opportunityType) || "unknown"),
      sqlString("advisory_pending"),
      sqlJson(opportunity),
      sqlJson(digestItems[index] || null),
      sqlJson(message),
      sqlNumber(chatId),
      sqlNumber(messageId),
      sqlString(input.generatedAt),
      sqlString(input.ingestionRunId),
    ]];
  });
}

function taskStatus(value: unknown): SeoMysqlDashboardTask["status"] {
  if (
    value === "draft"
    || value === "awaiting_medical_review"
    || value === "needs_target_page"
    || value === "in_progress"
    || value === "done"
    || value === "cancelled"
  ) {
    return value;
  }
  return "draft";
}

function weekKeyFromRunId(value: unknown): string | null {
  const runId = cleanString(value);
  if (!runId.startsWith("seo_weekly_")) return null;
  return cleanString(runId.replace(/^seo_weekly_/, "")) || null;
}

function runWeekKeyFromReport(report: Record<string, unknown>, dataWeekKey: string): string {
  const window = record(report.window);
  const sourceWeeklyArtifact = record(report.sourceWeeklyArtifact);
  return (
    cleanString(report.runWeekKey)
    || cleanString(window.runWeekKey)
    || cleanString(sourceWeeklyArtifact.runWeekKey)
    || weekKeyFromRunId(report.runId)
    || dataWeekKey
  );
}

function tasksFromDecisionRecords(report: Record<string, unknown>): SeoMysqlDashboardTask[] {
  const weekKey = cleanString(report.weekKey);
  const opportunities = opportunityByCluster(report);
  const tasks: SeoMysqlDashboardTask[] = [];
  for (const decisionValue of array(record(record(report.layers).systemWork).decisions)) {
    const decision = record(decisionValue);
    const taskId = cleanString(decision.taskId);
    const clusterId = cleanString(decision.clusterId);
    if (!taskId || !clusterId) continue;
    const opportunity = opportunities.get(clusterId) || {};
    tasks.push({
      taskId,
      weekKey,
      clusterId,
      opportunityType:
        cleanString(decision.taskOpportunityType)
        || cleanString(opportunity.opportunityType)
        || cleanString(opportunity.type)
        || "unknown",
      section: sectionFromOpportunity(opportunity),
      status: taskStatus(decision.taskStatus),
      targetUrl: nullableString(decision.taskTargetUrl) || nullableString(opportunity.targetUrl),
      notionUrl: nullableString(decision.taskUrl),
      createdAt: cleanString(decision.taskCreatedAt) || cleanString(decision.decidedAt) || cleanString(report.generatedAt),
      updatedAt: cleanString(decision.taskUpdatedAt) || cleanString(report.generatedAt),
    });
  }
  return tasks;
}

function buildInsert(table: string, columns: string[], rows: string[][], updateColumns: string[]): string {
  if (!rows.length) return "";
  const columnSql = columns.map(quoteIdent).join(", ");
  const valuesSql = rows.map((row) => `(${row.join(", ")})`).join(",\n");
  const updateSql = updateColumns.map((column) => `${quoteIdent(column)} = VALUES(${quoteIdent(column)})`).join(", ");
  return `INSERT INTO ${quoteIdent(table)} (${columnSql}) VALUES\n${valuesSql}\nON DUPLICATE KEY UPDATE ${updateSql};`;
}

export function buildMysqlDashboardExportPlan(input: {
  report: unknown;
  tasks?: readonly SeoMysqlDashboardTask[];
  aiVisibilityRecords?: readonly SeoAiVisibilityRecord[];
  sovWeeklyRecords?: readonly SeoSovWeeklyRecord[];
  config: SeoMysqlDashboardExportConfig;
}): MysqlDashboardExportPlan {
  const report = record(input.report);
  const layers = record(report.layers);
  const positions = record(layers.positions);
  const systemWork = record(layers.systemWork);
  const weekKey = cleanString(report.weekKey);
  const runWeekKey = runWeekKeyFromReport(report, weekKey);
  const runId = cleanString(report.runId) || `seo_weekly_${weekKey}`;
  const generatedAt = mysqlDateTime(report.generatedAt);
  const analyticsAccountId = input.config.analyticsAccountId;
  const sourceKey = input.config.sourceKey;
  const ingestionRunId = input.config.ingestionRunId;
  const decisions = decisionByCluster(report);
  const dashboardTasks = input.tasks ?? tasksFromDecisionRecords(report);
  const opportunities = opportunityByCluster(report);
  const statements = [buildSeoMysqlDashboardDdl(input.config.tables)];

  const positionRows: string[][] = [];
  for (const sectionEntry of array(positions.sections)) {
    const section = record(sectionEntry);
    const sectionName = cleanString(section.section);
    for (const itemValue of array(section.items)) {
      const item = record(itemValue);
      const currentPosition = nullableNumber(item.currentPosition);
      const status = currentPosition === null ? "no_data" : "found";
      positionRows.push([
        sqlString(sourceKey),
        sqlNumber(analyticsAccountId),
        sqlString(weekKey),
        sqlString(sectionName),
        sqlString(item.clusterId),
        sqlString(item.query),
        sqlNumber(currentPosition),
        sqlString(nullableString(item.matchedUrl)),
        sqlNumber(nullableNumber(item.delta)),
        sqlString(nullableString(item.region)),
        sqlString(status),
        sqlString(generatedAt),
        sqlString(ingestionRunId),
      ]);
    }
  }
  statements.push(
    buildInsert(
      input.config.tables.positionsWeekly,
      [
        "source_key",
        "analytics_account_id",
        "week_key",
        "section",
        "cluster_id",
        "query",
        "serp_position",
        "matched_url",
        "delta_prev",
        "region",
        "status",
        "checked_at",
        "ingestion_run_id",
      ],
      positionRows,
      [
        "source_key",
        "section",
        "query",
        "serp_position",
        "matched_url",
        "delta_prev",
        "region",
        "status",
        "checked_at",
        "ingestion_run_id",
      ]
    )
  );

  const asyncAdvisoryRows = advisoryJobRows({
    report,
    sourceKey,
    analyticsAccountId,
    runWeekKey,
    dataWeekKey: weekKey,
    ingestionRunId,
    generatedAt,
  });
  statements.push(
    buildInsert(
      input.config.tables.advisoryJobs,
      [
        "source_key",
        "analytics_account_id",
        "run_week_key",
        "data_week_key",
        "opportunity_id",
        "cluster_id",
        "opportunity_type",
        "status",
        "opportunity_json",
        "digest_item_json",
        "original_message_json",
        "telegram_chat_id",
        "telegram_message_id",
        "requested_at",
        "ingestion_run_id",
      ],
      asyncAdvisoryRows,
      [
        "source_key",
        "data_week_key",
        "cluster_id",
        "opportunity_type",
        "opportunity_json",
        "digest_item_json",
        "original_message_json",
        "telegram_chat_id",
        "telegram_message_id",
        "ingestion_run_id",
      ]
    )
  );

  const opportunityRows: string[][] = [];
  array(systemWork.opportunities).forEach((value, index) => {
    const opportunity = record(value);
    const clusterId = clusterFromOpportunity(opportunity, index);
    const decision = decisions.get(clusterId);
    const decisionValue = cleanString(decision?.decision) || "pending";
    opportunityRows.push([
      sqlString(sourceKey),
      sqlNumber(analyticsAccountId),
      sqlString(weekKey),
      sqlString(clusterId),
      sqlString(cleanString(opportunity.opportunityType) || cleanString(opportunity.type) || "unknown"),
      sqlString(sectionFromOpportunity(opportunity)),
      sqlString(cleanString(opportunity.priority) || "medium"),
      sqlNumber(confidenceToScore(opportunity.confidence)),
      sqlString(nullableString(opportunity.targetUrl)),
      sqlString(decisionValue),
      sqlString(nullableString(decision?.rejectReason)),
      sqlString(mysqlDateTime(decision?.decidedAt)),
      sqlString(ingestionRunId),
    ]);
  });
  statements.push(
    buildInsert(
      input.config.tables.opportunities,
      [
        "source_key",
        "analytics_account_id",
        "week_key",
        "cluster_id",
        "opportunity_type",
        "section",
        "priority",
        "confidence",
        "target_url",
        "decision",
        "reject_reason",
        "decided_at",
        "ingestion_run_id",
      ],
      opportunityRows,
      ["source_key", "section", "priority", "confidence", "target_url", "decision", "reject_reason", "decided_at", "ingestion_run_id"]
    )
  );

  const taskRows = dashboardTasks.map((task) => [
    sqlString(task.taskId),
    sqlString(sourceKey),
    sqlNumber(analyticsAccountId),
    sqlString(task.weekKey),
    sqlString(task.clusterId),
    sqlString(task.opportunityType),
    sqlString(sectionForTask(task, opportunities.get(task.clusterId) || {}, input.config.sectionPatterns)),
    sqlString(task.status),
    sqlString(nullableString(task.targetUrl)),
    sqlString(nullableString(task.notionUrl)),
    sqlString(mysqlDateTime(task.createdAt)),
    sqlString(mysqlDateTime(task.updatedAt)),
    sqlString(ingestionRunId),
  ]);
  statements.push(
    buildInsert(
      input.config.tables.tasks,
      [
        "task_id",
        "source_key",
        "analytics_account_id",
        "week_key",
        "cluster_id",
        "opportunity_type",
        "section",
        "status",
        "target_url",
        "notion_url",
        "created_at",
        "updated_at",
        "ingestion_run_id",
      ],
      taskRows,
      ["source_key", "section", "status", "target_url", "notion_url", "updated_at", "ingestion_run_id"]
    )
  );

  const counters = record(record(report.sourceWeeklyArtifact).counters);
  const sideEffects = record(report.sideEffects);
  const weeklyRows = [[
    sqlString(sourceKey),
    sqlNumber(analyticsAccountId),
    sqlString(weekKey),
    sqlString(runWeekKey),
    sqlString(trackingSetChecksum(report)),
    sqlString(trackingSetCount(report)),
    sqlString(trackingSetSeedCount(report)),
    sqlString(trackingSetLiveCount(report)),
    sqlString(trackingSetSeedFallbackCount(report)),
    sqlJson(trackingSetSnapshot(report)),
    sqlString(cleanString(report.status) || "completed"),
    sqlJson(report.stages || record(report.sourceWeeklyArtifact).stages || []),
    sqlNumber(numberOrZero(counters.requestCount)),
    sqlNumber(numberOrZero(record(record(report.advisoryEnrichment).summary).totalTokens)),
    sqlNumber(numberOrZero(record(systemWork.summary).digestMessages)),
    sqlString(mysqlDateTime(report.startedAt)),
    sqlString(generatedAt),
    sqlString(ingestionRunId),
  ]];
  void sideEffects;
  statements.push(
    buildInsert(
      input.config.tables.weeklyRuns,
      [
        "source_key",
        "analytics_account_id",
        "week_key",
        "run_week_key",
        "tracking_set_checksum",
        "tracking_set_item_count",
        "tracking_set_seed_count",
        "tracking_set_live_count",
        "tracking_set_seed_fallback_count",
        "tracking_set_snapshot",
        "status",
        "stages_json",
        "serp_requests",
        "llm_tokens",
        "digest_count",
        "started_at",
        "finished_at",
        "ingestion_run_id",
      ],
      weeklyRows,
      [
        "source_key",
        "analytics_account_id",
        "week_key",
        "run_week_key",
        "tracking_set_checksum",
        "tracking_set_item_count",
        "tracking_set_seed_count",
        "tracking_set_live_count",
        "tracking_set_seed_fallback_count",
        "tracking_set_snapshot",
        "status",
        "stages_json",
        "serp_requests",
        "llm_tokens",
        "digest_count",
        "finished_at",
        "ingestion_run_id",
      ]
    )
  );

  const sectionPatternRows = input.config.sectionPatterns.map((pattern) => [
    sqlString(sourceKey),
    sqlNumber(analyticsAccountId),
    sqlString(pattern.section),
    sqlString(pattern.urlPattern),
    sqlNumber(pattern.priority),
  ]);
  statements.push(
    buildInsert(
      input.config.tables.sectionPatterns,
      ["source_key", "analytics_account_id", "section", "url_pattern", "priority"],
      sectionPatternRows,
      ["source_key", "priority"]
    )
  );

  const aiVisibilityRows = (input.aiVisibilityRecords || []).map((record) => [
    sqlString(sourceKey),
    sqlNumber(analyticsAccountId),
    sqlString(record.engine),
    sqlString(record.period),
    sqlNumber(record.mentions),
    sqlNumber(record.citations),
    sqlNumber(record.presenceRate),
    sqlString(record.provenance),
    sqlString(mysqlDateTime(record.capturedAt)),
    sqlJson(record.raw || null),
    sqlString(ingestionRunId),
  ]);
  statements.push(
    buildInsert(
      input.config.tables.aiVisibility,
      [
        "source_key",
        "analytics_account_id",
        "engine",
        "period",
        "mentions",
        "citations",
        "presence_rate",
        "provenance",
        "captured_at",
        "raw_json",
        "ingestion_run_id",
      ],
      aiVisibilityRows,
      ["source_key", "mentions", "citations", "presence_rate", "captured_at", "raw_json", "ingestion_run_id"]
    )
  );

  const sovWeeklyRows = (input.sovWeeklyRecords || []).map((record) => [
    sqlString(sourceKey),
    sqlNumber(analyticsAccountId),
    sqlString(record.weekKey),
    sqlString(record.snapshotDate),
    sqlString(record.dateStart),
    sqlString(record.dateEnd),
    sqlString(record.cluster),
    sqlNumber(record.queryCount),
    sqlNumber(record.impressions),
    sqlNumber(record.clicks),
    sqlNumber(record.impressionSharePct),
    sqlNumber(record.clickSharePct),
    sqlNumber(record.ctrPct),
    sqlNumber(record.averagePosition),
    boolNumber(record.isNoise),
    boolNumber(record.isMedical),
    sqlString(ingestionRunId),
  ]);
  statements.push(
    buildInsert(
      input.config.tables.sovWeekly,
      [
        "source_key",
        "analytics_account_id",
        "week_key",
        "snapshot_date",
        "date_start",
        "date_end",
        "cluster",
        "query_count",
        "impressions",
        "clicks",
        "impression_share_pct",
        "click_share_pct",
        "ctr_pct",
        "average_position",
        "is_noise",
        "is_medical",
        "ingestion_run_id",
      ],
      sovWeeklyRows,
      [
        "source_key",
        "snapshot_date",
        "date_start",
        "date_end",
        "query_count",
        "impressions",
        "clicks",
        "impression_share_pct",
        "click_share_pct",
        "ctr_pct",
        "average_position",
        "is_noise",
        "is_medical",
        "ingestion_run_id",
      ]
    )
  );

  return {
    sql: statements.filter(Boolean).join("\n\n"),
    summary: {
      weekKey,
      positions: positionRows.length,
      opportunities: opportunityRows.length,
      tasks: taskRows.length,
      weeklyRuns: weeklyRows.length,
      sectionPatterns: sectionPatternRows.length,
      aiVisibility: aiVisibilityRows.length,
      sovWeekly: sovWeeklyRows.length,
      advisoryJobs: asyncAdvisoryRows.length,
    },
  };
}

function trackingSetArtifact(value: unknown): Record<string, unknown> {
  const sourceWeeklyArtifact = record(record(value).sourceWeeklyArtifact);
  const rankTrackingArtifact = record(sourceWeeklyArtifact.rankTrackingArtifact);
  return rankTrackingArtifact.trackingSetVersion
    ? record(rankTrackingArtifact.trackingSetVersion)
    : rankTrackingArtifact;
}

function trackingSetChecksum(value: unknown): string | null {
  const checksum = cleanString(trackingSetArtifact(value).checksum);
  return checksum || null;
}

function trackingSetCount(value: unknown): number {
  const set = trackingSetArtifact(value);
  return numberOrZero(set.itemCount);
}

function trackingSetSeedCount(value: unknown): number {
  const set = trackingSetArtifact(value);
  return numberOrZero(set.seedDerivedCount);
}

function trackingSetLiveCount(value: unknown): number {
  const set = trackingSetArtifact(value);
  return numberOrZero(set.liveDerivedCount);
}

function trackingSetSeedFallbackCount(value: unknown): number {
  const set = trackingSetArtifact(value);
  return numberOrZero(set.seedFallbackCount);
}

function trackingSetSnapshot(value: unknown): unknown | null {
  const artifact = record(trackingSetArtifact(value));
  return Object.keys(artifact).length ? artifact : null;
}

const nonMedicalSovClusters = new Set(["medical_org_labs_noise", "other", "brand"]);

export function buildSovWeeklyRecordsFromYandexWmSnapshot(input: {
  snapshot: unknown;
  weekKey: string;
  snapshotDate: string;
}): SeoSovWeeklyRecord[] {
  const snapshot = record(input.snapshot);
  const totals = record(snapshot.totals);
  const dateRange = record(snapshot.dateRange);
  const totalImpressions = numberOrZero(totals.impressions);
  const totalClicks = numberOrZero(totals.clicks);
  const records = array(snapshot.clusters).map((value) => {
    const cluster = record(value);
    const clusterName = cleanString(cluster.cluster);
    return {
      weekKey: input.weekKey,
      snapshotDate: input.snapshotDate,
      dateStart: nullableString(dateRange.startDate),
      dateEnd: nullableString(dateRange.endDate),
      cluster: clusterName,
      queryCount: numberOrZero(cluster.queryCount),
      impressions: numberOrZero(cluster.impressions),
      clicks: numberOrZero(cluster.clicks),
      impressionSharePct: numberOrZero(cluster.impressionSharePct),
      clickSharePct: numberOrZero(cluster.clickSharePct),
      ctrPct: nullableNumber(cluster.ctrPct),
      averagePosition: nullableNumber(cluster.averagePosition),
      isNoise: clusterName === "medical_org_labs_noise",
      isMedical: Boolean(clusterName) && !nonMedicalSovClusters.has(clusterName),
    };
  });
  const medicalRecords = records.filter((item) => item.isMedical);
  const medicalImpressions = medicalRecords.reduce((sum, item) => sum + item.impressions, 0);
  const medicalClicks = medicalRecords.reduce((sum, item) => sum + item.clicks, 0);
  const medicalQueryCount = medicalRecords.reduce((sum, item) => sum + item.queryCount, 0);
  if (medicalRecords.length) {
    records.push({
      weekKey: input.weekKey,
      snapshotDate: input.snapshotDate,
      dateStart: nullableString(dateRange.startDate),
      dateEnd: nullableString(dateRange.endDate),
      cluster: "medical_intent_total",
      queryCount: medicalQueryCount,
      impressions: medicalImpressions,
      clicks: medicalClicks,
      impressionSharePct: totalImpressions ? Number(((medicalImpressions / totalImpressions) * 100).toFixed(2)) : 0,
      clickSharePct: totalClicks ? Number(((medicalClicks / totalClicks) * 100).toFixed(2)) : 0,
      ctrPct: medicalImpressions ? Number(((medicalClicks / medicalImpressions) * 100).toFixed(2)) : 0,
      averagePosition: null,
      isNoise: false,
      isMedical: true,
    });
  }
  return records;
}

export function buildAiVisibilityImportPlan(input: {
  records: readonly SeoAiVisibilityRecord[];
  config: SeoMysqlDashboardExportConfig;
}): MysqlDashboardExportPlan {
  const sourceKey = input.config.sourceKey;
  const analyticsAccountId = input.config.analyticsAccountId;
  const ingestionRunId = input.config.ingestionRunId;
  const rows = input.records.map((record) => [
    sqlString(sourceKey),
    sqlNumber(analyticsAccountId),
    sqlString(record.engine),
    sqlString(record.period),
    sqlNumber(record.mentions),
    sqlNumber(record.citations),
    sqlNumber(record.presenceRate),
    sqlString(record.provenance),
    sqlString(mysqlDateTime(record.capturedAt)),
    sqlJson(record.raw || null),
    sqlString(ingestionRunId),
  ]);
  return {
    sql: [
      buildSeoMysqlDashboardDdl(input.config.tables),
      buildInsert(
        input.config.tables.aiVisibility,
        [
          "source_key",
          "analytics_account_id",
          "engine",
          "period",
          "mentions",
          "citations",
          "presence_rate",
          "provenance",
          "captured_at",
          "raw_json",
          "ingestion_run_id",
        ],
        rows,
        ["source_key", "mentions", "citations", "presence_rate", "captured_at", "raw_json", "ingestion_run_id"]
      ),
    ].filter(Boolean).join("\n\n"),
    summary: {
      weekKey: "manual",
      positions: 0,
      opportunities: 0,
      tasks: 0,
      weeklyRuns: 0,
      sectionPatterns: 0,
      aiVisibility: rows.length,
      sovWeekly: 0,
      advisoryJobs: 0,
    },
  };
}

export function buildSovWeeklyExportPlan(input: {
  records: readonly SeoSovWeeklyRecord[];
  config: SeoMysqlDashboardExportConfig;
}): MysqlDashboardExportPlan {
  const sourceKey = input.config.sourceKey;
  const analyticsAccountId = input.config.analyticsAccountId;
  const ingestionRunId = input.config.ingestionRunId;
  const rows = input.records.map((record) => [
    sqlString(sourceKey),
    sqlNumber(analyticsAccountId),
    sqlString(record.weekKey),
    sqlString(record.snapshotDate),
    sqlString(record.dateStart),
    sqlString(record.dateEnd),
    sqlString(record.cluster),
    sqlNumber(record.queryCount),
    sqlNumber(record.impressions),
    sqlNumber(record.clicks),
    sqlNumber(record.impressionSharePct),
    sqlNumber(record.clickSharePct),
    sqlNumber(record.ctrPct),
    sqlNumber(record.averagePosition),
    boolNumber(record.isNoise),
    boolNumber(record.isMedical),
    sqlString(ingestionRunId),
  ]);
  return {
    sql: [
      buildSeoMysqlDashboardDdl(input.config.tables),
      buildInsert(
        input.config.tables.sovWeekly,
        [
          "source_key",
          "analytics_account_id",
          "week_key",
          "snapshot_date",
          "date_start",
          "date_end",
          "cluster",
          "query_count",
          "impressions",
          "clicks",
          "impression_share_pct",
          "click_share_pct",
          "ctr_pct",
          "average_position",
          "is_noise",
          "is_medical",
          "ingestion_run_id",
        ],
        rows,
        [
          "source_key",
          "snapshot_date",
          "date_start",
          "date_end",
          "query_count",
          "impressions",
          "clicks",
          "impression_share_pct",
          "click_share_pct",
          "ctr_pct",
          "average_position",
          "is_noise",
          "is_medical",
          "ingestion_run_id",
        ]
      ),
    ].filter(Boolean).join("\n\n"),
    summary: {
      weekKey: input.records[0]?.weekKey || "unknown",
      positions: 0,
      opportunities: 0,
      tasks: 0,
      weeklyRuns: 0,
      sectionPatterns: 0,
      aiVisibility: 0,
      sovWeekly: rows.length,
      advisoryJobs: 0,
    },
  };
}

export async function runMysqlDashboardExport(input: {
  report: unknown;
  tasks?: readonly SeoMysqlDashboardTask[];
  config: SeoMysqlDashboardExportConfig;
  executor: MysqlDashboardExportExecutor;
}): Promise<MysqlDashboardExportResult> {
  const plan = buildMysqlDashboardExportPlan(input);
  try {
    await input.executor(plan.sql);
    return { status: "exported", error: null, plan };
  } catch (error) {
    return { status: "export_pending", error: error instanceof Error ? error.message : String(error), plan };
  }
}
