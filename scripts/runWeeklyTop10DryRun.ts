import "dotenv/config";
import "../src/config/firebase";
import { getAgencyTaskById } from "../src/services/firestore.service";
import { listSeoDraftTasksByRun } from "../src/features/seoAgent/seoDraftTaskRepository";
import { readSeoOpportunitiesFile, parseWeeklyTop10DryRunCliOptions } from "../src/features/seoAgent/weeklyTop10DryRunCli";
import { runWeeklyTop10DryRun } from "../src/features/seoAgent/weeklyTop10DryRunService";

async function main() {
  const options = parseWeeklyTop10DryRunCliOptions(process.argv.slice(2));
  const opportunities = readSeoOpportunitiesFile(options.opportunitiesPath);
  const result = await runWeeklyTop10DryRun({
    teamId: options.teamId,
    runId: options.runId,
    opportunities,
    config: options.config,
    readers: {
      listDraftTasksByRun: ({ teamId, runId }) => listSeoDraftTasksByRun(teamId, runId),
      getImplementationTaskById: getAgencyTaskById,
    },
  });

  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => process.exit(process.exitCode || 0), 250);
  });
