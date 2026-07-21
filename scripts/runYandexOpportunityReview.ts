import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import {
  buildYandexOpportunityReviewArtifact,
  parseYandexOpportunityReviewCliOptions,
} from "../src/features/seoAgent/yandexOpportunityReviewCli";

async function main() {
  const options = parseYandexOpportunityReviewCliOptions(process.argv.slice(2));
  const report = JSON.parse(readFileSync(options.reportPath, "utf8"));
  const artifact = buildYandexOpportunityReviewArtifact({
    report,
    reportPath: options.reportPath,
    now: options.now,
    market: options.market,
    language: options.language,
  });

  mkdirSync(dirname(options.outputPath), { recursive: true });
  writeFileSync(options.outputPath, `${JSON.stringify(artifact, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        outputPath: options.outputPath,
        schemaVersion: artifact.schemaVersion,
        searchPerformanceRecords: artifact.searchPerformance.recordCount,
        queryToPageCandidateUrls: artifact.queryToPageEvidence.summary.withCandidateUrl,
        opportunities: artifact.opportunityCount,
        sideEffects: artifact.sideEffects,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
