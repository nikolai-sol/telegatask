import { describe, expect, test } from "vitest";
import { zarukuSeoProductionConfig } from "./production/zaruku/zarukuSeoProductionConfig";
import {
  buildForumDiscoveryQueries,
  buildForumThreadDiscoveryReport,
  sanitizeForumThreadText,
  type ForumDiscoveryClusterConfig,
  type ForumDiscoverySearchResult,
} from "./forumThreadDiscovery";

const clusters: ForumDiscoveryClusterConfig[] = [
  {
    clusterId: "breast_disability",
    label: "инвалидность при раке молочной железы",
    seedQuery: "инвалидность при раке молочной железы",
    section: "/rak-molochnoj-zhelezy/",
  },
  {
    clusterId: "drug_topic",
    label: "герцептин побочные эффекты",
    seedQuery: "герцептин побочные эффекты",
    section: "/rak-molochnoj-zhelezy/",
  },
];

const coveragePages = [
  {
    url: "https://zaruku.ru/rak-molochnoj-zhelezy/invalidnost-pri-rake-molochnoj-zhelezy-kak-poluchit-i-kakie-preimushestva-ona-daet/",
    section: "/rak-molochnoj-zhelezy/",
    title: "Инвалидность при раке молочной железы",
    keywords: ["инвалидность", "рак", "молочной", "железы"],
  },
  {
    url: "https://zaruku.ru/rak-molochnoj-zhelezy/reabilitaciya-posle-raka-molochnoj-zhelezy-5-napravlenij/",
    section: "/rak-molochnoj-zhelezy/",
    title: "Реабилитация после рака молочной железы",
    keywords: ["восстановление", "рмж", "молочной", "железы"],
  },
];

const searchResults: ForumDiscoverySearchResult[] = [
  {
    query: "инвалидность при раке молочной железы форум",
    clusterId: "breast_disability",
    domain: "forum.onco.example",
    url: "https://forum.onco.example/thread/1",
    title: "Инвалидность при РМЖ: кто оформлял?",
    snippet: "Мария пишет: мой телефон +7 999 123-45-67 и email test@example.com",
    position: 1,
  },
  {
    query: "инвалидность при раке молочной железы форум",
    clusterId: "breast_disability",
    domain: "zaruku.ru",
    url: "https://zaruku.ru/rak-molochnoj-zhelezy/",
    title: "Статья",
    snippet: "Не форум",
    position: 2,
  },
  {
    query: "герцептин побочные эффекты форум",
    clusterId: "drug_topic",
    domain: "forum.onco.example",
    url: "https://forum.onco.example/thread/2",
    title: "Герцептин и побочные эффекты",
    snippet: "Вопрос про препарат",
    position: 1,
  },
  {
    query: "инвалидность при раке молочной железы отзывы",
    clusterId: "breast_disability",
    domain: "otzovik.example",
    url: "https://otzovik.example/review/1",
    title: "Отзывы про клинику",
    snippet: "бренд гемотест",
    position: 1,
  },
  {
    query: "восстановление после рмж форум",
    clusterId: "breast_recovery",
    domain: "forum.onco.example",
    url: "https://forum.onco.example/thread/3",
    title: "Восстановление после РМЖ: когда вернулись силы?",
    snippet: "Обсуждение восстановления после лечения",
    position: 1,
  },
];

const recoveryClusters: ForumDiscoveryClusterConfig[] = [
  ...clusters,
  {
    clusterId: "breast_recovery",
    label: "восстановление после рмж",
    seedQuery: "восстановление после рмж",
    section: "/rak-molochnoj-zhelezy/",
  },
];

describe("forumThreadDiscovery", () => {
  test("builds capped open-search queries from cluster config and modifiers", () => {
    expect(buildForumDiscoveryQueries({
      clusters,
      modifiers: ["форум", "обсуждение", "отзывы"],
      maxQueriesPerCluster: 2,
    })).toEqual([
      {
        clusterId: "breast_disability",
        query: "инвалидность при раке молочной железы форум",
        modifier: "форум",
      },
      {
        clusterId: "breast_disability",
        query: "инвалидность при раке молочной железы обсуждение",
        modifier: "обсуждение",
      },
      {
        clusterId: "drug_topic",
        query: "герцептин побочные эффекты форум",
        modifier: "форум",
      },
      {
        clusterId: "drug_topic",
        query: "герцептин побочные эффекты обсуждение",
        modifier: "обсуждение",
      },
    ]);
  });

  test("sanitizes likely author PII from thread text", () => {
    expect(sanitizeForumThreadText("Пишите Ивану: +7 999 123-45-67, test@example.com, @ivan_petrov")).toBe(
      "Пишите Ивану: [phone-redacted], [email-redacted], [handle-redacted]"
    );
  });

  test("filters obvious non-thread results and classifies coverage, drug, competitor and PII-safe text", () => {
    const report = buildForumThreadDiscoveryReport({
      generatedAt: "2026-07-17T00:00:00.000Z",
      source: "fixture",
      clusters: recoveryClusters,
      results: searchResults,
      coveragePages,
      semanticIntentConfig: zarukuSeoProductionConfig.semanticIntent,
    });

    expect(report.summary).toMatchObject({
      clusters: 3,
      rawResults: 5,
      acceptedThreads: 4,
      coveredThreads: 1,
      gapThreads: 2,
      partialThreads: 1,
      neverAnswerableThreads: 1,
      competitorExcludedThreads: 1,
    });
    expect(report.threads.map((thread) => thread.url)).not.toContain("https://zaruku.ru/rak-molochnoj-zhelezy/");
    expect(report.threads[0]).toMatchObject({
      clusterId: "breast_disability",
      sourceDomain: "forum.onco.example",
      coverage: {
        verdict: "covered",
        matchingArticleUrl:
          "https://zaruku.ru/rak-molochnoj-zhelezy/invalidnost-pri-rake-molochnoj-zhelezy-kak-poluchit-i-kakie-preimushestva-ona-daet/",
      },
      safety: {
        neverAnswerable: false,
        competitorExcluded: false,
        authorPiiStored: false,
      },
    });
    expect(report.threads[0].questionText).toContain("[phone-redacted]");
    expect(report.threads[0].questionText).toContain("[email-redacted]");
    expect(report.threads.find((thread) => thread.clusterId === "drug_topic")?.safety.neverAnswerable).toBe(true);
    expect(report.threads.find((thread) => thread.sourceDomain === "otzovik.example")?.safety.competitorExcluded).toBe(true);
    expect(report.domainFrequency[0]).toEqual({
      domain: "forum.onco.example",
      threads: 3,
      answerableThreads: 2,
      gapThreads: 1,
    });
  });

  test("marks section-only coverage as partial instead of covered", () => {
    const report = buildForumThreadDiscoveryReport({
      generatedAt: "2026-07-17T00:00:00.000Z",
      source: "fixture",
      clusters: recoveryClusters,
      results: searchResults,
      coveragePages,
      semanticIntentConfig: zarukuSeoProductionConfig.semanticIntent,
    });

    expect(report.threads.find((thread) => thread.clusterId === "breast_recovery")?.coverage).toMatchObject({
      verdict: "partial",
      matchingArticleUrl:
        "https://zaruku.ru/rak-molochnoj-zhelezy/reabilitaciya-posle-raka-molochnoj-zhelezy-5-napravlenij/",
      });
    });

  test("can use shared sitemap inventory resolver instead of configured coverage pages", () => {
    const report = buildForumThreadDiscoveryReport({
      generatedAt: "2026-07-17T00:00:00.000Z",
      source: "fixture",
      clusters: [
        {
          clusterId: "map_skolkovo",
          label: "онкологический центр в сколково адрес",
          seedQuery: "онкологический центр в сколково адрес",
          section: "/map/",
        },
      ],
      results: [
        {
          query: "онкологический центр в сколково адрес форум",
          clusterId: "map_skolkovo",
          domain: "forum.example",
          url: "https://forum.example/thread/skolkovo",
          title: "Онкологический центр в Сколково: адрес?",
          snippet: "Обсуждение, как найти центр в Сколково",
          position: 1,
        },
      ],
      coveragePages: [],
      inventoryPages: [
        {
          url: "https://zaruku.ru/map/moskva/organization_1425/",
          title: "Онкологический центр в Сколково",
          h1: "Онкологический центр в Сколково",
        },
      ],
      semanticIntentConfig: zarukuSeoProductionConfig.semanticIntent,
    });

    expect(report.threads[0]?.coverage).toMatchObject({
      verdict: "covered",
      matchingArticleUrl: "https://zaruku.ru/map/moskva/organization_1425/",
      matchedTitleTokens: expect.arrayContaining(["онкологический", "центр", "сколково"]),
    });
  });
});
