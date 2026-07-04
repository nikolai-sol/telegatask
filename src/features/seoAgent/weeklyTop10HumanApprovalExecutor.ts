import type { SeoDraftTaskStatus } from "./types";
import {
  planWeeklyTop10HumanApprovalCommand,
  type WeeklyTop10HumanApprovalActor,
  type WeeklyTop10HumanApprovalCommand,
  type WeeklyTop10HumanApprovalCommandPlan,
} from "./weeklyTop10HumanApprovalCommand";

export type WeeklyTop10HumanApprovalExecutorContract = {
  usesInjectedWriters: true;
  importsFirestore: false;
  executesOnlyValidPlans: true;
  runsProductionPipeline: false;
  sendsNotifications: false;
  persistsWeeklyDigest: false;
  notes: string[];
};

export type WeeklyTop10CreateDraftTaskWriterInput = {
  teamId: string;
  runId: string;
  actor: WeeklyTop10HumanApprovalActor;
  opportunityTitle: string;
  reason: string | null;
};

export type WeeklyTop10UpdateDraftTaskStatusWriterInput = {
  teamId: string;
  draftTaskId: string;
  status: Extract<SeoDraftTaskStatus, "approved" | "rejected">;
  actor: WeeklyTop10HumanApprovalActor;
  reason: string | null;
};

export type WeeklyTop10MarkDraftTaskConvertedWriterInput = {
  teamId: string;
  draftTaskId: string;
  realTaskId: string;
  convertedByUserId: string;
};

export type WeeklyTop10HumanApprovalExecutorWriters = {
  createDraftTask(input: WeeklyTop10CreateDraftTaskWriterInput): Promise<{ draftTaskId: string }>;
  updateDraftTaskStatus(
    input: WeeklyTop10UpdateDraftTaskStatusWriterInput
  ): Promise<{ draftTaskId: string; status: SeoDraftTaskStatus }>;
  markDraftTaskConverted(
    input: WeeklyTop10MarkDraftTaskConvertedWriterInput
  ): Promise<{ draftTaskId: string; realTaskId: string }>;
};

export type WeeklyTop10HumanApprovalExecutorResult = {
  executed: boolean;
  plan: WeeklyTop10HumanApprovalCommandPlan;
  result:
    | { type: "draft_task_created"; draftTaskId: string }
    | { type: "draft_task_status_updated"; draftTaskId: string; status: SeoDraftTaskStatus }
    | { type: "draft_task_converted"; draftTaskId: string; realTaskId: string }
    | null;
  sideEffects: {
    productionPipelineRun: false;
    sent: false;
    weeklyDigestPersisted: false;
  };
};

export const WEEKLY_TOP10_HUMAN_APPROVAL_EXECUTOR_CONTRACT: WeeklyTop10HumanApprovalExecutorContract = {
  usesInjectedWriters: true,
  importsFirestore: false,
  executesOnlyValidPlans: true,
  runsProductionPipeline: false,
  sendsNotifications: false,
  persistsWeeklyDigest: false,
  notes: [
    "This executor boundary has no direct Firestore dependency.",
    "Repository/service writers must be injected by a separate adapter.",
    "Invalid command plans do not call writer functions.",
    "The executor does not send Telegram notifications, persist Weekly Top-10 digests, or run the production pipeline.",
  ],
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function emptySideEffects(): WeeklyTop10HumanApprovalExecutorResult["sideEffects"] {
  return {
    productionPipelineRun: false,
    sent: false,
    weeklyDigestPersisted: false,
  };
}

export async function executeWeeklyTop10HumanApprovalCommand(
  writers: WeeklyTop10HumanApprovalExecutorWriters,
  command: WeeklyTop10HumanApprovalCommand
): Promise<WeeklyTop10HumanApprovalExecutorResult> {
  const plan = planWeeklyTop10HumanApprovalCommand(command);
  if (!plan.allowed) {
    return {
      executed: false,
      plan,
      result: null,
      sideEffects: emptySideEffects(),
    };
  }

  if (command.type === "create_draft_task") {
    const result = await writers.createDraftTask({
      teamId: command.teamId,
      runId: command.runId,
      actor: command.actor,
      opportunityTitle: cleanString(command.opportunityTitle),
      reason: cleanString(command.reason) || null,
    });
    return {
      executed: true,
      plan,
      result: {
        type: "draft_task_created",
        draftTaskId: result.draftTaskId,
      },
      sideEffects: emptySideEffects(),
    };
  }

  if (command.type === "approve_draft_task" || command.type === "reject_draft_task") {
    const status = command.type === "approve_draft_task" ? "approved" : "rejected";
    const result = await writers.updateDraftTaskStatus({
      teamId: command.teamId,
      draftTaskId: cleanString(command.draftTaskId),
      status,
      actor: command.actor,
      reason: cleanString(command.reason) || null,
    });
    return {
      executed: true,
      plan,
      result: {
        type: "draft_task_status_updated",
        draftTaskId: result.draftTaskId,
        status: result.status,
      },
      sideEffects: emptySideEffects(),
    };
  }

  const result = await writers.markDraftTaskConverted({
    teamId: command.teamId,
    draftTaskId: cleanString(command.draftTaskId),
    realTaskId: cleanString(command.realTaskId),
    convertedByUserId: command.actor.userId,
  });
  return {
    executed: true,
    plan,
    result: {
      type: "draft_task_converted",
      draftTaskId: result.draftTaskId,
      realTaskId: result.realTaskId,
    },
    sideEffects: emptySideEffects(),
  };
}
