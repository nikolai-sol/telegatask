import { describe, expect, it } from "vitest";
import {
  buildSectionRankingGapOpportunities,
  DEFAULT_SECTION_RANKING_GAP_CONFIG,
} from "./sectionRankingGapOpportunityEngine";
import type { WeeklyTop10ApprovalDecisionRecord } from "./weeklyTop10ApprovalDecision";
import type { SeoRankHistoryRecord } from "./sectionRankTracking";

function record(input: Partial<SeoRankHistoryRecord> & { clusterId: string; query: string; checkedAt: string }): SeoRankHistoryRecord {
  return {
    id: `${input.clusterId}_${input.checkedAt}`,
    teamId: "team_zaruku",
    runId: input.runId || `run_${input.checkedAt}`,
    domain: "zaruku.ru",
    searchEngine: "yandex",
    provider: "yandex_search_api",
    clusterId: input.clusterId,
    query: input.query,
    section: input.section || "/melanoma/",
    intentClass: input.intentClass || "medical_informational",
    checkedAt: input.checkedAt,
    serpPosition: input.serpPosition ?? null,
    found: input.found ?? input.serpPosition !== null,
    matchedUrl: input.matchedUrl || null,
    topResultDomains: input.topResultDomains || [],
    region: input.region || "ru",
    language: input.language || "ru",
    device: input.device || "desktop",
  };
}

function decision(input: Partial<WeeklyTop10ApprovalDecisionRecord> & { clusterId: string; decidedAt: string }): WeeklyTop10ApprovalDecisionRecord {
  return {
    id: `decision_${input.clusterId}`,
    teamId: "team_zaruku",
    runId: "digest_run",
    opportunityId: `opportunity_${input.clusterId}`,
    clusterId: input.clusterId,
    draftTaskId: null,
    decision: input.decision || "approved",
    rejectReason: null,
    reviewer: { userId: "operator", telegramUserId: 2779103 },
    decidedAt: input.decidedAt,
    source: "telegram_dev_callback",
    callbackData: null,
  };
}

describe("buildSectionRankingGapOpportunities", () => {
  it("creates section_ranking_gap opportunities for clusters missing in the last smoothing window", () => {
    const result = buildSectionRankingGapOpportunities({
      generatedAt: "2026-07-10T20:00:00.000Z",
      domain: "zaruku.ru",
      records: [
        record({
          clusterId: "seed_melanoma_podnogtevaya",
          query: "подногтевая меланома фото",
          checkedAt: "2026-07-10T10:00:00.000Z",
          found: false,
          serpPosition: null,
        }),
        record({
          clusterId: "seed_melanoma_podnogtevaya",
          query: "подногтевая меланома фото",
          checkedAt: "2026-07-10T09:00:00.000Z",
          found: false,
          serpPosition: null,
        }),
      ],
      decisions: [],
      config: {
        ...DEFAULT_SECTION_RANKING_GAP_CONFIG,
        rankSmoothingRuns: 2,
        sectionPriorities: { "/melanoma/": 1 },
      },
    });

    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0]).toMatchObject({
      opportunityType: "section_ranking_gap",
      type: "keyword",
      priority: "high",
      confidence: "medium",
      targetKeywords: ["подногтевая меланома фото"],
      targetUrl: null,
      sourceFindingId: "rank_gap_seed_melanoma_podnogtevaya",
    });
    expect(result.summary.bySection["/melanoma/"]).toBe(1);
    expect(result.opportunities[0].title).toContain("не найден в выдаче");
    expect(result.opportunities[0].title).not.toContain("не найден в Яндекс SERP");
  });

  it("creates a gap opportunity when the latest found position is worse than the configured max position", () => {
    const result = buildSectionRankingGapOpportunities({
      generatedAt: "2026-07-10T20:00:00.000Z",
      domain: "zaruku.ru",
      records: [
        record({
          clusterId: "seed_map_skolkovo",
          query: "онкологический центр в сколково адрес",
          section: "/map/",
          intentClass: "facility_navigational",
          checkedAt: "2026-07-10T10:00:00.000Z",
          serpPosition: 24,
          matchedUrl: "https://zaruku.ru/map/skolkovo",
        }),
      ],
      decisions: [],
      config: {
        ...DEFAULT_SECTION_RANKING_GAP_CONFIG,
        sectionRankingGapMaxPosition: 20,
        sectionPriorities: { "/map/": 2 },
      },
    });

    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0].confidence).toBe("high");
    expect(result.opportunities[0].evidence?.map((item) => item.metric)).toContain("serp_position");
  });

  it("does not create a duplicate gap item for a cluster decided inside the cooldown window", () => {
    const result = buildSectionRankingGapOpportunities({
      generatedAt: "2026-07-10T20:00:00.000Z",
      domain: "zaruku.ru",
      records: [
        record({
          clusterId: "seed_melanoma_podnogtevaya",
          query: "подногтевая меланома фото",
          checkedAt: "2026-07-10T10:00:00.000Z",
          found: false,
          serpPosition: null,
        }),
      ],
      decisions: [decision({ clusterId: "seed_melanoma_podnogtevaya", decidedAt: "2026-07-01T10:00:00.000Z" })],
      config: {
        ...DEFAULT_SECTION_RANKING_GAP_CONFIG,
        decisionCooldownDays: 30,
      },
    });

    expect(result.opportunities).toHaveLength(0);
    expect(result.summary.cooldownSkipped).toBe(1);
  });

  it("binds W28 melanoma gap variants to an existing target page and emits one cluster-level opportunity", () => {
    const result = buildSectionRankingGapOpportunities({
      generatedAt: "2026-07-12T12:00:00.000Z",
      domain: "zaruku.ru",
      records: [
        record({
          clusterId: "query_cluster_008",
          query: "меланома на ногте фото",
          checkedAt: "2026-07-10T21:29:11.135Z",
          found: false,
          serpPosition: null,
        }),
        record({
          clusterId: "query_cluster_004",
          query: "меланома ногтя фото",
          checkedAt: "2026-07-10T21:29:13.093Z",
          found: true,
          serpPosition: 19,
          matchedUrl: "https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/",
        }),
        record({
          clusterId: "seed_melanoma_podnogtevaya",
          query: "подногтевая меланома фото",
          checkedAt: "2026-07-10T21:29:19.148Z",
          found: false,
          serpPosition: null,
        }),
      ],
      decisions: [],
      config: {
        ...DEFAULT_SECTION_RANKING_GAP_CONFIG,
        rankSmoothingRuns: 2,
        sectionRankingGapMaxPosition: 20,
        sectionPriorities: { "/melanoma/": 1 },
        targetUrlBindingMinSharedTokens: 2,
      } as any,
    });

    expect(result.opportunities).toHaveLength(1);
    expect(result.summary.totalClusters).toBe(1);
    expect(result.opportunities[0]).toMatchObject({
      sourceFindingId: "rank_gap_query_cluster_008",
      targetUrl: "https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/",
      targetKeywords: ["меланома на ногте фото", "меланома ногтя фото", "подногтевая меланома фото"],
    });
    expect(result.opportunities[0].evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metric: "target_url_binding",
          query: "меланома ногтя фото",
          value: "меланома ногтя фото",
          url: "https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/",
          message: "Target URL inherited from query variant \"меланома ногтя фото\" at Yandex SERP position 19.",
        }),
      ])
    );
  });

  it("binds missing W29 lung section gaps to a sitemap inventory candidate", () => {
    const result = buildSectionRankingGapOpportunities({
      generatedAt: "2026-07-18T12:00:00.000Z",
      domain: "zaruku.ru",
      records: [
        record({
          clusterId: "seed_lung_symptoms",
          query: "рак легкого симптомы лечение",
          section: "/rak-lyogkogo/",
          checkedAt: "2026-07-18T10:00:00.000Z",
          found: false,
          serpPosition: null,
        }),
      ],
      decisions: [],
      inventoryPages: [
        {
          url: "https://zaruku.ru/rak-lyogkogo/lechenie/",
          title: "Лечение рака легкого",
          h1: "Лечение рака легкого",
        },
      ],
      config: {
        ...DEFAULT_SECTION_RANKING_GAP_CONFIG,
        rankSmoothingRuns: 1,
        sectionPriorities: { "/rak-lyogkogo/": 1 },
      },
    });

    expect(result.opportunities[0]).toMatchObject({
      targetUrl: "https://zaruku.ru/rak-lyogkogo/lechenie/",
      recommendedAction: "Доработать существующую страницу под кластер: усилить интент, сниппет и внутренние ссылки.",
    });
    expect(result.opportunities[0].evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "crawler",
          metric: "target_url_candidate",
          url: "https://zaruku.ru/rak-lyogkogo/lechenie/",
        }),
      ])
    );
  });
});
