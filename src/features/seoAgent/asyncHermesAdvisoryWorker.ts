import type { SeoDigestAdvisory, SeoOpportunity } from "./types";
import {
  enrichWeeklyTop10DigestAdvisory,
  type HermesDigestAdvisoryClient,
} from "./weeklyTop10DigestAdvisoryEnrichment";
import { mergeHermesAdvisoryIntoTelegramText } from "./weeklyTop10TelegramApprovalMessageV2";

export type AsyncHermesAdvisoryStatus = "advisory_pending" | "advisory_ready" | "advisory_skipped";

export type AsyncHermesAdvisoryJob = {
  id: string | number;
  status: AsyncHermesAdvisoryStatus;
  runWeekKey: string;
  requestedAt: string;
  opportunityId: string;
  opportunity: SeoOpportunity;
  originalMessage: {
    text: string;
    buttons?: Array<Array<{ text: string; callbackData: string }>>;
  };
  telegramChatId: string | number;
  telegramMessageId: string | number;
  advisory: SeoDigestAdvisory | null;
  telegramEditedAt: string | null;
};

export type AsyncHermesAdvisoryRepository = {
  listWork(input: { runWeekKey: string }): Promise<AsyncHermesAdvisoryJob[]>;
  markReady(id: AsyncHermesAdvisoryJob["id"], input: {
    advisory: SeoDigestAdvisory;
    at: string;
  }): Promise<unknown>;
  markSkipped(id: AsyncHermesAdvisoryJob["id"], input: { reason: string; at: string }): Promise<unknown>;
  recordAttemptFailure(id: AsyncHermesAdvisoryJob["id"], input: { error: string; at: string }): Promise<unknown>;
  markTelegramEdited(id: AsyncHermesAdvisoryJob["id"], input: { at: string }): Promise<unknown>;
};

export type AsyncHermesTelegramEditor = (input: {
  chatId: string | number;
  messageId: string | number;
  text: string;
  buttons: AsyncHermesAdvisoryJob["originalMessage"]["buttons"];
}) => Promise<unknown>;

export type AsyncHermesAdvisoryWorkerResult = {
  runWeekKey: string;
  selected: number;
  ready: number;
  edited: number;
  skipped: number;
  failed: number;
};

function errorMessage(value: unknown): string {
  return String((value as Error)?.message || value || "unknown_error");
}

function isStale(requestedAt: string, now: string, maxAgeDays: number): boolean {
  const requested = new Date(requestedAt).getTime();
  const current = new Date(now).getTime();
  if (!Number.isFinite(requested) || !Number.isFinite(current)) return false;
  return current - requested >= Math.max(0, maxAgeDays) * 24 * 60 * 60 * 1000;
}

async function editReadyJob(input: {
  job: AsyncHermesAdvisoryJob;
  advisory: SeoDigestAdvisory;
  generatedAt: string;
  repository: AsyncHermesAdvisoryRepository;
  editMessage: AsyncHermesTelegramEditor;
}): Promise<void> {
  await input.editMessage({
    chatId: input.job.telegramChatId,
    messageId: input.job.telegramMessageId,
    text: mergeHermesAdvisoryIntoTelegramText(input.job.originalMessage.text, input.advisory),
    buttons: input.job.originalMessage.buttons,
  });
  await input.repository.markTelegramEdited(input.job.id, { at: input.generatedAt });
}

export async function runAsyncHermesAdvisoryWorker(input: {
  generatedAt: string;
  runWeekKey: string;
  maxAgeDays: number;
  repository: AsyncHermesAdvisoryRepository;
  client: HermesDigestAdvisoryClient;
  drugComplianceTokens: readonly string[];
  editMessage: AsyncHermesTelegramEditor;
}): Promise<AsyncHermesAdvisoryWorkerResult> {
  const jobs = await input.repository.listWork({ runWeekKey: input.runWeekKey });
  const result: AsyncHermesAdvisoryWorkerResult = {
    runWeekKey: input.runWeekKey,
    selected: jobs.length,
    ready: 0,
    edited: 0,
    skipped: 0,
    failed: 0,
  };

  for (const job of jobs) {
    if (job.status === "advisory_skipped" || job.telegramEditedAt) continue;

    if (job.status === "advisory_ready") {
      if (!job.advisory) {
        await input.repository.recordAttemptFailure(job.id, {
          error: "advisory_ready_without_advisory",
          at: input.generatedAt,
        });
        result.failed += 1;
        continue;
      }
      try {
        await editReadyJob({ ...input, job, advisory: job.advisory });
        result.edited += 1;
      } catch (error) {
        await input.repository.recordAttemptFailure(job.id, {
          error: `telegram_edit_failed: ${errorMessage(error)}`,
          at: input.generatedAt,
        });
        result.failed += 1;
      }
      continue;
    }

    if (isStale(job.requestedAt, input.generatedAt, input.maxAgeDays)) {
      await input.repository.markSkipped(job.id, {
        reason: `stale_after_${input.maxAgeDays}_days`,
        at: input.generatedAt,
      });
      result.skipped += 1;
      continue;
    }

    const enrichment = await enrichWeeklyTop10DigestAdvisory({
      enabled: true,
      generatedAt: input.generatedAt,
      opportunities: [job.opportunity],
      client: input.client,
      config: { drugComplianceTokens: input.drugComplianceTokens },
    });
    const failure = enrichment.failures[0]?.reason || "empty_advisory";
    const advisory = enrichment.opportunities[0]?.advisory || null;

    if (!advisory) {
      if (enrichment.summary.complianceRejected > 0) {
        await input.repository.markSkipped(job.id, { reason: failure, at: input.generatedAt });
        result.skipped += 1;
      } else {
        await input.repository.recordAttemptFailure(job.id, { error: failure, at: input.generatedAt });
        result.failed += 1;
      }
      continue;
    }

    await input.repository.markReady(job.id, { advisory, at: input.generatedAt });
    result.ready += 1;
    try {
      await editReadyJob({ ...input, job, advisory });
      result.edited += 1;
    } catch (error) {
      await input.repository.recordAttemptFailure(job.id, {
        error: `telegram_edit_failed: ${errorMessage(error)}`,
        at: input.generatedAt,
      });
      result.failed += 1;
    }
  }

  return result;
}
