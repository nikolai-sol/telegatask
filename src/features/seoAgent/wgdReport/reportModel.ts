import { buildAllManagerFindingGroups } from "./findingGroups";
import {
  calculateWgdReportAssessment,
  hasCoherentTechnicalPageEvidence,
} from "./managerScoring";
import type { SeoSearchConsoleSnapshot } from "../types";
import type { YandexEvidence } from "./yandexEvidence";
import type {
  CrawlEvidence,
  LighthouseEvidence,
  PageEvidence,
  SourceCoverage,
  WgdFinding,
  WgdPublishedReport,
  WgdReportPayload,
} from "./types";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringArrayRecord(value: unknown): value is Record<string, string[]> {
  return isObject(value) && Object.values(value).every(isStringArray);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isObject(value) && Object.values(value).every((item) => typeof item === "string");
}

function isScalarRecord(
  value: unknown
): value is Record<string, string | number | boolean | null> {
  return isObject(value) && Object.values(value).every((item) =>
    item === null
      || typeof item === "string"
      || typeof item === "boolean"
      || (typeof item === "number" && Number.isFinite(item))
  );
}

function safeInteger(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function httpStatus(value: unknown): value is number {
  return safeInteger(value, 100, 599);
}

function pageStatus(value: unknown): value is number {
  return value === 0 || httpStatus(value);
}

function optionalHttpStatus(value: unknown): boolean {
  return value === undefined || httpStatus(value);
}

function optionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || safeInteger(value);
}

function nullableBoundedNumber(value: unknown, minimum: number, maximum: number): boolean {
  return value === null
    || (typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum);
}

function boundedScoreRecord(value: unknown): boolean {
  return isObject(value) && Object.values(value).every((item) => nullableBoundedNumber(item, 0, 100));
}

function nonNegativeMetricRecord(value: unknown): boolean {
  return isObject(value) && Object.values(value).every((item) =>
    item === null || (typeof item === "number" && Number.isFinite(item) && item >= 0)
  );
}

function queryIdentity(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

function canonicalizeQueries(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const query = item.trim();
    if (!query) continue;
    const key = queryIdentity(query);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(query);
  }
  return output;
}

function dedupeQueryObservations<T extends { query: string }>(
  observations: T[],
  requestedQueries: string[]
): T[] {
  const requestedDisplay = new Map(requestedQueries.map((query) => [queryIdentity(query), query]));
  const seen = new Set<string>();
  const output: T[] = [];
  for (const observation of observations) {
    const key = queryIdentity(observation.query);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push({
      ...observation,
      query: requestedDisplay.get(key) ?? observation.query.trim(),
    });
  }
  return output;
}

function normalizeCompetitors(value: unknown): NonNullable<
  YandexEvidence["serpChecks"][number]["competitorsAbove"]
> | undefined {
  if (!Array.isArray(value)) return undefined;
  const competitors = value.flatMap((item) => isObject(item)
      && typeof item.position === "number"
      && safeInteger(item.position, 1)
      && typeof item.domain === "string"
      && typeof item.url === "string"
      && (item.title === undefined || typeof item.title === "string")
    ? [{
        position: item.position,
        domain: item.domain,
        url: item.url,
        ...(typeof item.title === "string" ? { title: item.title } : {}),
      }]
    : []);
  return competitors;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function optionalStringArray(value: unknown): boolean {
  return value === undefined || isStringArray(value);
}

function validHeadings(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isObject(value) || !isStringArray(value.h1) || !isStringArray(value.h2)) return false;
  return [value.h3, value.h4, value.h5, value.h6].every(optionalStringArray);
}

function validImages(value: unknown): boolean {
  return value === undefined
    || (isObject(value)
      && safeInteger(value.total)
      && safeInteger(value.missingAlt)
      && (value.missingAlt as number) <= (value.total as number));
}

function isPageEvidence(value: unknown): value is PageEvidence {
  return isObject(value)
    && typeof value.requestedUrl === "string"
    && typeof value.finalUrl === "string"
    && pageStatus(value.status)
    && typeof value.indexable === "boolean"
    && Array.isArray(value.signalConflicts)
    && value.signalConflicts.every((item) => isObject(item)
      && typeof item.code === "string"
      && ["robots", "canonical", "hreflang"].includes(item.category as string))
    && [
      value.contentType, value.title, value.description, value.metaRobots, value.xRobotsTag,
      value.robots, value.canonical, value.error,
    ].every(optionalString)
    && [value.titleLength, value.descriptionLength, value.wordCount, value.depth,
      value.discoveryOrder, value.inboundInternalLinks, value.omittedLinkCount]
      .every(optionalNonNegativeInteger)
    && [value.linksTruncated, value.orphanCandidate].every(optionalBoolean)
    && [
      value.links, value.internalLinks, value.externalLinks, value.schemaTypes,
      value.schemaErrors, value.indexabilityConflicts,
    ].every(optionalStringArray)
    && validHeadings(value.headings)
    && validImages(value.images)
    && (value.openGraph === undefined || isStringRecord(value.openGraph))
    && (value.twitterCards === undefined || isStringRecord(value.twitterCards))
    && (value.discoverySources === undefined || (Array.isArray(value.discoverySources)
      && value.discoverySources.every((source) => ["start", "priority", "sitemap", "internal_link"].includes(source as string))));
}

export type WgdWritableLighthouseEvidence = Pick<LighthouseEvidence, "url" | "device">
  & Partial<Omit<LighthouseEvidence, "url" | "device">>;

export function isWritableLighthouseEvidence(value: unknown): value is WgdWritableLighthouseEvidence {
  return isObject(value)
    && typeof value.url === "string"
    && (value.device === "mobile" || value.device === "desktop")
    && (value.categoryScores === undefined || boundedScoreRecord(value.categoryScores))
    && (value.metrics === undefined || nonNegativeMetricRecord(value.metrics))
    && [value.transferSizeBytes, value.unusedJavaScriptBytes, value.unusedCssBytes]
      .every((item) => item === undefined || nullableBoundedNumber(item, 0, Number.MAX_VALUE))
    && (value.rawPayload === undefined || isObject(value.rawPayload))
    && (value.status === undefined || value.status === "success" || value.status === "failed")
    && optionalString(value.requestedUrl)
    && optionalString(value.finalUrl)
    && optionalString(value.error)
    && optionalString(value.rawPath)
    && optionalStringArray(value.insights);
}

export function isNormalizedLighthouseEvidence(value: unknown): value is LighthouseEvidence {
  return isWritableLighthouseEvidence(value)
    && value.measurementType === "lab"
    && isObject(value.fieldData)
    && value.fieldData.source === "CrUX"
    && (value.fieldData.state === "not_collected" || value.fieldData.state === "unavailable");
}

function isSourceCoverage(value: unknown): value is SourceCoverage {
  return isObject(value)
    && typeof value.id === "string"
    && ["success", "partial", "unavailable", "not_applicable", "owner_access_required"]
      .includes(value.state as string)
    && optionalString(value.label)
    && optionalString(value.message)
    && optionalString(value.checkedAt)
    && (value.details === undefined || isScalarRecord(value.details));
}

function normalizeRankCheck(value: unknown): YandexEvidence["serpChecks"][number] | undefined {
  if (!isObject(value)
    || typeof value.query !== "string"
    || value.searchEngine !== "yandex"
    || value.provider !== "yandex_search_api"
    || typeof value.targetDomain !== "string"
    || typeof value.found !== "boolean"
    || (value.device !== "mobile" && value.device !== "desktop")
    || typeof value.checkedAt !== "string") return undefined;
  if (value.found === false && [
    value.position,
    value.matchedUrl,
    value.title,
    value.snippet,
    value.competitorsAbove,
  ].some((item) => item !== undefined)) return undefined;
  const competitorsAbove = normalizeCompetitors(value.competitorsAbove);
  return {
    query: value.query,
    searchEngine: "yandex",
    provider: "yandex_search_api",
    targetDomain: value.targetDomain,
    found: value.found,
    ...(safeInteger(value.position, 1) ? { position: value.position } : {}),
    ...(typeof value.matchedUrl === "string" ? { matchedUrl: value.matchedUrl } : {}),
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.snippet === "string" ? { snippet: value.snippet } : {}),
    ...(competitorsAbove ? { competitorsAbove } : {}),
    ...(isStringArray(value.serpFeatures) ? { serpFeatures: value.serpFeatures } : {}),
    ...(isStringArray(value.topResultDomains) ? { topResultDomains: value.topResultDomains } : {}),
    ...(typeof value.location === "string" ? { location: value.location } : {}),
    ...(typeof value.region === "string" ? { region: value.region } : {}),
    ...(typeof value.language === "string" ? { language: value.language } : {}),
    device: value.device,
    checkedAt: value.checkedAt,
    ...(safeInteger(value.checkedDepth, 1)
      ? { checkedDepth: value.checkedDepth }
      : {}),
  };
}

function normalizeAiProbe(value: unknown): YandexEvidence["aiProbes"][number] | undefined {
  if (!isObject(value)
    || typeof value.query !== "string"
    || !["checked", "not_configured", "permission_denied", "failed"].includes(value.status as string)
    || (value.status === "checked" && typeof value.targetUsed !== "boolean")) return undefined;
  const targetUsed = typeof value.targetUsed === "boolean" ? value.targetUsed : false;
  return {
    channel: typeof value.channel === "string" ? value.channel : "Yandex Search API generative response",
    status: value.status as YandexEvidence["aiProbes"][number]["status"],
    query: value.query,
    result: typeof value.result === "string" ? value.result : "No reportable evidence.",
    sources: isStringArray(value.sources) ? value.sources : [],
    sourceDetails: Array.isArray(value.sourceDetails)
      ? value.sourceDetails.flatMap((source) => isObject(source)
          && typeof source.url === "string"
          && typeof source.title === "string"
          && typeof source.used === "boolean"
        ? [{ url: source.url, title: source.title, used: source.used }]
        : [])
      : [],
    usedSources: isStringArray(value.usedSources) ? value.usedSources : [],
    targetFound: typeof value.targetFound === "boolean" ? value.targetFound : targetUsed,
    targetUsed,
    sourcePosition: safeInteger(value.sourcePosition, 1)
      ? value.sourcePosition
      : null,
    usedSourcePosition: safeInteger(value.usedSourcePosition, 1)
      ? value.usedSourcePosition
      : null,
  };
}

function normalizeManualQuery(value: unknown): YandexEvidence["manualQueries"][number] | undefined {
  if (!isObject(value)
    || (value.source !== "yandex_search" && value.source !== "alice_ai")
    || typeof value.query !== "string"
    || typeof value.reason !== "string") return undefined;
  return { source: value.source, query: value.query, reason: value.reason };
}

function nullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function normalizeOwnerSnapshot(value: unknown): SeoSearchConsoleSnapshot | undefined {
  if (!isObject(value)
    || !nullableString(value.property)
    || !nullableString(value.siteUrl)
    || !isObject(value.dateRange)
    || !nullableString(value.dateRange.startDate)
    || !nullableString(value.dateRange.endDate)
    || !nullableNumber(value.dateRange.days)
    || !nullableNumber(value.clicks)
    || !nullableNumber(value.impressions)
    || !nullableNumber(value.ctr)
    || !nullableNumber(value.averagePosition)
    || !isStringArray(value.topQueries)
    || !isStringArray(value.topPages)
    || !isStringArray(value.countries)
    || !isStringArray(value.devices)) return undefined;
  return {
    property: value.property,
    siteUrl: value.siteUrl,
    dateRange: {
      startDate: value.dateRange.startDate,
      endDate: value.dateRange.endDate,
      days: value.dateRange.days,
    },
    clicks: value.clicks,
    impressions: value.impressions,
    ctr: value.ctr,
    averagePosition: value.averagePosition,
    topQueries: value.topQueries,
    topPages: value.topPages,
    countries: value.countries,
    devices: value.devices,
  };
}

function normalizeYandex(
  value: unknown,
  generatedAt: string,
  keywords: string[],
  aiQueries: string[]
): YandexEvidence | undefined {
  if (!isObject(value)) return undefined;
  const normalizedSerpChecks = Array.isArray(value.serpChecks)
    ? value.serpChecks.flatMap((check) => normalizeRankCheck(check) || [])
    : [];
  const normalizedAiProbes = Array.isArray(value.aiProbes)
    ? value.aiProbes.flatMap((probe) => normalizeAiProbe(probe) || [])
    : [];
  const serpChecks = dedupeQueryObservations(normalizedSerpChecks, keywords);
  const aiProbes = dedupeQueryObservations(normalizedAiProbes, aiQueries);
  const checkedProbes = aiProbes.filter((probe) => probe.status === "checked");
  const usedProbes = checkedProbes.filter((probe) => probe.targetUsed).length;
  const status: YandexEvidence["serpStatus"] = isObject(value.serpStatus)
    && ["connected", "missing_credentials", "no_keywords", "provider_error", "limit_exceeded", "partial_success"]
      .includes(value.serpStatus.state as string)
    && typeof value.serpStatus.message === "string"
    ? {
        state: value.serpStatus.state as YandexEvidence["serpStatus"]["state"],
        message: value.serpStatus.message,
        checkedAt: typeof value.serpStatus.checkedAt === "string"
          ? value.serpStatus.checkedAt
          : generatedAt,
        ...(typeof value.serpStatus.errorCode === "string" ? { errorCode: value.serpStatus.errorCode } : {}),
        ...(isScalarRecord(value.serpStatus.metricsSummary)
          ? { metricsSummary: value.serpStatus.metricsSummary }
          : {}),
      }
    : { state: "provider_error" as const, message: "Yandex evidence was unavailable.", checkedAt: generatedAt };
  const sample: YandexEvidence["aiSampleVisibility"] = {
    used: usedProbes,
    checked: checkedProbes.length,
    rate: checkedProbes.length ? usedProbes / checkedProbes.length : null,
  };
  const yandexWebmasterSnapshot = normalizeOwnerSnapshot(value.yandexWebmasterSnapshot);
  const gscSnapshot = normalizeOwnerSnapshot(value.gscSnapshot);
  return {
    serpChecks,
    serpStatus: status,
    aiProbes,
    aiSampleVisibility: sample,
    manualQueries: Array.isArray(value.manualQueries)
      ? value.manualQueries.flatMap((row) => normalizeManualQuery(row) || [])
      : [],
    ...(yandexWebmasterSnapshot ? { yandexWebmasterSnapshot } : {}),
    ...(gscSnapshot ? { gscSnapshot } : {}),
    limitations: isStringArray(value.limitations) ? value.limitations : [],
  };
}

function isFinding(value: unknown): value is WgdFinding {
  return isObject(value)
    && typeof value.code === "string"
    && ["critical", "high", "medium", "low"].includes(value.severity as string)
    && typeof value.evidence === "string"
    && typeof value.source === "string"
    && ["high", "medium", "low"].includes(value.confidence as string)
    && typeof value.action === "string"
    && typeof value.expectedEffect === "string"
    && typeof value.acceptanceCriterion === "string"
    && typeof value.verification === "string"
    && (value.affectedUrl === undefined || typeof value.affectedUrl === "string")
    && (value.scope === undefined || typeof value.scope === "string");
}

function groupingCrawlEvidence(value: unknown): Pick<
  CrawlEvidence,
  "brokenUrls" | "duplicateTitles" | "duplicateDescriptions"
> | undefined {
  if (!isObject(value)
    || !isStringArray(value.brokenUrls)
    || !isStringArrayRecord(value.duplicateTitles)
    || !isStringArrayRecord(value.duplicateDescriptions)) return undefined;
  return {
    brokenUrls: value.brokenUrls,
    duplicateTitles: value.duplicateTitles,
    duplicateDescriptions: value.duplicateDescriptions,
  };
}

function validRobots(value: unknown): boolean {
  if (!isObject(value)
    || typeof value.url !== "string"
    || !isStringArray(value.sitemapUrls)
    || !optionalHttpStatus(value.status)
    || !optionalString(value.error)) return false;
  const access = value.access;
  return isObject(access)
    && (access.state === "measured" || access.state === "unavailable")
    && (access.userAgent === "YandexBot" || access.userAgent === "Googlebot")
    && safeInteger(access.checkedUrlCount)
    && isStringArray(access.blockedUrls);
}

function robotsCoverageMatches(value: unknown, attempted: number): boolean {
  if (!isObject(value) || !isObject(value.access)) return false;
  return value.access.state === "measured"
    ? value.access.checkedUrlCount === attempted
    : value.access.checkedUrlCount === 0;
}

function validSitemapCandidate(value: unknown): boolean {
  return isObject(value)
    && typeof value.url === "string"
    && ["common", "robots", "sitemap"].includes(value.source as string)
    && isStringArray(value.urls)
    && optionalHttpStatus(value.status)
    && (value.isIndex === undefined || typeof value.isIndex === "boolean")
    && optionalString(value.error);
}

function validRedirectChain(value: unknown): boolean {
  return isObject(value)
    && typeof value.requestedUrl === "string"
    && typeof value.finalUrl === "string"
    && isStringArray(value.urls);
}

/** Return a crawl only when its provenance and every scoring dependency are coherent. */
export function isScorableCrawlEvidence(value: unknown): value is CrawlEvidence {
  if (!isObject(value)) return false;
  const attempted = value.attemptedUrlCount;
  const eligible = value.eligibleDiscoveredCount;
  const dropped = value.droppedEligibleCount;
  const truncated = value.truncated;
  if (![attempted, eligible, dropped].every((item) => safeInteger(item))
    || typeof truncated !== "boolean"
    || (attempted as number) > (eligible as number)
    || (attempted as number) + (dropped as number) !== eligible
    || truncated !== ((dropped as number) > 0)) return false;
  return Array.isArray(value.pages)
    && value.pages.every(isPageEvidence)
    && value.pages.length <= (attempted as number)
    && validRobots(value.robots)
    && robotsCoverageMatches(value.robots, attempted as number)
    && Array.isArray(value.sitemapCandidates)
    && value.sitemapCandidates.every(validSitemapCandidate)
    && isStringArray(value.discoveredUrls)
    && value.discoveredUrls.length === attempted
    && isStringArray(value.excludedUrls)
    && isStringArray(value.brokenUrls)
    && Array.isArray(value.redirectChains)
    && value.redirectChains.every(validRedirectChain)
    && isStringArrayRecord(value.duplicateTitles)
    && isStringArrayRecord(value.duplicateDescriptions)
    && isStringArray(value.limitations)
    && hasCoherentTechnicalPageEvidence(value as CrawlEvidence, value.pages as PageEvidence[]);
}

/** Build the sole schema-2 object published to both JSON and HTML. */
export function buildPublishedWgdReport(payload: WgdReportPayload): WgdPublishedReport {
  const evidenceCrawl = payload.crawl;
  const crawlPages = isObject(evidenceCrawl) && Array.isArray(evidenceCrawl.pages)
    ? evidenceCrawl.pages.filter(isPageEvidence)
    : [];
  const pages: PageEvidence[] = Array.isArray(payload.pages)
    ? payload.pages.filter(isPageEvidence)
    : crawlPages;
  const lighthouse: LighthouseEvidence[] = Array.isArray(payload.lighthouse)
    ? payload.lighthouse.filter(isNormalizedLighthouseEvidence)
    : [];
  const options = {
    ...payload.options,
    keywords: canonicalizeQueries(payload.options.keywords),
    aiQueries: canonicalizeQueries(payload.options.aiQueries),
    priorityUrls: Array.isArray(payload.options.priorityUrls)
      ? payload.options.priorityUrls.filter((item): item is string => typeof item === "string")
      : [],
  };
  const yandex = normalizeYandex(
    payload.yandex,
    payload.generatedAt,
    options.keywords,
    options.aiQueries
  );
  const sources: SourceCoverage[] = Array.isArray(payload.sources)
    ? payload.sources.filter(isSourceCoverage)
    : [];
  const findings: WgdFinding[] = Array.isArray(payload.findings)
    ? payload.findings.filter(isFinding)
    : [];
  const comparableCrawlPages = isObject(evidenceCrawl)
    && Array.isArray(evidenceCrawl.pages)
    && evidenceCrawl.pages.every(isPageEvidence)
    && isStringArray(evidenceCrawl.discoveredUrls)
    ? evidenceCrawl as unknown as CrawlEvidence
    : undefined;
  const pageEvidenceCoherent = !comparableCrawlPages
    || hasCoherentTechnicalPageEvidence(comparableCrawlPages, pages);
  const assessmentPages = pageEvidenceCoherent ? pages : [];
  const scoringCrawl = pageEvidenceCoherent && isScorableCrawlEvidence(evidenceCrawl)
    ? evidenceCrawl
    : undefined;
  const assessment = calculateWgdReportAssessment({
    options,
    crawl: scoringCrawl,
    pages: assessmentPages,
    lighthouse,
    yandex,
    sources,
    findings,
  });
  const groupedFindings = buildAllManagerFindingGroups({
    findings,
    crawl: groupingCrawlEvidence(evidenceCrawl),
  });
  const {
    schemaVersion: _incomingSchema,
    assessment: _incomingAssessment,
    groupedFindings: _incomingGroups,
    ...normalizedEvidence
  } = payload;

  return {
    ...normalizedEvidence,
    schemaVersion: "2.0",
    options,
    pages,
    lighthouse,
    sources,
    findings,
    ...(yandex ? { yandex } : {}),
    assessment,
    groupedFindings,
  };
}
