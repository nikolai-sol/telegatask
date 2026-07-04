import fs from "fs";
import path from "path";
import { describe, expect, test } from "vitest";

import aiProbesFixture from "./fixtures/aiProbes.json";
import draftTasksFixture from "./fixtures/draftTasks.json";
import lighthouseFixture from "./fixtures/lighthouse.json";
import pageFixture from "./fixtures/page.json";
import runFixture from "./fixtures/run.json";
import sitemapFixture from "./fixtures/sitemap.json";
import yandexQueriesFixture from "./fixtures/yandexQueries.json";

type AnyRecord = Record<string, unknown>;

const requiredTopLevelKeys = ["run", "draftTasks", "page", "sitemap", "lighthouse", "yandexQueries", "aiProbes"];
const knownSources = [
  "mock",
  "sistrix",
  "pagespeed",
  "crawler",
  "gsc",
  "yandex_webmaster",
  "google_serp_rank",
  "yandex_serp_rank",
] as const;
const selectedProductionSources = ["crawler", "yandex_webmaster", "yandex_serp_rank"];

function isRecord(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function expectRecord(value: unknown): asserts value is AnyRecord {
  expect(isRecord(value)).toBe(true);
}

function expectKeys(value: AnyRecord, keys: string[]): void {
  for (const key of keys) {
    expect(value).toHaveProperty(key);
  }
}

function expectStringOrNull(value: unknown): void {
  expect(typeof value === "string" || value === null).toBe(true);
}

function expectNumberOrNull(value: unknown): void {
  expect(typeof value === "number" || value === null).toBe(true);
}

function expectBooleanOrNull(value: unknown): void {
  expect(typeof value === "boolean" || value === null).toBe(true);
}

function loadReportPayload(): AnyRecord {
  const reportPath = process.env.WGD_BASELINE_REPORT;
  if (reportPath) {
    return JSON.parse(fs.readFileSync(path.resolve(reportPath), "utf8")) as AnyRecord;
  }

  return {
    run: runFixture,
    draftTasks: draftTasksFixture,
    page: pageFixture,
    sitemap: sitemapFixture,
    lighthouse: lighthouseFixture,
    yandexQueries: yandexQueriesFixture,
    aiProbes: aiProbesFixture,
  };
}

function loadHtmlReport(): string {
  const htmlPath =
    process.env.WGD_BASELINE_HTML ||
    path.resolve(__dirname, "fixtures", "report-outline.html");
  return fs.readFileSync(path.resolve(htmlPath), "utf8");
}

function validateSourceStatus(value: unknown): void {
  expectRecord(value);
  expect(knownSources).toContain(value.source);
  expect(["success", "partial", "failed", "skipped"]).toContain(value.status);
  expect(typeof value.message).toBe("string");
  expect(typeof value.collectedAt === "number" || typeof value.collectedAt === "string").toBe(true);
  if (value.errorCode !== undefined) expect(typeof value.errorCode).toBe("string");
  if (value.metricsSummary !== undefined) expectRecord(value.metricsSummary);
}

function validateSearchSnapshot(value: unknown): void {
  expectRecord(value);
  expectKeys(value, [
    "property",
    "siteUrl",
    "dateRange",
    "clicks",
    "impressions",
    "ctr",
    "averagePosition",
    "topQueries",
    "topPages",
    "countries",
    "devices",
  ]);
  expectStringOrNull(value.property);
  expectStringOrNull(value.siteUrl);
  expectRecord(value.dateRange);
  expectStringOrNull(value.dateRange.startDate);
  expectStringOrNull(value.dateRange.endDate);
  expectNumberOrNull(value.dateRange.days);
  expectNumberOrNull(value.clicks);
  expectNumberOrNull(value.impressions);
  expectNumberOrNull(value.ctr);
  expectNumberOrNull(value.averagePosition);
  expect(Array.isArray(value.topQueries)).toBe(true);
  expect(Array.isArray(value.topPages)).toBe(true);
  expect(Array.isArray(value.countries)).toBe(true);
  expect(Array.isArray(value.devices)).toBe(true);
}

function validateCrawler(value: unknown): void {
  expectRecord(value);
  expectKeys(value, [
    "pageUrl",
    "finalUrl",
    "httpStatus",
    "hasTitle",
    "hasMetaDescription",
    "hasH1",
    "hasCanonical",
    "robotsTxtReachable",
    "sitemapXmlReachable",
    "isIndexable",
  ]);
  expectStringOrNull(value.pageUrl);
  expectStringOrNull(value.finalUrl);
  expectNumberOrNull(value.httpStatus);
  expectBooleanOrNull(value.hasTitle);
  expectBooleanOrNull(value.hasMetaDescription);
  expectBooleanOrNull(value.hasH1);
  expectBooleanOrNull(value.hasCanonical);
  expectBooleanOrNull(value.robotsTxtReachable);
  expectBooleanOrNull(value.sitemapXmlReachable);
  expectBooleanOrNull(value.isIndexable);
}

function validatePageSpeedSnapshot(value: unknown): void {
  expectRecord(value);
  expectKeys(value, [
    "pageUrl",
    "performanceScore",
    "accessibilityScore",
    "bestPracticesScore",
    "seoScore",
    "largestContentfulPaintMs",
    "cumulativeLayoutShift",
    "interactionToNextPaintMs",
    "totalBlockingTimeMs",
  ]);
  expectStringOrNull(value.pageUrl);
  expectNumberOrNull(value.performanceScore);
  expectNumberOrNull(value.accessibilityScore);
  expectNumberOrNull(value.bestPracticesScore);
  expectNumberOrNull(value.seoScore);
  expectNumberOrNull(value.largestContentfulPaintMs);
  expectNumberOrNull(value.cumulativeLayoutShift);
  expectNumberOrNull(value.interactionToNextPaintMs);
  expectNumberOrNull(value.totalBlockingTimeMs);
}

function validateRecommendation(value: unknown): void {
  expectRecord(value);
  expectKeys(value, ["type", "title", "description", "priority"]);
  expect(["content", "technical", "competitive", "tracking"]).toContain(value.type);
  expect(typeof value.title).toBe("string");
  expect(typeof value.description).toBe("string");
  expect(["low", "medium", "high"]).toContain(value.priority);
}

function validateEvidence(value: unknown): void {
  expectRecord(value);
  expect(typeof value.source).toBe("string");
  expect(typeof value.message).toBe("string");
  if (value.metric !== undefined) expect(typeof value.metric).toBe("string");
  if (value.url !== undefined) expectStringOrNull(value.url);
  if (value.query !== undefined) expectStringOrNull(value.query);
}

function validateDraftTask(value: unknown): void {
  expectRecord(value);
  expectKeys(value, [
    "id",
    "teamId",
    "companyId",
    "runId",
    "domain",
    "sourceType",
    "sourceId",
    "sourceFindingId",
    "evidence",
    "labels",
    "title",
    "description",
    "priority",
    "status",
    "targetKeywords",
    "suggestedCompanyId",
    "realTaskId",
    "convertedAt",
    "convertedByUserId",
    "createdAt",
    "updatedAt",
  ]);
  expect(typeof value.id).toBe("string");
  expect(typeof value.teamId).toBe("string");
  expect(typeof value.companyId).toBe("string");
  expect(typeof value.runId).toBe("string");
  expect(value.domain).toBe("zaruku.ru");
  expect(["opportunity", "recommendation"]).toContain(value.sourceType);
  expectStringOrNull(value.sourceId);
  expectStringOrNull(value.sourceFindingId);
  expect(Array.isArray(value.evidence)).toBe(true);
  expect((value.evidence as unknown[]).length).toBeGreaterThan(0);
  (value.evidence as unknown[]).forEach(validateEvidence);
  expect(Array.isArray(value.labels)).toBe(true);
  expect(typeof value.title).toBe("string");
  expect(typeof value.description).toBe("string");
  expect(["normal", "priority", "fire"]).toContain(value.priority);
  expect(["draft", "approved", "rejected"]).toContain(value.status);
  expect(Array.isArray(value.targetKeywords)).toBe(true);
  expectStringOrNull(value.suggestedCompanyId);
  expectStringOrNull(value.realTaskId);
  expectStringOrNull(value.convertedAt);
  expectStringOrNull(value.convertedByUserId);
  expect(typeof value.createdAt).toBe("string");
  expect(typeof value.updatedAt).toBe("string");
}

describe("Zaruku WGD golden baseline regression", () => {
  const payload = loadReportPayload();

  test("preserves top-level report sections", () => {
    expect(Object.keys(payload).sort()).toEqual([...requiredTopLevelKeys].sort());
  });

  test("preserves production run schema and source selection", () => {
    const run = payload.run;
    expectRecord(run);
    expectKeys(run, [
      "id",
      "teamId",
      "companyId",
      "configId",
      "mode",
      "status",
      "provider",
      "sources",
      "sourceStatuses",
      "domain",
      "summary",
      "visibility",
      "keywords",
      "competitors",
      "technical",
      "searchConsole",
      "yandexWebmaster",
      "rankTracking",
      "pagespeed",
      "crawler",
      "findings",
      "opportunities",
      "recommendations",
      "harness",
      "scores",
      "createdAt",
      "createdByUserId",
    ]);

    expect(run.domain).toBe("zaruku.ru");
    expect(run.mode).toBe("quick_audit");
    expect(run.provider).toBe("multi_source");
    expect(run.sources).toEqual(selectedProductionSources);
    expect(["draft", "approved", "rejected", "failed"]).toContain(run.status);

    expectRecord(run.summary);
    expectKeys(run.summary, ["visibilityIndex", "keywordCount", "competitorCount"]);
    expectRecord(run.visibility);
    expectKeys(run.visibility, ["visibilityIndex", "trend", "notes"]);
    expect(Array.isArray(run.keywords)).toBe(true);
    expect(Array.isArray(run.competitors)).toBe(true);
    expectRecord(run.technical);
    expectKeys(run.technical, ["issueCount", "highlights"]);
    expect(Array.isArray(run.findings)).toBe(true);
    expect(Array.isArray(run.opportunities)).toBe(true);
    expect(Array.isArray(run.recommendations)).toBe(true);
    (run.recommendations as unknown[]).forEach(validateRecommendation);
    expectRecord(run.harness);
    expectKeys(run.harness, ["selectedSkills", "warnings", "blockedActions", "confidenceSummary", "draftTasks"]);
    expectRecord(run.scores);
    expectKeys(run.scores, ["visibilityScore", "opportunityScore", "competitorPressureScore", "overallSeoScore"]);
  });

  test("preserves collector presence and normalized collector outputs", () => {
    const run = payload.run;
    expectRecord(run);
    expect(Array.isArray(run.sourceStatuses)).toBe(true);
    const sourceStatuses = run.sourceStatuses as unknown[];
    sourceStatuses.forEach(validateSourceStatus);

    const statusNames = sourceStatuses.map((item) => {
      expectRecord(item);
      return item.source;
    });
    expect(statusNames).toEqual([...knownSources]);
    expect(statusNames).toEqual(expect.arrayContaining(selectedProductionSources));

    validateSearchSnapshot(run.searchConsole);
    validateSearchSnapshot(run.yandexWebmaster);
    validateCrawler(run.crawler);
    validatePageSpeedSnapshot(run.pagespeed);

    expectRecord(run.rankTracking);
    if (run.rankTracking.yandex !== undefined) {
      expectRecord(run.rankTracking.yandex);
      expect(run.rankTracking.yandex.provider).toBe("yandex_search_api");
      expect(Array.isArray(run.rankTracking.yandex.checks)).toBe(true);
      expectRecord(run.rankTracking.yandex.status);
      expectKeys(run.rankTracking.yandex.status, ["state", "message", "checkedAt"]);
    }
  });

  test("preserves draft task schema", () => {
    expect(Array.isArray(payload.draftTasks)).toBe(true);
    expect((payload.draftTasks as unknown[]).length).toBeGreaterThan(0);
    (payload.draftTasks as unknown[]).forEach(validateDraftTask);
  });

  test("preserves runner-owned page, sitemap, Lighthouse, Yandex query, and AI probe schemas", () => {
    const page = payload.page;
    expectRecord(page);
    expectKeys(page, [
      "url",
      "finalUrl",
      "httpStatus",
      "title",
      "description",
      "h1",
      "canonical",
      "wordCount",
      "bodySample",
      "internalLinks",
    ]);
    expectStringOrNull(page.title);
    expectStringOrNull(page.description);
    expectStringOrNull(page.h1);
    expectNumberOrNull(page.httpStatus);
    expect(typeof page.wordCount).toBe("number");
    expect(Array.isArray(page.internalLinks)).toBe(true);

    const sitemap = payload.sitemap;
    expectRecord(sitemap);
    expectKeys(sitemap, ["sitemapUrl", "status", "urlCount", "sampledUrls", "sectionCounts"]);
    expect(typeof sitemap.sitemapUrl).toBe("string");
    expectNumberOrNull(sitemap.status);
    expect(typeof sitemap.urlCount).toBe("number");
    expect(Array.isArray(sitemap.sampledUrls)).toBe(true);
    expect(Array.isArray(sitemap.sectionCounts)).toBe(true);

    const lighthouse = payload.lighthouse;
    expectRecord(lighthouse);
    expectKeys(lighthouse, [
      "status",
      "message",
      "pageUrl",
      "performanceScore",
      "accessibilityScore",
      "bestPracticesScore",
      "seoScore",
      "firstContentfulPaintMs",
      "largestContentfulPaintMs",
      "cumulativeLayoutShift",
      "totalBlockingTimeMs",
      "speedIndexMs",
      "totalByteWeight",
    ]);
    expect(["success", "failed"]).toContain(lighthouse.status);
    expect(typeof lighthouse.message).toBe("string");
    expectNumberOrNull(lighthouse.performanceScore);
    expectNumberOrNull(lighthouse.accessibilityScore);
    expectNumberOrNull(lighthouse.bestPracticesScore);
    expectNumberOrNull(lighthouse.seoScore);

    expect(Array.isArray(payload.yandexQueries)).toBe(true);
    for (const query of payload.yandexQueries as unknown[]) {
      expectRecord(query);
      expectKeys(query, ["query", "impressions", "clicks", "ctr", "averagePosition"]);
      expect(typeof query.query).toBe("string");
      expectNumberOrNull(query.impressions);
      expectNumberOrNull(query.clicks);
      expectNumberOrNull(query.ctr);
      expectNumberOrNull(query.averagePosition);
    }

    expect(Array.isArray(payload.aiProbes)).toBe(true);
    for (const probe of payload.aiProbes as unknown[]) {
      expectRecord(probe);
      expectKeys(probe, [
        "channel",
        "status",
        "query",
        "result",
        "sources",
        "sourceDetails",
        "usedSources",
        "targetFound",
        "targetUsed",
        "sourcePosition",
        "usedSourcePosition",
      ]);
      expect(typeof probe.channel).toBe("string");
      expect(["checked", "not_configured", "permission_denied", "failed"]).toContain(probe.status);
      expect(typeof probe.query).toBe("string");
      expect(typeof probe.result).toBe("string");
      expect(Array.isArray(probe.sources)).toBe(true);
      expect(Array.isArray(probe.sourceDetails)).toBe(true);
      expect(Array.isArray(probe.usedSources)).toBe(true);
      expect(typeof probe.targetFound).toBe("boolean");
      expect(typeof probe.targetUsed).toBe("boolean");
      expectNumberOrNull(probe.sourcePosition);
      expectNumberOrNull(probe.usedSourcePosition);
    }
  });

  test("preserves HTML report outline", () => {
    const html = loadHtmlReport();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>WGD Report - zaruku.ru</title>");
    expect(html).toContain("Executive Snapshot");
    expect(html).toContain("Yandex Webmaster: top queries");
    expect(html).toContain("Yandex SERP rank checks");
    expect(html).toContain("Lighthouse");
    expect(html).toContain("Yandex Alisa / AI source position");
    expect(html).toContain("Draft tasks");
  });
});
