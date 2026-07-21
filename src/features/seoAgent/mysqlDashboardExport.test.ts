import { describe, expect, test } from "vitest";
import {
  buildAiVisibilityImportPlan,
  buildMysqlDashboardExportPlan,
  buildSeoMysqlDashboardDdl,
  buildSovWeeklyRecordsFromYandexWmSnapshot,
  runMysqlDashboardExport,
  type MysqlDashboardExportExecutor,
} from "./mysqlDashboardExport";
import yandexWmSovSnapshot from "./fixtures/mysqlDashboardExport/yandexWmSovSnapshot.json";

const reportFixture = {
  schemaVersion: "seo_os_global_report_v1",
  generatedAt: "2026-07-12T00:00:00.000Z",
  weekKey: "2026-W28",
  runWeekKey: "2026-W29",
  dataWeekKey: "2026-W28",
  runId: "seo_weekly_2026-W28",
  startedAt: "2026-07-12T00:00:01.000Z",
  stages: [
    { stage: "tracking_list", status: "completed" },
    { stage: "rank_tracking", status: "completed" },
  ],
  advisoryEnrichment: {
    summary: {
      totalTokens: 321,
    },
  },
  sourceWeeklyArtifact: {
    counters: {
      requestCount: 23,
      digestMessages: 3,
    },
    stages: [
      { stage: "tracking_list", status: "completed" },
      { stage: "rank_tracking", status: "completed" },
    ],
    digestChatId: -1001234567890,
    digestMessageIds: [4321],
    gapDigestArtifact: {
      digest: {
        messages: [
          {
            text: "SEO-кандидат #1\nЧто сделать: обновить страницу",
            buttons: [[{ text: "Одобрить", callbackData: "s:ap:v1:team:run:w481" }]],
            metadata: {
              evidence: {
                opportunityId: "seo_opp_1",
                clusterId: "query_cluster_004",
              },
            },
          },
        ],
      },
    },
  },
  layers: {
    positions: {
      sections: [
        {
          section: "/melanoma/",
          items: [
            {
              clusterId: "query_cluster_004",
              query: "меланома ногтя фото",
              currentPosition: 19,
              delta: -1,
              deltaStatus: "ok",
              matchedUrl: "https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/",
            },
            {
              clusterId: "seed_melanoma_podnogtevaya",
              query: "подногтевая меланома фото",
              currentPosition: null,
              delta: null,
              deltaStatus: "no_data",
              matchedUrl: null,
            },
          ],
        },
      ],
    },
    systemWork: {
      summary: {
        digestMessages: 3,
      },
      opportunities: [
        {
          opportunityType: "section_ranking_gap",
          priority: "high",
          confidence: "medium",
          targetUrl: "https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/",
          sourceFindingId: "rank_gap_query_cluster_004",
          evidence: [
            {
              metric: "section",
              value: "/melanoma/",
            },
          ],
        },
      ],
      decisions: [
        {
          opportunityId: "seo_opp_1",
          clusterId: "query_cluster_004",
          decision: "approved",
          rejectReason: null,
          decidedAt: "2026-07-12T00:10:00.000Z",
          taskId: "seo_task_2026_W28_w481",
          taskStatus: "awaiting_medical_review",
          taskUrl: "https://notion.local/seo_task_2026_W28_w481",
          taskCreatedAt: "2026-07-12T00:15:00.000Z",
          taskUpdatedAt: "2026-07-12T00:15:00.000Z",
          taskTargetUrl: "https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/",
          taskOpportunityType: "section_ranking_gap",
        },
      ],
    },
  },
};

const configFixture = {
  sourceKey: "seo_os",
  analyticsAccountId: "66624469",
  ingestionRunId: "ingestion_2026_W28",
  tables: {
    positionsWeekly: "seo_positions_weekly",
    opportunities: "seo_opportunities",
    tasks: "seo_tasks",
    weeklyRuns: "seo_weekly_runs",
    sectionPatterns: "seo_section_patterns",
    aiVisibility: "seo_ai_visibility",
    sovWeekly: "seo_sov_weekly",
    advisoryJobs: "seo_advisory_jobs",
  },
  sectionPatterns: [
    {
      section: "/melanoma/",
      urlPattern: "/melanoma/%",
      priority: 1,
    },
  ],
};

describe("mysql dashboard export", () => {
  test("builds DDL for the SEO read model with ReportingDash audit columns", () => {
    const ddl = buildSeoMysqlDashboardDdl(configFixture.tables);

    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS seo_positions_weekly");
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS seo_opportunities");
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS seo_tasks");
    expect(ddl).toContain("section                VARCHAR(128) NOT NULL DEFAULT '/'");
    expect(ddl).toContain("needs_target_page");
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS seo_weekly_runs");
    expect(ddl).toContain("run_week_key           CHAR(8)");
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS seo_section_patterns");
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS seo_ai_visibility");
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS seo_sov_weekly");
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS seo_advisory_jobs");
    expect(ddl).toContain("ENUM('advisory_pending','advisory_ready','advisory_skipped')");
    expect(ddl).toContain("source_key             VARCHAR(64)");
    expect(ddl).toContain("analytics_account_id   BIGINT");
    expect(ddl).toContain("ingestion_run_id");
  });

  test("derives dashboard task rows from approval decision task metadata when no task file is provided", () => {
    const plan = buildMysqlDashboardExportPlan({
      report: reportFixture,
      config: configFixture,
    });

    expect(plan.summary.tasks).toBe(1);
    expect(plan.sql).toContain("INSERT INTO `seo_tasks`");
    expect(plan.sql).toContain("`section`");
    expect(plan.sql).toContain("'/melanoma/'");
    expect(plan.sql).toContain("'seo_task_2026_W28_w481'");
    expect(plan.sql).toContain("'awaiting_medical_review'");
    expect(plan.sql).toContain("'https://notion.local/seo_task_2026_W28_w481'");
  });

  test("derives task section from target URL patterns when the original opportunity aged out", () => {
    const report = {
      ...reportFixture,
      layers: {
        ...reportFixture.layers,
        systemWork: {
          ...reportFixture.layers.systemWork,
          opportunities: [],
          decisions: [
            {
              clusterId: "seed_melanoma_podnogtevaya",
              decision: "approved",
              taskId: "seo_task_2026_W28_w482",
              taskStatus: "awaiting_medical_review",
              taskTargetUrl: "https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/",
              taskOpportunityType: "section_ranking_gap",
              taskCreatedAt: "2026-07-12T00:15:00.000Z",
            },
          ],
        },
      },
    };

    const plan = buildMysqlDashboardExportPlan({
      report,
      config: configFixture,
    });

    const taskInsert = plan.sql.match(/INSERT INTO `seo_tasks`[\s\S]*?ON DUPLICATE KEY UPDATE/)?.[0] || "";
    expect(plan.summary.tasks).toBe(1);
    expect(taskInsert).toContain("'seo_task_2026_W28_w482'");
    expect(taskInsert).toContain("'/melanoma/'");
  });

  test("builds idempotent upserts keyed by week and cluster or section", () => {
    const plan = buildMysqlDashboardExportPlan({
      report: reportFixture,
      tasks: [],
      config: configFixture,
    });

    expect(plan.summary).toEqual({
      weekKey: "2026-W28",
      positions: 2,
      opportunities: 1,
      tasks: 0,
      weeklyRuns: 1,
      sectionPatterns: 1,
      aiVisibility: 0,
      sovWeekly: 0,
      advisoryJobs: 1,
    });
    expect(plan.sql).toContain("INSERT INTO `seo_positions_weekly`");
    expect(plan.sql).toContain("ON DUPLICATE KEY UPDATE");
    expect(plan.sql).toContain("UNIQUE KEY uq_position");
    expect(plan.sql).toContain("'found'");
    expect(plan.sql).toContain("'no_data'");
    expect(plan.sql).toContain("'2026-07-12 00:00:00'");
    expect(plan.sql).not.toContain("2026-07-12T00:00:00.000Z");
    expect(plan.sql).toContain("`run_week_key`");
    expect(plan.sql).toContain("'2026-W29'");
    expect(plan.sql).toContain("'completed', '[{\"stage\":\"tracking_list\",\"status\":\"completed\"},{\"stage\":\"rank_tracking\",\"status\":\"completed\"}]', 23, 321, 3");
    expect(plan.sql).toContain("'2026-07-12 00:00:01'");
    expect(plan.sql).toContain("INSERT INTO `seo_section_patterns`");
    expect(plan.sql).toContain("INSERT INTO `seo_advisory_jobs`");
    expect(plan.sql).toContain("'advisory_pending'");
    expect(plan.sql).toContain("-1001234567890");
    expect(plan.sql).toContain("4321");
  });

  test("does not reset advisory state or token telemetry on a weekly exporter rerun", () => {
    const plan = buildMysqlDashboardExportPlan({ report: reportFixture, tasks: [], config: configFixture });
    const advisoryUpsert = plan.sql.match(/INSERT INTO `seo_advisory_jobs`[\s\S]*?;/)?.[0] || "";

    expect(advisoryUpsert).toContain("ON DUPLICATE KEY UPDATE");
    expect(advisoryUpsert).not.toContain("`status` = VALUES(`status`)");
    expect(advisoryUpsert).not.toContain("`advisory_json` = VALUES(`advisory_json`)");
    expect(advisoryUpsert).not.toContain("`total_tokens` = VALUES(`total_tokens`)");
    expect(advisoryUpsert).not.toContain("`requested_at` = VALUES(`requested_at`)");
  });

  test("returns export_pending when MySQL execution fails and retry can reuse the same plan", async () => {
    const calls: string[] = [];
    const failingExecutor: MysqlDashboardExportExecutor = async (sql) => {
      calls.push(sql);
      throw new Error("mysql unavailable");
    };

    const result = await runMysqlDashboardExport({
      report: reportFixture,
      tasks: [],
      config: configFixture,
      executor: failingExecutor,
    });

    expect(result.status).toBe("export_pending");
    expect(result.error).toBe("mysql unavailable");
    expect(calls).toHaveLength(1);
    expect(result.plan.sql).toContain("INSERT INTO `seo_weekly_runs`");
  });

  test("builds a manual Alisa AI visibility import with idempotent provenance", () => {
    const plan = buildAiVisibilityImportPlan({
      config: configFixture,
      records: [
        {
          engine: "alisa_ai",
          period: "2026-07",
          mentions: 89,
          citations: 155,
          presenceRate: 0.44,
          provenance: "wm_alisa_manual",
          capturedAt: "2026-07-13T14:30:00.000Z",
          raw: { source: "Yandex Webmaster UI", note: "avg last 4 weeks" },
        },
      ],
    });

    expect(plan.summary.aiVisibility).toBe(1);
    expect(plan.sql).toContain("INSERT INTO `seo_ai_visibility`");
    expect(plan.sql).toContain("'alisa_ai'");
    expect(plan.sql).toContain("'2026-07'");
    expect(plan.sql).toContain("0.44");
    expect(plan.sql).toContain("'wm_alisa_manual'");
    expect(plan.sql).toContain("ON DUPLICATE KEY UPDATE");
  });

  test("maps Yandex Webmaster query SoV snapshots to cluster rows plus medical KPI aggregate", () => {
    const records = buildSovWeeklyRecordsFromYandexWmSnapshot({
      snapshot: yandexWmSovSnapshot,
      weekKey: "2026-W29",
      snapshotDate: "2026-07-13",
    });

    expect(records.map((record) => record.cluster)).toEqual([
      "medical_org_labs_noise",
      "breast_cancer",
      "lung_cancer",
      "brand",
      "medical_intent_total",
    ]);
    expect(records.find((record) => record.cluster === "medical_org_labs_noise")).toMatchObject({
      isNoise: true,
      isMedical: false,
      impressionSharePct: 60,
      clickSharePct: 10,
    });
    expect(records.find((record) => record.cluster === "medical_intent_total")).toMatchObject({
      isNoise: false,
      isMedical: true,
      impressions: 300,
      clicks: 80,
      impressionSharePct: 30,
      clickSharePct: 80,
    });
  });

  test("exports weekly query SoV records into the dashboard read model", () => {
    const sovWeeklyRecords = buildSovWeeklyRecordsFromYandexWmSnapshot({
      snapshot: yandexWmSovSnapshot,
      weekKey: "2026-W29",
      snapshotDate: "2026-07-13",
    });
    const plan = buildMysqlDashboardExportPlan({
      report: reportFixture,
      tasks: [],
      config: configFixture,
      sovWeeklyRecords,
    });

    expect(plan.summary.sovWeekly).toBe(5);
    expect(plan.sql).toContain("INSERT INTO `seo_sov_weekly`");
    expect(plan.sql).toContain("'medical_intent_total'");
    expect(plan.sql).toContain("'2026-06-13'");
    expect(plan.sql).toContain("'2026-07-10'");
  });
});
