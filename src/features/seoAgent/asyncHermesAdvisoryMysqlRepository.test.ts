import { describe, expect, test, vi } from "vitest";
import { createAsyncHermesAdvisoryMysqlRepository } from "./asyncHermesAdvisoryMysqlRepository";

describe("async Hermes advisory MySQL repository", () => {
  test("reads only actionable rows for the requested run week", async () => {
    const execute = vi.fn(async () => [JSON.stringify({
      id: 9,
      status: "advisory_pending",
      runWeekKey: "2026-W30",
      requestedAt: "2026-07-21T08:00:00.000Z",
      opportunityId: "seo_opp_1",
      opportunity: { title: "Тест" },
      originalMessage: { text: "Сообщение" },
      telegramChatId: -1001,
      telegramMessageId: 42,
      advisory: null,
      telegramEditedAt: null,
    })]);
    const repository = createAsyncHermesAdvisoryMysqlRepository({ table: "seo_advisory_jobs", execute });

    const rows = await repository.listWork({ runWeekKey: "2026-W30" });

    expect(rows).toHaveLength(1);
    expect(execute.mock.calls[0][0]).toContain("run_week_key = '2026-W30'");
    expect(execute.mock.calls[0][0]).toContain("telegram_edited_at IS NULL");
  });

  test("persists ready state with token telemetry without exposing another state transition", async () => {
    const execute = vi.fn(async () => []);
    const repository = createAsyncHermesAdvisoryMysqlRepository({ table: "seo_advisory_jobs", execute });

    await repository.markReady(9, {
      at: "2026-07-21T10:00:00.000Z",
      advisory: {
        source: "hermes",
        generatedAt: "2026-07-21T10:00:00.000Z",
        recommendationText: "Добавить блок.",
        coveredIntents: [],
        internalLinkSuggestions: [],
        medicalReviewText: null,
        complianceStatus: "passed",
        tokenUsage: { inputTokens: 20, outputTokens: 10, totalTokens: 30, estimated: true },
      },
    });

    const sql = execute.mock.calls[0][0];
    expect(sql).toContain("status = 'advisory_ready'");
    expect(sql).toContain("input_tokens = 20");
    expect(sql).toContain("output_tokens = 10");
    expect(sql).toContain("total_tokens = 30");
    expect(sql).toContain("WHERE id = 9 AND status = 'advisory_pending'");
  });
});
