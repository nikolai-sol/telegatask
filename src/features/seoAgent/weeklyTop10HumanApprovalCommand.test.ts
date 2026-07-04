import { describe, expect, test } from "vitest";
import {
  planWeeklyTop10HumanApprovalCommand,
  WEEKLY_TOP10_HUMAN_APPROVAL_COMMAND_CONTRACT,
} from "./weeklyTop10HumanApprovalCommand";

const actor = {
  userId: "user-1",
  role: "seo_manager" as const,
};

describe("weeklyTop10HumanApprovalCommand", () => {
  test("documents the human approval command contract", () => {
    expect(WEEKLY_TOP10_HUMAN_APPROVAL_COMMAND_CONTRACT).toEqual({
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
    });
  });

  test("plans an approve command without executing repository writes", () => {
    expect(
      planWeeklyTop10HumanApprovalCommand({
        type: "approve_draft_task",
        teamId: "team-1",
        runId: "run-1",
        draftTaskId: "draft-1",
        actor,
      })
    ).toEqual({
      commandType: "approve_draft_task",
      requiresHumanActor: true,
      allowed: true,
      repositoryMethod: "updateSeoDraftTaskStatus",
      targetDraftStatus: "approved",
      writes: ["seoDraftTasks"],
      runsProductionPipeline: false,
      sendsNotifications: false,
      errors: [],
    });
  });

  test("plans a conversion command as explicit human action and no delivery side effects", () => {
    expect(
      planWeeklyTop10HumanApprovalCommand({
        type: "convert_to_agency_task",
        teamId: "team-1",
        runId: "run-1",
        draftTaskId: "draft-1",
        realTaskId: "agency-task-1",
        actor,
      })
    ).toEqual({
      commandType: "convert_to_agency_task",
      requiresHumanActor: true,
      allowed: true,
      repositoryMethod: "markSeoDraftTaskConverted",
      targetDraftStatus: null,
      writes: ["seoDraftTasks", "agency_tasks"],
      runsProductionPipeline: false,
      sendsNotifications: false,
      errors: [],
    });
  });

  test("rejects missing human actor and command-specific fields", () => {
    expect(
      planWeeklyTop10HumanApprovalCommand({
        type: "reject_draft_task",
        teamId: "team-1",
        runId: "run-1",
        actor: { userId: "", role: "seo_manager" },
      })
    ).toEqual({
      commandType: "reject_draft_task",
      requiresHumanActor: true,
      allowed: false,
      repositoryMethod: null,
      targetDraftStatus: null,
      writes: [],
      runsProductionPipeline: false,
      sendsNotifications: false,
      errors: [
        "Missing required field: actor",
        "Missing required field: draftTaskId",
        "Missing required field: reason",
      ],
    });
  });
});
