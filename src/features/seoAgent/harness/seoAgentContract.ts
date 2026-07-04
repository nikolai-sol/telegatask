import type { SeoSourceName } from "../types";

export type SeoAgentAction = "create_draft_task" | "block_action" | "select_skill" | "validate_finding";

export const ALLOWED_SEO_SOURCES: SeoSourceName[] = [
  "mock",
  "sistrix",
  "pagespeed",
  "crawler",
  "gsc",
  "yandex_webmaster",
  "google_serp_rank",
  "yandex_serp_rank",
];

export const ALLOWED_AGENT_ACTIONS: SeoAgentAction[] = [
  "create_draft_task",
  "block_action",
  "select_skill",
  "validate_finding",
];

export const SEO_OUTPUT_CONSTRAINTS = {
  maxDraftTasksDefault: 5,
  requireEvidenceForFindings: true,
  requireEvidenceForDraftTasks: true,
  requireSourceFindingIdForDraftTasks: true,
  draftTasksOnly: true,
  groupRecommendationsBySeoCategory: true,
} as const;

export const SEO_AGENT_CONTRACT_RULES = [
  "Only create SEO draft tasks; never create real tasks directly.",
  "Never invent unavailable source data.",
  "Every finding must include source evidence.",
  "Recommendations must be grouped by SEO category.",
  "If GSC is unavailable, search demand conclusions must be low confidence.",
  "Do not generate more than 5 draft tasks by default.",
  "Preserve teamId and companyId on all findings and draft tasks.",
  "AI heuristic output is advisory and must never be presented as a Google ranking prediction.",
] as const;

export function isAllowedSeoSource(source: string): source is SeoSourceName {
  return ALLOWED_SEO_SOURCES.includes(source as SeoSourceName);
}

export function isAllowedAgentAction(action: string): action is SeoAgentAction {
  return ALLOWED_AGENT_ACTIONS.includes(action as SeoAgentAction);
}
