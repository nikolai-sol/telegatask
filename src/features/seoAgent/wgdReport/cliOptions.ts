import type { CoverageState, WgdMarket, WgdReportOptions } from "./types";
import { isForbiddenHostname, isPublicIpAddress } from "./networkSafety";
import { isIP } from "node:net";

const DEFAULT_REGION = "225";
const DEFAULT_CRAWL_LIMIT = 100;
const DEFAULT_LIGHTHOUSE_PAGE_LIMIT = 6;
const DEFAULT_OUT_DIR = "reports";
export const MAX_WGD_KEYWORDS = 50;
export const MAX_WGD_AI_QUERIES = 20;
export const MAX_WGD_KEYWORD_LENGTH = 200;
export const MAX_WGD_AI_QUERY_LENGTH = 1000;

const MARKET_VALUES: readonly WgdMarket[] = ["RU", "AT", "DE", "OTHER"];

type OptionName =
  | "url"
  | "market"
  | "language"
  | "region"
  | "crawl-limit"
  | "lighthouse-page-limit"
  | "keyword"
  | "ai-query"
  | "priority-url"
  | "out-dir";

function isOptionName(value: string): value is OptionName {
  return [
    "url",
    "market",
    "language",
    "region",
    "crawl-limit",
    "lighthouse-page-limit",
    "keyword",
    "ai-query",
    "priority-url",
    "out-dir",
  ].includes(value);
}

function usageError(message: string): never {
  throw new Error(`Invalid WGD report options: ${message}`);
}

function requiredValue(argv: readonly string[], index: number, name: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    usageError(`--${name} requires a value`);
  }
  return value;
}

function boundedPositiveInteger(value: string, name: string, maximum: number): number {
  if (!/^\d+$/.test(value)) {
    usageError(`--${name} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    usageError(`--${name} must be a positive integer`);
  }
  if (parsed > maximum) {
    usageError(`--${name} must be at most ${maximum}`);
  }
  return parsed;
}

function normalizeUrl(raw: string, optionName: string): URL {
  const value = raw.trim();
  if (!value) {
    usageError(`--${optionName} requires a non-empty URL`);
  }

  let parsed: URL;
  try {
    // Treat any explicit URI scheme as intentional. This ensures `mailto:`
    // and `file:` are rejected instead of accidentally becoming hostnames
    // such as `https://mailto:test`.
    parsed = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
  } catch {
    usageError(`--${optionName} must be a valid HTTP or HTTPS URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    usageError(`--${optionName} must use HTTP or HTTPS`);
  }
  if (parsed.username || parsed.password || parsed.search) {
    usageError(`--${optionName} must not contain credentials or query parameters`);
  }

  // Fragments are client-only and cannot be crawled. URL normalizes the root
  // path to a trailing slash, giving stable artifact names and comparisons.
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (isForbiddenHostname(hostname) || (isIP(hostname) !== 0 && !isPublicIpAddress(hostname))) {
    usageError(`--${optionName} must target a public internet host`);
  }
  return parsed;
}

function sanitizeOutputRoot(raw: string): string {
  const value = raw.trim();
  if (!value) {
    return DEFAULT_OUT_DIR;
  }
  if (value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value)) {
    usageError("--out-dir must be a relative path");
  }
  const segments = value.replace(/\\/g, "/").split("/");
  if (segments.some((segment) => segment === "..")) {
    usageError("--out-dir must not contain '..'");
  }
  const sanitized = segments.filter((segment) => segment && segment !== ".").join("/");
  return sanitized || DEFAULT_OUT_DIR;
}

function appendBoundedQuery(
  output: string[],
  seen: Set<string>,
  raw: string,
  optionName: "keyword" | "ai-query",
  maximumCount: number,
  maximumLength: number
): void {
  const value = raw.trim();
  if (!value) usageError(`--${optionName} requires a non-empty value`);
  if (value.length > maximumLength) {
    usageError(`--${optionName} must be at most ${maximumLength} characters`);
  }
  const key = value.normalize("NFKC").toLocaleLowerCase("en-US");
  if (seen.has(key)) return;
  if (output.length >= maximumCount) {
    usageError(`--${optionName} may be provided at most ${maximumCount} times`);
  }
  seen.add(key);
  output.push(value);
}

/**
 * Parse the intentionally small WGD CLI surface without external packages.
 * Repeating a list option preserves argument order, which makes report runs
 * deterministic and keeps explicit Lighthouse priorities stable.
 */
export function parseWgdCliOptions(argv: readonly string[]): WgdReportOptions {
  let rawUrl: string | undefined;
  let market: WgdMarket = "RU";
  let language = "ru";
  let region = DEFAULT_REGION;
  let crawlLimit = DEFAULT_CRAWL_LIMIT;
  let lighthousePageLimit = DEFAULT_LIGHTHOUSE_PAGE_LIMIT;
  let outDir = DEFAULT_OUT_DIR;
  const keywords: string[] = [];
  const aiQueries: string[] = [];
  const keywordKeys = new Set<string>();
  const aiQueryKeys = new Set<string>();
  const priorityUrls: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      usageError(`unexpected argument '${token}'`);
    }
    const name = token.slice(2);
    if (!isOptionName(name)) {
      usageError(`unknown option '${token}'`);
    }
    const value = requiredValue(argv, index, name);
    index += 1;

    switch (name) {
      case "url":
        if (rawUrl !== undefined) usageError("--url may only be provided once");
        rawUrl = value;
        break;
      case "market": {
        const normalized = value.toUpperCase() as WgdMarket;
        if (!MARKET_VALUES.includes(normalized)) {
          usageError(`--market must be one of ${MARKET_VALUES.join(", ")}`);
        }
        market = normalized;
        break;
      }
      case "language":
        language = value.toLowerCase();
        if (!/^[a-z]{2,3}(?:-[a-z]{2})?$/.test(language)) {
          usageError("--language must be a language code");
        }
        break;
      case "region":
        region = value.trim();
        if (!region) usageError("--region requires a non-empty value");
        break;
      case "crawl-limit":
        crawlLimit = boundedPositiveInteger(value, name, DEFAULT_CRAWL_LIMIT);
        break;
      case "lighthouse-page-limit":
        lighthousePageLimit = boundedPositiveInteger(value, name, DEFAULT_LIGHTHOUSE_PAGE_LIMIT);
        break;
      case "keyword":
        appendBoundedQuery(
          keywords,
          keywordKeys,
          value,
          "keyword",
          MAX_WGD_KEYWORDS,
          MAX_WGD_KEYWORD_LENGTH
        );
        break;
      case "ai-query":
        appendBoundedQuery(
          aiQueries,
          aiQueryKeys,
          value,
          "ai-query",
          MAX_WGD_AI_QUERIES,
          MAX_WGD_AI_QUERY_LENGTH
        );
        break;
      case "priority-url":
        priorityUrls.push(normalizeUrl(value, name).toString());
        break;
      case "out-dir":
        outDir = sanitizeOutputRoot(value);
        break;
      default:
        // Exhaustiveness is enforced by isOptionName and the switch above.
        usageError(`unknown option '--${name}'`);
    }
  }

  if (!rawUrl) {
    usageError("--url is required");
  }
  const normalizedUrl = normalizeUrl(rawUrl, "url");
  const domain = normalizedUrl.hostname;
  const dataForSeo: CoverageState = market === "RU" || language === "ru" ? "not_applicable" : "unavailable";

  return {
    url: normalizedUrl.toString(),
    domain,
    market,
    language,
    region,
    crawlLimit,
    lighthousePageLimit,
    keywords,
    aiQueries,
    priorityUrls,
    outDir,
    sources: { dataForSeo },
  };
}
