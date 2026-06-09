import type { SeoBlockedAction, SeoHarnessDraftTask } from "../types";
import { SEO_OUTPUT_CONSTRAINTS } from "./seoAgentContract";
import { normalizeEvidence } from "./seoEvidence";

export type SeoActionRealizerResult = {
  draftTasks: SeoHarnessDraftTask[];
  blockedActions: SeoBlockedAction[];
  warnings: string[];
};

function taskKey(task: SeoHarnessDraftTask): string {
  return `${task.sourceFindingId}:${task.title.trim().toLowerCase()}`;
}

export function realizeSeoActions(input: {
  draftTasks: SeoHarnessDraftTask[];
  attemptedActions?: string[];
}): SeoActionRealizerResult {
  const warnings: string[] = [];
  const blockedActions: SeoBlockedAction[] = [];
  const realized: SeoHarnessDraftTask[] = [];
  const seen = new Set<string>();

  for (const action of input.attemptedActions || []) {
    if (action !== "create_draft_task") {
      blockedActions.push({
        action,
        reason: "SEO Agent MVP may only create draft tasks; direct task creation or execution is blocked.",
      });
    }
  }

  for (const rawTask of input.draftTasks) {
    let task = rawTask;
    const evidence = normalizeEvidence(task.evidence);
    if (SEO_OUTPUT_CONSTRAINTS.requireSourceFindingIdForDraftTasks && !task.sourceFindingId) {
      blockedActions.push({
        action: "create_draft_task",
        reason: "Draft task blocked because sourceFindingId is missing.",
        title: task.title,
      });
      continue;
    }
    if (SEO_OUTPUT_CONSTRAINTS.requireEvidenceForDraftTasks && evidence.length === 0) {
      blockedActions.push({
        action: "create_draft_task",
        reason: "Draft task blocked because evidence is missing.",
        sourceFindingId: task.sourceFindingId,
        title: task.title,
      });
      continue;
    }
    if (task.priority === "fire") {
      warnings.push(`Draft task priority downgraded from fire to priority: ${task.title}`);
      task = { ...task, priority: "priority" };
    }

    const key = taskKey(task);
    if (seen.has(key)) {
      blockedActions.push({
        action: "create_draft_task",
        reason: "Duplicate draft task blocked.",
        sourceFindingId: task.sourceFindingId,
        title: task.title,
      });
      continue;
    }
    seen.add(key);
    realized.push({
      ...task,
      evidence,
      priority: task.priority === "fire" ? "priority" : task.priority,
    });
  }

  return { draftTasks: realized, blockedActions, warnings };
}
