import { describe, expect, test } from "vitest";
import expectedOpportunities from "./fixtures/searchPerformanceOpportunityEngine/expectedOpportunities.json";
import type { SeoOpportunity } from "./types";
import type { WeeklyTop10DryRunResult } from "./weeklyTop10DryRunService";
import {
  exportWeeklyTop10DryRunForDashboard,
  SEO_OS_REPORTING_EXPORT_CONTRACT,
} from "./seoOsReportingExportContract";

const opportunities = expectedOpportunities as SeoOpportunity[];

function dryRunResult(): WeeklyTop10DryRunResult {
  return {
    mode: "dry_run",
    teamId: "team-1",
    runId: "run-1",
    inputs: [
      {
        opportunity: opportunities[0],
        state: "implemented",
        firstSeenAt: "2026-06-01T00:00:00.000Z",
        approvedAt: "2026-06-10T00:00:00.000Z",
        implementedAt: "2026-07-01T12:00:00.000Z",
      },
      {
        opportunity: opportunities[1],
        state: "carried_over",
        firstSeenAt: "2026-06-25T00:00:00.000Z",
        approvedAt: null,
        implementedAt: null,
      },
      {
        opportunity: opportunities[2],
        state: "approved",
        firstSeenAt: "2026-06-02T00:00:00.000Z",
        approvedAt: "2026-06-11T00:00:00.000Z",
        implementedAt: null,
      },
    ],
    digest: {
      generatedAt: "2026-07-03T10:00:00.000Z",
      items: [
        {
          rank: 0,
          state: "carried_over",
          title: "Improve GSC CTR for \"за руку\"",
          priority: "high",
          confidenceScore: 89,
          targetKeywords: ["за руку"],
          recommendedAction: "Improve title, description, and snippet intent alignment for \"за руку\".",
          evidenceCount: 1,
          sourceKeys: ["gsc:search_performance:за руку:https://zaruku.ru/"],
        },
      ],
      watchlist: [],
      carriedOver: [
        {
          rank: 0,
          state: "carried_over",
          title: "Improve GSC CTR for \"за руку\"",
          priority: "high",
          confidenceScore: 89,
          targetKeywords: ["за руку"],
          recommendedAction: "Improve title, description, and snippet intent alignment for \"за руку\".",
          evidenceCount: 1,
          sourceKeys: ["gsc:search_performance:за руку:https://zaruku.ru/"],
        },
      ],
      approvedStale: [
        {
          rank: 0,
          state: "approved",
          title: "Improve Yandex Webmaster rankings for \"рак лечение\"",
          priority: "medium",
          confidenceScore: 60,
          targetKeywords: ["рак лечение"],
          recommendedAction: "Improve the page/query match for \"рак лечение\" and add internal links from relevant pages.",
          evidenceCount: 1,
          sourceKeys: ["yandex_webmaster:search_performance:рак лечение"],
        },
      ],
      summary: {
        totalCandidates: 2,
        includedCount: 1,
        watchlistCount: 0,
        carriedOverCount: 1,
        approvedStaleCount: 1,
        noNewOpportunities: true,
      },
    },
    snapshotCounts: {
      opportunities: 3,
      draftTasks: 3,
      implementationTasks: 1,
    },
    sideEffects: {
      persisted: false,
      sent: false,
      productionPipelineRun: false,
    },
  };
}

describe("seoOsReportingExportContract", () => {
  test("documents the reporting and dashboard export contract", () => {
    expect(SEO_OS_REPORTING_EXPORT_CONTRACT).toEqual({
      schemaVersion: "seo_os_reporting_dashboard_export_v1",
      sourceTypes: ["weekly_top10_dry_run"],
      intendedConsumers: ["dashboard", "reporting"],
      writes: [],
      sendsNotifications: false,
      notes: [
        "This contract is a pure export shape for reporting and dashboard consumers.",
        "It does not persist dashboard data.",
        "It does not send notifications.",
        "It does not run the production SEO pipeline.",
      ],
    });
  });

  test("exports a stable dashboard payload from a weekly top-10 dry-run result", () => {
    expect(exportWeeklyTop10DryRunForDashboard(dryRunResult())).toEqual({
      schemaVersion: "seo_os_reporting_dashboard_export_v1",
      generatedAt: "2026-07-03T10:00:00.000Z",
      teamId: "team-1",
      runId: "run-1",
      source: {
        type: "weekly_top10_dry_run",
        mode: "dry_run",
      },
      cards: [
        {
          id: "weekly_top10_included",
          kind: "metric",
          title: "Weekly Top-10 included",
          value: 1,
          detail: "2 active candidates",
        },
        {
          id: "weekly_top10_watchlist",
          kind: "metric",
          title: "Watchlist",
          value: 0,
          detail: null,
        },
        {
          id: "weekly_top10_approved_stale",
          kind: "status",
          title: "Approved stale",
          value: 1,
          detail: "Approved opportunities without implementation signal.",
        },
        {
          id: "weekly_top10_implemented",
          kind: "metric",
          title: "Implemented",
          value: 1,
          detail: "Implementation is explicit from linked agency task status.",
        },
        {
          id: "weekly_top10_no_new",
          kind: "status",
          title: "No new opportunities",
          value: true,
          detail: null,
        },
      ],
      weeklyTop10: {
        items: [
          {
            rank: 0,
            state: "carried_over",
            title: "Improve GSC CTR for \"за руку\"",
            priority: "high",
            confidenceScore: 89,
            targetKeywords: ["за руку"],
            recommendedAction: "Improve title, description, and snippet intent alignment for \"за руку\".",
            evidenceCount: 1,
            sourceKeys: ["gsc:search_performance:за руку:https://zaruku.ru/"],
          },
        ],
        watchlist: [],
        carriedOver: [
          {
            rank: 0,
            state: "carried_over",
            title: "Improve GSC CTR for \"за руку\"",
            priority: "high",
            confidenceScore: 89,
            targetKeywords: ["за руку"],
            recommendedAction: "Improve title, description, and snippet intent alignment for \"за руку\".",
            evidenceCount: 1,
            sourceKeys: ["gsc:search_performance:за руку:https://zaruku.ru/"],
          },
        ],
        approvedStale: [
          {
            rank: 0,
            state: "approved",
            title: "Improve Yandex Webmaster rankings for \"рак лечение\"",
            priority: "medium",
            confidenceScore: 60,
            targetKeywords: ["рак лечение"],
            recommendedAction: "Improve the page/query match for \"рак лечение\" and add internal links from relevant pages.",
            evidenceCount: 1,
            sourceKeys: ["yandex_webmaster:search_performance:рак лечение"],
          },
        ],
        summary: {
          totalCandidates: 2,
          includedCount: 1,
          watchlistCount: 0,
          carriedOverCount: 1,
          approvedStaleCount: 1,
          noNewOpportunities: true,
        },
      },
      stateSummary: {
        new: 0,
        carried_over: 1,
        approved: 1,
        implemented: 1,
        rejected: 0,
      },
      snapshotCounts: {
        opportunities: 3,
        draftTasks: 3,
        implementationTasks: 1,
      },
      sideEffects: {
        persisted: false,
        sent: false,
        productionPipelineRun: false,
      },
    });
  });

  test("copies export arrays so callers cannot mutate the source digest", () => {
    const source = dryRunResult();
    const exported = exportWeeklyTop10DryRunForDashboard(source);
    exported.weeklyTop10.items[0].targetKeywords.push("mutated");
    exported.weeklyTop10.items[0].sourceKeys.push("mutated");

    expect(source.digest.items[0].targetKeywords).toEqual(["за руку"]);
    expect(source.digest.items[0].sourceKeys).toEqual(["gsc:search_performance:за руку:https://zaruku.ru/"]);
  });
});
