import type { MetrikaSectionTrafficReport } from "./metrikaSectionTraffic";
import type { SeoRankDashboardExport } from "./sectionRankTracking";
import type { WeeklyTop10ApprovalDecisionRecord } from "./weeklyTop10ApprovalDecision";

export type SeoGlobalReport = {
  schemaVersion: "seo_os_global_report_v1";
  generatedAt: string;
  weekKey: string;
  runWeekKey: string;
  dataWeekKey: string;
  runId: string;
  startedAt: string | null;
  window: {
    label: string;
    kind: "week";
    weekKey: string;
    runWeekKey: string;
    dataWeekKey: string;
  };
  domain: string;
  teamId: string;
  layers: {
    positions: SeoRankDashboardExport;
    systemWork: {
      summary: {
        opportunityCount: number;
        digestMessages: number;
        approvedCount: number;
        rejectedCount: number;
        pendingDecisionCount: number;
      };
      opportunities: unknown[];
      decisions: WeeklyTop10ApprovalDecisionRecord[];
      rejectReasons: Array<{
        reason: string;
        count: number;
      }>;
    };
    metrika: MetrikaSectionTrafficReport;
    searchPerformance: {
      status: "available" | "unavailable";
      source: string | null;
      summary: {
        records: number;
        opportunities: number;
        impressions: number | null;
        clicks: number | null;
        ctr: number | null;
        averagePosition: number | null;
      };
      snapshot: unknown | null;
      records: unknown[];
      opportunities: unknown[];
    };
  };
  stages: unknown[];
  sourceWeeklyArtifact: unknown;
  advisoryEnrichment: unknown | null;
  notes: string[];
  sideEffects: {
    firestoreWrites: false;
    telegramMessagesSent: false;
    approvalCommandExecuted: false;
    productionPipelineRun: false;
    actionsGeneratedFromMetrika: false;
  };
};

function nestedRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberFrom(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function opportunitiesFromWeeklyArtifact(weeklyRhythmArtifact: unknown): unknown[] {
  const artifact = nestedRecord(weeklyRhythmArtifact);
  const gap = nestedRecord(artifact.gapDigestArtifact);
  const review = nestedRecord(gap.review);
  return Array.isArray(review.opportunities) ? review.opportunities : [];
}

function digestMessageCount(weeklyRhythmArtifact: unknown): number {
  const artifact = nestedRecord(weeklyRhythmArtifact);
  const counters = nestedRecord(artifact.counters);
  return numberFrom(counters.digestMessages);
}

function rejectReasons(decisions: readonly WeeklyTop10ApprovalDecisionRecord[]): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const decision of decisions) {
    if (decision.decision !== "rejected") continue;
    const reason = decision.rejectReason || "unspecified";
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => {
      const countDiff = b.count - a.count;
      if (countDiff) return countDiff;
      return a.reason.localeCompare(b.reason);
    });
}

function searchPerformanceLayer(value: unknown): SeoGlobalReport["layers"]["searchPerformance"] {
  const artifact = nestedRecord(value);
  const snapshot = nestedRecord(artifact.snapshot);
  const records = Array.isArray(artifact.records) ? artifact.records : [];
  const opportunities = Array.isArray(artifact.opportunities) ? artifact.opportunities : [];
  const hasSnapshot = Boolean(snapshot.property || snapshot.siteUrl || snapshot.impressions || snapshot.clicks);
  if (!hasSnapshot && records.length === 0 && opportunities.length === 0) {
    return {
      status: "unavailable",
      source: null,
      summary: {
        records: 0,
        opportunities: 0,
        impressions: null,
        clicks: null,
        ctr: null,
        averagePosition: null,
      },
      snapshot: null,
      records: [],
      opportunities: [],
    };
  }
  return {
    status: "available",
    source: cleanString(artifact.source) || null,
    summary: {
      records: records.length,
      opportunities: opportunities.length,
      impressions: numberOrNull(snapshot.impressions),
      clicks: numberOrNull(snapshot.clicks),
      ctr: numberOrNull(snapshot.ctr),
      averagePosition: numberOrNull(snapshot.averagePosition),
    },
    snapshot,
    records,
    opportunities,
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildSeoGlobalReport(input: {
  generatedAt: string;
  weekKey: string;
  runId: string;
  domain: string;
  teamId: string;
  rankDashboard: SeoRankDashboardExport;
  weeklyRhythmArtifact: unknown;
  decisions: readonly WeeklyTop10ApprovalDecisionRecord[];
  metrika: MetrikaSectionTrafficReport;
  searchPerformance?: unknown;
}): SeoGlobalReport {
  const opportunities = opportunitiesFromWeeklyArtifact(input.weeklyRhythmArtifact);
  const approvedCount = input.decisions.filter((decision) => decision.decision === "approved").length;
  const rejectedCount = input.decisions.filter((decision) => decision.decision === "rejected").length;
  const weeklyArtifact = nestedRecord(input.weeklyRhythmArtifact);
  const runWeekKey = cleanString(weeklyArtifact.runWeekKey) || input.weekKey;
  const dataWeekKey = cleanString(weeklyArtifact.dataWeekKey) || input.weekKey;
  const stages = Array.isArray(weeklyArtifact.stages) ? weeklyArtifact.stages : [];
  const advisoryEnrichment = nestedRecord(nestedRecord(weeklyArtifact.gapDigestArtifact).advisoryEnrichment);
  return {
    schemaVersion: "seo_os_global_report_v1",
    generatedAt: input.generatedAt,
    weekKey: input.weekKey,
    runWeekKey,
    dataWeekKey,
    runId: input.runId,
    startedAt: cleanString(weeklyArtifact.generatedAt) || null,
    window: {
      label: `week:${input.weekKey}`,
      kind: "week",
      weekKey: input.weekKey,
      runWeekKey,
      dataWeekKey,
    },
    domain: input.domain,
    teamId: input.teamId,
    layers: {
      positions: input.rankDashboard,
      systemWork: {
        summary: {
          opportunityCount: opportunities.length,
          digestMessages: digestMessageCount(input.weeklyRhythmArtifact),
          approvedCount,
          rejectedCount,
          pendingDecisionCount: Math.max(0, opportunities.length - approvedCount - rejectedCount),
        },
        opportunities,
        decisions: [...input.decisions],
        rejectReasons: rejectReasons(input.decisions),
      },
      metrika: input.metrika,
      searchPerformance: searchPerformanceLayer(input.searchPerformance ?? nestedRecord(input.weeklyRhythmArtifact).searchPerformanceArtifact),
    },
    stages,
    sourceWeeklyArtifact: input.weeklyRhythmArtifact,
    advisoryEnrichment: Object.keys(advisoryEnrichment).length ? advisoryEnrichment : null,
    notes: [
      "Chapter 7.3 Global Report contract: positions, system work and Metrika section traffic.",
      "Metrika is read-only and generates no opportunities or approval actions in v1.",
      "If Metrika is unavailable, weekly rhythm remains unaffected and this report records the unavailable status.",
    ],
    sideEffects: {
      firestoreWrites: false,
      telegramMessagesSent: false,
      approvalCommandExecuted: false,
      productionPipelineRun: false,
      actionsGeneratedFromMetrika: false,
    },
  };
}
