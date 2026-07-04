import {
  executeWeeklyTop10HumanApprovalCommand,
  type WeeklyTop10HumanApprovalExecutorResult,
  type WeeklyTop10HumanApprovalExecutorWriters,
} from "./weeklyTop10HumanApprovalExecutor";
import {
  planWeeklyTop10HumanApprovalCommand,
  type WeeklyTop10HumanApprovalActor,
  type WeeklyTop10HumanApprovalCommand,
  type WeeklyTop10HumanApprovalCommandType,
  type WeeklyTop10HumanApprovalCommandPlan,
} from "./weeklyTop10HumanApprovalCommand";

export const WEEKLY_TOP10_APPROVAL_EXECUTE_CONFIRMATION = "APPROVE_WEEKLY_TOP10_COMMAND";

export type WeeklyTop10HumanApprovalRunnerOptions = {
  command: WeeklyTop10HumanApprovalCommand;
  execute: boolean;
  confirmExecute: string | null;
};

export type WeeklyTop10HumanApprovalRunnerResult = {
  mode: "plan" | "execute";
  command: WeeklyTop10HumanApprovalCommand;
  plan: WeeklyTop10HumanApprovalCommandPlan;
  execution: WeeklyTop10HumanApprovalExecutorResult | null;
  guardrails: {
    requiresExecuteFlag: true;
    requiresConfirmation: typeof WEEKLY_TOP10_APPROVAL_EXECUTE_CONFIRMATION;
    productionPipelineRun: false;
    sendsNotifications: false;
    weeklyDigestPersisted: false;
  };
  errors: string[];
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readFlag(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  return cleanString(args[index + 1]) || null;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function actorRole(raw: string | null): WeeklyTop10HumanApprovalActor["role"] {
  return cleanString(raw || "seo_manager") as WeeklyTop10HumanApprovalActor["role"];
}

export function parseWeeklyTop10HumanApprovalRunnerOptions(
  args: string[]
): WeeklyTop10HumanApprovalRunnerOptions {
  const command: WeeklyTop10HumanApprovalCommand = {
    type: cleanString(readFlag(args, "--type")) as WeeklyTop10HumanApprovalCommandType,
    teamId: cleanString(readFlag(args, "--team-id")),
    runId: cleanString(readFlag(args, "--run-id")),
    actor: {
      userId: cleanString(readFlag(args, "--actor-user-id")),
      role: actorRole(readFlag(args, "--actor-role")),
    },
    draftTaskId: cleanString(readFlag(args, "--draft-task-id")) || undefined,
    opportunityTitle: cleanString(readFlag(args, "--opportunity-title")) || undefined,
    realTaskId: cleanString(readFlag(args, "--real-task-id")) || undefined,
    reason: cleanString(readFlag(args, "--reason")) || undefined,
  };

  return {
    command,
    execute: hasFlag(args, "--execute"),
    confirmExecute: readFlag(args, "--confirm-execute"),
  };
}

function guardrails(): WeeklyTop10HumanApprovalRunnerResult["guardrails"] {
  return {
    requiresExecuteFlag: true,
    requiresConfirmation: WEEKLY_TOP10_APPROVAL_EXECUTE_CONFIRMATION,
    productionPipelineRun: false,
    sendsNotifications: false,
    weeklyDigestPersisted: false,
  };
}

function guardedPlanResult(
  options: WeeklyTop10HumanApprovalRunnerOptions,
  plan: WeeklyTop10HumanApprovalCommandPlan,
  errors: string[]
): WeeklyTop10HumanApprovalRunnerResult {
  return {
    mode: options.execute ? "execute" : "plan",
    command: options.command,
    plan,
    execution: null,
    guardrails: guardrails(),
    errors,
  };
}

export async function runWeeklyTop10HumanApprovalRunner(
  options: WeeklyTop10HumanApprovalRunnerOptions,
  writers?: WeeklyTop10HumanApprovalExecutorWriters
): Promise<WeeklyTop10HumanApprovalRunnerResult> {
  const plan = planWeeklyTop10HumanApprovalCommand(options.command);
  if (!options.execute) {
    return guardedPlanResult(options, plan, []);
  }
  if (options.confirmExecute !== WEEKLY_TOP10_APPROVAL_EXECUTE_CONFIRMATION) {
    return guardedPlanResult(options, plan, [
      `Execution requires --confirm-execute ${WEEKLY_TOP10_APPROVAL_EXECUTE_CONFIRMATION}`,
    ]);
  }
  if (!writers) {
    return guardedPlanResult(options, plan, ["Execution requires injected repository writers."]);
  }

  const execution = await executeWeeklyTop10HumanApprovalCommand(writers, options.command);
  return {
    mode: "execute",
    command: options.command,
    plan,
    execution,
    guardrails: guardrails(),
    errors: execution.plan.errors,
  };
}
