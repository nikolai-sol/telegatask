import type { SeoDigestAdvisory } from "./types";
import type {
  AsyncHermesAdvisoryJob,
  AsyncHermesAdvisoryRepository,
  AsyncHermesAdvisoryStatus,
} from "./asyncHermesAdvisoryWorker";

export type MysqlLineExecutor = (sql: string) => Promise<string[]>;

function quoteIdent(value: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(value)) throw new Error(`Unsafe MySQL identifier: ${value}`);
  return `\`${value}\``;
}

function sqlString(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

function sqlNumber(value: unknown): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid MySQL number: ${value}`);
  return String(parsed);
}

function mysqlDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid datetime: ${value}`);
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function parseJob(line: string): AsyncHermesAdvisoryJob {
  const value = JSON.parse(line) as Record<string, unknown>;
  return {
    id: value.id as string | number,
    status: value.status as AsyncHermesAdvisoryStatus,
    runWeekKey: String(value.runWeekKey || ""),
    requestedAt: String(value.requestedAt || ""),
    opportunityId: String(value.opportunityId || ""),
    opportunity: value.opportunity as AsyncHermesAdvisoryJob["opportunity"],
    originalMessage: value.originalMessage as AsyncHermesAdvisoryJob["originalMessage"],
    telegramChatId: value.telegramChatId as string | number,
    telegramMessageId: value.telegramMessageId as string | number,
    advisory: (value.advisory || null) as SeoDigestAdvisory | null,
    telegramEditedAt: value.telegramEditedAt ? String(value.telegramEditedAt) : null,
  };
}

export function createAsyncHermesAdvisoryMysqlRepository(input: {
  table: string;
  execute: MysqlLineExecutor;
}): AsyncHermesAdvisoryRepository {
  const table = quoteIdent(input.table);
  return {
    async listWork({ runWeekKey }) {
      const sql = `SELECT JSON_OBJECT(
  'id', id,
  'status', status,
  'runWeekKey', run_week_key,
  'requestedAt', DATE_FORMAT(requested_at, '%Y-%m-%dT%H:%i:%s.000Z'),
  'opportunityId', opportunity_id,
  'opportunity', opportunity_json,
  'originalMessage', original_message_json,
  'telegramChatId', telegram_chat_id,
  'telegramMessageId', telegram_message_id,
  'advisory', advisory_json,
  'telegramEditedAt', IF(telegram_edited_at IS NULL, NULL, DATE_FORMAT(telegram_edited_at, '%Y-%m-%dT%H:%i:%s.000Z'))
) FROM ${table}
WHERE run_week_key = ${sqlString(runWeekKey)}
  AND telegram_edited_at IS NULL
  AND status IN ('advisory_pending','advisory_ready')
ORDER BY requested_at, id;`;
      return (await input.execute(sql)).filter(Boolean).map(parseJob);
    },

    async markReady(id, { advisory, at }) {
      await input.execute(`UPDATE ${table}
SET status = 'advisory_ready',
    advisory_json = ${sqlString(JSON.stringify(advisory))},
    advisory_text = ${sqlString(advisory.recommendationText)},
    input_tokens = ${sqlNumber(advisory.tokenUsage.inputTokens)},
    output_tokens = ${sqlNumber(advisory.tokenUsage.outputTokens)},
    total_tokens = ${sqlNumber(advisory.tokenUsage.totalTokens)},
    attempt_count = attempt_count + 1,
    last_attempt_at = ${sqlString(mysqlDateTime(at))},
    last_error = NULL,
    ready_at = ${sqlString(mysqlDateTime(at))}
WHERE id = ${sqlNumber(id)} AND status = 'advisory_pending';`);
    },

    async markSkipped(id, { reason, at }) {
      await input.execute(`UPDATE ${table}
SET status = 'advisory_skipped',
    attempt_count = attempt_count + 1,
    last_attempt_at = ${sqlString(mysqlDateTime(at))},
    skipped_at = ${sqlString(mysqlDateTime(at))},
    skip_reason = ${sqlString(reason)},
    last_error = NULL
WHERE id = ${sqlNumber(id)} AND status = 'advisory_pending';`);
    },

    async recordAttemptFailure(id, { error, at }) {
      await input.execute(`UPDATE ${table}
SET attempt_count = attempt_count + 1,
    last_attempt_at = ${sqlString(mysqlDateTime(at))},
    last_error = ${sqlString(error.slice(0, 1_024))}
WHERE id = ${sqlNumber(id)} AND telegram_edited_at IS NULL;`);
    },

    async markTelegramEdited(id, { at }) {
      await input.execute(`UPDATE ${table}
SET telegram_edited_at = ${sqlString(mysqlDateTime(at))},
    last_error = NULL
WHERE id = ${sqlNumber(id)} AND status = 'advisory_ready' AND telegram_edited_at IS NULL;`);
    },
  };
}
