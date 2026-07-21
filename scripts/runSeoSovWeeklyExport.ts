import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { spawn } from "child_process";
import {
  buildSovWeeklyExportPlan,
  buildSovWeeklyRecordsFromYandexWmSnapshot,
  type SeoMysqlDashboardExportConfig,
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
      "Usage: runSeoSovWeeklyExport --sov-snapshot <snapshot.json> --week-key <YYYY-Www> --snapshot-date <YYYY-MM-DD> --out <artifact.json> [--sql-out <export.sql>] [--execute]"
    );
  }
  return value;
}

function envValue(name: string): string {
  return cleanString(process.env[name]);
}

function buildConfig(ingestionRunId: string): SeoMysqlDashboardExportConfig {
  const config = zarukuSeoProductionConfig.mysqlDashboardExport;
  return {
    sourceKey: config.sourceKey,
    analyticsAccountId: config.analyticsAccountId,
    ingestionRunId,
    tables: config.tables,
    sectionPatterns: [],
  };
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
        env: { ...process.env, MYSQL_PWD: password },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `mysql exited with code ${code}`));
      });
      child.stdin.end(sql);
    });
  };
}

export async function runSeoSovWeeklyExportCli(args = process.argv.slice(2)) {
  const snapshotPath = requiredFlag(args, "--sov-snapshot");
  const weekKey = requiredFlag(args, "--week-key");
  const snapshotDate = requiredFlag(args, "--snapshot-date");
  const outPath = requiredFlag(args, "--out");
  const sqlOutPath = readFlag(args, "--sql-out");
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const records = buildSovWeeklyRecordsFromYandexWmSnapshot({ snapshot, weekKey, snapshotDate });
  const plan = buildSovWeeklyExportPlan({
    records,
    config: buildConfig(`seo_os_sov_weekly_${weekKey}`),
  });
  const enabled = writesEnabled(args);
  let status: "exported" | "export_pending" = "export_pending";
  let error: string | null = "SEO_MYSQL_DASHBOARD_EXPORT is disabled or --execute was not provided.";
  if (enabled) {
    try {
      await mysqlExecutor()(plan.sql);
      status = "exported";
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  if (sqlOutPath) {
    mkdirSync(dirname(sqlOutPath), { recursive: true });
    writeFileSync(sqlOutPath, `${plan.sql}\n`);
  }
  const artifact = {
    schemaVersion: "seo_os_sov_weekly_export_v1",
    generatedAt: new Date().toISOString(),
    window: { label: `week:${weekKey}`, kind: "week", weekKey },
    sourceSnapshotPath: snapshotPath,
    status,
    error,
    summary: plan.summary,
    records,
    sideEffects: {
      mysqlWrites: enabled && status === "exported",
      firestoreWrites: false,
      telegramMessagesSent: false,
      productionPipelineRun: false,
    },
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify(artifact, null, 2));
}

if (require.main === module) {
  runSeoSovWeeklyExportCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
