import type { WeeklyTop10DryRunResult } from "./weeklyTop10DryRunService";
import type { WeeklyTop10OpportunityState } from "./weeklyTop10Generator";

export type SeoOsReportingExportSchemaVersion = "seo_os_reporting_dashboard_export_v1";
export type SeoOsReportingExportSourceType = "weekly_top10_dry_run";
export type SeoOsReportingExportCardKind = "metric" | "status" | "list";

export type SeoOsReportingExportContract = {
  schemaVersion: SeoOsReportingExportSchemaVersion;
  sourceTypes: SeoOsReportingExportSourceType[];
  intendedConsumers: ["dashboard", "reporting"];
  writes: [];
  sendsNotifications: false;
  notes: string[];
};

export type SeoOsReportingDashboardCard = {
  id: string;
  kind: SeoOsReportingExportCardKind;
  title: string;
  value: string | number | boolean | null;
  detail: string | null;
};

export type SeoOsReportingWeeklyTop10Item = {
  rank: number;
  state: Exclude<WeeklyTop10OpportunityState, "rejected" | "implemented">;
  title: string;
  priority: string;
  confidenceScore: number;
  targetKeywords: string[];
  recommendedAction: string | null;
  evidenceCount: number;
  sourceKeys: string[];
};

export type SeoOsReportingDashboardExport = {
  schemaVersion: SeoOsReportingExportSchemaVersion;
  generatedAt: string;
  teamId: string;
  runId: string;
  source: {
    type: SeoOsReportingExportSourceType;
    mode: "dry_run";
  };
  cards: SeoOsReportingDashboardCard[];
  weeklyTop10: {
    items: SeoOsReportingWeeklyTop10Item[];
    watchlist: SeoOsReportingWeeklyTop10Item[];
    carriedOver: SeoOsReportingWeeklyTop10Item[];
    approvedStale: SeoOsReportingWeeklyTop10Item[];
    summary: WeeklyTop10DryRunResult["digest"]["summary"];
  };
  stateSummary: Record<WeeklyTop10OpportunityState, number>;
  snapshotCounts: WeeklyTop10DryRunResult["snapshotCounts"];
  sideEffects: WeeklyTop10DryRunResult["sideEffects"];
};

export const SEO_OS_REPORTING_EXPORT_CONTRACT: SeoOsReportingExportContract = {
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
};

function emptyStateSummary(): Record<WeeklyTop10OpportunityState, number> {
  return {
    new: 0,
    carried_over: 0,
    approved: 0,
    implemented: 0,
    rejected: 0,
  };
}

function buildStateSummary(input: WeeklyTop10DryRunResult): Record<WeeklyTop10OpportunityState, number> {
  const summary = emptyStateSummary();
  for (const item of input.inputs) {
    const state = item.state || "new";
    summary[state] += 1;
  }
  return summary;
}

function pluralize(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function dashboardCards(input: WeeklyTop10DryRunResult): SeoOsReportingDashboardCard[] {
  const stateSummary = buildStateSummary(input);
  return [
    {
      id: "weekly_top10_included",
      kind: "metric",
      title: "Weekly Top-10 included",
      value: input.digest.summary.includedCount,
      detail: `${input.digest.summary.totalCandidates} active ${pluralize(input.digest.summary.totalCandidates, "candidate", "candidates")}`,
    },
    {
      id: "weekly_top10_watchlist",
      kind: "metric",
      title: "Watchlist",
      value: input.digest.summary.watchlistCount,
      detail: null,
    },
    {
      id: "weekly_top10_approved_stale",
      kind: "status",
      title: "Approved stale",
      value: input.digest.summary.approvedStaleCount,
      detail: "Approved opportunities without implementation signal.",
    },
    {
      id: "weekly_top10_implemented",
      kind: "metric",
      title: "Implemented",
      value: stateSummary.implemented,
      detail: "Implementation is explicit from linked agency task status.",
    },
    {
      id: "weekly_top10_no_new",
      kind: "status",
      title: "No new opportunities",
      value: input.digest.summary.noNewOpportunities,
      detail: null,
    },
  ];
}

function weeklyTop10Item(item: SeoOsReportingWeeklyTop10Item): SeoOsReportingWeeklyTop10Item {
  return {
    rank: item.rank,
    state: item.state,
    title: item.title,
    priority: item.priority,
    confidenceScore: item.confidenceScore,
    targetKeywords: [...item.targetKeywords],
    recommendedAction: item.recommendedAction,
    evidenceCount: item.evidenceCount,
    sourceKeys: [...item.sourceKeys],
  };
}

export function exportWeeklyTop10DryRunForDashboard(
  input: WeeklyTop10DryRunResult
): SeoOsReportingDashboardExport {
  return {
    schemaVersion: SEO_OS_REPORTING_EXPORT_CONTRACT.schemaVersion,
    generatedAt: input.digest.generatedAt,
    teamId: input.teamId,
    runId: input.runId,
    source: {
      type: "weekly_top10_dry_run",
      mode: input.mode,
    },
    cards: dashboardCards(input),
    weeklyTop10: {
      items: input.digest.items.map(weeklyTop10Item),
      watchlist: input.digest.watchlist.map(weeklyTop10Item),
      carriedOver: input.digest.carriedOver.map(weeklyTop10Item),
      approvedStale: input.digest.approvedStale.map(weeklyTop10Item),
      summary: { ...input.digest.summary },
    },
    stateSummary: buildStateSummary(input),
    snapshotCounts: { ...input.snapshotCounts },
    sideEffects: { ...input.sideEffects },
  };
}
