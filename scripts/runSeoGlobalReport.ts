import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import "../src/config/firebase";
import { buildSeoGlobalReport } from "../src/features/seoAgent/globalReportAssembler";
import { zarukuSeoProductionConfig } from "../src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig";
import type { SeoRankDashboardExport } from "../src/features/seoAgent/sectionRankTracking";
import { listWeeklyTop10ApprovalDecisionsByTeam } from "../src/features/seoAgent/weeklyTop10ApprovalDecisionRepository";
import { collectYandexMetrikaSectionTraffic } from "../src/features/seoAgent/yandexMetrikaReportCollector";

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readFlag(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  return cleanString(args[index + 1]) || null;
}

function requiredFlag(args: string[], name: string): string {
  const value = readFlag(args, name);
  if (!value) {
    throw new Error(
      "Usage: runSeoGlobalReport --week-key <YYYY-Www> --weekly-artifact <task-048.json> --out <global-report.json> --raw-out <metrika-raw.json>"
    );
  }
  return value;
}

function nestedRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function rankDashboardFromWeeklyArtifact(artifact: unknown): SeoRankDashboardExport {
  const root = nestedRecord(artifact);
  const rankTracking = nestedRecord(root.rankTrackingArtifact);
  const dashboard = rankTracking.dashboard;
  if (!dashboard || typeof dashboard !== "object") {
    throw new Error("weekly artifact does not contain rankTrackingArtifact.dashboard");
  }
  return dashboard as SeoRankDashboardExport;
}

export async function runSeoGlobalReportCli(args = process.argv.slice(2)) {
  const weekKey = requiredFlag(args, "--week-key");
  const weeklyArtifactPath = requiredFlag(args, "--weekly-artifact");
  const outPath = requiredFlag(args, "--out");
  const rawOutPath = requiredFlag(args, "--raw-out");
  const generatedAt = new Date().toISOString();
  const weeklyArtifact = JSON.parse(readFileSync(weeklyArtifactPath, "utf8"));
  const runId = cleanString(nestedRecord(weeklyArtifact).runId) || `seo_weekly_${weekKey}`;

  const metrika = await collectYandexMetrikaSectionTraffic({
    generatedAt,
    weekKey,
    domain: zarukuSeoProductionConfig.domain,
    config: zarukuSeoProductionConfig.metrikaReport,
  });
  const decisions = await listWeeklyTop10ApprovalDecisionsByTeam(zarukuSeoProductionConfig.team.id);
  const globalReport = buildSeoGlobalReport({
    generatedAt,
    weekKey,
    runId,
    domain: zarukuSeoProductionConfig.domain,
    teamId: zarukuSeoProductionConfig.team.id,
    rankDashboard: rankDashboardFromWeeklyArtifact(weeklyArtifact),
    weeklyRhythmArtifact: weeklyArtifact,
    decisions,
    metrika: metrika.report,
  });

  mkdirSync(dirname(rawOutPath), { recursive: true });
  writeFileSync(rawOutPath, `${JSON.stringify(metrika.rawSnapshot, null, 2)}\n`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify({
    ...globalReport,
    source: "local_opt_in",
    inputs: {
      weeklyArtifactPath,
      rawMetrikaSnapshotPath: rawOutPath,
      approvalDecisions: decisions.length,
    },
    sideEffects: {
      ...globalReport.sideEffects,
      firestoreReads: true,
      metrikaApiReads: metrika.rawSnapshot.requestCount,
      reportArtifactsWritten: true,
    },
  }, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        outPath,
        rawOutPath,
        weekKey,
        runId,
        metrikaStatus: metrika.report.status,
        metrikaRequestCount: metrika.report.requestCount,
        sectionsWithTraffic: metrika.report.summary.sectionsWithTraffic,
        rankSections: globalReport.layers.positions.sections.length,
        opportunityCount: globalReport.layers.systemWork.summary.opportunityCount,
        approvalDecisions: decisions.length,
        sideEffects: {
          firestoreReads: true,
          firestoreWrites: false,
          telegramMessagesSent: false,
          approvalCommandExecuted: false,
          productionPipelineRun: false,
          actionsGeneratedFromMetrika: false,
        },
      },
      null,
      2
    )
  );
}

if (require.main === module) {
  runSeoGlobalReportCli().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
