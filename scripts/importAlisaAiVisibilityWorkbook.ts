import "dotenv/config";
import { spawn } from "child_process";
import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import {
  buildAiVisibilityImportPlan,
  type SeoAiVisibilityRecord,
  type SeoMysqlDashboardExportConfig,
} from "../src/features/seoAgent/mysqlDashboardExport";
import {
  readAlisaAiVisibilityWorkbook,
  type AlisaAiVisibilityWorkbookResult,
} from "../src/features/seoAgent/alisaAiVisibilityWorkbookImport";
import { zarukuSeoProductionConfig } from "../src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig";

export type ImportAlisaAiVisibilityOptions = {
  filePath: string;
  period: string;
  capturedAt: string;
  outputPath: string;
  sqlOutputPath: string | null;
  execute: boolean;
};

export type ImportAlisaAiVisibilityDependencies = {
  now: () => string;
  environment: NodeJS.ProcessEnv;
  executeSql: (sql: string) => Promise<void>;
  readWorkbook: (filePath: string) => Promise<AlisaAiVisibilityWorkbookResult>;
};

export type AlisaAiVisibilityImportArtifact = {
  schemaVersion: "seo_os_alisa_ai_visibility_workbook_import_v1";
  generatedAt: string;
  window: { kind: "period"; period: string; label: string };
  status: "exported" | "export_pending";
  error: string | null;
  source: AlisaAiVisibilityWorkbookResult["source"] & {
    captured_at: string;
  };
  metrics: AlisaAiVisibilityWorkbookResult["analysis"]["metrics"];
  validation: AlisaAiVisibilityWorkbookResult["analysis"]["validation"];
  missing_queries: AlisaAiVisibilityWorkbookResult["analysis"]["missing_queries"];
  zaruku_urls: AlisaAiVisibilityWorkbookResult["analysis"]["zaruku_urls"];
  competitor_source_domains: AlisaAiVisibilityWorkbookResult["analysis"]["competitor_source_domains"];
  summary: ReturnType<typeof buildAiVisibilityImportPlan>["summary"];
  record: SeoAiVisibilityRecord;
  sideEffects: {
    mysqlWrites: boolean;
    firestoreWrites: false;
    telegramMessagesSent: false;
    productionPipelineRun: false;
    dashboardUiChanged: false;
    recommendationSignalsChanged: false;
  };
};

const usage =
  "Usage: importAlisaAiVisibilityWorkbook --file <neurostatistics-zaruku.ru-YYYYMMDD-HHmmss.xlsx> --period <YYYY-MM> --captured-at <ISO-8601> --out <evidence.json> [--sql-out <export.sql>] [--execute]";

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
  if (!value) throw new Error(usage);
  return value;
}

export function parseImportAlisaAiVisibilityOptions(
  args: string[]
): ImportAlisaAiVisibilityOptions {
  const filePath = requiredFlag(args, "--file");
  const period = requiredFlag(args, "--period");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(period)) {
    throw new Error(`Invalid --period: ${period}; expected YYYY-MM`);
  }
  const capturedAt = requiredFlag(args, "--captured-at");
  if (Number.isNaN(Date.parse(capturedAt)) || !/[T ]\d{2}:\d{2}/u.test(capturedAt)) {
    throw new Error(`Invalid --captured-at: ${capturedAt}; expected an ISO-8601 timestamp`);
  }
  return {
    filePath,
    period,
    capturedAt,
    outputPath: requiredFlag(args, "--out"),
    sqlOutputPath: readFlag(args, "--sql-out"),
    execute: args.includes("--execute"),
  };
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

function writesEnabled(
  options: ImportAlisaAiVisibilityOptions,
  environment: NodeJS.ProcessEnv
): boolean {
  return options.execute
    && environment[zarukuSeoProductionConfig.mysqlDashboardExport.writesFlag] === "1";
}

function mysqlExecutor(environment: NodeJS.ProcessEnv): (sql: string) => Promise<void> {
  return async (sql: string) => {
    const config = zarukuSeoProductionConfig.mysqlDashboardExport;
    const host = cleanString(environment[config.hostEnvVar]);
    const port = cleanString(environment[config.portEnvVar]) || "3306";
    const database = cleanString(environment[config.databaseEnvVar]);
    const user = cleanString(environment[config.userEnvVar]);
    const password = cleanString(environment[config.passwordEnvVar]);
    if (!host || !database || !user || !password) {
      throw new Error("Missing MySQL env vars for dashboard export.");
    }

    await new Promise<void>((resolvePromise, rejectPromise) => {
      const child = spawn(
        "mysql",
        [
          "--no-defaults",
          "--connect-timeout=10",
          "-h",
          host,
          "-P",
          port,
          "-u",
          user,
          database,
        ],
        {
          env: { ...environment, MYSQL_PWD: password },
          stdio: ["pipe", "pipe", "pipe"],
        }
      );
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", rejectPromise);
      child.on("close", (code) => {
        if (code === 0) resolvePromise();
        else rejectPromise(new Error(stderr.trim() || `mysql exited with code ${code}`));
      });
      child.stdin.end(sql);
    });
  };
}

export async function runImportAlisaAiVisibilityWorkbook(
  options: ImportAlisaAiVisibilityOptions,
  dependencies: ImportAlisaAiVisibilityDependencies
): Promise<AlisaAiVisibilityImportArtifact> {
  const workbook = await dependencies.readWorkbook(options.filePath);
  const evidencePath = resolve(options.outputPath);
  const ingestionRunId = `seo_os_ai_visibility_${options.period.replace(
    /[^0-9A-Za-z_-]/gu,
    "_"
  )}_alisa_ai_neurostatistics`;
  const record: SeoAiVisibilityRecord = {
    engine: "alisa_ai",
    period: options.period,
    mentions: workbook.analysis.metrics.mentions,
    citations: workbook.analysis.metrics.citations,
    presenceRate: workbook.analysis.metrics.presence_rate,
    provenance: "wm_alisa_workbook",
    capturedAt: options.capturedAt,
    raw: {
      source: "neurostatistics_workbook",
      filename: workbook.source.filename,
      sha256: workbook.source.sha256,
      sheetName: workbook.source.sheet_name,
      evidencePath,
      queryCount: workbook.analysis.metrics.query_count,
      totalSourceCitations: workbook.analysis.metrics.total_source_citations,
      zarukuSourceCitations: workbook.analysis.metrics.zaruku_source_citations,
      citationConcentration: workbook.analysis.metrics.citation_concentration,
    },
  };
  const plan = buildAiVisibilityImportPlan({
    records: [record],
    config: buildConfig(ingestionRunId),
  });
  const enabled = writesEnabled(options, dependencies.environment);
  let status: AlisaAiVisibilityImportArtifact["status"] = "export_pending";
  let error: string | null =
    "SEO_MYSQL_DASHBOARD_EXPORT is disabled or --execute was not provided.";
  if (enabled) {
    try {
      await dependencies.executeSql(plan.sql);
      status = "exported";
      error = null;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }

  if (options.sqlOutputPath) {
    await mkdir(dirname(resolve(options.sqlOutputPath)), { recursive: true });
    await writeFile(resolve(options.sqlOutputPath), `${plan.sql}\n`, "utf8");
  }
  const artifact: AlisaAiVisibilityImportArtifact = {
    schemaVersion: "seo_os_alisa_ai_visibility_workbook_import_v1",
    generatedAt: dependencies.now(),
    window: {
      kind: "period",
      period: options.period,
      label: `period:${options.period}`,
    },
    status,
    error,
    source: {
      ...workbook.source,
      captured_at: options.capturedAt,
    },
    metrics: workbook.analysis.metrics,
    validation: workbook.analysis.validation,
    missing_queries: workbook.analysis.missing_queries,
    zaruku_urls: workbook.analysis.zaruku_urls,
    competitor_source_domains: workbook.analysis.competitor_source_domains,
    summary: plan.summary,
    record,
    sideEffects: {
      mysqlWrites: enabled && status === "exported",
      firestoreWrites: false,
      telegramMessagesSent: false,
      productionPipelineRun: false,
      dashboardUiChanged: false,
      recommendationSignalsChanged: false,
    },
  };
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
}

if (require.main === module) {
  const options = parseImportAlisaAiVisibilityOptions(process.argv.slice(2));
  runImportAlisaAiVisibilityWorkbook(options, {
    now: () => new Date().toISOString(),
    environment: process.env,
    executeSql: mysqlExecutor(process.env),
    readWorkbook: readAlisaAiVisibilityWorkbook,
  })
    .then((artifact) => {
      console.log(JSON.stringify(artifact, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
