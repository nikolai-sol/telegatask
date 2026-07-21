import "dotenv/config";
import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { spawn } from "child_process";
import {
  buildAiVisibilityImportPlan,
  type SeoAiVisibilityRecord,
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
      "Usage: runSeoAiVisibilityImport --engine <alisa_ai> --period <YYYY-MM> --presence-rate <0..1> --out <artifact.json> [--mentions <n>] [--citations <n>] [--provenance <wm_alisa_manual>] [--captured-at <iso>] [--sql-out <export.sql>] [--execute]"
    );
  }
  return value;
}

function numberFlag(args: string[], name: string): number | null {
  const value = readFlag(args, name);
  if (!value) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid numeric flag ${name}: ${value}`);
  return number;
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

export async function runSeoAiVisibilityImportCli(args = process.argv.slice(2)) {
  const engine = requiredFlag(args, "--engine");
  const period = requiredFlag(args, "--period");
  const presenceRate = numberFlag(args, "--presence-rate");
  if (presenceRate === null) throw new Error("--presence-rate is required.");
  const outPath = requiredFlag(args, "--out");
  const sqlOutPath = readFlag(args, "--sql-out");
  const capturedAt = readFlag(args, "--captured-at") || new Date().toISOString();
  const provenance = readFlag(args, "--provenance") || "wm_alisa_manual";
  const ingestionRunId = `seo_os_ai_visibility_${period.replace(/[^0-9A-Za-z_-]/g, "_")}_${engine}`;
  const record: SeoAiVisibilityRecord = {
    engine,
    period,
    mentions: numberFlag(args, "--mentions"),
    citations: numberFlag(args, "--citations"),
    presenceRate,
    provenance,
    capturedAt,
    raw: {
      source: "manual_import",
      note: readFlag(args, "--note"),
    },
  };
  const plan = buildAiVisibilityImportPlan({
    records: [record],
    config: buildConfig(ingestionRunId),
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
    schemaVersion: "seo_os_ai_visibility_import_v1",
    generatedAt: new Date().toISOString(),
    window: { label: `period:${period}`, kind: "period", period },
    status,
    error,
    summary: plan.summary,
    record,
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
  runSeoAiVisibilityImportCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
