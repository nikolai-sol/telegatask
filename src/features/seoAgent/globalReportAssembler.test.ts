import { describe, expect, test } from "vitest";
import weeklyRhythmArtifact from "./fixtures/globalReport/weeklyRhythmArtifact.json";
import { buildSeoGlobalReport } from "./globalReportAssembler";
import type { SeoRankDashboardExport } from "./sectionRankTracking";
import type { WeeklyTop10ApprovalDecisionRecord } from "./weeklyTop10ApprovalDecision";

const rankDashboard: SeoRankDashboardExport = {
  schemaVersion: "seo_os_rank_history_dashboard_export_v1",
  generatedAt: "2026-07-10T12:00:00.000Z",
  domain: "zaruku.ru",
  runId: "seo_weekly_2026-W28",
  searchEngine: "yandex",
  summary: {
    trackedClusters: 1,
    foundClusters: 1,
    coverageRatio: 1,
    alertCount: 0,
  },
  sections: [
    {
      section: "/melanoma/",
      trackedClusters: 1,
      foundClusters: 1,
      coverageRatio: 1,
      items: [
        {
          clusterId: "seed_melanoma",
          query: "подногтевая меланома фото",
          currentPosition: 11,
          previousPosition: 14,
          delta: -3,
          matchedUrl: "https://zaruku.ru/melanoma/post/",
          deltaStatus: "ok",
        },
      ],
    },
  ],
  alerts: [],
  notes: [],
};

const rejectedDecision: WeeklyTop10ApprovalDecisionRecord = {
  id: "decision_1",
  teamId: "qa-seo-team-1",
  runId: "seo_weekly_2026-W28",
  opportunityId: "opp_1",
  clusterId: "seed_melanoma",
  draftTaskId: null,
  decision: "rejected",
  rejectReason: "Already covered.",
  reviewer: { userId: "qa", telegramUserId: 2779103 },
  decidedAt: "2026-07-10T12:10:00.000Z",
  source: "telegram_dev_callback",
  callbackData: "reject:opp_1",
};

describe("globalReportAssembler", () => {
  test("assembles the Chapter 7.3 three-layer report contract", () => {
    const weeklyRhythmArtifactWithTelemetry = {
      ...weeklyRhythmArtifact,
      generatedAt: "2026-07-10T12:00:00.000Z",
      runWeekKey: "2026-W29",
      dataWeekKey: "2026-W28",
      stages: [
        { stage: "tracking_list", status: "completed" },
        { stage: "rank_tracking", status: "completed" },
      ],
      counters: {
        ...weeklyRhythmArtifact.counters,
        requestCount: 2,
        digestMessages: 1,
      },
      gapDigestArtifact: {
        ...(weeklyRhythmArtifact as any).gapDigestArtifact,
        advisoryEnrichment: {
          enabled: true,
          summary: { totalTokens: 123 },
        },
      },
    };

    const report = buildSeoGlobalReport({
      generatedAt: "2026-07-10T12:30:00.000Z",
      weekKey: "2026-W28",
      runId: "seo_weekly_2026-W28",
      domain: "zaruku.ru",
      teamId: "qa-seo-team-1",
      rankDashboard,
      weeklyRhythmArtifact: weeklyRhythmArtifactWithTelemetry,
      decisions: [rejectedDecision],
      metrika: {
        schemaVersion: "seo_os_metrika_section_traffic_v1",
        status: "available",
        generatedAt: "2026-07-10T12:20:00.000Z",
        weekKey: "2026-W28",
        domain: "zaruku.ru",
        requestCount: 1,
        summary: { totalVisits: 5, totalUsers: 4, sectionsWithTraffic: 1 },
        sections: [
          {
            section: "/melanoma/",
            visits: 5,
            users: 4,
            avgPageDepth: 2,
            avgVisitDurationSeconds: 90,
            bounceRate: 30,
            organic: { yandex: 3, google: 2, other: 0 },
            sampleUrls: ["https://zaruku.ru/melanoma/post/"],
          },
        ],
        unavailableReason: null,
      },
      searchPerformance: {
        schemaVersion: "seo_os_weekly_search_performance_v1",
        source: "gsc",
        snapshot: {
          property: "https://zaruku.ru/",
          siteUrl: "https://zaruku.ru/",
          dateRange: { startDate: "2026-06-17", endDate: "2026-07-14", days: 28 },
          clicks: 264,
          impressions: 16730,
          ctr: 1.57,
          averagePosition: 2.92,
          topQueries: ["за руку"],
          topPages: ["https://zaruku.ru/"],
          countries: ["rus"],
          devices: ["MOBILE"],
        },
        records: [{ source: "gsc", dimension: "summary" }],
        opportunities: [{ title: "Improve GSC CTR" }],
      },
    });

    expect(report.schemaVersion).toBe("seo_os_global_report_v1");
    expect(report.window).toEqual({
      label: "week:2026-W28",
      kind: "week",
      weekKey: "2026-W28",
      runWeekKey: "2026-W29",
      dataWeekKey: "2026-W28",
    });
    expect(report.runWeekKey).toBe("2026-W29");
    expect(report.dataWeekKey).toBe("2026-W28");
    expect(report.startedAt).toBe(weeklyRhythmArtifactWithTelemetry.generatedAt);
    expect(report.sourceWeeklyArtifact).toMatchObject({
      counters: {
        requestCount: 2,
        digestMessages: 1,
      },
    });
    expect(report.stages).toEqual(weeklyRhythmArtifactWithTelemetry.stages);
    expect(report.advisoryEnrichment).toEqual(
      weeklyRhythmArtifactWithTelemetry.gapDigestArtifact.advisoryEnrichment
    );
    expect(report.layers.positions.summary.trackedClusters).toBe(1);
    expect(report.layers.systemWork.summary).toMatchObject({
      opportunityCount: 1,
      approvedCount: 0,
      rejectedCount: 1,
    });
    expect(report.layers.systemWork.rejectReasons).toEqual([{ reason: "Already covered.", count: 1 }]);
    expect(report.layers.metrika.status).toBe("available");
    expect(report.layers.searchPerformance).toMatchObject({
      status: "available",
      source: "gsc",
      summary: {
        records: 1,
        opportunities: 1,
        impressions: 16730,
        clicks: 264,
      },
    });
    expect(report.sideEffects).toEqual({
      firestoreWrites: false,
      telegramMessagesSent: false,
      approvalCommandExecuted: false,
      productionPipelineRun: false,
      actionsGeneratedFromMetrika: false,
    });
  });
});
