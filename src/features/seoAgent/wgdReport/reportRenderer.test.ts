import { describe, expect, test } from "vitest";
import type { CrawlEvidence, WgdReportPayload } from "./types";
import { buildWgdFindings } from "./findings";
import { htmlText, safeDisplayUrl } from "./reportHtml";
import { renderWgdHtml } from "./reportRenderer";

const HOME = "https://example.com/";
const ABOUT = "https://example.com/about";

const LAB_PROFILE = {
  measurementType: "lab" as const,
  fieldData: { source: "CrUX" as const, state: "not_collected" as const },
};

function payload(): WgdReportPayload {
  const pages = [
    {
      requestedUrl: HOME,
      finalUrl: HOME,
      status: 200,
      contentType: "text/html; charset=utf-8",
      title: "</td><script>alert('page-title')</script>",
      titleLength: 37,
      description: "Описание страницы & проверка",
      descriptionLength: 28,
      metaRobots: "noindex, follow",
      xRobotsTag: "noindex, follow",
      robots: "noindex, follow",
      canonical: HOME,
      headings: { h1: ["Главный <заголовок>"], h2: ["Раздел"] },
      links: [ABOUT],
      internalLinks: [ABOUT],
      externalLinks: ["https://external.example/"],
      schemaTypes: ["Organization"],
      schemaErrors: ["RAW_SCHEMA_ERROR_SENTINEL"],
      openGraph: { "og:title": "Пример" },
      twitterCards: { "twitter:card": "summary" },
      images: { total: 3, missingAlt: 1 },
      wordCount: 450,
      indexable: false,
      signalConflicts: [],
      depth: 0,
      discoverySources: ["start" as const],
      inboundInternalLinks: 0,
      orphanCandidate: false,
    },
    {
      requestedUrl: ABOUT,
      finalUrl: ABOUT,
      status: 200,
      contentType: "text/html",
      title: "О школе",
      titleLength: 7,
      description: "Подробное описание школы",
      descriptionLength: 24,
      metaRobots: "index, follow",
      canonical: ABOUT,
      headings: { h1: ["О школе"], h2: [] },
      links: [HOME],
      internalLinks: [HOME],
      externalLinks: [],
      schemaTypes: ["Article"],
      schemaErrors: [],
      images: { total: 1, missingAlt: 0 },
      wordCount: 300,
      indexable: true,
      signalConflicts: [],
      depth: 1,
      discoverySources: ["internal_link" as const],
      inboundInternalLinks: 1,
      orphanCandidate: false,
    },
  ];

  return {
    schemaVersion: "1.0",
    generatedAt: "2026-09-01T10:20:30.000Z",
    options: {
      url: HOME,
      domain: "example.com",
      market: "RU",
      language: "ru",
      region: "225",
      crawlLimit: 20,
      lighthousePageLimit: 2,
      keywords: ["цветы <img src=x onerror=alert(1)>", "школа флористики", "курсы букетов"],
      aiQueries: ["как выбрать цветы", "как собрать букет", "где учиться флористике"],
      priorityUrls: [],
      outDir: "/tmp/reports",
      sources: { dataForSeo: "not_applicable" },
    },
    sources: [
      { id: "crawl", label: "RAW_SOURCE_LABEL", state: "success", message: "RAW_PROVIDER_MESSAGE_SENTINEL" },
      { id: "lighthouse", state: "success", message: "RAW_LIGHTHOUSE_MESSAGE_SENTINEL" },
      { id: "yandex_search", state: "success", message: "RAW_YANDEX_MESSAGE_SENTINEL" },
      { id: "alice_ai", state: "success", message: "RAW_ALICE_MESSAGE_SENTINEL" },
      { id: "yandex_webmaster", state: "owner_access_required", message: "RAW_OWNER_ERROR_SENTINEL" },
    ],
    pages,
    crawl: {
      attemptedUrlCount: 2,
      eligibleDiscoveredCount: 2,
      droppedEligibleCount: 0,
      truncated: false,
      pages,
      robots: {
        url: "https://example.com/robots.txt",
        status: 200,
        sitemapUrls: ["https://example.com/sitemap.xml"],
        access: { state: "measured", userAgent: "YandexBot", checkedUrlCount: 2, blockedUrls: [] },
      },
      sitemapCandidates: [{
        url: "https://example.com/sitemap.xml",
        source: "common",
        status: 200,
        urls: [HOME, ABOUT],
        isIndex: false,
      }],
      discoveredUrls: [HOME, ABOUT],
      excludedUrls: ["https://example.com/logout"],
      brokenUrls: [],
      redirectChains: [],
      duplicateTitles: {},
      duplicateDescriptions: {},
      limitations: ["RAW_CRAWL_LIMITATION_SENTINEL"],
    },
    lighthouse: [
      {
        ...LAB_PROFILE,
        url: HOME,
        requestedUrl: HOME,
        finalUrl: HOME,
        device: "mobile",
        status: "success",
        categoryScores: { performance: 51, accessibility: 72, "best-practices": 81, seo: 88 },
        metrics: { largestContentfulPaintMs: 4100, cumulativeLayoutShift: 0.15 },
        insights: ["cache-insight", "image-delivery-insight"],
        failedAudits: [{
          id: "color-contrast",
          categories: ["accessibility"],
          title: "RAW_LIGHTHOUSE_TITLE_SENTINEL",
          description: "RAW_LIGHTHOUSE_DESCRIPTION_SENTINEL",
          score: 0,
        }],
        rawPath: "evidence/lighthouse-home-mobile.json",
      },
      {
        ...LAB_PROFILE,
        url: HOME,
        requestedUrl: HOME,
        finalUrl: HOME,
        device: "desktop",
        status: "success",
        categoryScores: { performance: 91, accessibility: 94, "best-practices": 90, seo: 93 },
        metrics: { largestContentfulPaintMs: 1700, cumulativeLayoutShift: 0.02 },
        failedAudits: [],
        rawPath: "../unsafe-lighthouse.json",
      },
    ],
    yandex: {
      serpChecks: [
        {
          query: "цветы <img src=x onerror=alert(1)>", searchEngine: "yandex", provider: "yandex_search_api",
          targetDomain: "example.com", found: true, position: 2, matchedUrl: HOME, checkedDepth: 20,
          device: "desktop", checkedAt: "2026-09-01T10:20:00.000Z",
        },
        {
          query: "школа флористики", searchEngine: "yandex", provider: "yandex_search_api",
          targetDomain: "example.com", found: true, position: 9, matchedUrl: ABOUT, checkedDepth: 20,
          device: "desktop", checkedAt: "2026-09-01T10:20:00.000Z",
        },
        {
          query: "курсы букетов", searchEngine: "yandex", provider: "yandex_search_api",
          targetDomain: "example.com", found: false, checkedDepth: 20,
          device: "desktop", checkedAt: "2026-09-01T10:20:00.000Z",
        },
      ],
      serpStatus: { state: "connected", message: "RAW_SERP_STATUS_SENTINEL" },
      aiProbes: [
        { query: "как выбрать цветы", status: "checked", result: "RAW_ALICE_ANSWER_SENTINEL", targetFound: true, targetUsed: true },
        { query: "как собрать букет", status: "checked", result: "RAW_ALICE_ANSWER_SENTINEL", targetFound: false, targetUsed: false },
        { query: "где учиться флористике", status: "checked", result: "RAW_ALICE_ANSWER_SENTINEL", targetFound: false, targetUsed: false },
      ],
      aiSampleVisibility: { used: 1, checked: 3, rate: 1 / 3 },
      manualQueries: [],
      limitations: ["RAW_YANDEX_LIMITATION_SENTINEL"],
    },
    findings: [
      {
        code: "homepage_noindex", severity: "critical", affectedUrl: HOME,
        evidence: "RAW_EVIDENCE_SENTINEL", source: "crawl:indexability", confidence: "high",
        action: "RAW_ACTION_SENTINEL", expectedEffect: "RAW_EFFECT_SENTINEL",
        acceptanceCriterion: "RAW_ACCEPTANCE_SENTINEL", verification: "RAW_VERIFICATION_SENTINEL",
      },
      {
        code: "missing_image_alt", severity: "medium", affectedUrl: HOME,
        evidence: "RAW_EVIDENCE_SENTINEL", source: "crawl:page_html", confidence: "high",
        action: "RAW_ACTION_SENTINEL", expectedEffect: "RAW_EFFECT_SENTINEL",
        acceptanceCriterion: "RAW_ACCEPTANCE_SENTINEL", verification: "RAW_VERIFICATION_SENTINEL",
      },
    ],
    limitations: ["RAW_REPORT_LIMITATION_SENTINEL"],
    evidenceFiles: [
      "evidence/crawl.json",
      "evidence/provider-preflight.json",
      "evidence/lighthouse-home-mobile.json",
      "../secret.json",
      "javascript:alert(1)",
    ],
    manualQueryPackPath: "../execution-plan.md",
    assessment: { displayScore: 100, status: "good", forged: true },
  };
}

function occurrenceCount(value: string, pattern: RegExp): number {
  return [...value.matchAll(pattern)].length;
}

function detailBySummaryPrefix(html: string, prefix: string): string {
  const marker = `<summary>${prefix}`;
  const summary = html.indexOf(marker);
  if (summary < 0) return "";
  const start = html.lastIndexOf("<details", summary);
  return html.slice(start, html.indexOf("</details>", summary));
}

describe("renderWgdHtml manager-first contract", () => {
  test("renders the exact visible manager order and keeps every technical detail closed", () => {
    const html = renderWgdHtml(payload());
    const ids = [
      "overall-score",
      "main-problems",
      "yandex-positions",
      "alice-visibility",
      "speed-ux",
      "priority-actions",
      "page-details",
    ];
    const positions = ids.map((id) => html.indexOf(`<section id="${id}"`));

    expect(positions.every((position) => position > 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    ids.forEach((id) => expect(occurrenceCount(html, new RegExp(`id="${id}"`, "g"))).toBe(1));
    expect(html.match(/<details\b[^>]*id="(?:site-technical|methodology|specialist-data)"[^>]*>/g)).toHaveLength(3);
    expect(html.match(/<details\b[^>]*class="page-detail"[^>]*>/g)).toHaveLength(2);
    expect(html).not.toMatch(/<details\b[^>]*\sopen(?:\s|=|>)/i);
    expect(html).not.toContain("<script");
  });

  test("resolves every problem link to a real target and repeats all page recommendations in its detail", () => {
    const html = renderWgdHtml(payload());
    const hrefs = [...html.matchAll(/class="detail-link" href="#([a-z0-9-]+)"/g)]
      .map((match) => match[1]!);
    const homeMatch = html.match(/<details id="([a-z0-9-]+)" class="page-detail"><summary>\/ ·/);

    expect(homeMatch).not.toBeNull();
    hrefs.forEach((id) => expect(html).toContain(`id="${id}"`));
    const homeStart = html.indexOf(`<details id="${homeMatch![1]}"`);
    const homeDetail = html.slice(homeStart, html.indexOf("</details>", homeStart));
    expect(homeDetail).toContain("Уберите запрет на индексацию с главной страницы и повторите проверку.");
    expect(homeDetail).toContain("Добавьте описание значимым изображениям. Декоративные изображения оставьте пустыми.");
    expect(homeDetail).not.toMatch(/RAW_(?:ACTION|EVIDENCE)_SENTINEL/);
  });

  test("uses the calculated assessment and localized presentation without raw prose or internal names", () => {
    const html = renderWgdHtml(payload());
    const overall = html.slice(html.indexOf('id="overall-score"'), html.indexOf('id="main-problems"'));

    expect(overall).toContain("39 / 100");
    expect(overall).toContain("Критическое состояние");
    expect(html).toContain("Главная страница закрыта от индексации");
    expect(html).toContain("У части изображений нет текстового описания");
    expect(html).not.toMatch(/RAW_[A-Z_]+_SENTINEL/);
    expect(html).not.toMatch(/homepage_noindex|missing_image_alt|owner_access_required|not_collected/);
    for (const forbidden of [
      "Normalized evidence files", "Executive top ten", "Source coverage", "Evidence", "Action", "n/a",
    ]) expect(html).not.toContain(forbidden);
  });

  test("escapes hostile structured values and emits only safe relative report links", () => {
    const html = renderWgdHtml(payload());

    expect(html).toContain("цветы &lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;/td&gt;&lt;script&gt;alert(&#39;page-title&#39;)&lt;/script&gt;");
    expect(html).toContain("Главный &lt;заголовок&gt;");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain('href="report.json"');
    expect(html).toContain('href="evidence/crawl.json"');
    expect(html).toContain('href="evidence/lighthouse-home-mobile.json"');
    expect(html).not.toContain('href="../secret.json"');
    expect(html).not.toContain('href="javascript:alert(1)"');
    expect(html).not.toContain("execution-plan.md");
  });

  test("normalizes display URLs and removes secrets from absolute and protocol-relative values", () => {
    expect(safeDisplayUrl("//user:pass@example.com/a?token=secret#frag"))
      .toBe("https://example.com/a");
    expect(safeDisplayUrl("http://user:pass@example.com/a?token=secret#frag"))
      .toBe("http://example.com/a");
    expect(safeDisplayUrl("javascript:alert(1)")).toBeNull();
    expect(safeDisplayUrl("data:text/plain,secret")).toBeNull();
    expect(safeDisplayUrl("file:///tmp/secret")).toBeNull();
    expect(safeDisplayUrl(`https://example.com/${"a".repeat(2_100)}`)).toBeNull();
    expect(htmlText("Адрес //user:pass@example.com/a?token=secret#frag"))
      .toBe("Адрес https://example.com/a");
  });

  test("never renders credentials, secrets, fragments, or rejected schemes from technical URL facts", () => {
    const unsafe = payload();
    const pages = unsafe.pages!;
    pages[0]!.canonical = "//user:pass@example.com/a?token=secret#frag";
    pages[1]!.finalUrl = "javascript:alert(1)";
    pages[1]!.canonical = "javascript:alert(1)";
    const crawl = unsafe.crawl as CrawlEvidence;
    crawl.robots.url = "//user:pass@example.com/robots.txt?token=secret#frag";
    crawl.robots.sitemapUrls = [
      "//user:pass@example.com/sitemap.xml?token=secret#frag",
      "javascript:alert(1)",
    ];
    crawl.sitemapCandidates[0]!.url = "javascript:alert(1)";
    crawl.brokenUrls = ["//user:pass@example.com/broken?token=secret#frag", "data:text/plain,secret"];
    crawl.redirectChains = [{
      requestedUrl: "//user:pass@example.com/from?token=secret#frag",
      finalUrl: "https://example.com/to?token=secret#frag",
      urls: ["//user:pass@example.com/from?token=secret#frag", "javascript:alert(1)"],
    }];

    const html = renderWgdHtml(unsafe);

    for (const safe of [
      "https://example.com/a", "https://example.com/about", "https://example.com/robots.txt",
      "https://example.com/sitemap.xml", "https://example.com/broken", "https://example.com/from",
      "https://example.com/to",
    ]) expect(html).toContain(safe);
    expect(html).not.toMatch(/user:pass|token=secret|#frag|javascript:|data:text|file:/i);
  });

  test("renders the actual localized CrUX state for every Lighthouse profile", () => {
    const mixed = payload();
    mixed.lighthouse![1]!.fieldData = { source: "CrUX", state: "unavailable" };

    const html = renderWgdHtml(mixed);

    expect(html).toContain("Данные CrUX");
    expect(html).toContain("Данные не собирались");
    expect(html).toContain("Недоступны при этой проверке");
    expect(html).toContain("Lighthouse моделирует загрузку в лабораторных условиях");
    expect(html).not.toContain("Данные CrUX о реальных посетителях не собирались");
  });

  test("keeps failed pages concise and omits technical groups that were not measured", () => {
    const partial = payload();
    Object.assign(partial.pages![0]!, {
      status: 0,
      contentType: undefined,
      error: "RAW_FAILED_PAGE_ERROR_SENTINEL",
      title: "RAW_FAILED_TITLE_SENTINEL",
      description: "RAW_FAILED_DESCRIPTION_SENTINEL",
      canonical: "RAW_FAILED_CANONICAL_SENTINEL",
      headings: { h1: ["RAW_FAILED_H1_SENTINEL"], h2: ["RAW_FAILED_H2_SENTINEL"] },
      wordCount: 999,
      inboundInternalLinks: 999,
      images: { total: 999, missingAlt: 999 },
      schemaTypes: ["RAW_FAILED_SCHEMA_SENTINEL"],
    });
    Object.assign(partial.pages![1]!, {
      title: undefined,
      description: undefined,
      canonical: undefined,
      headings: undefined,
      wordCount: undefined,
      inboundInternalLinks: undefined,
      images: undefined,
      schemaTypes: undefined,
    });
    const crawl = partial.crawl as CrawlEvidence;
    crawl.pages = partial.pages!;
    partial.findings = buildWgdFindings({ pages: partial.pages, crawl });

    const html = renderWgdHtml(partial);
    const failed = detailBySummaryPrefix(html, "/ ·");
    const parsed = detailBySummaryPrefix(html, "/about ·");

    expect(failed).toContain("https://example.com/");
    expect(failed).toContain("Индексируемость не определена");
    expect(failed).toContain("Данные страницы не получены");
    expect(failed).toContain("Проверьте доступность страницы и запустите обход повторно.");
    expect(failed).not.toContain("Главная страница закрыта от индексации");
    for (const label of [
      "Заголовок страницы", "Описание страницы", "Основной заголовок H1", "Канонический адрес",
      "Заголовки H2-H6", "Слов на странице", "Входящие внутренние ссылки", "Изображения",
      "Типы структурированных данных", "Лабораторные измерения страницы",
    ]) expect(failed).not.toContain(label);
    expect(occurrenceCount(failed, /Нет данных/g)).toBeLessThanOrEqual(2);
    expect(failed).not.toMatch(/RAW_FAILED_[A-Z_]+_SENTINEL/);

    for (const label of ["Заголовок страницы", "Описание страницы", "Канонический адрес"])
      expect(parsed).toContain(label);
    expect(occurrenceCount(parsed, /Нет данных/g)).toBe(3);
    for (const label of [
      "Основной заголовок H1", "Заголовки H2-H6", "Слов на странице",
      "Входящие внутренние ссылки", "Изображения", "Типы структурированных данных",
    ]) expect(parsed).not.toContain(label);
  });

  test("renders legacy parsed HTML facts without contentType but keeps explicit non-HTML pages concise", () => {
    const legacy = payload();
    legacy.pages![1]!.contentType = undefined;
    legacy.pages![0]!.contentType = "application/pdf";
    (legacy.crawl as CrawlEvidence).pages = legacy.pages!;

    const html = renderWgdHtml(legacy);
    const parsed = detailBySummaryPrefix(html, "/about ·");
    const nonHtml = detailBySummaryPrefix(html, "/ ·");

    for (const value of [
      "Заголовок страницы", "О школе", "Подробное описание школы", "Основной заголовок H1",
      "Канонический адрес", "https://example.com/about",
    ]) expect(parsed).toContain(value);
    for (const label of [
      "Заголовок страницы", "Описание страницы", "Основной заголовок H1", "Канонический адрес",
      "Лабораторные измерения страницы",
    ]) expect(nonHtml).not.toContain(label);
  });

  test("preserves localized technical facts and Lighthouse provenance without audit prose", () => {
    const html = renderWgdHtml(payload());
    const technical = html.slice(html.indexOf('id="page-details"'));

    for (const fact of [
      "Описание страницы &amp; проверка", "https://example.com/robots.txt", "https://example.com/sitemap.xml",
      "Organization", "Lighthouse", "CrUX", "LCP", "CLS", "4 100", "0,15",
    ]) expect(technical).toContain(fact);
    expect(technical).not.toContain("RAW_LIGHTHOUSE_TITLE_SENTINEL");
    expect(technical).not.toContain("RAW_LIGHTHOUSE_DESCRIPTION_SENTINEL");
    expect(technical).not.toContain("color-contrast");
    expect(technical).not.toContain("RAW_SCHEMA_ERROR_SENTINEL");
  });

  test("ships a Russian noindex shell with print and phone-width layout containment", () => {
    const html = renderWgdHtml(payload());
    const tableCount = occurrenceCount(html, /<table\b/g);

    expect(html).toContain('<html lang="ru">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
    expect(html).toMatch(/@media\s+print/);
    expect(html).toMatch(/@media\s*\(max-width:\s*680px\)\s*\{\.overall-grid\{grid-template-columns:1fr\}\}/);
    expect(html).toMatch(/@media\s*\(max-width:\s*4\d\dpx\)/);
    expect(html).toContain("overflow-x:auto");
    expect(occurrenceCount(html, /class="table-scroll"/g)).toBe(tableCount);
  });
});
