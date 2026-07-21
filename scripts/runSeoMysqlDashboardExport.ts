import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { spawn } from "child_process";
import {
  buildMysqlDashboardExportPlan,
  runMysqlDashboardExport,
  type SeoMysqlDashboardExportConfig,
  type SeoMysqlDashboardTask,
} from "../src/features/seoAgent/mysqlDashboardExport";
import { zarukuSeoProductionConfig } from "../src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig";

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
      "Usage: runSeoMysqlDashboardExport --global-report <report.json> --out <artifact.json> [--tasks <tasks.json>] [--sql-out <export.sql>] [--execute]"
    );
  }
  return value;
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function envValue(name: string): string {
  return cleanString(process.env[name]);
}

function sectionPatternsFromConfig(): SeoMysqlDashboardExportConfig["sectionPatterns"] {
  const priorities = zarukuSeoProductionConfig.sectionRankTracking.sectionPriorities as Record<string, number>;
  return zarukuSeoProductionConfig.metrikaReport.sectionUrlPatterns.flatMap((pattern) =>
    pattern.urlIncludes.map((urlPattern) => ({
      section: pattern.section,
      urlPattern,
      priority: priorities[pattern.section] || 3,
    }))
  );
}

function buildConfig(ingestionRunId: string): SeoMysqlDashboardExportConfig {
  const config = zarukuSeoProductionConfig.mysqlDashboardExport;
  return {
    sourceKey: config.sourceKey,
    analyticsAccountId: config.analyticsAccountId,
    ingestionRunId,
    tables: config.tables,
    sectionPatterns: sectionPatternsFromConfig(),
  };
}

function readTasks(path: string | null): SeoMysqlDashboardTask[] | undefined {
  if (!path) return undefined;
  const parsed = readJsonFile(path);
  return Array.isArray(parsed) ? (parsed as SeoMysqlDashboardTask[]) : [];
}

function writesEnabled(args: string[]): boolean {
  return args.includes("--execute") && process.env[zarukuSeoProductionConfig.mysqlDashboardExport.writesFlag] === "1";
}

function mysqlExecutor(): (sql: string) => Promise<void> {
  const config = zarukuSeoProductionConfig.mysqlDashboardExport;
  const host = envValue(config.hostEnvVar);
  const port = envValue(config.portEnvVar) || "3306";
  const database = envValue(config.databaseEnvVar);
  const user = envValue(config.userEnvVar);
  const password = envValue(config.passwordEnvVar);
  if (!host || !database || !user || !password) {
    throw new Error("Missing MySQL env vars for dashboard export.");
  }

  return async (sql: string) => {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("mysql", ["--no-defaults", "--connect-timeout=10", "-h", host, "-P", port, "-u", user, database], {
        env: {
          ...process.env,
          MYSQL_PWD: password,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(stderr.trim() || `mysql exited with code ${code}`));
      });
      child.stdin.end(sql);
    });
  };
}

export async function runSeoMysqlDashboardExportCli(args = process.argv.slice(2)) {
  const globalReportPath = requiredFlag(args, "--global-report");
  const outPath = requiredFlag(args, "--out");
  const sqlOutPath = readFlag(args, "--sql-out");
  const tasksPath = readFlag(args, "--tasks");
  const report = readJsonFile(globalReportPath);
  const tasks = readTasks(tasksPath);
  const weekKey = cleanString((report as Record<string, unknown>).weekKey);
  const ingestionRunId = `seo_os_mysql_export_${weekKey || "unknown"}`;
  const config = buildConfig(ingestionRunId);
  const dryPlan = buildMysqlDashboardExportPlan({ report, tasks, config });
  const enabled = writesEnabled(args);
  const result = enabled
    ? await runMysqlDashboardExport({ report, tasks, config, executor: mysqlExecutor() })
    : {
        status: "export_pending" as const,
        error: "SEO_MYSQL_DASHBOARD_EXPORT is disabled or --execute was not provided.",
        plan: dryPlan,
      };

  if (sqlOutPath) {
    mkdirSync(dirname(sqlOutPath), { recursive: true });
    writeFileSync(sqlOutPath, `${result.plan.sql}\n`);
  }
  mkdirSync(dirname(outPath), { recursive: true });
  const artifact = {
    schemaVersion: "seo_os_mysql_dashboard_export_v1",
    generatedAt: new Date().toISOString(),
    source: enabled ? "live_mysql_export" : "local_dry_run",
    window: (report as Record<string, unknown>).window || { label: `week:${weekKey}`, kind: "week", weekKey },
    globalReportPath,
    tasksPath,
    status: result.status,
    error: result.error,
    summary: result.plan.summary,
    mysql: {
      hostEnvVar: zarukuSeoProductionConfig.mysqlDashboardExport.hostEnvVar,
      databaseEnvVar: zarukuSeoProductionConfig.mysqlDashboardExport.databaseEnvVar,
      tables: zarukuSeoProductionConfig.mysqlDashboardExport.tables,
    },
    sideEffects: {
      mysqlWrites: enabled && result.status === "exported",
      firestoreWrites: false,
      telegramMessagesSent: false,
      productionPipelineRun: false,
      readsFromMysqlIntoSeoOs: false,
    },
  };
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify(artifact, null, 2));
}

if (require.main === module) {
  runSeoMysqlDashboardExportCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
