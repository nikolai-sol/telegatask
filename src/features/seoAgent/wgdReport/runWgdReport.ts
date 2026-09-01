import { writeWgdArtifacts, type WgdArtifactPaths } from "./artifactWriter";
import { buildWgdFindings } from "./findings";
import { collectLighthouseProfiles } from "./lighthouseCollector";
import type { DnsResolver } from "./networkSafety";
import { defaultDnsResolver, resolvePublicHttpUrl } from "./networkSafety";
import {
  preflightProviders,
  type ProviderPreflightDeps,
  type ProviderPreflightEnv,
} from "./providerPreflight";
import {
  crawlSite as crawlSiteDefault,
  isMutationPath,
  type CrawlSiteDependencies,
} from "./siteCrawler";
import type {
  CoverageState,
  CrawlEvidence,
  CrawlFetch,
  CrawlSiteOptions,
  LighthouseEvidence,
  PageEvidence,
  SourceCoverage,
  WgdReportOptions,
  WgdReportPayload,
} from "./types";
import type { SeoSearchConsoleSnapshot } from "../types";
import { SeoProviderNotConfiguredError } from "../providers/seoDataProvider";
import {
  collectYandexEvidence as collectYandexEvidenceDefault,
  type YandexEvidence,
  type YandexEvidenceDeps,
  type YandexEvidenceEnv,
} from "./yandexEvidence";

const MAX_LIGHTHOUSE_PAGES = 6;
const CRAWL_CONCURRENCY = 5;
const CRAWL_TIMEOUT_MS = 15_000;

export type WgdRunSummary = {
  status: "success" | "partial";
  domain: string;
  pagesCrawled: number;
  findings: number;
  lighthouseProfiles: {
    requested: number;
    successful: number;
    failed: number;
  };
  coverage: Record<string, CoverageState>;
};

export type WgdReportRunResult = {
  reportDir: string;
  htmlPath: string;
  jsonPath: string;
  manualQueryPackPath: string | undefined;
  summary: WgdRunSummary;
};

type CrawlRunner = (
  options: CrawlSiteOptions,
  deps?: CrawlFetch | CrawlSiteDependencies
) => Promise<CrawlEvidence>;

type YandexWebmasterOwnerSource = {
  getSnapshot(
    domain: string,
    options?: { device?: null },
    signal?: AbortSignal
  ): Promise<SeoSearchConsoleSnapshot>;
};

type GoogleSearchConsoleOwnerSource = {
  getSnapshot(
    domain: string,
    options: { teamId: string; siteUrl?: string | null },
    signal?: AbortSignal
  ): Promise<SeoSearchConsoleSnapshot>;
};

export type WgdOwnerSourceFactories = {
  createYandexWebmaster: () => YandexWebmasterOwnerSource | Promise<YandexWebmasterOwnerSource>;
  createGoogleSearchConsole: () => GoogleSearchConsoleOwnerSource | Promise<GoogleSearchConsoleOwnerSource>;
};

export type RunWgdReportDeps = {
  env?: ProviderPreflightEnv & YandexEvidenceEnv;
  preflightDeps?: ProviderPreflightDeps;
  crawlSite?: CrawlRunner;
  crawlFetch?: CrawlFetch;
  dnsResolver?: DnsResolver;
  collectLighthouseProfiles?: (urls: string[]) => LighthouseEvidence[] | Promise<LighthouseEvidence[]>;
  collectYandexEvidence?: (options: WgdReportOptions, deps?: YandexEvidenceDeps) => Promise<YandexEvidence>;
  yandexDeps?: Omit<YandexEvidenceDeps, "env" | "ownerAccess">;
  ownerSourceFactories?: Partial<WgdOwnerSourceFactories>;
  writeArtifacts?: (payload: WgdReportPayload) => Promise<WgdArtifactPaths>;
  now?: () => Date;
};

const defaultOwnerSourceFactories: WgdOwnerSourceFactories = {
  createYandexWebmaster: async () => {
    const { YandexWebmasterSeoSource } = await import("../providers/yandexWebmasterSeoSource");
    return new YandexWebmasterSeoSource();
  },
  createGoogleSearchConsole: async () => {
    const { GoogleSearchConsoleSeoSource } = await import("../providers/googleSearchConsoleSeoSource");
    return new GoogleSearchConsoleSeoSource();
  },
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function auditedUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function normalizedHostname(value: string): string {
  return value.toLowerCase().replace(/\.$/, "");
}

function gscIdentityMatchesTarget(identity: unknown, target: URL): boolean {
  const text = clean(identity);
  if (!text) return false;
  if (/^sc-domain:/i.test(text)) {
    const domain = normalizedHostname(text.slice("sc-domain:".length));
    const hostname = normalizedHostname(target.hostname);
    return Boolean(domain && /^[a-z\d.-]+$/i.test(domain))
      && (hostname === domain || hostname.endsWith(`.${domain}`));
  }
  const prefix = auditedUrl(text);
  if (!prefix || prefix.username || prefix.password || prefix.origin !== target.origin) return false;
  prefix.hash = "";
  const comparableTarget = new URL(target.toString());
  comparableTarget.hash = "";
  return comparableTarget.toString().startsWith(prefix.toString());
}

function yandexIdentityOrigin(identity: unknown): string | undefined {
  const text = clean(identity);
  if (!text) return undefined;
  const hostId = /^(https?):([^/:]+):(\d+)$/i.exec(text);
  const url = auditedUrl(hostId ? `${hostId[1]}://${hostId[2]}:${hostId[3]}/` : text);
  return url && !url.username && !url.password ? url.origin : undefined;
}

function snapshotMatchesGsc(snapshot: SeoSearchConsoleSnapshot, targetValue: string): boolean {
  const target = auditedUrl(targetValue);
  if (!target) return false;
  const identities = [snapshot.property, snapshot.siteUrl].filter((value) => clean(value));
  return identities.length > 0 && identities.every((identity) => gscIdentityMatchesTarget(identity, target));
}

function snapshotMatchesYandex(snapshot: SeoSearchConsoleSnapshot, targetValue: string): boolean {
  const target = auditedUrl(targetValue);
  if (!target) return false;
  const identities = [snapshot.property, snapshot.siteUrl].filter((value) => clean(value));
  return identities.length > 0
    && identities.every((identity) => yandexIdentityOrigin(identity) === target.origin);
}

function createOwnerEvidenceBoundary(
  options: WgdReportOptions,
  env: ProviderPreflightEnv & YandexEvidenceEnv,
  overrides: Partial<WgdOwnerSourceFactories> = {}
): { preflightDeps: ProviderPreflightDeps; yandexDeps: Pick<
  YandexEvidenceDeps,
  "getYandexWebmasterSnapshot" | "getGscSnapshot"
> } {
  const factories = { ...defaultOwnerSourceFactories, ...overrides };
  let yandexSnapshot: Promise<SeoSearchConsoleSnapshot | undefined> | undefined;
  let gscSnapshot: Promise<SeoSearchConsoleSnapshot | undefined> | undefined;

  const getYandexWebmasterSnapshot = async (signal?: AbortSignal): Promise<SeoSearchConsoleSnapshot | undefined> => {
    yandexSnapshot ||= Promise.resolve(factories.createYandexWebmaster())
      .then((source) => source.getSnapshot(options.url, { device: null }, signal))
      .then((snapshot) => snapshotMatchesYandex(snapshot, options.url) ? snapshot : undefined)
      .catch((error) => {
        if (error instanceof SeoProviderNotConfiguredError) return undefined;
        throw error;
      });
    return yandexSnapshot;
  };
  const getGscSnapshot = async (signal?: AbortSignal): Promise<SeoSearchConsoleSnapshot | undefined> => {
    if (!gscSnapshot) {
      const teamId = clean(env.SEO_REPORT_GSC_TEAM_ID);
      if (!teamId) return undefined;
      const siteUrl = clean(env.GSC_SITE_URL) || null;
      gscSnapshot = Promise.resolve(factories.createGoogleSearchConsole())
        .then((source) => source.getSnapshot(options.domain, { teamId, siteUrl }, signal))
        .then((snapshot) => snapshotMatchesGsc(snapshot, options.url) ? snapshot : undefined)
        .catch((error) => {
          if (error instanceof SeoProviderNotConfiguredError) return undefined;
          throw error;
        });
    }
    return gscSnapshot;
  };

  return {
    preflightDeps: {
      checkYandexHost: async (_domain, signal) => Boolean(await getYandexWebmasterSnapshot(signal)),
      checkGscProperty: async (_domain, signal) => Boolean(await getGscSnapshot(signal)),
    },
    yandexDeps: {
      getYandexWebmasterSnapshot: async () => getYandexWebmasterSnapshot(),
      getGscSnapshot: async () => getGscSnapshot(),
    },
  };
}

function safeUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function isSuccessfulPage(page: PageEvidence): boolean {
  return !page.error && page.status >= 200 && page.status < 300;
}

function assertPublicPageFetched(options: WgdReportOptions, crawl: CrawlEvidence): void {
  const startUrl = safeUrl(options.url);
  const page = crawl.pages.find((item) => safeUrl(item.requestedUrl) === startUrl);
  if (!page || !isSuccessfulPage(page)) {
    throw new Error(`Public page fetch failed for ${startUrl || options.domain}.`);
  }
}

type LighthouseSelection = { urls: string[]; limitations: string[] };

function validatedCrawlTarget(
  page: PageEvidence,
  crawl: CrawlEvidence,
  origin: string
): string | undefined {
  if (!isSuccessfulPage(page)) return undefined;
  const requested = safeUrl(page.requestedUrl);
  const finalUrl = safeUrl(page.finalUrl || page.requestedUrl);
  if (!requested || !finalUrl) return undefined;
  if (new URL(requested).origin !== origin || new URL(finalUrl).origin !== origin) return undefined;
  if (isMutationPath(requested) || isMutationPath(finalUrl)) return undefined;

  const chain = crawl.redirectChains.find((item) => safeUrl(item.requestedUrl) === requested);
  if (requested !== finalUrl && !chain) return undefined;
  if (chain) {
    const chainFinal = safeUrl(chain.finalUrl);
    const urls = chain.urls.map(safeUrl);
    if (chainFinal !== finalUrl || urls[0] !== requested || urls[urls.length - 1] !== finalUrl) return undefined;
    if (urls.some((url) => !url || new URL(url).origin !== origin || isMutationPath(url))) return undefined;
  }
  return finalUrl;
}

function selectLighthousePages(options: WgdReportOptions, crawl: CrawlEvidence): LighthouseSelection {
  const homepage = safeUrl(options.url);
  if (!homepage) return { urls: [], limitations: [] };
  const origin = new URL(homepage).origin;
  const homePage = crawl.pages.find((page) => safeUrl(page.requestedUrl) === homepage);
  const homeTarget = homePage ? validatedCrawlTarget(homePage, crawl, origin) : undefined;
  const limitations: string[] = [];
  const priorities: string[] = [];
  for (const rawPriority of options.priorityUrls) {
    const priority = safeUrl(rawPriority);
    const page = priority
      ? crawl.pages.find((item) => safeUrl(item.requestedUrl) === priority && isSuccessfulPage(item))
      : undefined;
    if (!priority || !page) {
      limitations.push(`Priority URL skipped because no successful crawl evidence was collected: ${priority || "invalid URL"}`);
      continue;
    }
    const target = validatedCrawlTarget(page, crawl, origin);
    if (!target) {
      limitations.push(`Priority URL skipped because crawl evidence did not validate a safe final page: ${priority}`);
      continue;
    }
    priorities.push(target);
  }
  const candidates = crawl.pages
    .map((page, index) => ({ page, index }))
    .filter(({ page }) => isSuccessfulPage(page))
    .sort((a, b) => {
      const depth = (a.page.depth ?? Number.MAX_SAFE_INTEGER) - (b.page.depth ?? Number.MAX_SAFE_INTEGER);
      if (depth) return depth;
      const discovery = (a.page.discoveryOrder ?? Number.MAX_SAFE_INTEGER) - (b.page.discoveryOrder ?? Number.MAX_SAFE_INTEGER);
      return discovery || a.index - b.index;
    })
    .map(({ page }) => validatedCrawlTarget(page, crawl, origin));
  const ordered = [homeTarget, ...priorities, ...candidates];
  const result: string[] = [];
  const seen = new Set<string>();
  const limit = Math.min(MAX_LIGHTHOUSE_PAGES, Math.max(1, Math.floor(options.lighthousePageLimit)));
  for (const candidate of ordered) {
    if (!candidate || new URL(candidate).origin !== origin || isMutationPath(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    result.push(candidate);
    if (result.length >= limit) break;
  }
  return { urls: result, limitations: [...new Set(limitations)] };
}

/** Select a bounded, crawl-validated stable set without navigating raw priority URLs. */
export function selectLighthouseUrls(options: WgdReportOptions, crawl: CrawlEvidence): string[] {
  return selectLighthousePages(options, crawl).urls;
}

function sourceState(sources: SourceCoverage[], id: string): CoverageState | undefined {
  return sources.find((source) => source.id === id)?.state;
}

function upsertSource(sources: SourceCoverage[], source: SourceCoverage): void {
  const index = sources.findIndex((item) => item.id === source.id);
  if (index >= 0) sources[index] = source;
  else sources.push(source);
}

function ownerAccess(sources: SourceCoverage[]): { yandexWebmaster: boolean; gsc: boolean } {
  return {
    yandexWebmaster: sourceState(sources, "yandex_webmaster") === "success",
    gsc: sourceState(sources, "gsc") === "success",
  };
}

function reconcileOwnerEvidence(
  options: WgdReportOptions,
  evidence: YandexEvidence,
  sources: SourceCoverage[],
  checkedAt: string
): YandexEvidence {
  const yandexValid = sourceState(sources, "yandex_webmaster") === "success"
    && Boolean(evidence.yandexWebmasterSnapshot && snapshotMatchesYandex(evidence.yandexWebmasterSnapshot, options.url));
  const gscValid = sourceState(sources, "gsc") === "success"
    && Boolean(evidence.gscSnapshot && snapshotMatchesGsc(evidence.gscSnapshot, options.url));
  for (const [id, label, valid] of [
    ["yandex_webmaster", "Yandex Webmaster", yandexValid],
    ["gsc", "Google Search Console", gscValid],
  ] as const) {
    if (sourceState(sources, id) === "success" && !valid) {
      upsertSource(sources, {
        id,
        label,
        state: "owner_access_required",
        message: `Verified ${label} owner access is required for this domain.`,
        checkedAt,
      });
    }
  }
  const { yandexWebmasterSnapshot, gscSnapshot, ...safeEvidence } = evidence;
  return {
    ...safeEvidence,
    ...(yandexValid && yandexWebmasterSnapshot ? { yandexWebmasterSnapshot } : {}),
    ...(gscValid && gscSnapshot ? { gscSnapshot } : {}),
  };
}

function failedLighthouse(urls: string[], error = "Lighthouse execution failed"): LighthouseEvidence[] {
  return urls.flatMap((url) => (["mobile", "desktop"] as const).map((device) => ({
    url,
    requestedUrl: url,
    finalUrl: url,
    device,
    status: "failed" as const,
    measurementType: "lab" as const,
    fieldData: { source: "CrUX" as const, state: "not_collected" as const },
    error,
  })));
}

function unavailableYandex(options: WgdReportOptions, checkedAt: string): YandexEvidence {
  return {
    serpChecks: [],
    serpStatus: {
      state: options.keywords.length ? "provider_error" : "no_keywords",
      message: options.keywords.length ? "Yandex rank checks were unavailable." : "No Yandex rank-check keywords were provided.",
      checkedAt,
    },
    aiProbes: [],
    aiSampleVisibility: { used: 0, checked: 0, rate: null },
    manualQueries: [
      ...options.keywords.map((query) => ({ source: "yandex_search" as const, query, reason: "Yandex SERP evidence was unavailable." })),
      ...options.aiQueries.map((query) => ({ source: "alice_ai" as const, query, reason: "Alice AI probe evidence was unavailable." })),
    ],
    limitations: ["Optional Yandex evidence collection was unavailable."],
  };
}

function lighthouseCoverage(profiles: LighthouseEvidence[], requested: number, checkedAt: string): SourceCoverage {
  const successful = profiles.filter((item) => item.status === "success").length;
  const state: CoverageState = requested > 0 && successful === requested
    ? "success"
    : successful > 0
      ? "partial"
      : "unavailable";
  return {
    id: "lighthouse",
    label: "Lighthouse",
    state,
    message: state === "success"
      ? "All requested Lighthouse profiles completed."
      : state === "partial"
        ? "Some requested Lighthouse profiles were unavailable."
        : "Lighthouse profiles were unavailable.",
    checkedAt,
    details: { requested, successful, failed: profiles.filter((item) => item.status === "failed").length },
  };
}

function yandexSearchCoverage(
  options: WgdReportOptions,
  evidence: YandexEvidence,
  checkedAt: string
): SourceCoverage {
  const requested = options.keywords.length;
  const collected = evidence.serpChecks.length;
  let state: CoverageState;
  if (requested === 0) state = "not_applicable";
  else if (evidence.serpStatus.state === "connected" && collected >= requested) state = "success";
  else if ((evidence.serpStatus.state === "connected" || evidence.serpStatus.state === "partial_success") && collected > 0) state = "partial";
  else state = "unavailable";
  return {
    id: "yandex_search",
    label: "Yandex Search API",
    state,
    message: state === "success"
      ? "Yandex rank checks completed for all requested keywords."
      : state === "partial"
        ? "Yandex rank checks returned partial evidence."
        : state === "not_applicable"
          ? "No Yandex rank-check keywords were requested."
          : "Yandex rank checks were unavailable.",
    checkedAt,
    details: { requested, collected },
  };
}

function aliceCoverage(
  options: WgdReportOptions,
  evidence: YandexEvidence,
  checkedAt: string
): SourceCoverage {
  const requested = options.aiQueries.length;
  const checked = evidence.aiProbes.filter((probe) => probe.status === "checked").length;
  let state: CoverageState;
  if (requested === 0) state = "not_applicable";
  else if (checked >= requested) state = "success";
  else if (checked > 0) state = "partial";
  else state = "unavailable";
  return {
    id: "alice_ai",
    label: "Alice AI sample",
    state,
    message: state === "success"
      ? "All requested Alice AI sample probes were checked."
      : state === "partial"
        ? "Alice AI sample probes returned partial evidence."
        : state === "not_applicable"
          ? "No Alice AI sample queries were requested."
          : "Alice AI sample probes were unavailable.",
    checkedAt,
    details: { requested, checked },
  };
}

function coverageMap(sources: SourceCoverage[]): Record<string, CoverageState> {
  return Object.fromEntries(sources.map((source) => [source.id, source.state]));
}

function runStatus(sources: SourceCoverage[], yandex: YandexEvidence): "success" | "partial" {
  const sourcePartial = sources.some((source) => source.state !== "success" && source.state !== "not_applicable");
  const providerPartial = ["provider_error", "limit_exceeded", "partial_success", "missing_credentials"]
    .includes(yandex.serpStatus.state);
  return sourcePartial || providerPartial || yandex.manualQueries.length > 0 ? "partial" : "success";
}

/** Compose the bounded collectors into one evidence payload and publish its artifact bundle. */
export async function runWgdReport(
  options: WgdReportOptions,
  deps: RunWgdReportDeps = {}
): Promise<WgdReportRunResult> {
  const env: ProviderPreflightEnv & YandexEvidenceEnv = deps.env
    || process.env as ProviderPreflightEnv & YandexEvidenceEnv;
  const crawlRunner = deps.crawlSite || crawlSiteDefault;
  const resolveDns = deps.dnsResolver ?? defaultDnsResolver;
  await resolvePublicHttpUrl(options.url, resolveDns);
  const ownerDefaults = createOwnerEvidenceBoundary(options, env, deps.ownerSourceFactories);
  const preflightDeps: ProviderPreflightDeps = {
    ...ownerDefaults.preflightDeps,
    ...deps.preflightDeps,
  };
  const [preflight, crawl] = await Promise.all([
    preflightProviders(options, env, preflightDeps),
    crawlRunner(
      {
        startUrl: options.url,
        priorityUrls: options.priorityUrls,
        keywords: options.keywords,
        robotsUserAgent: options.market === "RU" || options.language.startsWith("ru")
          ? "YandexBot"
          : "Googlebot",
        limit: options.crawlLimit,
        concurrency: CRAWL_CONCURRENCY,
        timeoutMs: CRAWL_TIMEOUT_MS,
      },
      { ...(deps.crawlFetch ? { fetch: deps.crawlFetch } : {}), resolveDns }
    ),
  ]);
  assertPublicPageFetched(options, crawl);

  const generatedAt = (deps.now?.() || new Date()).toISOString();
  const lighthouseSelection = selectLighthousePages(options, crawl);
  const lighthouseUrls = lighthouseSelection.urls;
  const safeLighthouseUrls: string[] = [];
  const lighthouseValidationFailures: LighthouseEvidence[] = [];
  for (const url of lighthouseUrls) {
    try {
      await resolvePublicHttpUrl(url, resolveDns);
      safeLighthouseUrls.push(url);
    } catch {
      lighthouseValidationFailures.push(...failedLighthouse(
        [url],
        "Lighthouse target failed public-network validation"
      ));
    }
  }
  let lighthouse: LighthouseEvidence[];
  try {
    lighthouse = [
      ...await (deps.collectLighthouseProfiles
        ? deps.collectLighthouseProfiles(safeLighthouseUrls)
        : collectLighthouseProfiles(safeLighthouseUrls, undefined, { resolveDns })),
      ...lighthouseValidationFailures,
    ];
  } catch {
    lighthouse = [...failedLighthouse(safeLighthouseUrls), ...lighthouseValidationFailures];
  }

  let yandex: YandexEvidence;
  try {
    yandex = await (deps.collectYandexEvidence || collectYandexEvidenceDefault)(options, {
      ...ownerDefaults.yandexDeps,
      ...deps.yandexDeps,
      env,
      ownerAccess: ownerAccess(preflight),
    });
  } catch {
    yandex = unavailableYandex(options, generatedAt);
  }

  const sources = preflight.map((source) => ({ ...source }));
  yandex = reconcileOwnerEvidence(options, yandex, sources, generatedAt);
  upsertSource(sources, {
    id: "crawl",
    label: "Public crawl",
    state: "success",
    message: `Collected ${crawl.pages.length} public page record(s).`,
    checkedAt: generatedAt,
    details: { pages: crawl.pages.length },
  });
  const requestedProfiles = lighthouseUrls.length * 2;
  upsertSource(sources, lighthouseCoverage(lighthouse, requestedProfiles, generatedAt));
  upsertSource(sources, yandexSearchCoverage(options, yandex, generatedAt));
  upsertSource(sources, aliceCoverage(options, yandex, generatedAt));

  const findings = buildWgdFindings({ crawl, pages: crawl.pages, lighthouse, yandex, sources });
  const payload: WgdReportPayload = {
    generatedAt,
    options,
    sources,
    crawl,
    pages: crawl.pages,
    lighthouse,
    yandex,
    findings,
    limitations: [...new Set([...crawl.limitations, ...yandex.limitations, ...lighthouseSelection.limitations])],
  };
  const artifacts = await (deps.writeArtifacts || writeWgdArtifacts)(payload);
  const successful = lighthouse.filter((item) => item.status === "success").length;
  const failed = lighthouse.filter((item) => item.status === "failed").length;

  return {
    reportDir: artifacts.directory,
    htmlPath: artifacts.reportHtml,
    jsonPath: artifacts.reportJson,
    manualQueryPackPath: artifacts.manualQueryPack,
    summary: {
      status: runStatus(sources, yandex),
      domain: options.domain,
      pagesCrawled: crawl.pages.length,
      findings: findings.length,
      lighthouseProfiles: { requested: requestedProfiles, successful, failed },
      coverage: coverageMap(sources),
    },
  };
}
