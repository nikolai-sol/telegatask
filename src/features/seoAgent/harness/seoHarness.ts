import type {
  SeoBlockedAction,
  SeoConfidence,
  SeoFinding,
  SeoHarnessDraftTask,
  SeoHarnessMetadata,
  SeoPriority,
  SeoSelectedSkill,
  SeoSourceStatus,
} from "../types";
import { SEO_OUTPUT_CONSTRAINTS } from "./seoAgentContract";
import { hasEvidence, normalizeEvidence } from "./seoEvidence";
import { realizeSeoActions } from "./seoActionRealizer";
import { regulateSeoTrajectory } from "./seoTrajectoryRegulator";
import { type NormalizedSeoSourceOutputs, retrieveSeoSkills } from "./seoSkillRetriever";

type RawSeoFinding = Partial<SeoFinding> & {
  severity?: SeoPriority | "critical";
};

export type RunSeoHarnessInput = {
  domain: string;
  teamId: string;
  companyId: string;
  sourceStatuses: SeoSourceStatus[];
  normalizedSourceOutputs: NormalizedSeoSourceOutputs;
  llmFindings: RawSeoFinding[];
};

export type RunSeoHarnessResult = {
  findings: SeoFinding[];
  draftTasks: SeoHarnessDraftTask[];
  warnings: string[];
  blockedActions: SeoBlockedAction[];
  selectedSkills: SeoSelectedSkill[];
  confidenceSummary: SeoHarnessMetadata["confidenceSummary"];
};

function normalizeSeverity(value: SeoPriority | "critical" | undefined): SeoPriority {
  if (value === "critical" || value === "high") return "high";
  if (value === "low") return "low";
  return "medium";
}

function normalizeConfidence(value: SeoConfidence | undefined): SeoConfidence {
  if (value === "high" || value === "low") return value;
  return "medium";
}

function normalizeFinding(input: {
  raw: RawSeoFinding;
  index: number;
  domain: string;
  teamId: string;
  companyId: string;
}): SeoFinding | null {
  const title = String(input.raw.title || "").trim();
  if (!title) return null;
  const id = String(input.raw.id || `finding-${input.index + 1}`).trim();
  const category = input.raw.category || "technical";
  const evidence = normalizeEvidence(input.raw.evidence || []);

  return {
    id,
    teamId: input.teamId,
    companyId: input.companyId,
    domain: input.domain,
    url: typeof input.raw.url === "string" && input.raw.url.trim() ? input.raw.url.trim() : null,
    type: String(input.raw.type || category),
    category,
    title,
    description: String(input.raw.description || input.raw.recommendedAction || title).trim(),
    source: input.raw.source || evidence[0]?.source || "harness",
    severity: normalizeSeverity(input.raw.severity),
    confidence: normalizeConfidence(input.raw.confidence),
    evidence,
    recommendation: String(input.raw.recommendation || input.raw.recommendedAction || input.raw.description || title).trim(),
    labels: Array.isArray(input.raw.labels) ? input.raw.labels : [],
    ...(input.raw.recommendedAction ? { recommendedAction: input.raw.recommendedAction } : {}),
    targetKeywords: Array.isArray(input.raw.targetKeywords) ? input.raw.targetKeywords : [],
    sourceType: input.raw.sourceType === "opportunity" ? "opportunity" : "recommendation",
    sourceId: input.raw.sourceId || null,
  };
}

function draftPriority(severity: SeoPriority): SeoHarnessDraftTask["priority"] {
  return severity === "high" ? "priority" : "normal";
}

function buildDraftTaskFromFinding(finding: SeoFinding): SeoHarnessDraftTask {
  return {
    teamId: finding.teamId,
    companyId: finding.companyId,
    domain: finding.domain,
    sourceFindingId: finding.id,
    sourceType: finding.sourceType,
    sourceId: finding.sourceId,
    title: finding.title,
    description: finding.recommendedAction || finding.description,
    priority: draftPriority(finding.severity),
    targetKeywords: finding.targetKeywords,
    evidence: finding.evidence,
  };
}

export function runSeoHarness(input: RunSeoHarnessInput): RunSeoHarnessResult {
  const warnings: string[] = [];
  const blockedActions: SeoBlockedAction[] = [];
  const selectedSkills = retrieveSeoSkills({
    domain: input.domain,
    normalizedSourceOutputs: {
      ...input.normalizedSourceOutputs,
      sourceStatuses: input.sourceStatuses,
    },
    limit: 3,
  }).map((skill) => ({ id: skill.id, title: skill.title, score: skill.score }));

  const normalizedFindings: SeoFinding[] = [];
  input.llmFindings.forEach((raw, index) => {
    const finding = normalizeFinding({
      raw,
      index,
      domain: input.domain,
      teamId: input.teamId,
      companyId: input.companyId,
    });
    if (!finding) return;
    if (SEO_OUTPUT_CONSTRAINTS.requireEvidenceForFindings && !hasEvidence(finding)) {
      blockedActions.push({
        action: "validate_finding",
        reason: "Finding blocked because evidence is missing.",
        sourceFindingId: finding.id,
        title: finding.title,
      });
      return;
    }
    normalizedFindings.push(finding);
  });

  const draftIntents = normalizedFindings.map(buildDraftTaskFromFinding);
  const realized = realizeSeoActions({
    draftTasks: draftIntents,
    attemptedActions: ["create_draft_task"],
  });
  const regulated = regulateSeoTrajectory({
    findings: normalizedFindings,
    draftTasks: realized.draftTasks,
    sourceStatuses: input.sourceStatuses,
  });

  return {
    findings: regulated.findings,
    draftTasks: regulated.draftTasks,
    warnings: [...warnings, ...realized.warnings, ...regulated.warnings],
    blockedActions: [...blockedActions, ...realized.blockedActions, ...regulated.blockedActions],
    selectedSkills,
    confidenceSummary: regulated.confidenceSummary,
  };
}
