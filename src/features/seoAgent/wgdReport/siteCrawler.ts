import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import robotsParser from "robots-parser";
import { analyzeHtmlPage } from "./htmlAnalyzer";
import {
  defaultDnsResolver,
  resolvePublicHttpUrl,
  UnsafeNetworkTargetError,
  type DnsAddress,
  type DnsResolver,
} from "./networkSafety";
import type {
  CrawlEvidence,
  CrawlFetch,
  CrawlFetchResponse,
  CrawlSiteOptions,
  PageDiscoverySource,
  PageEvidence,
  RobotsEvidence,
  RobotsAccessEvidence,
  SitemapCandidate,
} from "./types";

const MAX_PAGE_LIMIT = 100;
const MAX_CONCURRENCY = 5;
const MAX_SITEMAP_FILES = 10;
const MAX_TIMEOUT_MS = 15_000;
export const MAX_HTML_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_ROBOTS_BODY_BYTES = 512 * 1024;
export const MAX_SITEMAP_BODY_BYTES = 5 * 1024 * 1024;
const COMMON_SITEMAP_PATHS = ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml"];
const HTML_CONTENT_TYPE = /^(?:text\/html|application\/xhtml\+xml)\b/i;
const MUTATION_SEGMENT = /^(?:login|logout|sign(?:-|_)?(?:in|out|up)|register|registration|account|cart|checkout|admin|wp-admin|api|auth)$/i;

type QueuedUrl = { url: string; depth?: number; discoveryOrder: number };
type FetchResult = { response?: CrawlFetchResponse; text?: string; error?: string };
type OriginFetchResult = FetchResult & { finalUrl?: string; redirectUrls: string[] };
type BodyKind = "html" | "robots" | "sitemap";
type RobotsCollection = {
  evidence: Omit<RobotsEvidence, "access">;
  body: string;
  accessState: RobotsAccessEvidence["state"];
};

export type CrawlSiteDependencies = {
  fetch?: CrawlFetch;
  resolveDns?: DnsResolver;
};

class ResponseTooLargeError extends Error {
  constructor() {
    super("response too large");
    this.name = "ResponseTooLargeError";
  }
}

function sanitizeUrl(value: string, base?: string): string | undefined {
  try {
    const url = new URL(value, base);
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

function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function headerValue(response: CrawlFetchResponse, name: string): string | undefined {
  const value = response.headers.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isHtml(response: CrawlFetchResponse): boolean {
  const contentType = headerValue(response, "content-type");
  return Boolean(contentType && HTML_CONTENT_TYPE.test(contentType));
}

function boundedInteger(value: number, maximum: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(1, Math.floor(value)));
}

function declaredContentLength(response: CrawlFetchResponse): number | null {
  const value = headerValue(response, "content-length");
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function ignoreCleanupPromise(operation: unknown): void {
  if (operation && typeof (operation as PromiseLike<unknown>).then === "function") {
    void Promise.resolve(operation).catch(() => undefined);
  }
}

function cancelBody(response: CrawlFetchResponse | undefined, reason: string): void {
  const body = response?.body;
  try {
    if (body?.cancel) ignoreCleanupPromise(body.cancel(reason));
    else body?.destroy?.(new Error(reason));
  } catch {
    // Cancellation is best effort; the caller still returns only fixed evidence.
  }
}

async function readBoundedBody(response: CrawlFetchResponse, maximumBytes: number): Promise<string> {
  const body = response.body;
  if (!body) return "";
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  if (body.getReader) {
    const reader = body.getReader();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const value = chunk.value || new Uint8Array();
        bytes += value.byteLength;
        if (bytes > maximumBytes) {
          try {
            ignoreCleanupPromise(reader.cancel?.("response too large"));
          } catch {
            // Cancellation is best effort; classification stays deterministic.
          }
          throw new ResponseTooLargeError();
        }
        text += decoder.decode(value, { stream: true });
      }
      return text + decoder.decode();
    } finally {
      reader.releaseLock?.();
    }
  }
  if (body[Symbol.asyncIterator]) {
    for await (const rawChunk of body as AsyncIterable<Uint8Array | string>) {
      const value = typeof rawChunk === "string" ? new TextEncoder().encode(rawChunk) : rawChunk;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        cancelBody(response, "response too large");
        throw new ResponseTooLargeError();
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  }
  throw new Error("response body unavailable");
}

/** Fetch and stream a response under one deadline and deterministic byte cap. */
export async function fetchWithTimeout(
  fetchImpl: CrawlFetch,
  url: string,
  timeoutMs: number,
  maximumBytes = MAX_HTML_BODY_BYTES,
  resolvedAddress?: DnsAddress,
  shouldRead: (response: CrawlFetchResponse) => boolean = () => true
): Promise<FetchResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let activeResponse: CrawlFetchResponse | undefined;
  const request = Promise.resolve().then(async () => {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: "manual",
      ...(resolvedAddress ? { resolvedAddress } : {}),
    });
    activeResponse = response;
    if (isRedirectStatus(response.status) || !shouldRead(response)) {
      cancelBody(response, "response body not required");
      return { response };
    }
    const declared = declaredContentLength(response);
    if (declared !== null && declared > maximumBytes) {
      controller.abort();
      cancelBody(response, "response too large");
      throw new ResponseTooLargeError();
    }
    return { response, text: await readBoundedBody(response, maximumBytes) };
  });
  const deadlineMs = boundedInteger(timeoutMs, MAX_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const timedOut = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      cancelBody(activeResponse, "timeout");
      resolve(undefined);
    }, deadlineMs);
  });
  try {
    const result = await Promise.race([request, timedOut]);
    return result ?? { error: "timeout" };
  } catch (error) {
    if (error instanceof ResponseTooLargeError) return { error: "response too large" };
    return { error: "fetch failed" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Canonical guard shared by every public-page fetch or process boundary. */
export function isMutationPath(url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  for (let count = 0; count < 10; count += 1) {
    try {
      const decoded = decodeURIComponent(pathname);
      if (decoded === pathname) break;
      pathname = decoded;
    } catch {
      break;
    }
  }
  return pathname.replace(/\\/g, "/").split("/").some((segment) => MUTATION_SEGMENT.test(segment));
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

async function fetchSameOrigin(
  fetchImpl: CrawlFetch,
  resolveDns: DnsResolver,
  requestedUrl: string,
  origin: string,
  timeoutMs: number,
  bodyKind: BodyKind
): Promise<OriginFetchResult> {
  if (isMutationPath(requestedUrl)) return { error: "mutation-path excluded", redirectUrls: [] };
  const deadline = Date.now() + boundedInteger(timeoutMs, MAX_TIMEOUT_MS, MAX_TIMEOUT_MS);
  let currentUrl = requestedUrl;
  const redirectUrls = [requestedUrl];
  for (let count = 0; count < 10; count += 1) {
    let remaining = Math.floor(deadline - Date.now());
    if (remaining <= 0) return { error: "timeout", redirectUrls };
    let resolution;
    try {
      resolution = await resolvePublicHttpUrl(currentUrl, resolveDns, remaining);
    } catch {
      return { error: Date.now() >= deadline ? "timeout" : "unsafe network destination", redirectUrls };
    }
    remaining = Math.floor(deadline - Date.now());
    if (remaining <= 0) return { error: "timeout", redirectUrls };
    const maximumBytes = bodyKind === "robots"
      ? MAX_ROBOTS_BODY_BYTES
      : bodyKind === "sitemap"
        ? MAX_SITEMAP_BODY_BYTES
        : MAX_HTML_BODY_BYTES;
    const shouldReadBody = bodyKind === "html"
      ? isHtml
      : bodyKind === "robots"
        ? (response: CrawlFetchResponse) => response.status >= 200 && response.status < 300
        : () => true;
    const result = await fetchWithTimeout(
      fetchImpl,
      currentUrl,
      remaining,
      maximumBytes,
      resolution.addresses[0],
      shouldReadBody
    );
    if (!result.response) return { ...result, redirectUrls };
    const location = headerValue(result.response, "location");
    if (isRedirectStatus(result.response.status) && location) {
      const destination = sanitizeUrl(location, currentUrl);
      if (!destination || !sameOrigin(destination, origin)) return { error: "cross-origin redirect", redirectUrls };
      if (isMutationPath(destination)) return { error: "mutation-path excluded", redirectUrls };
      if (redirectUrls.includes(destination)) return { error: "redirect loop", redirectUrls };
      redirectUrls.push(destination);
      currentUrl = destination;
      continue;
    }
    const finalUrl = safeFinalUrl(result.response, currentUrl);
    if (!sameOrigin(finalUrl, origin)) return { error: "cross-origin redirect", redirectUrls };
    if (isMutationPath(finalUrl)) return { error: "mutation-path excluded", redirectUrls };
    remaining = Math.floor(deadline - Date.now());
    if (remaining <= 0) return { error: "timeout", redirectUrls };
    try {
      await resolvePublicHttpUrl(finalUrl, resolveDns, remaining);
    } catch {
      return { error: Date.now() >= deadline ? "timeout" : "unsafe network destination", redirectUrls };
    }
    if (finalUrl !== currentUrl) redirectUrls.push(finalUrl);
    return { ...result, finalUrl, redirectUrls };
  }
  return { error: "too many redirects", redirectUrls };
}

function pinnedLookup(address: DnsAddress): (...args: unknown[]) => void {
  return (_hostname: unknown, rawOptions: unknown, rawCallback?: unknown) => {
    const callback = typeof rawOptions === "function" ? rawOptions : rawCallback;
    if (typeof callback !== "function") return;
    if (rawOptions && typeof rawOptions === "object" && "all" in rawOptions && rawOptions.all) {
      callback(null, [address]);
    } else {
      callback(null, address.address, address.family);
    }
  };
}

const defaultCrawlFetch: CrawlFetch = async (value, init = {}) => {
  const url = new URL(value);
  const address = init.resolvedAddress;
  if (!address) throw new UnsafeNetworkTargetError();
  return new Promise<CrawlFetchResponse>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.1",
        "Accept-Encoding": "identity",
        "User-Agent": "TelegaTask-WGD/1.0",
      },
      signal: init.signal,
      lookup: pinnedLookup(address) as never,
    }, (response) => {
      resolve({
        status: response.statusCode || 0,
        url: value,
        headers: {
          get(name: string) {
            const header = response.headers[name.toLowerCase()];
            return Array.isArray(header) ? header.join(", ") : header == null ? null : String(header);
          },
        },
        body: response,
      });
    });
    request.on("error", reject);
    request.end();
  });
};

function fetchDependency(deps: CrawlFetch | CrawlSiteDependencies | undefined): CrawlFetch {
  if (typeof deps === "function") return deps;
  return deps?.fetch || defaultCrawlFetch;
}

function resolverDependency(deps: CrawlFetch | CrawlSiteDependencies | undefined): DnsResolver {
  return typeof deps === "function" ? defaultDnsResolver : deps?.resolveDns || defaultDnsResolver;
}

function extractRobotsSitemaps(text: string, baseUrl: string, origin: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (result.length >= MAX_SITEMAP_FILES) break;
    const match = /^\s*sitemap\s*:\s*(\S+)\s*$/i.exec(line);
    const url = match ? sanitizeUrl(match[1], baseUrl) : undefined;
    if (url && sameOrigin(url, origin) && !seen.has(url)) {
      seen.add(url);
      result.push(url);
    }
  }
  return result;
}

function extractSitemapLocations(
  xml: string,
  baseUrl: string,
  origin: string,
  limit: number,
  onUniqueUrl?: (url: string) => void
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const pattern = /<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) {
    const value = match[1].replace(/&amp;/gi, "&").trim();
    const url = sanitizeUrl(value, baseUrl);
    if (url && sameOrigin(url, origin) && !seen.has(url)) {
      seen.add(url);
      onUniqueUrl?.(url);
      if (result.length < limit) result.push(url);
    }
  }
  return result;
}

function isSitemapIndex(xml: string): boolean {
  return /<\s*sitemapindex\b/i.test(xml);
}

function collectDuplicates(pages: PageEvidence[], field: "title" | "description"): Record<string, string[]> {
  const occurrences = new Map<string, string[]>();
  for (const page of pages) {
    const value = page[field]?.trim();
    if (!value) continue;
    const urls = occurrences.get(value) ?? [];
    urls.push(page.finalUrl || page.requestedUrl);
    occurrences.set(value, urls);
  }
  return Object.fromEntries(Array.from(occurrences).filter(([, urls]) => urls.length > 1));
}

const DISCOVERY_SOURCE_ORDER: readonly PageDiscoverySource[] = ["start", "priority", "sitemap", "internal_link"];

function addDiscoverySource(
  sources: Map<string, Set<PageDiscoverySource>>,
  url: string,
  source: PageDiscoverySource
): void {
  const values = sources.get(url) ?? new Set<PageDiscoverySource>();
  values.add(source);
  sources.set(url, values);
}

function pageGraphEvidence(
  pages: PageEvidence[],
  startUrl: string,
  sources: Map<string, Set<PageDiscoverySource>>
): PageEvidence[] {
  const identityToPage = new Map<string, number>();
  pages.forEach((page, index) => {
    if (page.requestedUrl && !identityToPage.has(page.requestedUrl)) identityToPage.set(page.requestedUrl, index);
  });
  pages.forEach((page, index) => {
    if (page.finalUrl && !identityToPage.has(page.finalUrl)) identityToPage.set(page.finalUrl, index);
  });

  const inbound = pages.map(() => new Set<number>());
  pages.forEach((page, sourceIndex) => {
    for (const link of page.internalLinks ?? []) {
      const targetIndex = identityToPage.get(link);
      if (targetIndex !== undefined && targetIndex !== sourceIndex) inbound[targetIndex].add(sourceIndex);
    }
  });

  const depths = new Map<number, number>();
  const startIndex = identityToPage.get(startUrl);
  const queue: number[] = [];
  if (startIndex !== undefined) {
    depths.set(startIndex, 0);
    queue.push(startIndex);
  }
  while (queue.length) {
    const sourceIndex = queue.shift()!;
    const nextDepth = (depths.get(sourceIndex) ?? 0) + 1;
    for (const link of pages[sourceIndex].internalLinks ?? []) {
      const targetIndex = identityToPage.get(link);
      if (targetIndex === undefined || (depths.get(targetIndex) ?? Number.POSITIVE_INFINITY) <= nextDepth) continue;
      depths.set(targetIndex, nextDepth);
      queue.push(targetIndex);
    }
  }

  return pages.map((page, index) => {
    const collectedSources = new Set<PageDiscoverySource>();
    for (const identity of [page.requestedUrl, page.finalUrl]) {
      for (const source of sources.get(identity) ?? []) collectedSources.add(source);
    }
    const discoverySources = DISCOVERY_SOURCE_ORDER.filter((source) => collectedSources.has(source));
    const inboundInternalLinks = inbound[index].size;
    const orphanCandidate = index !== startIndex
      && (collectedSources.has("priority") || collectedSources.has("sitemap"))
      && inboundInternalLinks === 0;
    const { depth: _provisionalDepth, ...withoutDepth } = page;
    const depth = depths.get(index);
    return {
      ...withoutDepth,
      ...(depth !== undefined ? { depth } : {}),
      discoverySources,
      inboundInternalLinks,
      orphanCandidate,
    };
  });
}

function safeFinalUrl(response: CrawlFetchResponse, requestedUrl: string): string {
  return sanitizeUrl(response.url ?? requestedUrl) ?? requestedUrl;
}

async function collectRobots(
  fetchImpl: CrawlFetch,
  resolveDns: DnsResolver,
  robotsUrl: string,
  origin: string,
  timeoutMs: number
): Promise<RobotsCollection> {
  const result = await fetchSameOrigin(fetchImpl, resolveDns, robotsUrl, origin, timeoutMs, "robots");
  if (!result.response) {
    return {
      evidence: { url: robotsUrl, sitemapUrls: [], error: result.error },
      body: "",
      accessState: "unavailable",
    };
  }
  const measured = (result.response.status >= 200 && result.response.status < 300)
    || result.response.status === 404
    || result.response.status === 410;
  return {
    evidence: {
      url: robotsUrl,
      status: result.response.status,
      sitemapUrls: result.response.status >= 200 && result.response.status < 300
        ? extractRobotsSitemaps(result.text ?? "", robotsUrl, origin)
        : [],
    },
    body: result.response.status >= 200 && result.response.status < 300 ? result.text ?? "" : "",
    accessState: measured ? "measured" : "unavailable",
  };
}

async function collectSitemaps(
  fetchImpl: CrawlFetch,
  resolveDns: DnsResolver,
  candidates: Array<{ url: string; source: SitemapCandidate["source"] }>,
  origin: string,
  timeoutMs: number,
  maximumPageUrls: number,
  onUniquePageUrl?: (url: string) => void
): Promise<SitemapCandidate[]> {
  const output: SitemapCandidate[] = [];
  const seen = new Set<string>();
  const queue = [...candidates];
  let remainingPageUrls = maximumPageUrls;
  while (queue.length && output.length < MAX_SITEMAP_FILES) {
    const next = queue.shift()!;
    if (seen.has(next.url)) continue;
    seen.add(next.url);
    const result = await fetchSameOrigin(fetchImpl, resolveDns, next.url, origin, timeoutMs, "sitemap");
    if (!result.response) {
      output.push({ url: next.url, source: next.source, urls: [], error: result.error });
      continue;
    }
    const xml = result.text ?? "";
    const index = result.response.status >= 200 && result.response.status < 300 && isSitemapIndex(xml);
    const locationLimit = index ? MAX_SITEMAP_FILES : remainingPageUrls;
    const urls = result.response.status >= 200 && result.response.status < 300
      ? extractSitemapLocations(xml, next.url, origin, locationLimit, index ? undefined : onUniquePageUrl)
      : [];
    if (!index) remainingPageUrls -= urls.length;
    output.push({ url: next.url, source: next.source, status: result.response.status, urls, isIndex: index });
    if (index) {
      for (const url of urls) queue.push({ url, source: "sitemap" });
    }
  }
  return output;
}

/** Crawl a sanitized same-origin URL graph with bounded requests and evidence aggregation. */
export async function crawlSite(
  options: CrawlSiteOptions,
  deps?: CrawlFetch | CrawlSiteDependencies
): Promise<CrawlEvidence> {
  const startUrl = sanitizeUrl(options.startUrl);
  if (!startUrl) throw new Error("startUrl must be an absolute HTTP(S) URL");
  const origin = new URL(startUrl).origin;
  const fetchImpl = fetchDependency(deps);
  const resolveDns = resolverDependency(deps);
  const timeoutMs = boundedInteger(options.timeoutMs, MAX_TIMEOUT_MS, MAX_TIMEOUT_MS);
  await resolvePublicHttpUrl(startUrl, resolveDns, timeoutMs);
  if (isMutationPath(startUrl)) {
    const robotsUserAgent = options.robotsUserAgent;
    return {
      attemptedUrlCount: 0,
      eligibleDiscoveredCount: 0,
      droppedEligibleCount: 0,
      truncated: false,
      pages: [],
      robots: {
        url: new URL("/robots.txt", origin).toString(),
        sitemapUrls: [],
        access: { state: "unavailable", userAgent: robotsUserAgent, checkedUrlCount: 0, blockedUrls: [] },
        error: "mutation-path excluded",
      },
      sitemapCandidates: [],
      discoveredUrls: [],
      excludedUrls: [startUrl],
      brokenUrls: [],
      redirectChains: [],
      duplicateTitles: {},
      duplicateDescriptions: {},
      limitations: ["Start URL excluded by mutation-path policy."],
    };
  }
  const limit = boundedInteger(options.limit, MAX_PAGE_LIMIT, MAX_PAGE_LIMIT);
  const concurrency = boundedInteger(options.concurrency, MAX_CONCURRENCY, 1);
  const limitations: string[] = [];
  const excludedUrls: string[] = [];
  const excludedSeen = new Set<string>();
  const discoverySources = new Map<string, Set<PageDiscoverySource>>();
  const eligibleUrls = new Set<string>();
  const admittedUrls = new Set<string>();
  const discoveredUrls: string[] = [];
  let frontier: QueuedUrl[] = [];
  let discoveryOrder = 0;
  const addExcluded = (url: string) => {
    if (!excludedSeen.has(url) && excludedUrls.length < limit) {
      excludedSeen.add(url);
      excludedUrls.push(url);
    }
  };
  const observeEligible = (url: string, source: PageDiscoverySource): boolean => {
    if (isMutationPath(url)) {
      addExcluded(url);
      return false;
    }
    eligibleUrls.add(url);
    addDiscoverySource(discoverySources, url, source);
    return true;
  };
  const admit = (url: string, depth: number | undefined): void => {
    if (admittedUrls.has(url) || admittedUrls.size >= limit) return;
    admittedUrls.add(url);
    discoveredUrls.push(url);
    frontier.push({
      url,
      ...(depth !== undefined ? { depth } : {}),
      discoveryOrder,
    });
    discoveryOrder += 1;
  };
  observeEligible(startUrl, "start");
  admit(startUrl, 0);
  if (options.limit > MAX_PAGE_LIMIT) limitations.push(`Page crawl capped at ${MAX_PAGE_LIMIT} URLs.`);
  if (options.concurrency > MAX_CONCURRENCY) limitations.push(`Crawl concurrency capped at ${MAX_CONCURRENCY}.`);

  let recordedInvalidPriority = false;
  for (const rawPriority of options.priorityUrls ?? []) {
    const url = sanitizeUrl(rawPriority);
    if (!url) {
      if (!recordedInvalidPriority) {
        limitations.push("A priority URL was skipped because it was not a valid HTTP(S) URL.");
        recordedInvalidPriority = true;
      }
      continue;
    }
    if (!sameOrigin(url, origin)) {
      addExcluded(url);
      continue;
    }
    if (!observeEligible(url, "priority")) continue;
    admit(url, url === startUrl ? 0 : undefined);
  }

  const robotsUrl = new URL("/robots.txt", origin).toString();
  const robotsCollection = await collectRobots(fetchImpl, resolveDns, robotsUrl, origin, timeoutMs);
  const robots = robotsCollection.evidence;
  if (robots.error === "response too large") {
    limitations.push(`robots.txt response exceeded the ${MAX_ROBOTS_BODY_BYTES}-byte download limit.`);
  }
  const sitemapSeeds = [
    ...COMMON_SITEMAP_PATHS.map((path) => ({ url: new URL(path, origin).toString(), source: "common" as const })),
    ...robots.sitemapUrls.map((url) => ({ url, source: "robots" as const })),
  ];
  const sitemapCandidates = await collectSitemaps(
    fetchImpl,
    resolveDns,
    sitemapSeeds,
    origin,
    timeoutMs,
    Math.max(0, limit - admittedUrls.size),
    (url) => { observeEligible(url, "sitemap"); }
  );
  for (const candidate of sitemapCandidates) {
    if (candidate.error === "response too large") {
      limitations.push(`Sitemap response exceeded the ${MAX_SITEMAP_BODY_BYTES}-byte download limit for ${candidate.url}.`);
    }
  }
  const sitemapPageUrls = sitemapCandidates
    .filter((candidate) => !candidate.isIndex)
    .flatMap((candidate) => candidate.urls)
    .filter((url) => {
      return !isMutationPath(url);
    });
  for (const url of sitemapPageUrls) admit(url, undefined);
  const pages: PageEvidence[] = [];
  const brokenUrls: string[] = [];
  const redirectChains: CrawlEvidence["redirectChains"] = [];
  let attempted = 0;

  while (frontier.length && attempted < limit) {
    const batch = frontier.splice(0, Math.min(concurrency, limit - attempted));
    attempted += batch.length;
    const results = await Promise.all(batch.map(async (item) => ({
      item,
      result: await fetchSameOrigin(fetchImpl, resolveDns, item.url, origin, timeoutMs, "html"),
    })));
    const nextFrontier: QueuedUrl[] = [];

    for (const { item, result } of results) {
      if (!result.response) {
        pages.push({
          requestedUrl: item.url,
          finalUrl: item.url,
          status: 0,
          indexable: false,
          signalConflicts: [],
          depth: item.depth,
          discoveryOrder: item.discoveryOrder,
          error: result.error,
        });
        brokenUrls.push(item.url);
        if (result.error === "response too large") {
          limitations.push(`HTML response exceeded the ${MAX_HTML_BODY_BYTES}-byte download limit for ${item.url}.`);
        }
        continue;
      }
      const response = result.response;
      const finalUrl = result.finalUrl ?? item.url;
      if (result.redirectUrls.length > 1) redirectChains.push({ requestedUrl: item.url, finalUrl, urls: result.redirectUrls });
      if (response.status >= 400) brokenUrls.push(item.url);
      if (!isHtml(response)) continue;

      const html = result.text ?? "";
      const page = {
        ...analyzeHtmlPage(
          {
            requestedUrl: item.url,
            finalUrl,
            status: response.status,
            headers: {
              "content-type": headerValue(response, "content-type"),
              "x-robots-tag": headerValue(response, "x-robots-tag"),
            },
            html,
          },
          {
            maxInternalLinks: limit,
            maxExternalLinks: limit,
            keywords: options.keywords,
            onDiscoveredInternalUrl: (url) => { observeEligible(url, "internal_link"); },
          }
        ),
        depth: item.depth,
        discoveryOrder: item.discoveryOrder,
      };
      pages.push(page);
      if (page.linksTruncated) limitations.push(`Link evidence truncated for ${item.url}.`);
      for (const link of page.internalLinks ?? []) {
        if (!sameOrigin(link, origin)) continue;
        if (isMutationPath(link)) {
          addExcluded(link);
          continue;
        }
        if (admittedUrls.has(link) || admittedUrls.size >= limit) continue;
        admittedUrls.add(link);
        discoveredUrls.push(link);
        nextFrontier.push({
          url: link,
          ...(typeof item.depth === "number" ? { depth: item.depth + 1 } : {}),
          discoveryOrder,
        });
        discoveryOrder += 1;
      }
    }
    frontier.push(...nextFrontier);
  }
  const droppedEligibleCount = eligibleUrls.size - admittedUrls.size;
  const truncated = droppedEligibleCount > 0;
  if (truncated) limitations.push(`Page crawl truncated after ${attempted} URLs.`);

  const enrichedPages = pageGraphEvidence(pages, startUrl, discoverySources);
  const robotsPolicy = robotsCollection.accessState === "measured"
    ? robotsParser(robotsUrl, robotsCollection.body)
    : undefined;
  const robotsAccess: RobotsAccessEvidence = robotsCollection.accessState === "measured"
    ? {
        state: "measured",
        userAgent: options.robotsUserAgent,
        checkedUrlCount: admittedUrls.size,
        blockedUrls: [...admittedUrls].filter((url) =>
          robotsPolicy?.isAllowed(url, options.robotsUserAgent) === false
        ),
      }
    : {
        state: "unavailable",
        userAgent: options.robotsUserAgent,
        checkedUrlCount: 0,
        blockedUrls: [],
      };

  return {
    attemptedUrlCount: attempted,
    eligibleDiscoveredCount: eligibleUrls.size,
    droppedEligibleCount,
    truncated,
    pages: enrichedPages,
    robots: { ...robots, access: robotsAccess },
    sitemapCandidates,
    discoveredUrls,
    excludedUrls,
    brokenUrls,
    redirectChains,
    duplicateTitles: collectDuplicates(enrichedPages, "title"),
    duplicateDescriptions: collectDuplicates(enrichedPages, "description"),
    limitations,
  };
}
