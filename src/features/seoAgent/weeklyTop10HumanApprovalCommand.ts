import type { SeoDraftTaskStatus } from "./types";
import type { WeeklyTop10ApprovalWriteCommand } from "./weeklyTop10PersistenceDecision";

export type WeeklyTop10HumanApprovalCommandType = WeeklyTop10ApprovalWriteCommand;

export type WeeklyTop10HumanApprovalActor = {
  userId: string;
  role: "owner" | "admin" | "seo_manager";
};

export type WeeklyTop10HumanApprovalCommand = {
  type: WeeklyTop10HumanApprovalCommandType;
  teamId: string;
  runId: string;
  actor: WeeklyTop10HumanApprovalActor;
  draftTaskId?: string;
  opportunityTitle?: string;
  realTaskId?: string;
  reason?: string;
};

export type WeeklyTop10HumanApprovalCommandPlan = {
  commandType: WeeklyTop10HumanApprovalCommandType;
  requiresHumanActor: true;
  allowed: boolean;
  repositoryMethod:
    | "createSeoDraftTasks"
    | "updateSeoDraftTaskStatus"
    | "markSeoDraftTaskConverted"
    | null;
  targetDraftStatus: SeoDraftTaskStatus | null;
  writes: Array<"seoDraftTasks" | "agency_tasks">;
  runsProductionPipeline: false;
  sendsNotifications: false;
  errors: string[];
};

export type WeeklyTop10HumanApprovalCommandContract = {
  requiresHumanActor: true;
  acceptedActorRoles: WeeklyTop10HumanApprovalActor["role"][];
  commands: Record<
    WeeklyTop10HumanApprovalCommandType,
    {
      repositoryMethod:
        | "createSeoDraftTasks"
        | "updateSeoDraftTaskStatus"
        | "markSeoDraftTaskConverted";
      writes: Array<"seoDraftTasks" | "agency_tasks">;
      requiredFields: Array<keyof WeeklyTop10HumanApprovalCommand>;
      statusAfterCommand: SeoDraftTaskStatus | "converted" | "draft";
    }
  >;
  disallowedSideEffects: ["run_production_pipeline", "send_telegram", "persist_weekly_digest"];
  notes: string[];
};

export const WEEKLY_TOP10_HUMAN_APPROVAL_COMMAND_CONTRACT: WeeklyTop10HumanApprovalCommandContract = {
  requiresHumanActor: true,
  acceptedActorRoles: ["owner", "admin", "seo_manager"],
  commands: {
    create_draft_task: {
      repositoryMethod: "createSeoDraftTasks",
      writes: ["seoDraftTasks"],
      requiredFields: ["teamId", "runId", "actor", "opportunityTitle"],
      statusAfterCommand: "draft",
    },
    approve_draft_task: {
      repositoryMethod: "updateSeoDraftTaskStatus",
      writes: ["seoDraftTasks"],
      requiredFields: ["teamId", "runId", "actor", "draftTaskId"],
      statusAfterCommand: "approved",
    },
    reject_draft_task: {
      repositoryMethod: "updateSeoDraftTaskStatus",
      writes: ["seoDraftTasks"],
      requiredFields: ["teamId", "runId", "actor", "draftTaskId", "reason"],
      statusAfterCommand: "rejected",
    },
    convert_to_agency_task: {
      repositoryMethod: "markSeoDraftTaskConverted",
      writes: ["seoDraftTasks", "agency_tasks"],
      requiredFields: ["teamId", "runId", "actor", "draftTaskId", "realTaskId"],
      statusAfterCommand: "converted",
    },
  },
  disallowedSideEffects: ["run_production_pipeline", "send_telegram", "persist_weekly_digest"],
  notes: [
    "This module defines command contracts only; it does not execute repository writes.",
    "Every approval command requires an explicit human actor.",
    "Telegram delivery and production pipeline execution are outside this command boundary.",
    "Weekly Top-10 digest persistence remains deferred.",
  ],
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isAcceptedActor(actor: WeeklyTop10HumanApprovalCommand["actor"]): boolean {
  return Boolean(
    actor &&
      cleanString(actor.userId) &&
      WEEKLY_TOP10_HUMAN_APPROVAL_COMMAND_CONTRACT.acceptedActorRoles.includes(actor.role)
  );
}

function requiredFieldMissing(
  command: WeeklyTop10HumanApprovalCommand,
  field: keyof WeeklyTop10HumanApprovalCommand
): boolean {
  if (field === "actor") return !isAcceptedActor(command.actor);
  const value = command[field];
  return !cleanString(value);
}

function targetDraftStatus(
  commandType: WeeklyTop10HumanApprovalCommandType
): SeoDraftTaskStatus | null {
  if (commandType === "approve_draft_task") return "approved";
  if (commandType === "reject_draft_task") return "rejected";
  if (commandType === "create_draft_task") return "draft";
  return null;
}

export function planWeeklyTop10HumanApprovalCommand(
  command: WeeklyTop10HumanApprovalCommand
): WeeklyTop10HumanApprovalCommandPlan {
  const commandContract = WEEKLY_TOP10_HUMAN_APPROVAL_COMMAND_CONTRACT.commands[command.type];
  const errors = commandContract
    ? commandContract.requiredFields
        .filter((field) => requiredFieldMissing(command, field))
        .map((field) => `Missing required field: ${String(field)}`)
    : [`Unsupported command type: ${command.type}`];

  return {
    commandType: command.type,
    requiresHumanActor: true,
    allowed: errors.length === 0,
    repositoryMethod: errors.length === 0 ? commandContract.repositoryMethod : null,
    targetDraftStatus: errors.length === 0 ? targetDraftStatus(command.type) : null,
    writes: errors.length === 0 ? [...commandContract.writes] : [],
    runsProductionPipeline: false,
    sendsNotifications: false,
    errors,
  };
}
