import type { YandexEvidence } from "./yandexEvidence";
import type {
  CrawlEvidence,
  LighthouseEvidence,
  PageEvidence,
  SourceCoverage,
  WgdComponentId,
  WgdFinding,
  WgdFindingDeliveryStage,
  WgdFindingSeverity,
  WgdKnownFindingCode,
  WgdManagerFindingGroup,
  WgdManagerFindingScope,
  WgdManagerPresentation,
  WgdReportAssessment,
  WgdReportOptions,
} from "./types";
import {
  getReportLocalization,
  type WgdKnownSourceId,
  type WgdLighthouseCategory,
  type WgdLighthouseDiagnostic,
  type WgdManagerSourceState,
  type WgdPageIndexabilityState,
  type WgdReportLocalization,
} from "./reportLocalization";
import { safeDisplayUrl } from "./reportHtml";
import { findingCatalogEntry } from "./findingCatalog";

export type WgdManagerNormalizedPayload = {
  generatedAt: string;
  options: WgdReportOptions;
  sources?: SourceCoverage[];
  crawl?: CrawlEvidence;
  pages?: PageEvidence[];
  lighthouse?: LighthouseEvidence[];
  yandex?: YandexEvidence;
  findings: WgdFinding[];
  limitations?: readonly unknown[];
  evidenceFiles?: string[];
  manualQueryPackPath?: string;
};

export type WgdManagerPresentationInput = {
  normalized: WgdManagerNormalizedPayload;
  assessment: WgdReportAssessment;
  findingGroups: WgdManagerFindingGroup[];
};

const COMPONENT_ORDER: readonly WgdComponentId[] = ["technical", "yandex", "lighthouse", "alice"];
const STAGE_ORDER: readonly WgdFindingDeliveryStage[] = ["blocking", "visibility", "improvement"];
const DIAGNOSTIC_PRESENTATION = {
  "cache-insight": true,
  "font-display-insight": true,
  "image-delivery-insight": true,
  "render-blocking-insight": true,
  "uses-long-cache-ttl": true,
  "font-display": true,
  "render-blocking-resources": true,
  "uses-optimized-images": true,
  "uses-responsive-images": true,
  "modern-image-formats": true,
  "efficient-animated-content": true,
} satisfies Record<WgdLighthouseDiagnostic, true>;
export const DIAGNOSTIC_PRESENTATION_ORDER: readonly WgdLighthouseDiagnostic[] =
  Object.keys(DIAGNOSTIC_PRESENTATION) as WgdLighthouseDiagnostic[];
const DIAGNOSTICS = new Set<string>(DIAGNOSTIC_PRESENTATION_ORDER);
const SOURCE_PRESENTATION = {
  crawl: true,
  crawler: true,
  lighthouse: true,
  yandex_search: true,
  alice_ai: true,
  yandex_webmaster: true,
  gsc: true,
  dataforseo: true,
} satisfies Record<WgdKnownSourceId, true>;
export const SOURCE_PRESENTATION_ORDER: readonly WgdKnownSourceId[] =
  Object.keys(SOURCE_PRESENTATION) as WgdKnownSourceId[];
const SITE_TECHNICAL_ANCHORS = new Set([
  "#site-technical", "#methodology", "#speed-ux", "#alice-visibility", "#page-details",
]);
const DEFAULT_EVIDENCE_FILES = [
  "evidence/crawl.json",
  "evidence/provider-preflight.json",
  "evidence/yandex-serp.json",
  "evidence/yandex-ai-probes.json",
] as const;
const SEVERITY_ORDER: Record<WgdFindingSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function arithmeticMean(values: readonly number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function safeHttpUrl(value: unknown): string | null {
  return safeDisplayUrl(value);
}

function safeDomain(options: WgdReportOptions): string {
  try {
    return new URL(options.url).hostname;
  } catch {
    const domain = options.domain.trim().toLowerCase();
    return /^[a-z\d.-]+$/i.test(domain) ? domain : "";
  }
}

function sameUrl(left: string, right: string): boolean {
  return safeHttpUrl(left) === safeHttpUrl(right);
}

function pageName(value: string): string {
  try {
    const pathname = new URL(value).pathname || "/";
    try {
      return decodeURIComponent(pathname);
    } catch {
      return pathname;
    }
  } catch {
    return "/";
  }
}

function urlHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function pageDetailBaseId(url: string): string {
  const parsed = new URL(url);
  const slug = `${parsed.hostname}${parsed.pathname}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "page";
  return `page-detail-${slug}-${urlHash(url)}`;
}

function safeEvidencePath(value: unknown): string | null {
  if (typeof value !== "string"
    || !/^evidence\/[a-z0-9][a-z0-9._/-]*$/i.test(value)
    || value.includes("..")) return null;
  return value;
}

function sourceState(value: SourceCoverage["state"]): WgdManagerSourceState {
  return value;
}

function pageIndexability(page: PageEvidence): WgdPageIndexabilityState {
  if (page.error || !finite(page.status) || page.status <= 0) return "unknown";
  return page.indexable ? "indexable" : "not_indexable";
}

function successfulProfile(item: LighthouseEvidence): boolean {
  return item.status === "success";
}

function completeLighthouseProfiles(items: readonly LighthouseEvidence[]): LighthouseEvidence[] {
  const byUrl = new Map<string, LighthouseEvidence[]>();
  for (const item of items) {
    const url = safeHttpUrl(profileIdentity(item));
    if (!url) continue;
    const profiles = byUrl.get(url) || [];
    profiles.push(item);
    byUrl.set(url, profiles);
  }
  const complete: LighthouseEvidence[] = [];
  for (const profiles of byUrl.values()) {
    const valid = (device: "mobile" | "desktop") => profiles.find((item) =>
      item.device === device
        && successfulProfile(item)
        && finite(item.categoryScores?.performance)
        && finite(item.categoryScores?.accessibility)
        && finite(item.categoryScores?.["best-practices"])
    );
    const mobile = valid("mobile");
    const desktop = valid("desktop");
    if (mobile && desktop) complete.push(mobile, desktop);
  }
  return complete;
}

function profileIdentity(item: LighthouseEvidence): string {
  return safeHttpUrl(item.requestedUrl) || safeHttpUrl(item.url) || "";
}

function performanceForPage(
  items: readonly LighthouseEvidence[],
  url: string,
  device: "mobile" | "desktop"
): number | null {
  const profile = items.find((item) =>
    item.device === device
      && successfulProfile(item)
      && sameUrl(profileIdentity(item), url)
      && finite(item.categoryScores?.performance)
  );
  return profile && finite(profile.categoryScores?.performance)
    ? Math.round(profile.categoryScores.performance)
    : null;
}

type YandexObservation = "found" | "miss" | "incomplete" | "depth_unavailable" | "invalid" | "failed";

function classifyYandexCheck(
  check: YandexEvidence["serpChecks"][number] | undefined
): YandexObservation {
  if (!check) return "failed";
  if (!finite(check.checkedDepth) || check.checkedDepth <= 0) return "depth_unavailable";
  if (check.found === false) return check.checkedDepth >= 20 ? "miss" : "incomplete";
  if (check.found !== true) return "invalid";
  if (!finite(check.position)
    || check.position <= 0
    || check.position > 20
    || check.position > check.checkedDepth) return "invalid";
  return "found";
}

function buildYandex(
  input: WgdManagerPresentationInput,
  copy: WgdReportLocalization
): WgdManagerPresentation["yandex"] {
  const checks = input.normalized.yandex?.serpChecks || [];
  let checked = 0;
  let found = 0;
  let top10 = 0;
  const rows = input.normalized.options.keywords.map((query) => {
    const check = checks.find((item) => item.query === query);
    const observation = classifyYandexCheck(check);
    if (observation === "found") {
      checked += 1;
      found += 1;
      if (check!.position! <= 10) top10 += 1;
      return {
        query,
        position: copy.formatNumber(check!.position!),
        page: safeHttpUrl(check!.matchedUrl) || copy.labels.pageNotProvided,
        result: copy.labels.siteFound,
      };
    }
    if (observation === "miss") {
      checked += 1;
      return {
        query,
        position: copy.labels.noData,
        page: copy.labels.pageNotProvided,
        result: copy.labels.notFoundFirst20,
      };
    }
    if (observation === "incomplete") {
      return {
        query,
        position: copy.labels.noData,
        page: copy.labels.pageNotProvided,
        result: copy.labels.incompleteFirst20,
      };
    }
    if (observation === "depth_unavailable") {
      return {
        query,
        position: copy.labels.noData,
        page: copy.labels.pageNotProvided,
        result: copy.labels.depthUnavailable,
      };
    }
    if (observation === "invalid") {
      return {
        query,
        position: copy.labels.noData,
        page: copy.labels.pageNotProvided,
        result: copy.labels.invalidYandexObservation,
      };
    }
    return {
      query,
      position: copy.labels.noData,
      page: copy.labels.pageNotProvided,
      result: copy.labels.checkFailed,
    };
  });
  const requested = input.normalized.options.keywords.length;
  return {
    summary: {
      requested,
      checked,
      found,
      top10,
      text: copy.formatYandexSummary(requested, checked, found, top10),
    },
    rows,
    empty: rows.length ? null : copy.emptyStates.yandex,
  };
}

function buildAlice(
  input: WgdManagerPresentationInput,
  copy: WgdReportLocalization
): WgdManagerPresentation["alice"] {
  const probes = input.normalized.yandex?.aiProbes || [];
  let checkedCount = 0;
  let usedCount = 0;
  const rows = input.normalized.options.aiQueries.map((query) => {
    const probe = probes.find((item) => item.query === query);
    if (probe?.status !== "checked") return { query, result: copy.labels.checkFailed };
    checkedCount += 1;
    if (probe.targetUsed) usedCount += 1;
    return { query, result: probe.targetUsed ? copy.labels.aliceUsed : copy.labels.aliceNotUsed };
  });
  const aliceAssessment = input.assessment.components.alice;
  const score = aliceAssessment.scoringCoverage > 0 ? aliceAssessment.score : null;
  return {
    score,
    scoreText: aliceAssessment.scoringCoverage > 0 ? copy.formatScore(score) : copy.labels.notScored,
    usedCount,
    checkedCount,
    requestedCount: input.normalized.options.aiQueries.length,
    conclusion: copy.formatAliceConclusion(usedCount, checkedCount),
    note: copy.labels.aliceNote,
    rows,
    empty: rows.length ? null : copy.emptyStates.alice,
  };
}

function buildLighthouse(
  input: WgdManagerPresentationInput,
  copy: WgdReportLocalization
): WgdManagerPresentation["lighthouse"] {
  const profiles = completeLighthouseProfiles(input.normalized.lighthouse || []);
  const performances = (device: "mobile" | "desktop") => profiles
    .filter((item) => item.device === device && finite(item.categoryScores?.performance))
    .map((item) => item.categoryScores!.performance!);
  const mobileAverage = arithmeticMean(performances("mobile"));
  const desktopAverage = arithmeticMean(performances("desktop"));
  const categoryScore = (category: WgdLighthouseCategory) => arithmeticMean(profiles
      .map((item) => item.categoryScores?.[category])
      .filter((value): value is number => finite(value)));
  const accessibility = categoryScore("accessibility");
  const bestPractices = categoryScore("best-practices");
  const seo = categoryScore("seo");
  const scoreInputs: WgdManagerPresentation["lighthouse"]["scoreInputs"] = [];
  const addScoreInput = (name: string, score: number | null, weight: 50 | 20 | 10) => {
    if (score === null) return;
    scoreInputs.push({
      name,
      score,
      scoreText: copy.formatScore(score),
      weight,
      weightText: copy.formatPercent(weight / 100),
    });
  };
  addScoreInput(copy.labels.mobilePerformance, mobileAverage, 50);
  addScoreInput(copy.labels.desktopPerformance, desktopAverage, 20);
  addScoreInput(copy.lighthouseCategories.accessibility, accessibility, 20);
  addScoreInput(copy.lighthouseCategories["best-practices"], bestPractices, 10);
  const supplementaryResults: WgdManagerPresentation["lighthouse"]["supplementaryResults"] = seo === null
    ? []
    : [{
      name: copy.lighthouseCategories.seo,
      score: seo,
      scoreText: copy.formatScore(seo),
      note: copy.labels.excludedFromSpeedScore,
    }];
  const worstUrl = input.assessment.components.lighthouse.worstMobileUrl;
  const safeWorstUrl = safeHttpUrl(worstUrl);
  const worstScore = worstUrl ? performanceForPage(profiles, worstUrl, "mobile") : null;
  const presentDiagnostics = new Set(profiles.flatMap((item) => item.insights || []).filter((id) => DIAGNOSTICS.has(id)));
  const diagnostics = DIAGNOSTIC_PRESENTATION_ORDER
    .filter((id) => presentDiagnostics.has(id))
    .map((id) => copy.lighthouseDiagnostics[id]);
  const lighthouseAssessment = input.assessment.components.lighthouse;
  const score = lighthouseAssessment.scoringCoverage > 0 ? lighthouseAssessment.score : null;
  return {
    score,
    scoreText: lighthouseAssessment.scoringCoverage > 0 ? copy.formatScore(score) : copy.labels.notScored,
    mobileAverage,
    mobileAverageText: copy.formatScore(mobileAverage),
    desktopAverage,
    desktopAverageText: copy.formatScore(desktopAverage),
    scoreInputs,
    supplementaryResults,
    worstMobilePage: safeWorstUrl && worstScore !== null
      ? { url: safeWorstUrl, score: worstScore, scoreText: copy.formatScore(worstScore) }
      : null,
    diagnostics,
    diagnosticsEmpty: diagnostics.length ? null : copy.emptyStates.diagnostics,
    note: copy.labels.lighthouseNote,
    roundingNote: copy.labels.lighthouseRoundingNote,
    empty: profiles.length ? null : copy.emptyStates.lighthouse,
  };
}

type LocalizedProblem = {
  title: string;
  priority: string;
  affected: string;
  impact: string;
  action: string;
  stage: WgdFindingDeliveryStage;
  scope: WgdManagerFindingScope;
  technicalAnchor: string;
  affectedUrls: string[];
};

type LocalizedPageProblem = {
  code: WgdKnownFindingCode;
  affectedUrl: string;
  severity: WgdFindingSeverity;
  rank: number;
  title: string;
  priority: string;
  action: string;
};

function buildProblems(
  input: WgdManagerPresentationInput,
  copy: WgdReportLocalization
): LocalizedProblem[] {
  return input.findingGroups.flatMap((group) => {
    if (!Object.prototype.hasOwnProperty.call(copy.findings, group.code)) return [];
    const presentation = copy.findings[group.code];
    const affectedUrls = group.affectedUrls
      .map(safeHttpUrl)
      .filter((url): url is string => Boolean(url));
    if (group.scope === "page" && affectedUrls.length === 0) return [];
    return [{
      title: presentation.title,
      priority: copy.severities[group.severity],
      affected: group.scope === "site"
        ? copy.labels.siteLevelProblem
        : copy.formatAffectedPages(affectedUrls.length),
      impact: presentation.impact,
      action: presentation.action,
      stage: group.deliveryStage,
      scope: group.scope,
      technicalAnchor: group.technicalAnchor,
      affectedUrls,
    }];
  });
}

function buildPageDetailProblems(
  input: WgdManagerPresentationInput,
  copy: WgdReportLocalization
): LocalizedPageProblem[] {
  const grouped = new Map<string, {
    code: WgdKnownFindingCode;
    affectedUrl: string;
    severity: WgdFindingSeverity;
    rank: number;
  }>();
  for (const finding of input.normalized.findings) {
    const catalog = findingCatalogEntry(finding.code);
    const affectedUrl = safeHttpUrl(finding.affectedUrl);
    if (!catalog
      || catalog.managerScope !== "page"
      || !affectedUrl
      || !Object.prototype.hasOwnProperty.call(copy.findings, finding.code)
      || !Object.prototype.hasOwnProperty.call(copy.severities, finding.severity)) continue;
    const code = finding.code as WgdKnownFindingCode;
    const key = `${code}\0${affectedUrl}`;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, { code, affectedUrl, severity: finding.severity, rank: catalog.rank });
    } else if (SEVERITY_ORDER[finding.severity] < SEVERITY_ORDER[current.severity]) {
      current.severity = finding.severity;
    }
  }
  return [...grouped.values()]
    .sort((left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
      || left.rank - right.rank
      || left.code.localeCompare(right.code)
      || left.affectedUrl.localeCompare(right.affectedUrl)
    )
    .map((problem) => ({
      ...problem,
      title: copy.findings[problem.code].title,
      priority: copy.severities[problem.severity],
      action: copy.findings[problem.code].action,
    }));
}

function buildPages(
  input: WgdManagerPresentationInput,
  copy: WgdReportLocalization,
  problems: readonly LocalizedPageProblem[]
): WgdManagerPresentation["pages"] {
  const pages = input.normalized.pages || input.normalized.crawl?.pages || [];
  const lighthouse = input.normalized.lighthouse || [];
  const idCounts = new Map<string, number>();
  return pages.flatMap((page) => {
    const url = safeHttpUrl(page.finalUrl) || safeHttpUrl(page.requestedUrl);
    if (!url) return [];
    const baseId = pageDetailBaseId(url);
    const occurrence = (idCounts.get(baseId) || 0) + 1;
    idCounts.set(baseId, occurrence);
    const id = occurrence === 1 ? baseId : `${baseId}-${occurrence}`;
    const pageAssessment = input.assessment.pages.find((item) => sameUrl(item.url, url));
    const pageProblems = problems.filter((item) => sameUrl(item.affectedUrl, url));
    const problem = pageProblems[0];
    const mobile = performanceForPage(lighthouse, url, "mobile");
    const desktop = performanceForPage(lighthouse, url, "desktop");
    return [{
      id,
      url,
      name: pageName(url),
      score: pageAssessment?.score ?? null,
      scoreText: copy.formatScore(pageAssessment?.score ?? null),
      indexability: copy.pageIndexability[pageIndexability(page)],
      mainProblem: problem?.title || copy.labels.noMainProblem,
      httpStatus: finite(page.status) && page.status > 0 ? copy.formatNumber(page.status) : copy.labels.noData,
      mobilePerformance: copy.formatScore(mobile),
      desktopPerformance: copy.formatScore(desktop),
      problems: pageProblems.map((item) => ({
        title: item.title,
        priority: item.priority,
        action: item.action,
      })),
    }];
  });
}

function problemDestination(
  problem: LocalizedProblem,
  pages: WgdManagerPresentation["pages"],
  copy: WgdReportLocalization
): Pick<WgdManagerPresentation["problems"][number], "href" | "linkLabel"> {
  if (problem.scope === "page") {
    const target = pages.find((page) =>
      problem.affectedUrls.some((affected) => sameUrl(affected, page.url))
    );
    return {
      href: target ? `#${target.id}` : "#page-details",
      linkLabel: copy.headings.pages,
    };
  }
  const href = SITE_TECHNICAL_ANCHORS.has(problem.technicalAnchor)
    ? problem.technicalAnchor
    : "#site-technical";
  const linkLabel = href === "#methodology"
    ? copy.headings.methodology
    : href === "#speed-ux"
      ? copy.headings.speed
      : href === "#alice-visibility"
        ? copy.headings.alice
        : href === "#page-details"
          ? copy.headings.pages
          : copy.headings.siteTechnical;
  return { href, linkLabel };
}

function buildMethodology(
  input: WgdManagerPresentationInput,
  copy: WgdReportLocalization
): WgdManagerPresentation["methodology"] {
  const orderedSources = SOURCE_PRESENTATION_ORDER.flatMap((id) =>
    (input.normalized.sources || [])
      .filter((item) => item.id === id)
      .map((source) => ({ id, source }))
  );
  const sources = orderedSources.map(({ id, source }) => ({
    source: copy.sourceNames[id],
    state: copy.sourceStates[sourceState(source.state)],
  }));
  const accessGaps = orderedSources.flatMap(({ id, source }) => {
    if (source.state !== "owner_access_required") return [];
    return [{
      source: copy.sourceNames[id],
      state: copy.sourceStates.owner_access_required,
    }];
  });
  const limitations = new Set<string>();
  const crawl = input.normalized.crawl;
  if (crawl && (crawl.truncated || crawl.droppedEligibleCount > 0)) {
    limitations.add(copy.formatLimitation("crawlTruncated", { count: crawl.droppedEligibleCount }));
  }
  const pages = input.normalized.pages || crawl?.pages || [];
  const pageCollectionErrors = pages.filter((page) =>
    Boolean(page.error) || !finite(page.status) || page.status <= 0
  ).length;
  if (pageCollectionErrors > 0) {
    limitations.add(copy.formatLimitation("pageCollectionErrors", { count: pageCollectionErrors }));
  }
  const collectionGap = (
    kind: "lighthouseIncomplete" | "yandexIncomplete" | "aliceIncomplete",
    collected: number,
    requested: number
  ) => {
    if (requested > 0 && collected < requested) {
      limitations.add(copy.formatLimitation(kind, { collected, requested }));
    }
  };
  collectionGap(
    "lighthouseIncomplete",
    input.assessment.components.lighthouse.collected,
    input.assessment.components.lighthouse.requested
  );
  collectionGap(
    "yandexIncomplete",
    input.assessment.components.yandex.collected,
    input.assessment.components.yandex.requested
  );
  collectionGap(
    "aliceIncomplete",
    input.assessment.components.alice.collected,
    input.assessment.components.alice.requested
  );
  for (const { id, source } of orderedSources) {
    if (source.state !== "partial" && source.state !== "unavailable") continue;
    limitations.add(copy.formatLimitation(
      source.state === "partial" ? "sourcePartial" : "sourceUnavailable",
      { source: copy.sourceNames[id] }
    ));
  }
  if (accessGaps.length) limitations.add(copy.formatLimitation("ownerAccess"));
  if ((input.normalized.limitations?.length || 0) > 0) {
    limitations.add(copy.formatLimitation("additional"));
  }
  return {
    summary: [copy.labels.methodologyData, copy.labels.methodologyScoring],
    sources,
    accessGaps,
    accessNote: accessGaps.length ? copy.labels.ownerAccessNote : copy.emptyStates.accessGaps,
    limitations: [...limitations],
  };
}

function buildSpecialist(
  input: WgdManagerPresentationInput,
  copy: WgdReportLocalization
): WgdManagerPresentation["specialist"] {
  const configured = (input.normalized.evidenceFiles || []).map(safeEvidencePath)
    .filter((path): path is string => Boolean(path));
  const files = configured.length ? configured : [...DEFAULT_EVIDENCE_FILES];
  const paths = [
    "report.json",
    ...files,
    ...(input.normalized.manualQueryPackPath === "manual-query-pack.md" ? ["manual-query-pack.md"] : []),
  ];
  const unique = [...new Set(paths)];
  return {
    note: copy.labels.specialistNote,
    links: unique.map((path) => ({ label: path, href: path })),
    empty: unique.length ? null : copy.emptyStates.specialistFiles,
  };
}

/** Build manager-visible copy without copying prose from normalized evidence. */
export function buildManagerPresentation(input: WgdManagerPresentationInput): WgdManagerPresentation {
  const copy = getReportLocalization(input.normalized.options.language);
  const assessment = input.assessment;
  const localizedProblems = buildProblems(input, copy);
  const pageDetailProblems = buildPageDetailProblems(input, copy);
  const pages = buildPages(input, copy, pageDetailProblems);
  const problems = localizedProblems.slice(0, 5)
    .map((problem) => ({
      title: problem.title,
      priority: problem.priority,
      affected: problem.affected,
      impact: problem.impact,
      action: problem.action,
      ...problemDestination(problem, pages, copy),
    }));
  const priorityStages = STAGE_ORDER.flatMap((stage) => {
    const stageProblems = localizedProblems.filter((problem) => problem.stage === stage);
    if (!stageProblems.length) return [];
    return [{
      title: copy.deliveryStages[stage].title,
      result: copy.deliveryStages[stage].result,
      items: stageProblems.map((problem) => problem.title),
    }];
  });
  const components = COMPONENT_ORDER.map((id) => {
    const component = assessment.components[id];
    const score = component.scoringCoverage > 0 ? component.score : null;
    return {
      name: copy.components[id].name,
      score,
      scoreText: component.scoringCoverage > 0 ? copy.formatScore(score) : copy.labels.notScored,
      collection: copy.formatCollection(component.collected, component.requested),
      coverage: copy.formatPercent(component.collectionCoverage),
      explanation: copy.components[id].explanation,
    };
  });
  const completenessText = copy.formatPercent(assessment.completeness / 100);
  const conclusion = assessment.status
    ? copy.conclusions.score[assessment.status]
    : copy.conclusions.assessment[assessment.state];
  return {
    locale: copy.locale,
    labels: copy.labels,
    headings: {
      overall: copy.headings.overall,
      components: copy.headings.components,
      problems: copy.headings.problems,
      yandex: copy.headings.yandex,
      alice: copy.headings.alice,
      speed: copy.headings.speed,
      priorities: copy.headings.priorities,
      pages: copy.headings.pages,
      siteTechnical: copy.headings.siteTechnical,
      methodology: copy.headings.methodology,
      specialist: copy.headings.specialist,
    },
    header: {
      title: copy.headings.report,
      domain: safeDomain(input.normalized.options),
      date: copy.formatDate(input.normalized.generatedAt),
      market: copy.markets[input.normalized.options.market],
      searchEngine: copy.labels.searchEngine,
      completeness: `${copy.labels.completeness}: ${completenessText}`,
    },
    overall: {
      score: assessment.displayScore,
      scoreText: copy.formatScore(assessment.displayScore),
      state: copy.assessmentStates[assessment.state],
      status: assessment.status ? copy.scoreStatuses[assessment.status] : null,
      completeness: assessment.completeness,
      completenessText,
      conclusion,
    },
    components,
    problems,
    problemsEmpty: problems.length ? null : copy.emptyStates.problems,
    yandex: buildYandex(input, copy),
    alice: buildAlice(input, copy),
    lighthouse: buildLighthouse(input, copy),
    priorityStages,
    prioritiesEmpty: priorityStages.length ? null : copy.emptyStates.priorities,
    pages,
    pagesEmpty: pages.length ? null : copy.emptyStates.pages,
    methodology: buildMethodology(input, copy),
    specialist: buildSpecialist(input, copy),
  };
}
