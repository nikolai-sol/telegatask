import type { WeeklyTop10GeneratorConfig } from "./weeklyTop10Generator";
import type { WeeklyTop10SnapshotRepositoryReaders } from "./weeklyTop10SnapshotRepository";
import type { SeoOpportunity } from "./types";
import {
  exportWeeklyTop10DryRunForDashboard,
  type SeoOsReportingDashboardExport,
} from "./seoOsReportingExportContract";
import { runWeeklyTop10DryRun } from "./weeklyTop10DryRunService";

export type WeeklyTop10ReportingExportInput = {
  teamId: string;
  runId: string;
  opportunities: SeoOpportunity[];
  readers: WeeklyTop10SnapshotRepositoryReaders;
  config?: Partial<WeeklyTop10GeneratorConfig>;
};

export type WeeklyTop10ReportingExportCliContract = {
  mode: "dry_run";
  outputSchema: "seo_os_reporting_dashboard_export_v1";
  writes: [];
  sendsNotifications: false;
  runsProductionPipeline: false;
  notes: string[];
};

export const WEEKLY_TOP10_REPORTING_EXPORT_CLI_CONTRACT: WeeklyTop10ReportingExportCliContract = {
  mode: "dry_run",
  outputSchema: "seo_os_reporting_dashboard_export_v1",
  writes: [],
  sendsNotifications: false,
  runsProductionPipeline: false,
  notes: [
    "This boundary runs the existing Weekly Top-10 dry-run path.",
    "It converts the dry-run result to the dashboard/reporting export contract.",
    "It does not persist dashboard data.",
    "It does not send Telegram notifications.",
    "It does not run the production SEO pipeline.",
  ],
};

export async function runWeeklyTop10ReportingExport(
  input: WeeklyTop10ReportingExportInput
): Promise<SeoOsReportingDashboardExport> {
  const dryRunResult = await runWeeklyTop10DryRun(input);
  return exportWeeklyTop10DryRunForDashboard(dryRunResult);
}
