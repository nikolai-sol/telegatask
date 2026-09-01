import { describe, expect, test } from "vitest";
import type { YandexEvidence } from "./yandexEvidence";
import type {
  CrawlEvidence,
  LighthouseEvidence,
  PageEvidence,
  WgdManagerFindingGroup,
  WgdReportAssessment,
  WgdReportOptions,
  WgdReportPayload,
} from "./types";
import {
  buildManagerPresentation,
  DIAGNOSTIC_PRESENTATION_ORDER,
  SOURCE_PRESENTATION_ORDER,
  type WgdManagerPresentationInput,
} from "./managerPresentation";

const HOME = "https://example.com/";
const SLOW = "https://example.com/slow";
const RAW_FINDING_EVIDENCE = "RAW_FINDING_EVIDENCE_SENTINEL";
const RAW_FINDING_ACTION = "RAW_FINDING_ACTION_SENTINEL";
const RAW_SOURCE_MESSAGE = "RAW_SOURCE_MESSAGE_SENTINEL";
const RAW_PROVIDER_ERROR = "RAW_PROVIDER_ERROR_SENTINEL";
const RAW_ALICE_ANSWER = "RAW_ALICE_ANSWER_SENTINEL";
const RAW_AUDIT_TITLE = "RAW_AUDIT_TITLE_SENTINEL";
const RAW_AUDIT_DESCRIPTION = "RAW_AUDIT_DESCRIPTION_SENTINEL";
const RAW_TOP_LEVEL_LIMITATION = "RAW_TOP_LEVEL_LIMITATION_SENTINEL";
const UNKNOWN_FINDING_CODE = "unknown_internal_finding_sentinel";

function options(language = "ru"): WgdReportOptions {
  return {
    url: HOME,
    domain: "example.com",
    market: "RU",
    language,
    region: "225",
    crawlLimit: 20,
    lighthousePageLimit: 2,
    keywords: ["found query", "missing query", "failed query"],
    aiQueries: ["used query", "unused query", "failed ai query"],
    priorityUrls: [],
    outDir: "/tmp/report",
    sources: { dataForSeo: "not_applicable" },
  };
}

function page(url: string, overrides: Partial<PageEvidence> = {}): PageEvidence {
  return {
    requestedUrl: url,
    finalUrl: url,
    status: 200,
    contentType: "text/html",
    title: url === HOME ? "Главная" : "Медленная страница",
    description: "Описание страницы",
    canonical: url,
    headings: { h1: ["Заголовок"], h2: [] },
    internalLinks: [],
    indexable: true,
    signalConflicts: [],
    inboundInternalLinks: 1,
    ...overrides,
  };
}

function crawl(pages: PageEvidence[]): CrawlEvidence {
  return {
    attemptedUrlCount: pages.length,
    eligibleDiscoveredCount: pages.length,
    droppedEligibleCount: 0,
    truncated: false,
    pages,
    robots: {
      url: "https://example.com/robots.txt",
      status: 200,
      sitemapUrls: ["https://example.com/sitemap.xml"],
      access: { state: "measured", userAgent: "YandexBot", checkedUrlCount: pages.length, blockedUrls: [] },
    },
    sitemapCandidates: [],
    discoveredUrls: pages.map((item) => item.requestedUrl),
    excludedUrls: [],
    brokenUrls: [],
    redirectChains: [],
    duplicateTitles: {},
    duplicateDescriptions: {},
    limitations: [],
  };
}

function lighthouse(url: string, device: "mobile" | "desktop", performance: number): LighthouseEvidence {
  return {
    url,
    requestedUrl: url,
    finalUrl: url,
    device,
    status: "success",
    measurementType: "lab",
    fieldData: { source: "CrUX", state: "not_collected" },
    categoryScores: {
      performance,
      accessibility: 90,
      "best-practices": 85,
      seo: 95,
    },
    metrics: { largestContentfulPaintMs: 2500 },
    insights: ["image-delivery-insight", "unknown-internal-insight"],
    failedAudits: [{
      id: "color-contrast",
      title: RAW_AUDIT_TITLE,
      description: RAW_AUDIT_DESCRIPTION,
      score: 0,
      categories: ["accessibility"],
    }],
  };
}

function yandex(): YandexEvidence {
  return {
    serpChecks: [
      {
        query: "found query", searchEngine: "yandex", provider: "yandex_search_api",
        targetDomain: "example.com", found: true, position: 4, matchedUrl: SLOW,
        checkedDepth: 20, device: "desktop", checkedAt: "2026-09-01T10:00:00.000Z",
      },
      {
        query: "missing query", searchEngine: "yandex", provider: "yandex_search_api",
        targetDomain: "example.com", found: false, checkedDepth: 20,
        device: "desktop", checkedAt: "2026-09-01T10:00:00.000Z",
      },
    ],
    serpStatus: {
      state: "partial_success",
      message: `${RAW_SOURCE_MESSAGE} ${RAW_PROVIDER_ERROR}`,
      checkedAt: "2026-09-01T10:00:00.000Z",
    },
    aiProbes: [
      {
        channel: "internal channel", status: "checked", query: "used query", result: RAW_ALICE_ANSWER,
        sources: [], sourceDetails: [], usedSources: [HOME], targetFound: true, targetUsed: true,
        sourcePosition: 1, usedSourcePosition: 1,
      },
      {
        channel: "internal channel", status: "checked", query: "unused query", result: RAW_ALICE_ANSWER,
        sources: [], sourceDetails: [], usedSources: [], targetFound: false, targetUsed: false,
        sourcePosition: null, usedSourcePosition: null,
      },
      {
        channel: "internal channel", status: "failed", query: "failed ai query", result: RAW_PROVIDER_ERROR,
        sources: [], sourceDetails: [], usedSources: [], targetFound: false, targetUsed: false,
        sourcePosition: null, usedSourcePosition: null,
      },
    ],
    aiSampleVisibility: { used: 1, checked: 2, rate: 0.5 },
    manualQueries: [],
    limitations: [RAW_PROVIDER_ERROR],
  };
}

function component(score: number, weight: 40 | 25 | 20 | 15, collected = 2, requested = 3) {
  const scoringCoverage = collected / requested;
  return {
    score,
    nominalWeight: weight,
    effectiveWeight: weight * scoringCoverage,
    collectionCoverage: scoringCoverage,
    scoringCoverage,
    collected,
    requested,
  };
}

function assessment(): WgdReportAssessment {
  const technical = component(61, 40, 2, 2);
  const lighthouseComponent = component(63, 20, 2, 2);
  return {
    state: "scored",
    calculatedScore: 72,
    displayScore: 72,
    completeness: 100,
    status: "needs_improvement",
    indexabilityCapApplied: false,
    components: {
      technical: { ...technical, nominalWeight: 40, crawlCompletion: 1, atomicRuleCoverage: 1, rules: [] },
      yandex: { ...component(53, 25), nominalWeight: 25 },
      lighthouse: { ...lighthouseComponent, nominalWeight: 20, worstMobileUrl: SLOW },
      alice: { ...component(33, 15), nominalWeight: 15 },
    },
    pages: [
      { url: HOME, score: 88, collectionCoverage: 1, noindexCapApplied: false, groups: {
        indexability: { nominalWeight: 45, measuredWeight: 45, earnedPoints: 45, score: 100 },
        content: { nominalWeight: 30, measuredWeight: 30, earnedPoints: 25, score: 83 },
        internal_structure: { nominalWeight: 10, measuredWeight: 10, earnedPoints: 10, score: 100 },
        lighthouse: { nominalWeight: 15, measuredWeight: 15, earnedPoints: 9, score: 60 },
      } },
      { url: SLOW, score: 64, collectionCoverage: 1, noindexCapApplied: false, groups: {
        indexability: { nominalWeight: 45, measuredWeight: 45, earnedPoints: 45, score: 100 },
        content: { nominalWeight: 30, measuredWeight: 30, earnedPoints: 20, score: 67 },
        internal_structure: { nominalWeight: 10, measuredWeight: 10, earnedPoints: 10, score: 100 },
        lighthouse: { nominalWeight: 15, measuredWeight: 15, earnedPoints: 4, score: 27 },
      } },
    ],
  };
}

function findingGroups(): WgdManagerFindingGroup[] {
  return [{
    code: "missing_canonical",
    rank: 7,
    severity: "high",
    deliveryStage: "visibility",
    technicalAnchor: "#page-details",
    scope: "page",
    affectedUrls: [SLOW],
    findingCount: 1,
  }];
}

function input(language = "ru"): WgdManagerPresentationInput {
  const pages = [page(HOME), page(SLOW, { canonical: undefined })];
  const raw: WgdReportPayload = {
    generatedAt: "2026-09-01T10:00:00.000Z",
    options: options(language),
    sources: [
      { id: "crawl", state: "success", message: RAW_SOURCE_MESSAGE },
      { id: "yandex_webmaster", state: "owner_access_required", message: RAW_SOURCE_MESSAGE },
      { id: "gsc", state: "owner_access_required", message: RAW_SOURCE_MESSAGE },
      { id: "dataforseo", state: "not_applicable", message: RAW_SOURCE_MESSAGE },
    ],
    pages,
    crawl: crawl(pages),
    lighthouse: [
      lighthouse(HOME, "mobile", 70), lighthouse(HOME, "desktop", 90),
      lighthouse(SLOW, "mobile", 40), lighthouse(SLOW, "desktop", 80),
      { ...lighthouse(SLOW, "mobile", 40), status: "failed", error: RAW_PROVIDER_ERROR },
    ],
    yandex: yandex(),
    findings: [
      {
        code: "missing_canonical", severity: "high", affectedUrl: SLOW,
        evidence: RAW_FINDING_EVIDENCE, source: "crawl", confidence: "high",
        action: RAW_FINDING_ACTION, expectedEffect: "raw effect", acceptanceCriterion: "raw criterion",
        verification: "raw verification",
      },
      {
        code: UNKNOWN_FINDING_CODE, severity: "critical", affectedUrl: HOME,
        evidence: RAW_FINDING_EVIDENCE, source: "crawl", confidence: "high",
        action: RAW_FINDING_ACTION, expectedEffect: "raw effect", acceptanceCriterion: "raw criterion",
        verification: "raw verification",
      },
    ],
    limitations: [RAW_TOP_LEVEL_LIMITATION],
    evidenceFiles: ["evidence/crawl.json", "../unsafe.json", "evidence/lighthouse-safe.json"],
    manualQueryPackPath: "manual-query-pack.md",
  };
  return {
    normalized: {
      ...raw,
      crawl: raw.crawl as CrawlEvidence,
      yandex: raw.yandex as YandexEvidence,
    },
    assessment: assessment(),
    findingGroups: findingGroups(),
  };
}

describe("buildManagerPresentation", () => {
  test("builds the complete Russian manager model from normalized evidence and supplied scores", () => {
    const model = buildManagerPresentation(input());

    expect(model.locale).toBe("ru");
    expect(model.header).toMatchObject({
      title: "SEO-аудит сайта", domain: "example.com", date: "1 сентября 2026 г.",
      market: "Россия", searchEngine: "Яндекс",
    });
    expect(model.headings.components).toBe("Составляющие оценки");
    expect(model.labels).toMatchObject({
      query: "Запрос",
      position: "Позиция",
      page: "Страница",
      result: "Результат",
      mobileAverage: "Средняя оценка на мобильных устройствах",
      desktopAverage: "Средняя оценка на компьютерах",
      source: "Источник",
      state: "Состояние",
    });
    expect(model.overall).toMatchObject({ score: 72, state: "Оценка рассчитана", status: "Требуются улучшения" });
    expect(model.components.map((item) => [item.name, item.score])).toEqual([
      ["Техническое SEO и индексируемость", 61],
      ["Позиции в Яндексе", 53],
      ["Скорость и удобство", 63],
      ["Видимость в ответах Алисы", 33],
    ]);
    expect(model.problems).toEqual([expect.objectContaining({
      title: "На странице не указан канонический адрес",
      priority: "высокий",
      affected: "Затронута 1 страница",
      href: expect.stringMatching(/^#page-detail-/),
      linkLabel: "Подробнее по страницам",
    })]);
    expect(model.priorityStages).toHaveLength(1);
    expect(model.priorityStages[0]).toMatchObject({
      title: "Исправить проблемы, влияющие на видимость и посадочные страницы",
    });
  });

  test("limits only problem cards while retaining a sixth group in priorities", () => {
    const allGroups = input();
    allGroups.findingGroups = [
      { code: "homepage_noindex", rank: 1, severity: "critical", deliveryStage: "blocking", technicalAnchor: "#indexability", scope: "site", affectedUrls: [], findingCount: 1 },
      { code: "indexability_signal_conflict", rank: 2, severity: "high", deliveryStage: "blocking", technicalAnchor: "#indexability", scope: "page", affectedUrls: [HOME], findingCount: 1 },
      { code: "missing_sitemap", rank: 4, severity: "high", deliveryStage: "visibility", technicalAnchor: "#indexability", scope: "site", affectedUrls: [], findingCount: 1 },
      { code: "broken_internal_links", rank: 5, severity: "high", deliveryStage: "blocking", technicalAnchor: "#internal-links", scope: "site", affectedUrls: [], findingCount: 1 },
      { code: "missing_h1", rank: 7, severity: "high", deliveryStage: "visibility", technicalAnchor: "#page-details", scope: "page", affectedUrls: [HOME], findingCount: 1 },
      { code: "missing_image_alt", rank: 15, severity: "medium", deliveryStage: "improvement", technicalAnchor: "#page-details", scope: "page", affectedUrls: [SLOW], findingCount: 1 },
    ];

    const model = buildManagerPresentation(allGroups);
    const sixthTitle = "У части изображений нет текстового описания";

    expect(model.problems).toHaveLength(5);
    expect(model.problems.map((problem) => problem.title)).not.toContain(sixthTitle);
    expect(model.priorityStages).toContainEqual(expect.objectContaining({
      title: "Улучшить скорость, контент и дополнительные сигналы",
      items: [sixthTitle],
    }));
    expect(model.pages.find((item) => item.url === SLOW)?.mainProblem)
      .toBe("На странице не указан канонический адрес");
  });

  test("lists every requested Yandex and Alice query with localized missing and failure wording", () => {
    const model = buildManagerPresentation(input());

    expect(model.yandex.summary).toMatchObject({ requested: 3, checked: 2, found: 1, top10: 1 });
    expect(model.yandex.rows).toEqual([
      expect.objectContaining({ query: "found query", position: "4", page: SLOW, result: "Сайт найден" }),
      expect.objectContaining({ query: "missing query", result: "Не найден среди первых 20 результатов" }),
      expect.objectContaining({ query: "failed query", result: "Проверка не выполнена" }),
    ]);
    expect(model.alice).toMatchObject({ score: 33, usedCount: 1, checkedCount: 2, requestedCount: 3 });
    expect(model.alice.rows).toEqual([
      expect.objectContaining({ query: "used query", result: "Сайт использован как источник" }),
      expect.objectContaining({ query: "unused query", result: "Сайт не использован как источник" }),
      expect.objectContaining({ query: "failed ai query", result: "Проверка не выполнена" }),
    ]);
  });

  test("matches Yandex scoring semantics for shallow found and invalid position observations", () => {
    const boundary = input();
    boundary.normalized.options.keywords = ["shallow found", "shallow miss", "missing depth", "position 21"];
    boundary.normalized.yandex!.serpChecks = [
      {
        query: "shallow found", searchEngine: "yandex", provider: "yandex_search_api",
        targetDomain: "example.com", found: true, position: 4, matchedUrl: SLOW, checkedDepth: 10,
        device: "desktop", checkedAt: "2026-09-01T10:00:00.000Z",
      },
      {
        query: "shallow miss", searchEngine: "yandex", provider: "yandex_search_api",
        targetDomain: "example.com", found: false, checkedDepth: 10,
        device: "desktop", checkedAt: "2026-09-01T10:00:00.000Z",
      },
      {
        query: "missing depth", searchEngine: "yandex", provider: "yandex_search_api",
        targetDomain: "example.com", found: false,
        device: "desktop", checkedAt: "2026-09-01T10:00:00.000Z",
      },
      {
        query: "position 21", searchEngine: "yandex", provider: "yandex_search_api",
        targetDomain: "example.com", found: true, position: 21, matchedUrl: SLOW, checkedDepth: 30,
        device: "desktop", checkedAt: "2026-09-01T10:00:00.000Z",
      },
    ];
    boundary.assessment.components.yandex = {
      score: 80,
      nominalWeight: 25,
      effectiveWeight: 0,
      collectionCoverage: 0.25,
      scoringCoverage: 0,
      collected: 1,
      requested: 4,
    };

    const model = buildManagerPresentation(boundary);

    expect(model.yandex.summary).toMatchObject({ requested: 4, checked: 1, found: 1, top10: 1 });
    expect(model.yandex.summary.checked).toBe(boundary.assessment.components.yandex.collected);
    expect(model.components[1].score).toBeNull();
    expect(model.yandex.rows).toEqual([
      expect.objectContaining({ query: "shallow found", position: "4", page: SLOW, result: "Сайт найден" }),
      expect.objectContaining({ query: "shallow miss", result: "Проверены не все первые 20 результатов" }),
      expect.objectContaining({ query: "missing depth", result: "Глубина проверки не подтверждена" }),
      expect.objectContaining({ query: "position 21", result: "Результат проверки не подтверждён" }),
    ]);
    expect(model.yandex.rows[3]).toMatchObject({ position: "Нет данных", page: "Страница не определена" });
  });

  test("summarizes Lighthouse lab data and pages without using raw audit prose", () => {
    const presentationInput = input();
    presentationInput.normalized.lighthouse?.push(
      lighthouse("https://example.com/mobile-only", "mobile", 0)
    );
    const model = buildManagerPresentation(presentationInput);

    expect(model.lighthouse).toMatchObject({
      mobileAverage: 55,
      desktopAverage: 85,
      worstMobilePage: { url: SLOW, score: 40 },
      note: "Lighthouse моделирует загрузку в лабораторных условиях и не заменяет данные реальных посетителей.",
    });
    expect(model.lighthouse.scoreInputs.map((item) => [item.name, item.weight])).toEqual([
      ["Производительность на мобильных устройствах", 50],
      ["Производительность на компьютерах", 20],
      ["Доступность", 20],
      ["Лучшие практики", 10],
    ]);
    expect(model.lighthouse.supplementaryResults).toEqual([expect.objectContaining({
      name: "Поисковая оптимизация",
      score: 95,
      note: "Не входит в оценку скорости и удобства",
    })]);
    expect(model.lighthouse.diagnostics).toEqual(["Оптимизировать загрузку изображений"]);
    expect(model.pages).toEqual([
      expect.objectContaining({ url: HOME, name: "/", score: 88, indexability: "Доступна для индексации" }),
      expect.objectContaining({
        url: SLOW, name: "/slow", score: 64, indexability: "Доступна для индексации",
        mainProblem: "На странице не указан канонический адрес",
      }),
    ]);
  });

  test("discloses owner-console gaps without changing supplied scores and returns safe specialist links", () => {
    const model = buildManagerPresentation(input());

    expect(model.overall.score).toBe(72);
    expect(model.methodology.accessGaps.map((item) => item.source)).toEqual([
      "Яндекс.Вебмастер", "Google Search Console",
    ]);
    expect(model.methodology.accessNote).toContain("не снижает оценку сайта");
    expect(model.methodology.sources).toContainEqual({ source: "DataForSEO", state: "Не используется для этого рынка" });
    expect(model.specialist.links).toEqual([
      { label: "report.json", href: "report.json" },
      { label: "evidence/crawl.json", href: "evidence/crawl.json" },
      { label: "evidence/lighthouse-safe.json", href: "evidence/lighthouse-safe.json" },
      { label: "manual-query-pack.md", href: "manual-query-pack.md" },
    ]);
  });

  test("derives localized collection limitations from structured evidence without copying raw prose", () => {
    const limited = input();
    limited.normalized.crawl!.truncated = true;
    limited.normalized.crawl!.droppedEligibleCount = 4;
    limited.normalized.pages![1].status = 0;
    limited.normalized.pages![1].error = RAW_PROVIDER_ERROR;
    limited.assessment.components.lighthouse.collected = 1;
    limited.assessment.components.lighthouse.requested = 2;
    limited.assessment.components.yandex.collected = 1;
    limited.assessment.components.yandex.requested = 3;
    limited.normalized.sources!.push({ id: "lighthouse", state: "partial", message: RAW_SOURCE_MESSAGE });

    const model = buildManagerPresentation(limited);
    const limitations = model.methodology.limitations.join(" ");

    expect(limitations).toContain("Обход ограничен");
    expect(limitations).toContain("4");
    expect(limitations).toContain("Страницы с ошибкой сбора данных: 1");
    expect(limitations).toContain("Полные пары проверок Lighthouse: 1 из 2");
    expect(limitations).toContain("Проверенные запросы в Яндексе: 1 из 3");
    expect(limitations).toContain("Проверенные ответы Алисы: 2 из 3");
    expect(limitations).toContain("данные получены частично");
    expect(limitations).toContain("подтверждённого доступа");
    expect(limitations).toContain("дополнительные ограничения сбора");
    expect(limitations).not.toContain(RAW_TOP_LEVEL_LIMITATION);
    expect(limitations).not.toContain(RAW_PROVIDER_ERROR);
  });

  test("uses compile-time checked diagnostic and source presentation orders", () => {
    expect(DIAGNOSTIC_PRESENTATION_ORDER).toEqual([
      "cache-insight", "font-display-insight", "image-delivery-insight", "render-blocking-insight",
      "uses-long-cache-ttl", "font-display", "render-blocking-resources", "uses-optimized-images",
      "uses-responsive-images", "modern-image-formats", "efficient-animated-content",
    ]);
    expect(SOURCE_PRESENTATION_ORDER).toEqual([
      "crawl", "crawler", "lighthouse", "yandex_search", "alice_ai", "yandex_webmaster", "gsc", "dataforseo",
    ]);
  });

  test("shows query observations without a component score when the sample cannot be scored", () => {
    const smallSample = input();
    smallSample.assessment.components.yandex.score = 100;
    smallSample.assessment.components.yandex.scoringCoverage = 0;
    smallSample.assessment.components.yandex.effectiveWeight = 0;

    const model = buildManagerPresentation(smallSample);
    const yandexComponent = model.components.find((item) => item.name === "Позиции в Яндексе");

    expect(yandexComponent).toMatchObject({ score: null, scoreText: "Без отдельной оценки" });
    expect(model.yandex.rows).toHaveLength(3);
  });

  test("uses a neutral label for a conclusively non-indexable page", () => {
    const blocked = input();
    blocked.normalized.pages![1].indexable = false;

    const model = buildManagerPresentation(blocked);

    expect(model.pages[1].indexability).toBe("Недоступна для индексации");
  });

  test("preserves raw three-pair Lighthouse means so the weighted inputs reproduce the supplied score", () => {
    const fractional = input();
    const profile = (
      url: string,
      device: "mobile" | "desktop",
      performance: number,
      accessibility: number,
      bestPractices: number
    ) => ({
      ...lighthouse(url, device, performance),
      categoryScores: { performance, accessibility, "best-practices": bestPractices, seo: 95 },
    });
    fractional.normalized.lighthouse = [
      profile("https://example.com/a", "mobile", 56, 71, 98),
      profile("https://example.com/a", "desktop", 26, 71, 98),
      profile("https://example.com/b", "mobile", 56, 72, 98),
      profile("https://example.com/b", "desktop", 26, 72, 98),
      profile("https://example.com/c", "mobile", 57, 72, 98),
      profile("https://example.com/c", "desktop", 26, 72, 98),
    ];
    fractional.assessment.components.lighthouse = {
      ...component(58, 20, 3, 3), nominalWeight: 20, worstMobileUrl: "https://example.com/a",
    };

    const model = buildManagerPresentation(fractional);
    const reproduced = Math.round(model.lighthouse.scoreInputs.reduce(
      (sum, item) => sum + item.score * item.weight / 100,
      0
    ));

    expect(model.lighthouse.mobileAverage).toBe(169 / 3);
    expect(model.lighthouse.desktopAverage).toBe(26);
    expect(model.lighthouse.scoreInputs.map((item) => item.score)).toEqual([
      169 / 3, 26, 430 / 6, 98,
    ]);
    expect(reproduced).toBe(fractional.assessment.components.lighthouse.score);
    expect(model.lighthouse.roundingNote).toBe("Средние значения при показе могут быть округлены.");
  });

  test("never copies raw prose, provider errors, audit copy, unknown codes, or internal states", () => {
    const serialized = JSON.stringify(buildManagerPresentation(input()));
    [
      RAW_FINDING_EVIDENCE, RAW_FINDING_ACTION, RAW_SOURCE_MESSAGE, RAW_PROVIDER_ERROR,
      RAW_ALICE_ANSWER, RAW_AUDIT_TITLE, RAW_AUDIT_DESCRIPTION, RAW_TOP_LEVEL_LIMITATION, UNKNOWN_FINDING_CODE,
      "missing_canonical", "owner_access_required", "partial_success", "unknown-internal-insight",
    ].forEach((sentinel) => expect(serialized).not.toContain(sentinel));
  });

  test("allows only known technical anchors into the manager model", () => {
    const dangerous = input();
    dangerous.findingGroups[0] = {
      ...dangerous.findingGroups[0],
      technicalAnchor: "#raw-anchor-sentinel",
    };

    const model = buildManagerPresentation(dangerous);

    expect(model.problems[0].href).toMatch(/^#page-detail-/);
    expect(JSON.stringify(model)).not.toContain("raw-anchor-sentinel");
  });

  test("builds stable collision-safe page IDs and points each page problem at a rendered detail", () => {
    const duplicated = input();
    duplicated.normalized.pages!.push(page(`${SLOW}?variant=1`));
    duplicated.normalized.crawl!.pages = duplicated.normalized.pages!;

    const first = buildManagerPresentation(duplicated);
    const second = buildManagerPresentation(duplicated);
    const ids = first.pages.map((item) => item.id);

    expect(ids).toEqual(second.pages.map((item) => item.id));
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(id).toMatch(/^page-detail-[a-z0-9-]+$/));
    expect(first.problems[0].href).toBe(`#${first.pages.find((item) => item.url === SLOW)!.id}`);
  });

  test("uses real destinations and localized link labels for page, site, speed, methodology, and Alice problems", () => {
    const destinations = input();
    destinations.findingGroups = [
      { code: "missing_canonical", rank: 1, severity: "high", deliveryStage: "visibility", technicalAnchor: "#page-details", scope: "page", affectedUrls: [SLOW], findingCount: 1 },
      { code: "missing_sitemap", rank: 2, severity: "high", deliveryStage: "visibility", technicalAnchor: "#site-technical", scope: "site", affectedUrls: [], findingCount: 1 },
      { code: "mobile_desktop_regression", rank: 3, severity: "medium", deliveryStage: "improvement", technicalAnchor: "#speed-ux", scope: "site", affectedUrls: [], findingCount: 1 },
      { code: "crawl_truncated", rank: 4, severity: "medium", deliveryStage: "visibility", technicalAnchor: "#methodology", scope: "site", affectedUrls: [], findingCount: 1 },
      { code: "alice_ai_not_used", rank: 5, severity: "medium", deliveryStage: "visibility", technicalAnchor: "#alice-visibility", scope: "site", affectedUrls: [], findingCount: 1 },
    ];

    const model = buildManagerPresentation(destinations);

    expect(model.problems.map(({ href, linkLabel }) => [href, linkLabel])).toEqual([
      [`#${model.pages.find((item) => item.url === SLOW)!.id}`, "Подробнее по страницам"],
      ["#site-technical", "Технические данные сайта"],
      ["#speed-ux", "Скорость и удобство"],
      ["#methodology", "Методика и доступность данных"],
      ["#alice-visibility", "Видимость в ответах Алисы"],
    ]);
  });

  test("deduplicates every known page finding and keeps ineligible heuristics out of open cards and stages", () => {
    const complete = input();
    complete.normalized.findings.push(
      {
        code: "generic_description", severity: "low", affectedUrl: SLOW,
        evidence: RAW_FINDING_EVIDENCE, source: "crawl", confidence: "medium",
        action: RAW_FINDING_ACTION, expectedEffect: "raw effect", acceptanceCriterion: "raw criterion",
        verification: "raw verification",
      },
      {
        code: "generic_description", severity: "high", affectedUrl: `${SLOW}?duplicate=1`,
        evidence: RAW_FINDING_EVIDENCE, source: "crawl", confidence: "medium",
        action: RAW_FINDING_ACTION, expectedEffect: "raw effect", acceptanceCriterion: "raw criterion",
        verification: "raw verification",
      }
    );

    const model = buildManagerPresentation(complete);
    const slow = model.pages.find((item) => item.url === SLOW)!;

    expect(slow.problems).toEqual([
      expect.objectContaining({
        title: "На странице не указан канонический адрес",
        action: "Укажите корректный канонический адрес и повторите обход.",
      }),
      expect.objectContaining({
        title: "Описание страницы слишком общее",
        priority: "высокий",
        action: "Уточните описание по фактическому содержанию страницы.",
      }),
    ]);
    expect(model.problems.map((problem) => problem.title)).not.toContain("Описание страницы слишком общее");
    expect(model.priorityStages.flatMap((stage) => stage.items)).not.toContain("Описание страницы слишком общее");
    expect(JSON.stringify(slow)).not.toContain(RAW_FINDING_ACTION);
    expect(JSON.stringify(slow)).not.toContain(RAW_FINDING_EVIDENCE);
  });

  test("uses the explicit English fallback as one locale", () => {
    const model = buildManagerPresentation(input("de-AT"));
    const authoredText = JSON.stringify(model);

    expect(model.locale).toBe("en");
    expect(model.header.title).toBe("Site SEO audit");
    expect(model.headings.problems).toBe("What limits growth");
    expect(authoredText).not.toMatch(/[А-Яа-яЁё]/);
  });
});
