import { describe, expect, test, vi } from "vitest";
import {
  runAsyncHermesAdvisoryWorker,
  type AsyncHermesAdvisoryJob,
  type AsyncHermesAdvisoryRepository,
} from "./asyncHermesAdvisoryWorker";
import type { HermesDigestAdvisoryClient } from "./weeklyTop10DigestAdvisoryEnrichment";

const opportunity = {
  type: "content" as const,
  opportunityType: "section_ranking_gap" as const,
  title: "Закрыть gap по меланоме",
  description: "Нет покрытия",
  targetKeywords: ["меланома признаки"],
  market: "RU",
  language: "ru",
  priority: "high" as const,
  confidence: "medium" as const,
  source: "provider" as const,
  sourceFindingId: "rank_gap_query_cluster_004",
};

function job(overrides: Partial<AsyncHermesAdvisoryJob> = {}): AsyncHermesAdvisoryJob {
  return {
    id: 7,
    status: "advisory_pending",
    runWeekKey: "2026-W30",
    requestedAt: "2026-07-21T08:00:00.000Z",
    opportunityId: "seo_opp_1",
    opportunity,
    originalMessage: {
      text: "SEO-кандидат #1\nЧто сделать: обновить страницу",
      buttons: [[{ text: "Одобрить", callbackData: "approve" }]],
    },
    telegramChatId: -100123,
    telegramMessageId: 4321,
    advisory: null,
    telegramEditedAt: null,
    ...overrides,
  };
}

function repository(jobs: AsyncHermesAdvisoryJob[], events: string[]): AsyncHermesAdvisoryRepository {
  return {
    listWork: vi.fn(async () => jobs),
    markReady: vi.fn(async () => events.push("ready")),
    markSkipped: vi.fn(async () => events.push("skipped")),
    recordAttemptFailure: vi.fn(async () => events.push("failure")),
    markTelegramEdited: vi.fn(async () => events.push("edited")),
  };
}

function validClient(): HermesDigestAdvisoryClient {
  return {
    generateDigestAdvisory: vi.fn(async () => ({
      advisory: {
        recommendationText: "Добавить блок о признаках и маршруте пациента.",
        coveredIntents: ["признаки"],
        internalLinkSuggestions: ["Ссылка из раздела меланомы"],
        medicalReviewText: "Требуется медицинское ревью.",
      },
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30, estimated: false },
    })),
  };
}

describe("async Hermes advisory worker", () => {
  test("persists a valid advisory before editing the original Telegram message", async () => {
    const events: string[] = [];
    const repo = repository([job()], events);
    const editMessage = vi.fn(async () => events.push("edit"));

    const result = await runAsyncHermesAdvisoryWorker({
      generatedAt: "2026-07-21T10:00:00.000Z",
      runWeekKey: "2026-W30",
      maxAgeDays: 2,
      repository: repo,
      client: validClient(),
      drugComplianceTokens: ["ритуксимаб"],
      editMessage,
    });

    expect(events).toEqual(["ready", "edit", "edited"]);
    expect(editMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: -100123,
      messageId: 4321,
      text: expect.stringContaining("Hermes-рекомендация:"),
    }));
    expect(result).toMatchObject({ selected: 1, ready: 1, edited: 1, skipped: 0, failed: 0 });
  });

  test("retries only Telegram edit for a ready row and never calls Hermes again", async () => {
    const events: string[] = [];
    const ready = job({
      status: "advisory_ready",
      advisory: {
        source: "hermes",
        generatedAt: "2026-07-21T09:00:00.000Z",
        recommendationText: "Добавить блок о признаках.",
        coveredIntents: [],
        internalLinkSuggestions: [],
        medicalReviewText: null,
        complianceStatus: "passed",
        tokenUsage: { inputTokens: 4, outputTokens: 2, totalTokens: 6, estimated: true },
      },
    });
    const repo = repository([ready], events);
    const client = validClient();
    const editMessage = vi.fn(async () => events.push("edit"));

    const result = await runAsyncHermesAdvisoryWorker({
      generatedAt: "2026-07-21T10:00:00.000Z",
      runWeekKey: "2026-W30",
      maxAgeDays: 2,
      repository: repo,
      client,
      drugComplianceTokens: [],
      editMessage,
    });

    expect(client.generateDigestAdvisory).not.toHaveBeenCalled();
    expect(events).toEqual(["edit", "edited"]);
    expect(result).toMatchObject({ ready: 0, edited: 1 });
  });

  test("marks a pending job skipped after the staleness window", async () => {
    const events: string[] = [];
    const repo = repository([job({ requestedAt: "2026-07-18T09:00:00.000Z" })], events);
    const client = validClient();
    const editMessage = vi.fn();

    const result = await runAsyncHermesAdvisoryWorker({
      generatedAt: "2026-07-21T10:00:00.000Z",
      runWeekKey: "2026-W30",
      maxAgeDays: 2,
      repository: repo,
      client,
      drugComplianceTokens: [],
      editMessage,
    });

    expect(repo.markSkipped).toHaveBeenCalledWith(7, expect.objectContaining({ reason: "stale_after_2_days" }));
    expect(client.generateDigestAdvisory).not.toHaveBeenCalled();
    expect(editMessage).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  test("skips a non-Russian or drug-naming advisory after deterministic post-checks", async () => {
    const events: string[] = [];
    const repo = repository([job()], events);
    const client: HermesDigestAdvisoryClient = {
      generateDigestAdvisory: vi.fn(async () => ({
        advisory: {
          recommendationText: "Добавить блок про ритуксимаб.",
          coveredIntents: [],
          internalLinkSuggestions: [],
          medicalReviewText: null,
        },
      })),
    };

    const result = await runAsyncHermesAdvisoryWorker({
      generatedAt: "2026-07-21T10:00:00.000Z",
      runWeekKey: "2026-W30",
      maxAgeDays: 2,
      repository: repo,
      client,
      drugComplianceTokens: ["ритуксимаб"],
      editMessage: vi.fn(),
    });

    expect(repo.markSkipped).toHaveBeenCalledWith(7, expect.objectContaining({
      reason: "advisory_contains_drug_compliance_token: ритуксимаб",
    }));
    expect(result.skipped).toBe(1);
  });

  test("records a transient Hermes failure and keeps the job retryable", async () => {
    const events: string[] = [];
    const repo = repository([job()], events);
    const client: HermesDigestAdvisoryClient = {
      generateDigestAdvisory: vi.fn(async () => { throw new Error("timeout"); }),
    };

    const result = await runAsyncHermesAdvisoryWorker({
      generatedAt: "2026-07-21T10:00:00.000Z",
      runWeekKey: "2026-W30",
      maxAgeDays: 2,
      repository: repo,
      client,
      drugComplianceTokens: [],
      editMessage: vi.fn(),
    });

    expect(repo.recordAttemptFailure).toHaveBeenCalledWith(7, expect.objectContaining({ error: "timeout" }));
    expect(result.failed).toBe(1);
  });
});
