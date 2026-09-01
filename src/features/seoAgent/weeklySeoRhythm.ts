export const SEO_WEEKLY_RHYTHM_CRON_FLAG = "SEO_WEEKLY_RHYTHM_CRON";

export type WeeklySeoRhythmStage =
  | "disabled"
  | "lock"
  | "tracking_list"
  | "budget"
  | "rank_tracking"
  | "search_performance"
  | "gap_digest"
  | "digest_delivery"
  | "artifact"
  | "global_report"
  | "dashboard_export";

export type WeeklySeoRhythmRunRecord = {
  weekKey: string;
  runWeekKey?: string;
  dataWeekKey?: string;
  runId: string;
  status: "running" | "completed" | "failed";
  lockOwner: string | null;
  startedAt: string;
  completedAt: string | null;
  failedAt: string | null;
  failureStage: WeeklySeoRhythmStage | null;
  failureMessage: string | null;
  digestMessageIds: number[];
  artifactPath: string | null;
  approvalTargets?: WeeklySeoRhythmApprovalTarget[];
};

export type WeeklySeoRhythmApprovalTarget = {
  draftTaskId: string;
  callbackData: string;
  opportunityId: string;
  clusterId: string | null;
};

export type WeeklySeoRhythmStore = {
  getRun(input: { weekKey: string }): Promise<WeeklySeoRhythmRunRecord | null>;
  createRun(record: WeeklySeoRhythmRunRecord): Promise<WeeklySeoRhythmRunRecord>;
  updateRun(input: {
    weekKey: string;
    patch: Partial<WeeklySeoRhythmRunRecord>;
  }): Promise<WeeklySeoRhythmRunRecord>;
};

export type WeeklySeoRhythmDigestMessage = {
  text: string;
  buttons?: unknown[][];
  metadata?: unknown;
};

import type { SeoSectionRankTrackingListItem } from "./sectionRankTracking";

export type WeeklySeoRhythmDeps = {
  store: WeeklySeoRhythmStore;
  buildTrackingList(): Promise<SeoSectionRankTrackingListItem[]>;
  runRankTracking(input: {
    runId: string;
    weekKey: string;
    runWeekKey: string;
    dataWeekKey: string;
    trackingList: SeoSectionRankTrackingListItem[];
  }): Promise<{
    requestCount: number;
    recordsWritten: number;
    artifact: unknown;
  }>;
  collectSearchPerformance?(input: { runId: string; weekKey: string; runWeekKey: string; dataWeekKey: string }): Promise<{
    records: number;
    opportunities: number;
    artifact: unknown;
  }>;
  buildGapDigest(input: { runId: string; weekKey: string; runWeekKey: string; dataWeekKey: string }): Promise<{
    opportunityCount: number;
    messages: WeeklySeoRhythmDigestMessage[];
    artifact: unknown;
  }>;
  sendDigest(messages: WeeklySeoRhythmDigestMessage[]): Promise<Array<{ messageId: number }>>;
  sendServiceMessage(text: string): Promise<{ messageId: number }>;
  writeArtifact(input: {
    weekKey: string;
    runWeekKey: string;
    dataWeekKey: string;
    runId: string;
    artifact: WeeklySeoRhythmArtifact;
  }): Promise<{ path: string } | void>;
  buildGlobalReport?(input: {
    weekKey: string;
    runWeekKey: string;
    dataWeekKey: string;
    runId: string;
    weeklyArtifact: WeeklySeoRhythmArtifact;
  }): Promise<{
    path: string | null;
    metrikaStatus: "available" | "unavailable";
  }>;
  exportDashboard?(input: {
    weekKey: string;
    runWeekKey: string;
    dataWeekKey: string;
    runId: string;
    weeklyArtifact: WeeklySeoRhythmArtifact;
    globalReportPath: string | null;
  }): Promise<{
    status: "exported" | "export_pending";
    path: string | null;
    error: string | null;
  }>;
};

export type WeeklySeoRhythmArtifact = {
  schemaVersion: "seo_os_weekly_rhythm_run_v1";
  weekKey: string;
  runWeekKey?: string;
  dataWeekKey?: string;
  runId: string;
  generatedAt: string;
  status: "completed" | "failed";
  stages: Array<{
    stage: WeeklySeoRhythmStage;
    status: "completed" | "failed" | "skipped";
    message?: string;
  }>;
  counters: {
    trackingListSize: number;
    requestCount: number;
    maxSerpRequests: number;
    recordsWritten: number;
    searchPerformanceRecords: number;
    searchPerformanceOpportunities: number;
    opportunityCount: number;
    digestMessages: number;
  };
  rankTrackingArtifact: unknown | null;
  searchPerformanceArtifact: unknown | null;
  gapDigestArtifact: unknown | null;
  digestMessageIds: number[];
  sideEffects: {
    firestoreWrites: boolean;
    telegramMessagesSent: boolean;
    approvalCommandExecuted: false;
    productionPipelineRun: false;
  };
  globalReport: {
    status: "not_configured" | "completed" | "metrika_unavailable" | "failed";
    path: string | null;
    metrikaStatus: "not_requested" | "available" | "unavailable";
    failureMessage: string | null;
  };
  dashboardExport?: {
    status: "not_configured" | "exported" | "export_pending";
    path: string | null;
    failureMessage: string | null;
  };
};

export type WeeklySeoRhythmResult = {
  status: "disabled" | "noop" | "completed" | "failed";
  weekKey: string;
  runWeekKey?: string;
  dataWeekKey?: string;
  runId: string;
  artifact: WeeklySeoRhythmArtifact | null;
  artifactPath: string | null;
  failureStage: WeeklySeoRhythmStage | null;
  digestMessageIds: number[];
};

export type SeoWeeklyRhythmWindow = {
  triggeredAt: string;
  runWeekKey: string;
  dataWeekKey: string;
  dataWeekAnchorIso: string;
  runId: string;
};

export function buildSeoIsoWeekKey(isoDate: string): string {
  const date = new Date(isoDate);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid date for ISO week key.");
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function buildLastCompletedSeoWeekAnchorIso(isoDate: string): string {
  const date = new Date(isoDate);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid date for completed SEO week anchor.");
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0, 0));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() - day);
  return utc.toISOString();
}

export function buildSeoWeeklyRhythmWindow(triggeredAt: string): SeoWeeklyRhythmWindow {
  const runWeekKey = buildSeoIsoWeekKey(triggeredAt);
  const dataWeekAnchorIso = buildLastCompletedSeoWeekAnchorIso(triggeredAt);
  const dataWeekKey = buildSeoIsoWeekKey(dataWeekAnchorIso);
  return {
    triggeredAt,
    runWeekKey,
    dataWeekKey,
    dataWeekAnchorIso,
    runId: `seo_weekly_${runWeekKey}`,
  };
}

function localTimeParts(isoDate: string, timeZone: string): { weekday: string; hour: number; minute: number } {
  const date = new Date(isoDate);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid date for weekly rhythm catch-up.");
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return {
    weekday: value("weekday"),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  };
}

export function shouldRunWeeklySeoRhythmCatchUp(input: {
  now: string;
  env?: Record<string, string | undefined>;
  timeZone?: string;
}): boolean {
  const env = input.env || process.env;
  if (!enabled(env)) return false;
  const parts = localTimeParts(input.now, input.timeZone || "Europe/Vienna");
  if (parts.weekday !== "Mon") return false;
  return parts.hour > 9 || (parts.hour === 9 && parts.minute >= 0);
}

function enabled(env: Record<string, string | undefined>): boolean {
  return env[SEO_WEEKLY_RHYTHM_CRON_FLAG] === "1";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function draftTaskIdFromCallbackData(callbackData: string): string {
  const parts = callbackData.split(":");
  return cleanString(parts[parts.length - 1]);
}

export function buildWeeklySeoRhythmApprovalTargets(
  messages: WeeklySeoRhythmDigestMessage[]
): WeeklySeoRhythmApprovalTarget[] {
  const targets: WeeklySeoRhythmApprovalTarget[] = [];
  for (const message of messages) {
    const evidence = record(record(message.metadata).evidence);
    const opportunityId = cleanString(evidence.opportunityId);
    if (!opportunityId) continue;
    const clusterId = cleanString(evidence.clusterId) || null;
    const buttons = Array.isArray(message.buttons) ? message.buttons.flat() : [];
    for (const button of buttons) {
      const callbackData = cleanString(record(button).callbackData);
      const draftTaskId = draftTaskIdFromCallbackData(callbackData);
      if (!callbackData || !draftTaskId) continue;
      targets.push({ draftTaskId, callbackData, opportunityId, clusterId });
    }
  }
  return targets;
}

function newRunRecord(input: {
  weekKey: string;
  runWeekKey: string;
  dataWeekKey: string;
  runId: string;
  now: string;
  lockOwner: string;
}): WeeklySeoRhythmRunRecord {
  return {
    weekKey: input.weekKey,
    runWeekKey: input.runWeekKey,
    dataWeekKey: input.dataWeekKey,
    runId: input.runId,
    status: "running",
    lockOwner: input.lockOwner,
    startedAt: input.now,
    completedAt: null,
    failedAt: null,
    failureStage: null,
    failureMessage: null,
    digestMessageIds: [],
    artifactPath: null,
  };
}

function emptyArtifact(input: {
  weekKey: string;
  runWeekKey: string;
  dataWeekKey: string;
  runId: string;
  now: string;
  maxSerpRequests: number;
}): WeeklySeoRhythmArtifact {
  return {
    schemaVersion: "seo_os_weekly_rhythm_run_v1",
    weekKey: input.weekKey,
    runWeekKey: input.runWeekKey,
    dataWeekKey: input.dataWeekKey,
    runId: input.runId,
    generatedAt: input.now,
    status: "failed",
    stages: [],
    counters: {
      trackingListSize: 0,
      requestCount: 0,
      maxSerpRequests: input.maxSerpRequests,
      recordsWritten: 0,
      searchPerformanceRecords: 0,
      searchPerformanceOpportunities: 0,
      opportunityCount: 0,
      digestMessages: 0,
    },
    rankTrackingArtifact: null,
    searchPerformanceArtifact: null,
    gapDigestArtifact: null,
    digestMessageIds: [],
    sideEffects: {
      firestoreWrites: false,
      telegramMessagesSent: false,
      approvalCommandExecuted: false,
      productionPipelineRun: false,
    },
    globalReport: {
      status: "not_configured",
      path: null,
      metrikaStatus: "not_requested",
      failureMessage: null,
    },
    dashboardExport: {
      status: "not_configured",
      path: null,
      failureMessage: null,
    },
  };
}

async function failRun(input: {
  deps: WeeklySeoRhythmDeps;
  weekKey: string;
  runId: string;
  now: string;
  artifact: WeeklySeoRhythmArtifact;
  stage: WeeklySeoRhythmStage;
  error: unknown;
}): Promise<WeeklySeoRhythmResult> {
  const message = String((input.error as Error)?.message || input.error);
  input.artifact.status = "failed";
  input.artifact.stages.push({ stage: input.stage, status: "failed", message });
  await input.deps.sendServiceMessage(`SEO weekly rhythm: прогон не завершён: этап ${input.stage}. ${message}`);
  const writeResult = await input.deps.writeArtifact({
    weekKey: input.weekKey,
    runWeekKey: input.artifact.runWeekKey || input.weekKey,
    dataWeekKey: input.artifact.dataWeekKey || input.artifact.weekKey,
    runId: input.runId,
    artifact: input.artifact,
  });
  const artifactPath = writeResult?.path || null;
  await input.deps.store.updateRun({
    weekKey: input.weekKey,
    patch: {
      status: "failed",
      lockOwner: null,
      failedAt: input.now,
      failureStage: input.stage,
      failureMessage: message,
      artifactPath,
    },
  });
  return {
    status: "failed",
    weekKey: input.weekKey,
    runWeekKey: input.artifact.runWeekKey || input.weekKey,
    dataWeekKey: input.artifact.dataWeekKey || input.artifact.weekKey,
    runId: input.runId,
    artifact: input.artifact,
    artifactPath,
    failureStage: input.stage,
    digestMessageIds: [],
  };
}

export async function runWeeklySeoRhythm(input: {
  now: string;
  window?: SeoWeeklyRhythmWindow;
  env?: Record<string, string | undefined>;
  config: {
    weeklyRunMaxSerpRequests: number;
  };
  deps: WeeklySeoRhythmDeps;
}): Promise<WeeklySeoRhythmResult> {
  const env = input.env || process.env;
  const legacyWeekKey = buildSeoIsoWeekKey(input.now);
  const runWeekKey = input.window?.runWeekKey || legacyWeekKey;
  const dataWeekKey = input.window?.dataWeekKey || legacyWeekKey;
  const weekKey = runWeekKey;
  const runId = input.window?.runId || `seo_weekly_${runWeekKey}`;
  if (!enabled(env)) {
    return {
      status: "disabled",
      weekKey,
      runWeekKey,
      dataWeekKey,
      runId,
      artifact: null,
      artifactPath: null,
      failureStage: "disabled",
      digestMessageIds: [],
    };
  }

  const existing = await input.deps.store.getRun({ weekKey });
  if (existing?.status === "completed") {
    return {
      status: "noop",
      weekKey,
      runWeekKey,
      dataWeekKey: existing.dataWeekKey || dataWeekKey,
      runId: existing.runId,
      artifact: null,
      artifactPath: existing.artifactPath,
      failureStage: null,
      digestMessageIds: existing.digestMessageIds,
    };
  }
  if (existing?.status === "running" && existing.lockOwner) {
    return {
      status: "noop",
      weekKey,
      runWeekKey,
      dataWeekKey: existing.dataWeekKey || dataWeekKey,
      runId: existing.runId,
      artifact: null,
      artifactPath: existing.artifactPath,
      failureStage: "lock",
      digestMessageIds: existing.digestMessageIds,
    };
  }

  const lockOwner = `${runId}_${Date.now()}`;
  await input.deps.store.createRun(newRunRecord({ weekKey, runWeekKey, dataWeekKey, runId, now: input.now, lockOwner }));
  const artifact = emptyArtifact({
    weekKey: dataWeekKey,
    runWeekKey,
    dataWeekKey,
    runId,
    now: input.now,
    maxSerpRequests: input.config.weeklyRunMaxSerpRequests,
  });

  let trackingList: SeoSectionRankTrackingListItem[] = [];
  try {
    trackingList = await input.deps.buildTrackingList();
    artifact.counters.trackingListSize = trackingList.length;
    artifact.stages.push({ stage: "tracking_list", status: "completed" });
  } catch (error) {
    return failRun({ deps: input.deps, weekKey, runId, now: input.now, artifact, stage: "tracking_list", error });
  }

  if (trackingList.length > input.config.weeklyRunMaxSerpRequests) {
    return failRun({
      deps: input.deps,
      weekKey,
      runId,
      now: input.now,
      artifact,
      stage: "budget",
      error: `SERP budget exceeded: ${trackingList.length}/${input.config.weeklyRunMaxSerpRequests}`,
    });
  }
  artifact.stages.push({ stage: "budget", status: "completed" });

  try {
    const rank = await input.deps.runRankTracking({
      runId,
      weekKey: dataWeekKey,
      runWeekKey,
      dataWeekKey,
      trackingList,
    });
    artifact.counters.requestCount = rank.requestCount;
    artifact.counters.recordsWritten = rank.recordsWritten;
    artifact.rankTrackingArtifact = rank.artifact;
    artifact.sideEffects.firestoreWrites = rank.recordsWritten > 0;
    artifact.stages.push({ stage: "rank_tracking", status: "completed" });
  } catch (error) {
    return failRun({ deps: input.deps, weekKey, runId, now: input.now, artifact, stage: "rank_tracking", error });
  }

  if (input.deps.collectSearchPerformance) {
    try {
      const searchPerformance = await input.deps.collectSearchPerformance({
        runId,
        weekKey: dataWeekKey,
        runWeekKey,
        dataWeekKey,
      });
      artifact.counters.searchPerformanceRecords = searchPerformance.records;
      artifact.counters.searchPerformanceOpportunities = searchPerformance.opportunities;
      artifact.searchPerformanceArtifact = searchPerformance.artifact;
      artifact.stages.push({ stage: "search_performance", status: "completed" });
    } catch (error) {
      return failRun({ deps: input.deps, weekKey, runId, now: input.now, artifact, stage: "search_performance", error });
    }
  }

  let messages: WeeklySeoRhythmDigestMessage[] = [];
  try {
    const gap = await input.deps.buildGapDigest({ runId, weekKey: dataWeekKey, runWeekKey, dataWeekKey });
    messages = gap.messages;
    artifact.counters.opportunityCount = gap.opportunityCount;
    artifact.counters.digestMessages = messages.length;
    artifact.gapDigestArtifact = gap.artifact;
    artifact.stages.push({ stage: "gap_digest", status: "completed" });
  } catch (error) {
    return failRun({ deps: input.deps, weekKey, runId, now: input.now, artifact, stage: "gap_digest", error });
  }

  try {
    const sent = messages.length ? await input.deps.sendDigest(messages) : [];
    artifact.digestMessageIds = sent.map((item) => item.messageId);
    artifact.sideEffects.telegramMessagesSent = sent.length > 0;
    artifact.stages.push({ stage: "digest_delivery", status: "completed" });
  } catch (error) {
    return failRun({ deps: input.deps, weekKey, runId, now: input.now, artifact, stage: "digest_delivery", error });
  }

  artifact.status = "completed";
  let globalReportPath: string | null = null;
  if (input.deps.buildGlobalReport) {
    try {
      const globalReport = await input.deps.buildGlobalReport({
        weekKey: dataWeekKey,
        runWeekKey,
        dataWeekKey,
        runId,
        weeklyArtifact: artifact,
      });
      globalReportPath = globalReport.path;
      artifact.globalReport = {
        status: globalReport.metrikaStatus === "available" ? "completed" : "metrika_unavailable",
        path: globalReport.path,
        metrikaStatus: globalReport.metrikaStatus,
        failureMessage: null,
      };
      artifact.stages.push({ stage: "global_report", status: "completed" });
    } catch (error) {
      artifact.globalReport = {
        status: "failed",
        path: null,
        metrikaStatus: "unavailable",
        failureMessage: String((error as Error)?.message || error),
      };
      artifact.stages.push({ stage: "global_report", status: "skipped", message: artifact.globalReport.failureMessage || undefined });
    }
  }
  if (input.deps.exportDashboard) {
    try {
      const dashboardExport = await input.deps.exportDashboard({
        weekKey: dataWeekKey,
        runWeekKey,
        dataWeekKey,
        runId,
        weeklyArtifact: artifact,
        globalReportPath,
      });
      artifact.dashboardExport = {
        status: dashboardExport.status,
        path: dashboardExport.path,
        failureMessage: dashboardExport.error,
      };
      artifact.stages.push({ stage: "dashboard_export", status: dashboardExport.status === "exported" ? "completed" : "skipped", message: dashboardExport.error || undefined });
    } catch (error) {
      artifact.dashboardExport = {
        status: "export_pending",
        path: null,
        failureMessage: String((error as Error)?.message || error),
      };
      artifact.stages.push({ stage: "dashboard_export", status: "skipped", message: artifact.dashboardExport.failureMessage || undefined });
    }
  }
  const writeResult = await input.deps.writeArtifact({ weekKey, runWeekKey, dataWeekKey, runId, artifact });
  const artifactPath = writeResult?.path || null;
  artifact.stages.push({ stage: "artifact", status: "completed" });
  await input.deps.store.updateRun({
    weekKey,
    patch: {
      status: "completed",
      lockOwner: null,
      completedAt: input.now,
      failureStage: null,
      failureMessage: null,
      digestMessageIds: artifact.digestMessageIds,
      artifactPath,
      approvalTargets: buildWeeklySeoRhythmApprovalTargets(messages),
    },
  });

  return {
    status: "completed",
    weekKey,
    runWeekKey,
    dataWeekKey,
    runId,
    artifact,
    artifactPath,
    failureStage: null,
    digestMessageIds: artifact.digestMessageIds,
  };
}
