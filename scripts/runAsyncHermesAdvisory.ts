import "dotenv/config";
import { spawn } from "child_process";
import {
  createAsyncHermesAdvisoryMysqlRepository,
  type MysqlLineExecutor,
} from "../src/features/seoAgent/asyncHermesAdvisoryMysqlRepository";
import { runAsyncHermesAdvisoryWorker } from "../src/features/seoAgent/asyncHermesAdvisoryWorker";
import { zarukuSeoProductionConfig } from "../src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig";
import { buildSeoIsoWeekKey } from "../src/features/seoAgent/weeklySeoRhythm";
import { createHermesCliDigestAdvisoryClient } from "../src/features/seoAgent/weeklyTop10DigestAdvisoryEnrichment";

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readFlag(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? cleanString(args[index + 1]) || null : null;
}

function envValue(name: string): string {
  return cleanString(process.env[name]);
}

function collectProcessLines(input: {
  command: string;
  args: string[];
  sql: string;
  env?: NodeJS.ProcessEnv;
}): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      env: input.env || process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.split("\n").map((line) => line.trim()).filter(Boolean));
        return;
      }
      reject(new Error(stderr.trim() || `${input.command} exited with code ${code}`));
    });
    child.stdin.end(input.sql);
  });
}

export function mysqlLineExecutor(): MysqlLineExecutor {
  const sshTarget = envValue("SEO_ASYNC_HERMES_MYSQL_SSH_TARGET");
  if (sshTarget) {
    const remoteDir = envValue("SEO_ASYNC_HERMES_MYSQL_REMOTE_DIR") || "/opt/telegatask";
    if (!/^[a-zA-Z0-9_.@-]+$/.test(sshTarget)) throw new Error("Unsafe async Hermes SSH target");
    if (!/^[a-zA-Z0-9_./-]+$/.test(remoteDir)) throw new Error("Unsafe async Hermes remote directory");
    const remoteCommand = `cd ${remoteDir} && set -a && . ./.env && set +a && MYSQL_PWD="$MYSQL_PASSWORD" mysql --no-defaults --connect-timeout=10 --batch --raw --skip-column-names -h "$MYSQL_HOST" -P "\${MYSQL_PORT:-3306}" -u "$MYSQL_USER" "$MYSQL_DB"`;
    return (sql) => collectProcessLines({
      command: "ssh",
      args: ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", sshTarget, remoteCommand],
      sql,
    });
  }

  const config = zarukuSeoProductionConfig.mysqlDashboardExport;
  const host = envValue(config.hostEnvVar);
  const port = envValue(config.portEnvVar) || "3306";
  const database = envValue(config.databaseEnvVar);
  const user = envValue(config.userEnvVar);
  const password = envValue(config.passwordEnvVar);
  if (!host || !database || !user || !password) {
    throw new Error("Missing MySQL env vars for async Hermes advisory worker.");
  }

  return (sql) => collectProcessLines({
    command: "mysql",
    args: [
      "--no-defaults",
      "--connect-timeout=10",
      "--batch",
      "--raw",
      "--skip-column-names",
      "-h", host,
      "-P", port,
      "-u", user,
      database,
    ],
    sql,
    env: { ...process.env, MYSQL_PWD: password },
  });
}

async function telegramEdit(input: {
  chatId: string | number;
  messageId: string | number;
  text: string;
  buttons?: Array<Array<{ text: string; callbackData: string }>>;
}): Promise<void> {
  const token = cleanString(process.env.TELEGRAM_BOT_TOKEN);
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const response = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: input.chatId,
      message_id: input.messageId,
      text: input.text,
      reply_markup: {
        inline_keyboard: (input.buttons || []).map((row) => row.map((button) => ({
          text: button.text,
          callback_data: button.callbackData,
        }))),
      },
      disable_web_page_preview: true,
    }),
  });
  const payload = await response.json() as { ok?: boolean; description?: string };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.description || `editMessageText failed with HTTP ${response.status}`);
  }
}

export async function runAsyncHermesAdvisoryCli(args = process.argv.slice(2)): Promise<void> {
  const generatedAt = readFlag(args, "--now") || new Date().toISOString();
  const runWeekKey = readFlag(args, "--run-week")
    || cleanString(process.env.SEO_ASYNC_HERMES_RUN_WEEK_KEY)
    || buildSeoIsoWeekKey(generatedAt);
  const maxAgeDays = Number(
    readFlag(args, "--max-age-days") || process.env.SEO_ASYNC_HERMES_MAX_AGE_DAYS || "2"
  );
  if (!Number.isFinite(maxAgeDays) || maxAgeDays < 0) throw new Error("max age days must be a non-negative number");

  const repository = createAsyncHermesAdvisoryMysqlRepository({
    table: zarukuSeoProductionConfig.mysqlDashboardExport.tables.advisoryJobs,
    execute: mysqlLineExecutor(),
  });
  if (args.includes("--list-only")) {
    const jobs = await repository.listWork({ runWeekKey });
    console.log(JSON.stringify({ mode: "list_only", runWeekKey, selected: jobs.length }, null, 2));
    return;
  }

  const result = await runAsyncHermesAdvisoryWorker({
    generatedAt,
    runWeekKey,
    maxAgeDays,
    repository,
    client: createHermesCliDigestAdvisoryClient(),
    drugComplianceTokens: zarukuSeoProductionConfig.semanticIntent.drugComplianceTokens,
    editMessage: telegramEdit,
  });
  console.log(JSON.stringify({ mode: "execute", ...result }, null, 2));
}

if (require.main === module) {
  runAsyncHermesAdvisoryCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
