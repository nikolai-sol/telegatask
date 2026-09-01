import { describe, expect, test } from "vitest";
import type {
  LighthouseFieldDataEvidence,
  WgdAssessmentState,
  WgdFindingDeliveryStage,
  WgdFindingSeverity,
  WgdKnownFindingCode,
  WgdScoreStatus,
} from "./types";
import {
  getReportLocalization,
  resolveReportLocale,
  type WgdLighthouseCategory,
  type WgdLighthouseDiagnostic,
  type WgdManagerEmptyState,
  type WgdManagerHeading,
  type WgdManagerLabel,
  type WgdManagerLimitation,
  type WgdManagerSourceState,
  type WgdKnownSourceId,
  type WgdPageIndexabilityState,
} from "./reportLocalization";

const ASSESSMENT_STATES: readonly WgdAssessmentState[] = ["scored", "preliminary", "insufficient_data"];
const SCORE_STATUSES: readonly WgdScoreStatus[] = ["critical", "high_risk", "needs_improvement", "good"];
const SEVERITIES: readonly WgdFindingSeverity[] = ["critical", "high", "medium", "low"];
const DELIVERY_STAGES: readonly WgdFindingDeliveryStage[] = ["blocking", "visibility", "improvement"];
const FINDING_CODES: readonly WgdKnownFindingCode[] = [
  "homepage_noindex", "indexability_signal_conflict", "page_evidence_collection_failed",
  "missing_sitemap", "broken_internal_links", "orphan_candidate", "missing_h1",
  "missing_canonical", "duplicate_titles", "mobile_desktop_regression",
  "accessibility_audits_failed", "duplicate_descriptions", "generic_description",
  "keyword_topic_alignment_gap", "thin_content_heuristic", "missing_image_alt",
  "alice_ai_not_used", "crawl_truncated", "owner_access_gap",
];
const SOURCE_STATES: readonly WgdManagerSourceState[] = [
  "success", "partial", "unavailable", "not_applicable", "owner_access_required",
  "failed", "skipped", "connected", "not_collected", "measured", "not_measured",
  "no_keywords", "missing_credentials", "provider_error", "limit_exceeded",
  "partial_success", "checked", "not_configured", "permission_denied",
];
const SOURCE_IDS: readonly WgdKnownSourceId[] = [
  "crawl", "crawler", "lighthouse", "yandex_search", "alice_ai", "yandex_webmaster", "gsc", "dataforseo",
];
const LIMITATIONS: readonly WgdManagerLimitation[] = [
  "crawlTruncated", "pageCollectionErrors", "lighthouseIncomplete", "yandexIncomplete",
  "aliceIncomplete", "sourcePartial", "sourceUnavailable", "ownerAccess", "additional",
];
const LIGHTHOUSE_CATEGORIES: readonly WgdLighthouseCategory[] = [
  "performance", "accessibility", "best-practices", "seo",
];
const LIGHTHOUSE_FIELD_DATA_STATES: readonly LighthouseFieldDataEvidence["state"][] = [
  "not_collected", "unavailable",
];
const PAGE_STATES: readonly WgdPageIndexabilityState[] = ["indexable", "not_indexable", "unknown"];
const HEADINGS: readonly WgdManagerHeading[] = [
  "report", "overall", "components", "problems", "yandex", "alice", "speed",
  "priorities", "pages", "siteTechnical", "methodology", "specialist",
];
const EMPTY_STATES: readonly WgdManagerEmptyState[] = [
  "problems", "yandex", "alice", "lighthouse", "priorities", "pages", "accessGaps",
  "diagnostics", "specialistFiles",
];
const DIAGNOSTICS: readonly WgdLighthouseDiagnostic[] = [
  "cache-insight", "font-display-insight", "image-delivery-insight", "render-blocking-insight",
  "uses-long-cache-ttl", "font-display", "render-blocking-resources", "uses-optimized-images",
  "uses-responsive-images", "modern-image-formats", "efficient-animated-content",
];
const MANAGER_LABELS: readonly WgdManagerLabel[] = [
  "noData", "notScored", "searchEngine", "completeness", "siteLevelProblem", "siteFound",
  "notFoundFirst20", "incompleteFirst20", "depthUnavailable", "invalidYandexObservation", "checkFailed",
  "pageNotProvided", "aliceUsed", "aliceNotUsed", "aliceNote", "lighthouseNote", "lighthouseRoundingNote",
  "methodologyData", "methodologyScoring",
  "ownerAccessNote", "specialistNote", "noMainProblem", "query", "position", "page", "result",
  "priority", "affected", "impact", "action", "componentScore", "collection", "coverage",
  "mobileAverage", "desktopAverage", "worstMobilePage", "scoreInputs", "supplementaryResults",
  "weight", "pageScore", "indexability", "mainProblem", "httpStatus", "mobilePerformance",
  "desktopPerformance", "source", "state", "diagnostics", "requestedQueries", "checkedQueries",
  "foundQueries", "top10Queries", "usedAnswers",
  "cruxFieldData", "confirmedProblems",
  "excludedFromSpeedScore",
];

function expectRussian(value: string): void {
  expect(value).toMatch(/[А-Яа-яЁё]/);
  expect(value).not.toMatch(/[—–]/);
}

function stringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringValues);
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(stringValues);
}

describe("report localization", () => {
  test.each(["ru", "RU", "ru-RU", "ru-cyrl", " ru-AT "])("selects Russian for %s", (language) => {
    expect(resolveReportLocale(language)).toBe("ru");
    expect(getReportLocalization(language)).toBe(getReportLocalization("ru"));
  });

  test.each(["en", "de", "fr-AT", "", "unknown"])("uses one explicit English fallback for %s", (language) => {
    expect(resolveReportLocale(language)).toBe("en");
    expect(getReportLocalization(language)).toBe(getReportLocalization("en"));
  });

  test("covers every assessment state, score status, severity, and delivery stage in Russian", () => {
    const ru = getReportLocalization("ru");
    ASSESSMENT_STATES.forEach((state) => expectRussian(ru.assessmentStates[state]));
    SCORE_STATUSES.forEach((status) => expectRussian(ru.scoreStatuses[status]));
    SEVERITIES.forEach((severity) => expectRussian(ru.severities[severity]));
    DELIVERY_STAGES.forEach((stage) => {
      expectRussian(ru.deliveryStages[stage].title);
      expectRussian(ru.deliveryStages[stage].result);
    });
  });

  test("covers every known finding with manager-ready title, impact, and action", () => {
    const findings = getReportLocalization("ru").findings;
    const bannedManagerJargon = /\b(?:title|descriptions?|canonical|hreflang|noindex|alt)\b/i;
    FINDING_CODES.forEach((code) => {
      expectRussian(findings[code].title);
      expectRussian(findings[code].impact);
      expectRussian(findings[code].action);
      expect(findings[code].title).not.toContain(code);
      expect(findings[code].title).not.toMatch(bannedManagerJargon);
      expect(findings[code].impact).not.toMatch(bannedManagerJargon);
      expect(findings[code].action).not.toMatch(bannedManagerJargon);
    });
    expect(findings.missing_canonical.action).toContain("канонический адрес");
  });

  test("covers source states, Lighthouse categories, page states, headings, empty states, and diagnostics", () => {
    const ru = getReportLocalization("ru");
    SOURCE_STATES.forEach((state) => expectRussian(ru.sourceStates[state]));
    SOURCE_IDS.forEach((source) => {
      expect(ru.sourceNames[source]).not.toBe("");
      expect(ru.sourceNames[source]).not.toMatch(/[—–]/);
    });
    LIMITATIONS.forEach((limitation) => expectRussian(ru.limitations[limitation]));
    LIGHTHOUSE_CATEGORIES.forEach((category) => expectRussian(ru.lighthouseCategories[category]));
    LIGHTHOUSE_FIELD_DATA_STATES.forEach((state) => expectRussian(ru.lighthouseFieldDataStates[state]));
    PAGE_STATES.forEach((state) => expectRussian(ru.pageIndexability[state]));
    HEADINGS.forEach((heading) => expectRussian(ru.headings[heading]));
    EMPTY_STATES.forEach((state) => expectRussian(ru.emptyStates[state]));
    DIAGNOSTICS.forEach((diagnostic) => expectRussian(ru.lighthouseDiagnostics[diagnostic]));
    MANAGER_LABELS.forEach((label) => expectRussian(ru.labels[label]));
  });

  test("formats dates and numbers for the selected locale", () => {
    const ru = getReportLocalization("ru");
    const en = getReportLocalization("de");

    expect(ru.formatDate("2026-09-01T10:00:00.000Z")).toBe("1 сентября 2026 г.");
    expect(ru.formatNumber(1234.5, { maximumFractionDigits: 1 })).toMatch(/^1[\s\u00a0]234,5$/);
    expect(en.formatDate("2026-09-01T10:00:00.000Z")).toBe("September 1, 2026");
    expect(en.formatNumber(1234.5, { maximumFractionDigits: 1 })).toBe("1,234.5");
  });

  test("keeps all authored copy free of dash punctuation and formulaic filler", () => {
    const text = JSON.stringify([getReportLocalization("ru"), getReportLocalization("en")]);
    const russianCopy = stringValues(getReportLocalization("ru")).join("\n");
    expect(text).not.toMatch(/[—–]/);
    expect(text).not.toMatch(/(?:stands as|serves as|vibrant|pivotal|crucial|let's dive|here's what you need to know)/i);
    expect(russianCopy).not.toMatch(/\b(?:title|descriptions?|canonical|hreflang|noindex|alt)\b/i);
  });
});
