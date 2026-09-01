import type { YandexEvidence } from "./yandexEvidence";
import type {
  CrawlEvidence,
  LighthouseEvidence,
  PageEvidence,
  SourceCoverage,
  WgdAtomicRuleAssessment,
  WgdComponentAssessment,
  WgdFinding,
  WgdLighthouseComponentAssessment,
  WgdPageAssessment,
  WgdPageGroupAssessment,
  WgdReportAssessment,
  WgdReportOptions,
  WgdScoreStatus,
  WgdTechnicalComponentAssessment,
  WgdTechnicalRuleId,
} from "./types";

export type WgdReportScoringInput = {
  options: Pick<WgdReportOptions, "url" | "keywords" | "aiQueries">;
  crawl?: CrawlEvidence;
  pages?: PageEvidence[];
  lighthouse?: LighthouseEvidence[];
  yandex?: YandexEvidence;
  sources?: SourceCoverage[];
  findings?: WgdFinding[];
};

type TechnicalRuleDefinition = readonly [WgdTechnicalRuleId, number];

const TECHNICAL_RULES: readonly TechnicalRuleDefinition[] = [
  ["http_success", 20],
  ["indexability", 25],
  ["robots_access", 5],
  ["sitemap", 10],
  ["canonical", 12],
  ["signal_conflicts", 3],
  ["title_present", 3],
  ["title_unique", 2],
  ["description_present", 3],
  ["description_unique", 2],
  ["h1_present", 5],
  ["broken_internal_links", 5],
  ["redirect_chains", 3],
  ["orphan_pages", 2],
];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? clamp(numerator / denominator, 0, 1) : 0;
}

function finiteScore(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function mean(values: readonly number[]): number | null {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function normalizedUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function uniqueUrlIdentities(values: readonly string[]): Set<string> | null {
  const identities = values.map(normalizedUrl);
  const unique = new Set(identities);
  return unique.size === identities.length ? unique : null;
}

function uniquePageIdentities(pages: readonly PageEvidence[]): Set<string> | null {
  return uniqueUrlIdentities(pages.map((page) => page.requestedUrl));
}

/** Require one unique top-level row for every unique page row retained by the crawl. */
export function hasCoherentTechnicalPageEvidence(
  crawl: CrawlEvidence,
  pages: readonly PageEvidence[]
): boolean {
  const discovered = uniqueUrlIdentities(crawl.discoveredUrls);
  const crawlPages = uniquePageIdentities(crawl.pages);
  const topLevelPages = uniquePageIdentities(pages);
  if (!discovered || !crawlPages || !topLevelPages) return false;
  if ([...crawlPages].some((identity) => !discovered.has(identity))) return false;
  return crawlPages.size === topLevelPages.size
    && [...crawlPages].every((identity) => topLevelPages.has(identity));
}

function pageUrl(page: PageEvidence): string {
  return page.finalUrl || page.requestedUrl;
}

function isParsedHtml(page: PageEvidence): boolean {
  const htmlContent = !page.contentType
    || /(?:text\/html|application\/xhtml\+xml)/i.test(page.contentType);
  return !page.error && page.status > 0 && htmlContent;
}

function isSuccessfulHtml(page: PageEvidence): boolean {
  return isParsedHtml(page) && page.status >= 200 && page.status < 300;
}

function isHomepage(page: PageEvidence, requestedHomepage: string): boolean {
  const requested = normalizedUrl(requestedHomepage);
  if ([page.requestedUrl, page.finalUrl].map(normalizedUrl).includes(requested)) return true;
  try {
    const expected = new URL(requested);
    const actual = new URL(pageUrl(page));
    return actual.origin === expected.origin && (actual.pathname === "/" || actual.pathname === "");
  } catch {
    return false;
  }
}

function nonEmpty(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function duplicateUrls(groups: Record<string, string[]> | undefined): Set<string> {
  return new Set(Object.values(groups || {}).flat().map(normalizedUrl));
}

function unconfirmedResponseUrls(pages: PageEvidence[]): Set<string> {
  return new Set(
    pages
      .filter((item) => item.status === 0 || Boolean(item.error))
      .map((item) => normalizedUrl(item.requestedUrl))
  );
}

function confirmedAttemptedUrls(crawl: CrawlEvidence, pages: PageEvidence[]): Set<string> {
  const unconfirmed = unconfirmedResponseUrls(pages);
  return new Set(
    crawl.discoveredUrls
      .map(normalizedUrl)
      .filter((url) => !unconfirmed.has(url))
  );
}

function atomicRule(
  id: WgdTechnicalRuleId,
  weight: number,
  applicableCount: number,
  measuredCount: number,
  passedCount: number
): WgdAtomicRuleAssessment {
  const applicable = Math.max(0, applicableCount);
  const measured = clamp(measuredCount, 0, applicable);
  const passed = clamp(passedCount, 0, measured);
  return {
    id,
    weight,
    applicableCount: applicable,
    measuredCount: measured,
    passedCount: passed,
    ruleCoverage: applicable > 0 ? ratio(measured, applicable) : null,
    passRate: measured > 0 ? ratio(passed, measured) : null,
  };
}

function technicalScore(rules: readonly WgdAtomicRuleAssessment[]): number | null {
  const denominator = rules.reduce(
    (sum, rule) => sum + rule.weight * (rule.ruleCoverage ?? 0),
    0
  );
  if (denominator === 0) return null;
  const numerator = rules.reduce(
    (sum, rule) => sum
      + rule.weight * (rule.ruleCoverage ?? 0) * (rule.passRate ?? 0),
    0
  );
  return Math.round((numerator / denominator) * 100);
}

function sameOrigin(value: string, origin: string): boolean {
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}

function buildTechnicalRules(
  input: WgdReportScoringInput,
  pages: PageEvidence[]
): WgdAtomicRuleAssessment[] {
  const crawl = input.crawl;
  if (!crawl) {
    return TECHNICAL_RULES.map(([id, weight]) => atomicRule(id, weight, 0, 0, 0));
  }

  const parsedPages = pages.filter(isParsedHtml);
  const homepage = parsedPages.find((item) => isHomepage(item, input.options.url));
  const intendedPages = pages.filter((item) => isSuccessfulHtml(item) || item === homepage);
  const titleDuplicates = duplicateUrls(crawl.duplicateTitles);
  const descriptionDuplicates = duplicateUrls(crawl.duplicateDescriptions);
  const titles = intendedPages.filter((item) => nonEmpty(item.title));
  const descriptions = intendedPages.filter((item) => nonEmpty(item.description));
  const canonicalPages = intendedPages.filter((item) => item.indexable);
  const conflictMeasured = intendedPages.filter((item) => Array.isArray(item.signalConflicts));
  const h1Measured = intendedPages.filter((item) => Array.isArray(item.headings?.h1));
  const observedInternalTargets = new Set(
    parsedPages.flatMap((item) => item.internalLinks || []).map(normalizedUrl)
  );
  const confirmedTargets = confirmedAttemptedUrls(crawl, pages);
  const measuredInternalTargets = [...observedInternalTargets]
    .filter((target) => confirmedTargets.has(target));
  const brokenTargets = new Set(crawl.brokenUrls.map(normalizedUrl));
  const errorStubUrls = unconfirmedResponseUrls(pages);
  const redirectMeasured = Math.max(0, crawl.attemptedUrlCount - errorStubUrls.size);
  const failedRedirects = new Set(
    crawl.redirectChains
      .filter((item) => item.urls.length > 2 && !errorStubUrls.has(normalizedUrl(item.requestedUrl)))
      .map((item) => normalizedUrl(item.requestedUrl))
  );
  const orphanApplicable = intendedPages.filter((item) => !isHomepage(item, input.options.url));
  const orphanMeasured = orphanApplicable.filter((item) => Number.isFinite(item.inboundInternalLinks));
  let siteOrigin = "";
  try {
    siteOrigin = new URL(input.options.url).origin;
  } catch {
    // Invalid options cannot create positive sitemap evidence.
  }
  const nonIndexSitemaps = crawl.sitemapCandidates.filter((item) => item.isIndex !== true);
  const sitemapPassed = nonIndexSitemaps.some((item) =>
    typeof item.status === "number"
      && item.status >= 200
      && item.status < 300
      && item.urls.some((url) => siteOrigin && sameOrigin(url, siteOrigin))
  );
  const sitemapMeasured = sitemapPassed
    || (nonIndexSitemaps.length > 0
      && nonIndexSitemaps.every((item) => Number.isFinite(item.status)));

  const counts: Record<WgdTechnicalRuleId, readonly [number, number, number]> = {
    http_success: [
      pages.length,
      pages.filter((item) => !item.error && item.status > 0).length,
      pages.filter((item) => !item.error && item.status >= 200 && item.status < 300).length,
    ],
    indexability: [
      intendedPages.length,
      intendedPages.length,
      intendedPages.filter((item) => item.indexable).length,
    ],
    robots_access: [
      1,
      crawl.robots.access?.state === "measured" ? 1 : 0,
      crawl.robots.access?.state === "measured" && crawl.robots.access.blockedUrls.length === 0 ? 1 : 0,
    ],
    sitemap: [1, sitemapMeasured ? 1 : 0, sitemapPassed ? 1 : 0],
    canonical: [
      canonicalPages.length,
      canonicalPages.filter((item) => Array.isArray(item.signalConflicts)).length,
      canonicalPages.filter((item) =>
        Array.isArray(item.signalConflicts)
          && nonEmpty(item.canonical)
          && !item.signalConflicts.some((conflict) => conflict.category === "canonical")
      ).length,
    ],
    signal_conflicts: [
      intendedPages.length,
      conflictMeasured.length,
      conflictMeasured.filter((item) => item.signalConflicts.length === 0).length,
    ],
    title_present: [intendedPages.length, intendedPages.length, titles.length],
    title_unique: [
      titles.length,
      titles.length,
      titles.filter((item) => !titleDuplicates.has(normalizedUrl(pageUrl(item)))).length,
    ],
    description_present: [intendedPages.length, intendedPages.length, descriptions.length],
    description_unique: [
      descriptions.length,
      descriptions.length,
      descriptions.filter((item) => !descriptionDuplicates.has(normalizedUrl(pageUrl(item)))).length,
    ],
    h1_present: [
      intendedPages.length,
      h1Measured.length,
      h1Measured.filter((item) => item.headings!.h1.length > 0).length,
    ],
    broken_internal_links: [
      observedInternalTargets.size,
      measuredInternalTargets.length,
      measuredInternalTargets.filter((target) => !brokenTargets.has(target)).length,
    ],
    redirect_chains: [
      crawl.attemptedUrlCount,
      redirectMeasured,
      Math.max(0, redirectMeasured - failedRedirects.size),
    ],
    orphan_pages: [
      orphanApplicable.length,
      orphanMeasured.length,
      orphanMeasured.filter((item) => (item.inboundInternalLinks ?? 0) > 0).length,
    ],
  };

  return TECHNICAL_RULES.map(([id, weight]) => atomicRule(id, weight, ...counts[id]));
}

function technicalComponent(
  input: WgdReportScoringInput,
  pages: PageEvidence[]
): WgdTechnicalComponentAssessment {
  const rules = buildTechnicalRules(input, pages);
  const applicableWeight = rules.reduce(
    (sum, rule) => sum + (rule.applicableCount > 0 ? rule.weight : 0),
    0
  );
  const coveredWeight = rules.reduce(
    (sum, rule) => sum + rule.weight * (rule.ruleCoverage ?? 0),
    0
  );
  const atomicRuleCoverage = ratio(coveredWeight, applicableWeight);
  const crawlCompletion = input.crawl
    ? ratio(input.crawl.attemptedUrlCount, input.crawl.eligibleDiscoveredCount)
    : 0;
  const collectionCoverage = crawlCompletion * atomicRuleCoverage;
  const homepageParsed = pages.some((item) =>
    isHomepage(item, input.options.url) && isParsedHtml(item)
  );
  const scoringCoverage = homepageParsed ? collectionCoverage : 0;
  return {
    score: technicalScore(rules),
    nominalWeight: 40,
    effectiveWeight: 40 * scoringCoverage,
    collectionCoverage,
    scoringCoverage,
    collected: input.crawl?.attemptedUrlCount ?? 0,
    requested: input.crawl?.eligibleDiscoveredCount ?? 0,
    crawlCompletion,
    atomicRuleCoverage,
    rules,
  };
}

function yandexBand(check: YandexEvidence["serpChecks"][number]): number | null {
  if (!Number.isSafeInteger(check.checkedDepth) || check.checkedDepth! <= 0) return null;
  if (!check.found) {
    const contradictoryHitEvidence = [
      check.position,
      check.matchedUrl,
      check.title,
      check.snippet,
      check.competitorsAbove,
    ].some((item) => item !== undefined);
    if (contradictoryHitEvidence) return null;
    return check.checkedDepth! >= 20 ? 0 : null;
  }
  if (!Number.isSafeInteger(check.position)
    || check.position! <= 0
    || check.position! > 20
    || check.position! > check.checkedDepth!) {
    return null;
  }
  if (check.position! <= 3) return 100;
  if (check.position! <= 10) return 80;
  if (check.position! <= 20) return 60;
  return null;
}

function yandexComponent(input: WgdReportScoringInput): WgdReportAssessment["components"]["yandex"] {
  const requestedQueries = new Set(input.options.keywords.filter(
    (query): query is string => typeof query === "string" && query.trim().length > 0
  ));
  const scores: number[] = [];
  const observedQueries = new Set<string>();
  const checks: unknown[] = Array.isArray(input.yandex?.serpChecks)
    ? input.yandex.serpChecks
    : [];
  for (const candidate of checks) {
    if (!isObject(candidate)
      || typeof candidate.query !== "string"
      || typeof candidate.found !== "boolean"
      || !requestedQueries.has(candidate.query)
      || observedQueries.has(candidate.query)) continue;
    observedQueries.add(candidate.query);
    const score = yandexBand(candidate as YandexEvidence["serpChecks"][number]);
    if (score === null) continue;
    scores.push(score);
  }
  const requested = requestedQueries.size;
  const collected = scores.length;
  const collectionCoverage = ratio(collected, requested);
  const scoringCoverage = collected >= 3 && collectionCoverage >= 0.6
    ? collectionCoverage
    : 0;
  return {
    score: scores.length ? Math.round(mean(scores)!) : null,
    nominalWeight: 25,
    effectiveWeight: 25 * scoringCoverage,
    collectionCoverage,
    scoringCoverage,
    collected,
    requested,
  };
}

type CompleteLighthousePair = {
  url: string;
  mobilePerformance: number;
  desktopPerformance: number;
  accessibilityScores: [number, number];
  bestPracticesScores: [number, number];
};

function lighthouseIdentity(item: LighthouseEvidence): string {
  return item.requestedUrl || item.url;
}

function hasValidCategoryScoreRecord(item: LighthouseEvidence): boolean {
  return isObject(item.categoryScores)
    && Object.values(item.categoryScores).every((score) =>
      score === null || finiteScore(score) !== null
    );
}

function completeLighthousePairs(items: LighthouseEvidence[]): {
  requested: number;
  pairs: CompleteLighthousePair[];
} {
  const profiles = new Map<string, LighthouseEvidence[]>();
  for (const item of items) {
    const url = lighthouseIdentity(item);
    if (!url) continue;
    const rows = profiles.get(url) || [];
    rows.push(item);
    profiles.set(url, rows);
  }
  const pairs: CompleteLighthousePair[] = [];
  for (const [url, rows] of profiles) {
    const validProfile = (device: "mobile" | "desktop") => rows.find((item) =>
      item.device === device
        && item.status === "success"
        && hasValidCategoryScoreRecord(item)
        && finiteScore(item.categoryScores?.performance) !== null
        && finiteScore(item.categoryScores?.accessibility) !== null
        && finiteScore(item.categoryScores?.["best-practices"]) !== null
    );
    const mobile = validProfile("mobile");
    const desktop = validProfile("desktop");
    if (!mobile || !desktop) continue;
    pairs.push({
      url,
      mobilePerformance: finiteScore(mobile.categoryScores?.performance)!,
      desktopPerformance: finiteScore(desktop.categoryScores?.performance)!,
      accessibilityScores: [
        finiteScore(mobile.categoryScores?.accessibility)!,
        finiteScore(desktop.categoryScores?.accessibility)!,
      ],
      bestPracticesScores: [
        finiteScore(mobile.categoryScores?.["best-practices"])!,
        finiteScore(desktop.categoryScores?.["best-practices"])!,
      ],
    });
  }
  return { requested: profiles.size, pairs };
}

function lighthouseComponent(input: WgdReportScoringInput): WgdLighthouseComponentAssessment {
  const { requested, pairs } = completeLighthousePairs(input.lighthouse || []);
  const collected = pairs.length;
  const collectionCoverage = ratio(collected, requested);
  const mobilePerformance = mean(pairs.map((item) => item.mobilePerformance));
  const desktopPerformance = mean(pairs.map((item) => item.desktopPerformance));
  const accessibility = mean(pairs.flatMap((item) => item.accessibilityScores));
  const bestPractices = mean(pairs.flatMap((item) => item.bestPracticesScores));
  const score = mobilePerformance === null
    || desktopPerformance === null
    || accessibility === null
    || bestPractices === null
    ? null
    : Math.round(
      mobilePerformance * 0.5
        + desktopPerformance * 0.2
        + accessibility * 0.2
        + bestPractices * 0.1
    );
  const scoringCoverage = collected > 0 ? collectionCoverage : 0;
  const worst = [...pairs].sort((a, b) => {
    const performance = a.mobilePerformance - b.mobilePerformance;
    if (performance) return performance;
    return a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
  })[0];
  return {
    score,
    nominalWeight: 20,
    effectiveWeight: 20 * scoringCoverage,
    collectionCoverage,
    scoringCoverage,
    collected,
    requested,
    worstMobileUrl: worst?.url ?? null,
  };
}

function aliceComponent(input: WgdReportScoringInput): WgdReportAssessment["components"]["alice"] {
  const requestedQueries = new Set(input.options.aiQueries.filter(
    (query): query is string => typeof query === "string" && query.trim().length > 0
  ));
  const checked: YandexEvidence["aiProbes"] = [];
  const observedQueries = new Set<string>();
  const probes: unknown[] = Array.isArray(input.yandex?.aiProbes)
    ? input.yandex.aiProbes
    : [];
  for (const candidate of probes) {
    if (!isObject(candidate)
      || typeof candidate.query !== "string"
      || !["checked", "not_configured", "permission_denied", "failed"].includes(candidate.status as string)
      || (candidate.status === "checked" && typeof candidate.targetUsed !== "boolean")
      || !requestedQueries.has(candidate.query)
      || observedQueries.has(candidate.query)) continue;
    observedQueries.add(candidate.query);
    if (candidate.status !== "checked") continue;
    checked.push(candidate as YandexEvidence["aiProbes"][number]);
  }
  const requested = requestedQueries.size;
  const collected = checked.length;
  const collectionCoverage = ratio(collected, requested);
  const scoringCoverage = collected >= 3 && collectionCoverage >= 0.6
    ? collectionCoverage
    : 0;
  return {
    score: collected
      ? Math.round(ratio(checked.filter((item) => item.targetUsed).length, collected) * 100)
      : null,
    nominalWeight: 15,
    effectiveWeight: 15 * scoringCoverage,
    collectionCoverage,
    scoringCoverage,
    collected,
    requested,
  };
}

function pageLighthousePerformances(
  url: string,
  items: LighthouseEvidence[]
): { mobile: number; desktop: number } | null {
  const identities = new Set([url, normalizedUrl(url)]);
  const matching = items.filter((item) => identities.has(lighthouseIdentity(item))
    || identities.has(normalizedUrl(lighthouseIdentity(item))));
  const score = (device: "mobile" | "desktop") => {
    const item = matching.find((candidate) =>
      candidate.device === device
        && candidate.status === "success"
        && hasValidCategoryScoreRecord(candidate)
        && finiteScore(candidate.categoryScores?.performance) !== null
    );
    return item ? finiteScore(item.categoryScores?.performance) : null;
  };
  const mobile = score("mobile");
  const desktop = score("desktop");
  return mobile === null || desktop === null ? null : { mobile, desktop };
}

function pageGroup(
  nominalWeight: WgdPageGroupAssessment["nominalWeight"],
  measuredWeight: number,
  earnedPoints: number
): WgdPageGroupAssessment {
  return {
    nominalWeight,
    measuredWeight,
    earnedPoints,
    score: measuredWeight > 0 ? Math.round((earnedPoints / measuredWeight) * 100) : null,
  };
}

function hasNoindex(page: PageEvidence): boolean {
  return [page.metaRobots, page.xRobotsTag, page.robots].some((value) =>
    typeof value === "string" && /(?:^|[,;:\s])noindex(?:$|[,;\s])/i.test(value)
  );
}

function pageAssessment(
  page: PageEvidence,
  crawl: CrawlEvidence | undefined,
  lighthouseItems: LighthouseEvidence[]
): WgdPageAssessment {
  const url = pageUrl(page);
  const successfulHtml = isSuccessfulHtml(page);
  const titleDuplicates = duplicateUrls(crawl?.duplicateTitles);
  const descriptionDuplicates = duplicateUrls(crawl?.duplicateDescriptions);
  const pageIdentities = [page.requestedUrl, page.finalUrl].map(normalizedUrl);
  const duplicatedTitle = pageIdentities.some((identity) => titleDuplicates.has(identity));
  const duplicatedDescription = pageIdentities.some((identity) => descriptionDuplicates.has(identity));

  let indexabilityMeasured = 0;
  let indexabilityEarned = 0;
  if (!page.error && page.status > 0) {
    indexabilityMeasured += 20;
    if (page.status >= 200 && page.status < 300) indexabilityEarned += 20;
  }
  if (successfulHtml) {
    indexabilityMeasured += 25;
    if (page.indexable) indexabilityEarned += 25;
  }

  let contentMeasured = 0;
  let contentEarned = 0;
  if (successfulHtml) {
    contentMeasured += 4;
    if (nonEmpty(page.title)) {
      contentEarned += 4;
      if (crawl) {
        contentMeasured += 4;
        if (!duplicatedTitle) contentEarned += 4;
      }
    }
    contentMeasured += 3.5;
    if (nonEmpty(page.description)) {
      contentEarned += 3.5;
      if (crawl) {
        contentMeasured += 3.5;
        if (!duplicatedDescription) contentEarned += 3.5;
      }
    }
    if (Array.isArray(page.headings?.h1)) {
      contentMeasured += 7;
      if (page.headings.h1.length > 0) contentEarned += 7;
    }
    if (Array.isArray(page.signalConflicts)) {
      contentMeasured += 8;
      if (nonEmpty(page.canonical)
        && !page.signalConflicts.some((conflict) => conflict.category === "canonical")) {
        contentEarned += 8;
      }
    }
  }

  let structureMeasured = 0;
  let structureEarned = 0;
  if (successfulHtml && Number.isFinite(page.inboundInternalLinks)) {
    structureMeasured += 5;
    if ((page.inboundInternalLinks ?? 0) > 0) structureEarned += 5;
  }
  if (successfulHtml && Array.isArray(page.internalLinks) && page.linksTruncated !== true) {
    const outgoingTargets = new Set(page.internalLinks.map(normalizedUrl));
    const confirmedTargets = crawl
      ? confirmedAttemptedUrls(crawl, crawl.pages)
      : undefined;
    const fullyMeasured = outgoingTargets.size === 0
      || [...outgoingTargets].every((target) => confirmedTargets?.has(target));
    if (fullyMeasured) {
      structureMeasured += 5;
      const broken = new Set((crawl?.brokenUrls || []).map(normalizedUrl));
      if (![...outgoingTargets].some((target) => broken.has(target))) {
        structureEarned += 5;
      }
    }
  }

  let lighthouseMeasured = 0;
  let lighthouseEarned = 0;
  const performance = pageLighthousePerformances(url, lighthouseItems);
  if (performance) {
    lighthouseMeasured = 15;
    lighthouseEarned = 10 * performance.mobile / 100 + 5 * performance.desktop / 100;
  }

  const groups = {
    indexability: pageGroup(45, indexabilityMeasured, indexabilityEarned),
    content: pageGroup(30, contentMeasured, contentEarned),
    internal_structure: pageGroup(10, structureMeasured, structureEarned),
    lighthouse: pageGroup(15, lighthouseMeasured, lighthouseEarned),
  } as const;
  const measuredWeight = Object.values(groups).reduce((sum, group) => sum + group.measuredWeight, 0);
  const earnedPoints = Object.values(groups).reduce((sum, group) => sum + group.earnedPoints, 0);
  const uncappedScore = measuredWeight > 0
    ? Math.round((earnedPoints / measuredWeight) * 100)
    : null;
  const noindexCapApplied = uncappedScore !== null && uncappedScore > 39 && hasNoindex(page);
  return {
    url,
    score: uncappedScore === null ? null : noindexCapApplied ? 39 : uncappedScore,
    collectionCoverage: ratio(measuredWeight, 100),
    noindexCapApplied,
    groups,
  };
}

function scoreStatus(score: number): WgdScoreStatus {
  if (score <= 39) return "critical";
  if (score <= 59) return "high_risk";
  if (score <= 79) return "needs_improvement";
  return "good";
}

function siteIndexabilityCap(
  pages: PageEvidence[],
  requestedHomepage: string,
  score: number | null
): boolean {
  if (score === null || score <= 39) return false;
  const intended = pages.filter(isSuccessfulHtml);
  const homepage = intended.find((item) => isHomepage(item, requestedHomepage));
  if (homepage && !homepage.indexable) return true;
  const blocked = intended.filter((item) => !item.indexable).length;
  return intended.length > 0 && blocked / intended.length > 0.5;
}

/** Calculate deterministic site and page scores from normalized evidence only. */
export function calculateWgdReportAssessment(input: WgdReportScoringInput): WgdReportAssessment {
  const candidatePages = input.pages ?? input.crawl?.pages ?? [];
  const pageEvidenceCoherent = !input.crawl
    || hasCoherentTechnicalPageEvidence(input.crawl, candidatePages);
  const pages = pageEvidenceCoherent ? candidatePages : [];
  const technicalInput = pageEvidenceCoherent
    ? input
    : { ...input, crawl: undefined, pages: [] };
  const technical = technicalComponent(technicalInput, pages);
  const yandex = yandexComponent(input);
  const lighthouse = lighthouseComponent(input);
  const alice = aliceComponent(input);
  const components: WgdComponentAssessment[] = [technical, yandex, lighthouse, alice];
  const completeness = components.reduce((sum, component) => sum + component.effectiveWeight, 0);
  const weightedScore = completeness > 0
    ? Math.round(components.reduce(
      (sum, component) => sum + (component.score ?? 0) * component.effectiveWeight,
      0
    ) / completeness)
    : null;
  const indexabilityCapApplied = siteIndexabilityCap(pages, input.options.url, weightedScore);
  const calculatedScore = weightedScore === null
    ? null
    : indexabilityCapApplied ? 39 : weightedScore;
  const state = completeness >= 80
    ? "scored" as const
    : completeness >= 60
      ? "preliminary" as const
      : "insufficient_data" as const;
  const displayScore = state === "insufficient_data" ? null : calculatedScore;
  const status = state === "scored" && displayScore !== null
    ? scoreStatus(displayScore)
    : null;

  return {
    state,
    calculatedScore,
    displayScore,
    completeness,
    status,
    indexabilityCapApplied,
    components: { technical, yandex, lighthouse, alice },
    pages: pages.map((item) => pageAssessment(item, input.crawl, input.lighthouse || [])),
  };
}
