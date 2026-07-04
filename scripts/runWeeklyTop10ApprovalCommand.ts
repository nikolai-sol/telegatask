import "dotenv/config";
import {
  parseWeeklyTop10HumanApprovalRunnerOptions,
  runWeeklyTop10HumanApprovalRunner,
} from "../src/features/seoAgent/weeklyTop10HumanApprovalRunnerCli";
import type { WeeklyTop10HumanApprovalExecutorWriters } from "../src/features/seoAgent/weeklyTop10HumanApprovalExecutor";

async function firestoreWriters(): Promise<WeeklyTop10HumanApprovalExecutorWriters> {
  await import("../src/config/firebase");
  const repository = await import("../src/features/seoAgent/seoDraftTaskRepository");
  return {
    createDraftTask: async () => {
      throw new Error("create_draft_task execution is not wired in this guarded local runner yet.");
    },
    updateDraftTaskStatus: async (input) => {
      const updated = await repository.updateSeoDraftTaskStatus({
        teamId: input.teamId,
        draftTaskId: input.draftTaskId,
        status: input.status,
      });
      if (!updated) throw new Error("SEO draft task not found.");
      return {
        draftTaskId: updated.id,
        status: updated.status,
      };
    },
    markDraftTaskConverted: async (input) => {
      const updated = await repository.markSeoDraftTaskConverted({
        teamId: input.teamId,
        draftTaskId: input.draftTaskId,
        realTaskId: input.realTaskId,
        convertedByUserId: input.convertedByUserId,
      });
      if (!updated) throw new Error("SEO draft task not found.");
      return {
        draftTaskId: updated.id,
        realTaskId: updated.realTaskId || input.realTaskId,
      };
    },
  };
}

async function main() {
  const options = parseWeeklyTop10HumanApprovalRunnerOptions(process.argv.slice(2));
  const writers = options.execute ? await firestoreWriters() : undefined;
  const result = await runWeeklyTop10HumanApprovalRunner(options, writers);
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length > 0 || result.execution?.plan.allowed === false) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => process.exit(process.exitCode || 0), 250);
  });
