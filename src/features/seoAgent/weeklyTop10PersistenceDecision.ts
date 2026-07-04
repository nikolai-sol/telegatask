import type { WeeklyTop10Digest, WeeklyTop10DigestItem } from "./weeklyTop10Generator";

export type WeeklyTop10PersistenceDecisionStatus = "deferred";
export type WeeklyTop10ApprovalWriteCommand =
  | "create_draft_task"
  | "approve_draft_task"
  | "reject_draft_task"
  | "convert_to_agency_task";
export type WeeklyTop10DisallowedAutomation =
  | "auto_persist_digest"
  | "auto_approve_opportunity"
  | "auto_convert_to_agency_task"
  | "send_telegram_without_approval"
  | "run_production_pipeline";

export type WeeklyTop10PersistenceDecisionContract = {
  digestPersistence: {
    decision: WeeklyTop10PersistenceDecisionStatus;
    newCollection: null;
    reason: string;
  };
  approvalBoundary: {
    stateSourceCollection: "seoDraftTasks";
    implementationSourceCollection: "agency_tasks";
    requiresHumanActor: true;
    allowedWriteCommands: WeeklyTop10ApprovalWriteCommand[];
    disallowedAutomation: WeeklyTop10DisallowedAutomation[];
  };
  reportingExport: {
    remainsReadOnly: true;
    schemaVersion: "seo_os_reporting_dashboard_export_v1";
  };
  notes: string[];
};

export type WeeklyTop10ApprovalCandidateAction =
  | "create_draft_task_for_review"
  | "keep_existing_draft_task"
  | "review_stale_approved_task";

export type WeeklyTop10ApprovalCandidate = {
  digestSection: "items" | "carriedOver" | "approvedStale";
  rank: number;
  title: string;
  state: WeeklyTop10DigestItem["state"];
  action: WeeklyTop10ApprovalCandidateAction;
  requiresHumanApproval: true;
};

export const WEEKLY_TOP10_PERSISTENCE_DECISION_CONTRACT: WeeklyTop10PersistenceDecisionContract = {
  digestPersistence: {
    decision: "deferred",
    newCollection: null,
    reason:
      "Weekly Top-10 digest persistence is deferred until a real product consumer needs history beyond reporting export.",
  },
  approvalBoundary: {
    stateSourceCollection: "seoDraftTasks",
    implementationSourceCollection: "agency_tasks",
    requiresHumanActor: true,
    allowedWriteCommands: [
      "create_draft_task",
      "approve_draft_task",
      "reject_draft_task",
      "convert_to_agency_task",
    ],
    disallowedAutomation: [
      "auto_persist_digest",
      "auto_approve_opportunity",
      "auto_convert_to_agency_task",
      "send_telegram_without_approval",
      "run_production_pipeline",
    ],
  },
  reportingExport: {
    remainsReadOnly: true,
    schemaVersion: "seo_os_reporting_dashboard_export_v1",
  },
  notes: [
    "Do not add a Weekly Top-10 persistence collection in the current step.",
    "Approval state remains represented by existing seoDraftTasks status.",
    "Implementation state remains explicit through seoDraftTasks.realTaskId -> agency_tasks.id.",
    "Any write command must be a separate human-triggered approval boundary, not part of dry-run or reporting export.",
  ],
};

function candidateFromItem(
  digestSection: WeeklyTop10ApprovalCandidate["digestSection"],
  item: WeeklyTop10DigestItem
): WeeklyTop10ApprovalCandidate {
  const action: WeeklyTop10ApprovalCandidateAction =
    digestSection === "approvedStale"
      ? "review_stale_approved_task"
      : item.state === "new"
        ? "create_draft_task_for_review"
        : "keep_existing_draft_task";

  return {
    digestSection,
    rank: item.rank,
    title: item.title,
    state: item.state,
    action,
    requiresHumanApproval: true,
  };
}

export function buildWeeklyTop10ApprovalCandidates(
  digest: WeeklyTop10Digest
): WeeklyTop10ApprovalCandidate[] {
  return [
    ...digest.items.map((item) => candidateFromItem("items", item)),
    ...digest.carriedOver.map((item) => candidateFromItem("carriedOver", item)),
    ...digest.approvedStale.map((item) => candidateFromItem("approvedStale", item)),
  ];
}
