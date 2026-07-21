import type { WeeklyTop10ApprovalDecisionRecord } from "./weeklyTop10ApprovalDecision";

export type WeeklyTop10ApprovalTaskStatus =
  | "draft"
  | "awaiting_medical_review"
  | "needs_target_page";

export type WeeklyTop10ApprovalTaskExecutionStatus =
  | "created"
  | "already_created"
  | "execution_pending"
  | "skipped_rejected"
  | "skipped_disabled";

export type WeeklyTop10ApprovalTaskCreateInput = {
  taskId: string;
  weekKey: string;
  runId: string;
  teamId: string;
  decisionId: string;
  opportunityId: string;
  clusterId: string;
  draftTaskId: string;
  title: string;
  section: string;
  query: string;
  queryCluster: string[];
  opportunityType: string;
  status: WeeklyTop10ApprovalTaskStatus;
  targetUrl: string | null;
  medicalReviewRequired: boolean;
  medicalReviewer: "";
  advisoryText: string | null;
  medicalReviewText: string | null;
  createdAt: string;
};

export type WeeklyTop10ApprovalTaskExecutionUpdate = {
  decisionId: string;
  executionStatus: WeeklyTop10ApprovalTaskExecutionStatus;
  taskId?: string | null;
  taskStatus?: WeeklyTop10ApprovalTaskStatus | null;
  taskUrl?: string | null;
  taskCreatedAt?: string | null;
  taskUpdatedAt?: string | null;
  taskTargetUrl?: string | null;
  taskOpportunityType?: string | null;
  executionError?: string | null;
};

export type WeeklyTop10ApprovalTaskExecutionWriter = {
  createTask(input: WeeklyTop10ApprovalTaskCreateInput): Promise<{
    taskId: string;
    taskUrl: string | null;
  }>;
  updateDecisionTaskExecution(input: WeeklyTop10ApprovalTaskExecutionUpdate): Promise<void>;
};

export type WeeklyTop10ApprovalTaskExecutionResult = {
  tasks: WeeklyTop10ApprovalTaskCreateInput[];
  summary: {
    created: number;
    alreadyCreated: number;
    rejectedSkipped: number;
    pending: number;
    failed: number;
  };
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function weekKeyFromRunId(runId: string): string {
  const cleaned = cleanString(runId);
  return cleaned.startsWith("seo_weekly_") ? cleaned.replace(/^seo_weekly_/, "") : cleaned;
}

function taskId(input: { weekKey: string; draftTaskId: string }): string {
  return `seo_task_${input.weekKey.replace(/[^a-zA-Z0-9]+/g, "_")}_${input.draftTaskId.replace(/[^a-zA-Z0-9_-]+/g, "_")}`;
}

function evidenceFromArtifact(weeklyArtifact: unknown, decision: WeeklyTop10ApprovalDecisionRecord): Record<string, unknown> | null {
  const artifact = record(weeklyArtifact);
  const digest = record(record(artifact.gapDigestArtifact).digest);
  for (const message of array(digest.messages)) {
    const evidence = record(record(message).metadata && record(record(message).metadata).evidence);
    if (cleanString(evidence.opportunityId) === decision.opportunityId) return evidence;
    if (cleanString(evidence.clusterId) === cleanString(decision.clusterId)) return evidence;
  }
  return null;
}

function stringArray(value: unknown): string[] {
  return array(value).map(cleanString).filter(Boolean);
}

function taskStatus(input: { targetUrl: string | null; medicalReviewRequired: boolean }): WeeklyTop10ApprovalTaskStatus {
  if (!input.targetUrl) return "needs_target_page";
  return input.medicalReviewRequired ? "awaiting_medical_review" : "draft";
}

function buildCreateInput(input: {
  decision: WeeklyTop10ApprovalDecisionRecord;
  evidence: Record<string, unknown>;
  weeklyArtifact: unknown;
  now: string;
}): WeeklyTop10ApprovalTaskCreateInput {
  const artifact = record(input.weeklyArtifact);
  const weekKey = cleanString(artifact.weekKey) || weekKeyFromRunId(input.decision.runId);
  const targetUrl = cleanString(input.evidence.targetUrl) || null;
  const medicalReviewRequired = input.evidence.medicalReviewRequired !== false;
  const query = cleanString(input.evidence.query);
  const queryCluster = stringArray(input.evidence.seedQueries);
  const advisory = record(input.evidence.advisory);
  const status = taskStatus({ targetUrl, medicalReviewRequired });
  return {
    taskId: taskId({ weekKey, draftTaskId: cleanString(input.decision.draftTaskId) }),
    weekKey,
    runId: input.decision.runId,
    teamId: input.decision.teamId,
    decisionId: input.decision.id,
    opportunityId: input.decision.opportunityId,
    clusterId: cleanString(input.decision.clusterId) || cleanString(input.evidence.clusterId),
    draftTaskId: cleanString(input.decision.draftTaskId),
    title: `SEO: ${query || cleanString(input.evidence.clusterId)}`,
    section: cleanString(input.evidence.section) || "/",
    query,
    queryCluster: queryCluster.length ? queryCluster : [query].filter(Boolean),
    opportunityType: cleanString(input.evidence.opportunityType) || "section_ranking_gap",
    status,
    targetUrl,
    medicalReviewRequired,
    medicalReviewer: "",
    advisoryText: cleanString(advisory.recommendationText) || null,
    medicalReviewText: cleanString(advisory.medicalReviewText) || null,
    createdAt: input.now,
  };
}

function emptySummary(): WeeklyTop10ApprovalTaskExecutionResult["summary"] {
  return {
    created: 0,
    alreadyCreated: 0,
    rejectedSkipped: 0,
    pending: 0,
    failed: 0,
  };
}

export async function executeWeeklyTop10ApprovalTasks(input: {
  enabled: boolean;
  decisions: readonly WeeklyTop10ApprovalDecisionRecord[];
  weeklyArtifact: unknown;
  writer: WeeklyTop10ApprovalTaskExecutionWriter;
  now?: () => string;
}): Promise<WeeklyTop10ApprovalTaskExecutionResult> {
  const summary = emptySummary();
  const tasks: WeeklyTop10ApprovalTaskCreateInput[] = [];
  const now = input.now || (() => new Date().toISOString());

  for (const decision of input.decisions) {
    if (!input.enabled) {
      summary.pending += 1;
      continue;
    }
    if (decision.decision === "rejected") {
      summary.rejectedSkipped += 1;
      continue;
    }
    if (cleanString((decision as any).taskId)) {
      summary.alreadyCreated += 1;
      continue;
    }

    const evidence = evidenceFromArtifact(input.weeklyArtifact, decision);
    if (!evidence) {
      summary.failed += 1;
      await input.writer.updateDecisionTaskExecution({
        decisionId: decision.id,
        executionStatus: "execution_pending",
        executionError: "Opportunity evidence not found in weekly artifact.",
      });
      continue;
    }

    const createdAt = now();
    const task = buildCreateInput({ decision, evidence, weeklyArtifact: input.weeklyArtifact, now: createdAt });
    tasks.push(task);
    try {
      const created = await input.writer.createTask(task);
      await input.writer.updateDecisionTaskExecution({
        decisionId: decision.id,
        executionStatus: "created",
        taskId: created.taskId,
        taskStatus: task.status,
        taskUrl: created.taskUrl,
        taskCreatedAt: createdAt,
        taskUpdatedAt: createdAt,
        taskTargetUrl: task.targetUrl,
        taskOpportunityType: task.opportunityType,
        executionError: null,
      });
      summary.created += 1;
    } catch (error) {
      summary.failed += 1;
      await input.writer.updateDecisionTaskExecution({
        decisionId: decision.id,
        executionStatus: "execution_pending",
        taskStatus: task.status,
        taskTargetUrl: task.targetUrl,
        taskOpportunityType: task.opportunityType,
        executionError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { tasks, summary };
}
