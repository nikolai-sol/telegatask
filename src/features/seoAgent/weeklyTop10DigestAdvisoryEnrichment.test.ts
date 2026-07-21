import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DEFAULT_HERMES_DIGEST_MODEL,
  createHermesCliDigestAdvisoryClient,
  createDefaultHermesDigestAdvisoryClient,
  enrichWeeklyTop10DigestAdvisory,
  resolveHermesDigestModel,
  type HermesDigestAdvisoryClient,
} from "./weeklyTop10DigestAdvisoryEnrichment";
import type { SeoOpportunity } from "./types";

const opportunity: SeoOpportunity = {
  type: "keyword",
  opportunityType: "section_ranking_gap",
  title: "Закрыть ranking gap: меланома на ногте фото",
  description: "Missing Yandex SERP coverage.",
  targetUrl: "https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/",
  targetKeywords: ["меланома на ногте фото", "меланома ногтя фото"],
  market: "RU",
  language: "ru",
  impact: "high",
  effort: "medium",
  urgency: "medium",
  priority: "high",
  confidence: "medium",
  source: "provider",
  recommendedAction: "Доработать существующую страницу под кластер.",
  sourceFindingId: "rank_gap_query_cluster_008",
  evidence: [
    {
      source: "yandex_serp_rank",
      metric: "section",
      value: "/melanoma/",
      query: "меланома на ногте фото",
      url: "https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/",
      message: "Section target cluster: /melanoma/",
    },
  ],
};

function deterministicCopy(value: SeoOpportunity): Omit<SeoOpportunity, "advisory"> {
  const copy = { ...value } as SeoOpportunity;
  delete copy.advisory;
  return copy;
}

describe("weeklyTop10DigestAdvisoryEnrichment", () => {
  function clearHermesEnv(): void {
    delete process.env.HERMES_DIGEST_MODEL;
    delete process.env.HERMES_DIGEST_BLOCKED_MODELS;
  }

  beforeEach(() => {
    clearHermesEnv();
  });

  afterEach(() => {
    clearHermesEnv();
  });

  test("does nothing and does not call Hermes when the flag is disabled", async () => {
    const client: HermesDigestAdvisoryClient = {
      generateDigestAdvisory: vi.fn(),
    };

    const result = await enrichWeeklyTop10DigestAdvisory({
      enabled: false,
      generatedAt: "2026-07-12T12:00:00.000Z",
      opportunities: [opportunity],
      client,
      config: { drugComplianceTokens: ["ритуксимаб"] },
    });

    expect(client.generateDigestAdvisory).not.toHaveBeenCalled();
    expect(result.opportunities).toEqual([opportunity]);
    expect(result.summary).toMatchObject({ requested: 0, enriched: 0, degraded: 0, complianceRejected: 0 });
  });

  test("adds advisory text without changing deterministic opportunity fields", async () => {
    const client: HermesDigestAdvisoryClient = {
      generateDigestAdvisory: vi.fn(async () => ({
        advisory: {
          recommendationText: "Доработать существующую страницу: добавить блок про видимые признаки на ногте и усилить внутренние ссылки из melanoma hub.",
          coveredIntents: ["симптомы на ногте", "фото-признаки"],
          internalLinkSuggestions: ["Добавить ссылку из melanoma hub"],
          medicalReviewText: "Перед публикацией требуется медицинское ревью.",
        },
        usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200, estimated: false },
      })),
    };

    const result = await enrichWeeklyTop10DigestAdvisory({
      enabled: true,
      generatedAt: "2026-07-12T12:00:00.000Z",
      opportunities: [opportunity],
      client,
      config: { drugComplianceTokens: ["ритуксимаб"] },
    });

    expect(deterministicCopy(result.opportunities[0])).toEqual(deterministicCopy(opportunity));
    expect(result.opportunities[0].advisory).toMatchObject({
      source: "hermes",
      generatedAt: "2026-07-12T12:00:00.000Z",
      recommendationText: expect.stringContaining("Доработать существующую страницу"),
      coveredIntents: ["симптомы на ногте", "фото-признаки"],
      internalLinkSuggestions: ["Добавить ссылку из melanoma hub"],
      medicalReviewText: "Перед публикацией требуется медицинское ревью.",
      complianceStatus: "passed",
      tokenUsage: { inputTokens: 120, outputTokens: 80, totalTokens: 200, estimated: false },
    });
    expect(result.summary).toMatchObject({ requested: 1, enriched: 1, degraded: 0, complianceRejected: 0 });
  });

  test("degrades gracefully when Hermes fails", async () => {
    const client: HermesDigestAdvisoryClient = {
      generateDigestAdvisory: vi.fn(async () => {
        throw new Error("timeout");
      }),
    };

    const result = await enrichWeeklyTop10DigestAdvisory({
      enabled: true,
      generatedAt: "2026-07-12T12:00:00.000Z",
      opportunities: [opportunity],
      client,
      config: { drugComplianceTokens: ["ритуксимаб"] },
    });

    expect(result.opportunities).toEqual([opportunity]);
    expect(result.summary).toMatchObject({ requested: 1, enriched: 0, degraded: 1, complianceRejected: 0 });
    expect(result.failures[0]).toMatchObject({ opportunityId: "rank_gap_query_cluster_008", reason: "timeout" });
  });

  test("rejects advisory text containing configured drug compliance tokens", async () => {
    const client: HermesDigestAdvisoryClient = {
      generateDigestAdvisory: vi.fn(async () => ({
        advisory: {
          recommendationText: "Добавить блок про ритуксимаб.",
          coveredIntents: [],
          internalLinkSuggestions: [],
          medicalReviewText: "Медревью требуется.",
        },
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30, estimated: false },
      })),
    };

    const result = await enrichWeeklyTop10DigestAdvisory({
      enabled: true,
      generatedAt: "2026-07-12T12:00:00.000Z",
      opportunities: [opportunity],
      client,
      config: { drugComplianceTokens: ["ритуксимаб"] },
    });

    expect(result.opportunities).toEqual([opportunity]);
    expect(result.summary).toMatchObject({ requested: 1, enriched: 0, degraded: 0, complianceRejected: 1 });
    expect(result.failures[0]).toMatchObject({
      opportunityId: "rank_gap_query_cluster_008",
      reason: "advisory_contains_drug_compliance_token: ритуксимаб",
    });
  });

  test("rejects non-Russian Hermes advisory values with a deterministic post-check", async () => {
    const client: HermesDigestAdvisoryClient = {
      generateDigestAdvisory: vi.fn(async () => ({
        advisory: {
          recommendationText: "Improve the existing page and add stronger internal links.",
          coveredIntents: ["photo symptoms"],
          internalLinkSuggestions: ["Link from the melanoma hub"],
          medicalReviewText: "Medical review is required.",
        },
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30, estimated: false },
      })),
    };

    const result = await enrichWeeklyTop10DigestAdvisory({
      enabled: true,
      generatedAt: "2026-07-12T12:00:00.000Z",
      opportunities: [opportunity],
      client,
      config: { drugComplianceTokens: ["ритуксимаб"] },
    });

    expect(result.opportunities).toEqual([opportunity]);
    expect(result.summary).toMatchObject({ requested: 1, enriched: 0, degraded: 0, complianceRejected: 1 });
    expect(result.failures[0]).toMatchObject({
      opportunityId: "rank_gap_query_cluster_008",
      reason: "advisory_not_russian",
    });
  });

  test("creates a Hermes CLI client that passes the prompt to hermes oneshot and parses JSON", async () => {
    const runCommand = vi.fn(async () =>
      JSON.stringify({
        recommendationText: "Усилить страницу конкретным блоком по интенту.",
        coveredIntents: ["интент"],
        internalLinkSuggestions: ["ссылка"],
        medicalReviewText: "Медревью требуется.",
      })
    );
    const client = createHermesCliDigestAdvisoryClient({
      command: "/usr/local/bin/hermes",
      model: "grok-4.3",
      runCommand,
    });

    const result = await client.generateDigestAdvisory({
      opportunity,
      prompt: "Return JSON",
    });

    expect(runCommand).toHaveBeenCalledWith("/usr/local/bin/hermes", [
      "-z",
      "Return JSON",
      "--model",
      "grok-4.3",
      "--ignore-rules",
      "--safe-mode",
    ]);
    expect(result?.advisory).toEqual({
      recommendationText: "Усилить страницу конкретным блоком по интенту.",
      coveredIntents: ["интент"],
      internalLinkSuggestions: ["ссылка"],
      medicalReviewText: "Медревью требуется.",
    });
    expect(result?.usage?.estimated).toBe(true);
  });

  test("uses Grok 4.5 as the Hermes digest model by default", async () => {
    expect(DEFAULT_HERMES_DIGEST_MODEL).toBe("grok-4.5");
    expect(resolveHermesDigestModel("")).toBe("grok-4.5");
  });

  test("allows Grok 4.5 when configured explicitly", async () => {
    expect(resolveHermesDigestModel("grok-4.5")).toBe("grok-4.5");
  });

  test("default Hermes client prefers local Hermes CLI when available", async () => {
    const llm = { generate: vi.fn(async () => null) };
    const runCommand = vi.fn(async () =>
      JSON.stringify({
        recommendationText: "CLI Hermes response",
        coveredIntents: [],
        internalLinkSuggestions: [],
        medicalReviewText: null,
      })
    );
    const client = createDefaultHermesDigestAdvisoryClient(llm, {
      command: "/local/hermes",
      commandExists: () => true,
      runCommand,
    });

    const result = await client.generateDigestAdvisory({
      opportunity,
      prompt: "Return JSON",
    });

    expect(llm.generate).not.toHaveBeenCalled();
    expect(runCommand).toHaveBeenCalled();
    expect(result?.advisory.recommendationText).toBe("CLI Hermes response");
  });
});
