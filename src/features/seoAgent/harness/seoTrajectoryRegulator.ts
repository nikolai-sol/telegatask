import type {
  SeoBlockedAction,
  SeoConfidence,
  SeoConfidenceSummary,
  SeoFinding,
  SeoHarnessDraftTask,
  SeoPriority,
  SeoSourceStatus,
} from "../types";
import { SEO_OUTPUT_CONSTRAINTS } from "./seoAgentContract";
import { confidenceFromSourceStatuses, normalizeEvidence } from "./seoEvidence";

export type SeoTrajectoryRegulatorResult = {
  findings: SeoFinding[];
  draftTasks: SeoHarnessDraftTask[];
  warnings: string[];
  blockedActions: SeoBlockedAction[];
  confidenceSummary: SeoConfidenceSummary;
};

const severityWeight: Record<SeoPriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const confidenceWeight: Record<SeoConfidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

function findingKey(finding: SeoFinding): string {
  return `${finding.category}:${finding.title.trim().toLowerCase()}`;
}

function taskRank(task: SeoHarnessDraftTask, findingsById: Map<string, SeoFinding>): number {
  const finding = findingsById.get(task.sourceFindingId);
  const severity = finding ? severityWeight[finding.severity] : task.priority === "priority" ? 3 : 1;
  const confidence = finding ? confidenceWeight[finding.confidence] : 1;
  return severity * 10 + confidence;
}

function summarizeConfidence(findings: SeoFinding[]): SeoConfidenceSummary {
  return findings.reduce(
    (summary, finding) => ({
      ...summary,
      [finding.confidence]: summary[finding.confidence] + 1,
    }),
    { high: 0, medium: 0, low: 0 } as SeoConfidenceSummary
  );
}

export function regulateSeoTrajectory(input: {
  findings: SeoFinding[];
  draftTasks: SeoHarnessDraftTask[];
  sourceStatuses: SeoSourceStatus[];
}): SeoTrajectoryRegulatorResult {
  const warnings: string[] = [];
  const blockedActions: SeoBlockedAction[] = [];
  const seenFindings = new Set<string>();
  const regulatedFindings: SeoFinding[] = [];

  for (const status of input.sourceStatuses) {
    if (status.status === "partial") {
      warnings.push(`Source ${status.source} returned partial data: ${status.message}`);
    }
    if (status.status === "failed") {
      warnings.push(`Source ${status.source} failed: ${status.message}`);
    }
  }

  for (const finding of input.findings) {
    const key = findingKey(finding);
    if (seenFindings.has(key)) {
      blockedActions.push({
        action: "validate_finding",
        reason: "Duplicate recommendation/finding merged or blocked.",
        sourceFindingId: finding.id,
        title: finding.title,
      });
      continue;
    }
    seenFindings.add(key);
    regulatedFindings.push({
      ...finding,
      evidence: normalizeEvidence(finding.evidence),
      confidence: confidenceFromSourceStatuses(input.sourceStatuses, finding),
    });
  }

  const lowConfidenceCount = regulatedFindings.filter((finding) => finding.confidence === "low").length;
  if (lowConfidenceCount > Math.max(2, regulatedFindings.length / 2)) {
    warnings.push("Run contains many low-confidence findings; use source evidence review before approving draft tasks.");
  }

  const findingsById = new Map(regulatedFindings.map((finding) => [finding.id, finding]));
  const sortedTasks = [...input.draftTasks].sort((a, b) => taskRank(b, findingsById) - taskRank(a, findingsById));
  const taskLimit = SEO_OUTPUT_CONSTRAINTS.maxDraftTasksDefault;
  const limitedTasks = sortedTasks.slice(0, taskLimit);

  for (const task of sortedTasks.slice(taskLimit)) {
    blockedActions.push({
      action: "create_draft_task",
      reason: `Draft task blocked because SEO Agent MVP limits output to ${taskLimit} tasks by default.`,
      sourceFindingId: task.sourceFindingId,
      title: task.title,
    });
  }

  return {
    findings: regulatedFindings,
    draftTasks: limitedTasks,
    warnings,
    blockedActions,
    confidenceSummary: summarizeConfidence(regulatedFindings),
  };
}
