import type { SeoDeviceType, SeoRankProviderStatus, YandexRankCheck } from "../types";
import { normalizeProviderDomain, SeoProviderError } from "./seoDataProvider";
import { isMatchingTargetDomain, normalizeResultDomain } from "./serpMatching";
import {
  fetchBoundedProviderText,
  ProviderBodyLimitError,
  ProviderDeadlineError,
  withProviderDeadline,
} from "./boundedProviderHttp";

type YandexSerpRankRunResult = {
  checks: YandexRankCheck[];
  status: SeoRankProviderStatus;
};

type YandexSearchResponse = {
  id?: string;
  done?: boolean;
  response?: {
    rawData?: string;
  };
};

export type YandexSerpRankEnv = Partial<Record<
  | "YANDEX_SEARCH_API_KEY"
  | "YANDEX_SEARCH_FOLDER_ID"
  | "YANDEX_SEARCH_DEFAULT_REGION"
  | "YANDEX_SEARCH_DEFAULT_LANGUAGE"
  | "YANDEX_SEARCH_DEFAULT_DEVICE"
  | "YANDEX_SEARCH_MODE"
  | "SEO_MATCH_SUBDOMAINS",
  string | undefined
>>;

export type YandexSerpFetch = (url: string, init?: RequestInit) => Promise<Response>;
export type YandexSerpSleep = (ms: number) => Promise<void>;

export type YandexSerpRankSourceDeps = {
  env?: YandexSerpRankEnv;
  fetchImpl?: YandexSerpFetch;
  sleepImpl?: YandexSerpSleep;
  requestTimeoutMs?: number;
  overallTimeoutMs?: number;
  maxResponseBytes?: number;
};

export const YANDEX_SERP_REQUEST_TIMEOUT_MS = 15_000;
export const YANDEX_SERP_OVERALL_TIMEOUT_MS = 75_000;
export const YANDEX_SERP_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const YANDEX_SERP_CHECKED_DEPTH = 20;

function isoNow(): string {
  return new Date().toISOString();
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function boundedDependencyValue(value: number | undefined, maximum: number): number {
  if (!Number.isFinite(value)) return maximum;
  return Math.min(maximum, Math.max(1, Math.floor(value!)));
}

function readDevice(value: unknown): SeoDeviceType {
  return value === "mobile" ? "mobile" : "desktop";
}

function readSearchTypeAndLocalization(languageInput: string): {
  searchType: "SEARCH_TYPE_RU" | "SEARCH_TYPE_TR" | "SEARCH_TYPE_COM" | "SEARCH_TYPE_KK";
  localization:
    | "LOCALIZATION_RU"
    | "LOCALIZATION_UK"
    | "LOCALIZATION_BE"
    | "LOCALIZATION_KK"
    | "LOCALIZATION_TR"
    | "LOCALIZATION_EN";
} {
  const language = cleanString(languageInput).toLowerCase();
  if (language === "tr") return { searchType: "SEARCH_TYPE_TR", localization: "LOCALIZATION_TR" };
  if (language === "kk") return { searchType: "SEARCH_TYPE_KK", localization: "LOCALIZATION_KK" };
  if (language === "uk") return { searchType: "SEARCH_TYPE_RU", localization: "LOCALIZATION_UK" };
  if (language === "be") return { searchType: "SEARCH_TYPE_RU", localization: "LOCALIZATION_BE" };
  if (language === "en") return { searchType: "SEARCH_TYPE_COM", localization: "LOCALIZATION_EN" };
  return { searchType: "SEARCH_TYPE_RU", localization: "LOCALIZATION_RU" };
}

function decodeRawData(rawData: string, maximumBytes: number): string {
  const value = cleanString(rawData);
  if (!value) return "";
  if (Buffer.byteLength(value, "utf8") > maximumBytes) throw new ProviderBodyLimitError();
  if (value.startsWith("<")) return value;
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8").trim();
    if (Buffer.byteLength(decoded, "utf8") > maximumBytes) throw new ProviderBodyLimitError();
    return decoded || value;
  } catch (error) {
    if (error instanceof ProviderBodyLimitError) throw error;
    return value;
  }
}

function readProcessEnv(): YandexSerpRankEnv {
  return {
    YANDEX_SEARCH_API_KEY: process.env.YANDEX_SEARCH_API_KEY,
    YANDEX_SEARCH_FOLDER_ID: process.env.YANDEX_SEARCH_FOLDER_ID,
    YANDEX_SEARCH_DEFAULT_REGION: process.env.YANDEX_SEARCH_DEFAULT_REGION,
    YANDEX_SEARCH_DEFAULT_LANGUAGE: process.env.YANDEX_SEARCH_DEFAULT_LANGUAGE,
    YANDEX_SEARCH_DEFAULT_DEVICE: process.env.YANDEX_SEARCH_DEFAULT_DEVICE,
    YANDEX_SEARCH_MODE: process.env.YANDEX_SEARCH_MODE,
    SEO_MATCH_SUBDOMAINS: process.env.SEO_MATCH_SUBDOMAINS,
  };
}

function defaultFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, init);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasCredentials(env: YandexSerpRankEnv): boolean {
  return Boolean(cleanString(env.YANDEX_SEARCH_API_KEY) && cleanString(env.YANDEX_SEARCH_FOLDER_ID));
}

function providerStatus(state: SeoRankProviderStatus["state"], message: string, metricsSummary?: Record<string, string | number | boolean | null>, errorCode?: string): SeoRankProviderStatus {
  return {
    state,
    message,
    checkedAt: isoNow(),
    ...(errorCode ? { errorCode } : {}),
    ...(metricsSummary ? { metricsSummary } : {}),
  };
}

function xmlEntries(xml: string): Array<{ domain: string; url: string; title?: string; snippet?: string }> {
  const docs = Array.from(xml.matchAll(/<doc(?:\s[^>]*)?>[\s\S]*?<\/doc>/g)).map((match) => match[0]);
  return docs.map((doc) => {
    const url = cleanString((doc.match(/<url>([\s\S]*?)<\/url>/i) || [])[1]);
    const domain = normalizeResultDomain(url);
    const title = cleanString((doc.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]);
    const snippet = cleanString((doc.match(/<headline>([\s\S]*?)<\/headline>/i) || [])[1]);
    return { domain, url, ...(title ? { title } : {}), ...(snippet ? { snippet } : {}) };
  });
}

function parseYandexResponse(text: string): YandexSearchResponse {
  try {
    return JSON.parse(text || "{}") as YandexSearchResponse;
  } catch (error) {
    if (error instanceof ProviderBodyLimitError) throw error;
    throw new SeoProviderError({
      category: "yandex_serp_invalid_json",
      safeMessage: "Yandex rank tracking returned invalid data",
      statusCode: 503,
    });
  }
}

async function pollDeferredResult(
  operationId: string,
  apiKey: string,
  fetchImpl: YandexSerpFetch,
  sleepImpl: YandexSerpSleep,
  requestTimeoutMs: number,
  overallDeadline: number,
  maximumBytes: number
): Promise<YandexSearchResponse> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const remaining = overallDeadline - Date.now();
    if (remaining <= 0) throw new ProviderDeadlineError();
    const { text } = await fetchBoundedProviderText(
      fetchImpl,
      `https://operation.api.cloud.yandex.net/operations/${encodeURIComponent(operationId)}`,
      { headers: { Authorization: `Api-Key ${apiKey}` } },
      { timeoutMs: Math.min(requestTimeoutMs, remaining), maximumBytes }
    );
    const payload = parseYandexResponse(text);
    if (payload.done && payload.response?.rawData) return payload;
    const sleepBudget = overallDeadline - Date.now();
    if (sleepBudget <= 0) throw new ProviderDeadlineError();
    await withProviderDeadline(sleepImpl(Math.min(1500, sleepBudget)), sleepBudget);
  }
  throw new SeoProviderError({
    category: "yandex_serp_provider_error",
    safeMessage: "Yandex rank tracking deferred search did not finish in time",
    statusCode: 503,
  });
}

export class YandexSerpRankSource {
  private readonly injectedEnv?: YandexSerpRankEnv;
  private readonly fetchImpl: YandexSerpFetch;
  private readonly sleepImpl: YandexSerpSleep;
  private readonly requestTimeoutMs: number;
  private readonly overallTimeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(deps: YandexSerpRankSourceDeps = {}) {
    this.injectedEnv = deps.env;
    this.fetchImpl = deps.fetchImpl || defaultFetch;
    this.sleepImpl = deps.sleepImpl || defaultSleep;
    this.requestTimeoutMs = boundedDependencyValue(deps.requestTimeoutMs, YANDEX_SERP_REQUEST_TIMEOUT_MS);
    this.overallTimeoutMs = boundedDependencyValue(deps.overallTimeoutMs, YANDEX_SERP_OVERALL_TIMEOUT_MS);
    this.maxResponseBytes = boundedDependencyValue(deps.maxResponseBytes, YANDEX_SERP_MAX_RESPONSE_BYTES);
  }

  async run(input: {
    targetDomain: string;
    targetDomainAliases?: string[];
    keywords: string[];
    region?: string | null;
    language?: string | null;
    device?: SeoDeviceType | null;
  }): Promise<YandexSerpRankRunResult> {
    const env = this.injectedEnv || readProcessEnv();
    if (!hasCredentials(env)) {
      return {
        checks: [],
        status: providerStatus(
          "missing_credentials",
          "Yandex Search API credentials are not configured",
          undefined,
          "YANDEX_SEARCH_MISSING_CREDENTIALS"
        ),
      };
    }

    const keywords = Array.from(new Set((input.keywords || []).map((item) => cleanString(item)).filter(Boolean)));
    if (keywords.length === 0) {
      return {
        checks: [],
        status: providerStatus(
          "no_keywords",
          "No tracking keywords were provided for Yandex rank checks",
          undefined,
          "YANDEX_SEARCH_NO_KEYWORDS"
        ),
      };
    }

    const apiKey = cleanString(env.YANDEX_SEARCH_API_KEY);
    const folderId = cleanString(env.YANDEX_SEARCH_FOLDER_ID);
    const region = cleanString(input.region) || cleanString(env.YANDEX_SEARCH_DEFAULT_REGION) || "225";
    const language = cleanString(input.language) || cleanString(env.YANDEX_SEARCH_DEFAULT_LANGUAGE) || "ru";
    const { searchType, localization } = readSearchTypeAndLocalization(language);
    const device = readDevice(input.device || env.YANDEX_SEARCH_DEFAULT_DEVICE);
    const mode = cleanString(env.YANDEX_SEARCH_MODE).toLowerCase() === "sync" ? "sync" : "deferred";
    const allowSubdomains = String(env.SEO_MATCH_SUBDOMAINS || "").trim().toLowerCase() === "true";

    const checks: YandexRankCheck[] = [];
    let failedCount = 0;
    let limitExceeded = false;
    const overallDeadline = Date.now() + this.overallTimeoutMs;

    for (const keyword of keywords) {
      try {
        const remaining = overallDeadline - Date.now();
        if (remaining <= 0) throw new ProviderDeadlineError();
        const { response, text } = await fetchBoundedProviderText(
          this.fetchImpl,
          `https://searchapi.api.cloud.yandex.net/v2/web/${mode === "sync" ? "search" : "searchAsync"}`,
          {
            method: "POST",
            headers: {
              Authorization: `Api-Key ${apiKey}`,
              "x-folder-id": folderId,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query: {
                searchType,
                queryText: keyword,
                page: 0,
                fixTypoMode: "FIX_TYPO_MODE_ON",
              },
              groupSpec: {
                groupMode: "GROUP_MODE_FLAT",
                groupsOnPage: YANDEX_SERP_CHECKED_DEPTH,
                docsInGroup: 1,
              },
              ...(region ? { region } : {}),
              l10n: localization,
              folderId,
              responseFormat: "FORMAT_XML",
            }),
          },
          {
            timeoutMs: Math.min(this.requestTimeoutMs, remaining),
            maximumBytes: this.maxResponseBytes,
          }
        );
        if (response.status === 402 || response.status === 429) {
          limitExceeded = true;
          failedCount += 1;
          continue;
        }
        if (!response.ok) {
          failedCount += 1;
          continue;
        }

        let payload = parseYandexResponse(text);
        if (mode === "deferred") {
          const operationId = cleanString(payload.id);
          if (!operationId) {
            failedCount += 1;
            continue;
          }
          payload = await pollDeferredResult(
            operationId,
            apiKey,
            this.fetchImpl,
            this.sleepImpl,
            this.requestTimeoutMs,
            overallDeadline,
            this.maxResponseBytes
          );
        }

        const rawData = decodeRawData(cleanString(payload.response?.rawData), this.maxResponseBytes);
        if (!rawData) {
          failedCount += 1;
          continue;
        }

        const entries = xmlEntries(rawData).slice(0, YANDEX_SERP_CHECKED_DEPTH);
        const matchedIndex = entries.findIndex((entry) =>
          isMatchingTargetDomain({
            targetDomain: input.targetDomain,
            targetDomainAliases: input.targetDomainAliases,
            resultDomain: entry.domain,
            resultUrl: entry.url,
            allowSubdomains,
          })
        );
        const matched = matchedIndex >= 0 ? entries[matchedIndex] : null;
        const competitorsAbove = matchedIndex > 0
          ? entries.slice(0, matchedIndex).slice(0, 5).map((entry, index) => ({
              position: index + 1,
              domain: entry.domain,
              url: entry.url,
              ...(entry.title ? { title: entry.title } : {}),
            }))
          : [];

        checks.push({
          query: keyword,
          searchEngine: "yandex",
          provider: "yandex_search_api",
          checkedDepth: YANDEX_SERP_CHECKED_DEPTH,
          targetDomain: normalizeProviderDomain(input.targetDomain),
          found: Boolean(matched),
          ...(matchedIndex >= 0 ? { position: matchedIndex + 1 } : {}),
          ...(matched?.url ? { matchedUrl: matched.url } : {}),
          ...(matched?.title ? { title: matched.title } : {}),
          ...(matched?.snippet ? { snippet: matched.snippet } : {}),
          ...(competitorsAbove.length > 0 ? { competitorsAbove } : {}),
          serpFeatures: [],
          topResultDomains: entries
            .map((entry) => entry.domain)
            .filter(Boolean)
            .slice(0, 5),
          region,
          language,
          device,
          checkedAt: isoNow(),
        });
      } catch (error) {
        failedCount += 1;
        continue;
      }
    }

    const foundCount = checks.filter((item) => item.found).length;
    const metricsSummary = {
      queryCount: keywords.length,
      foundCount,
      missingCount: Math.max(0, checks.length - foundCount),
      failedCount,
    };

    if (limitExceeded) {
      return {
        checks,
        status: providerStatus(
          checks.length > 0 ? "partial_success" : "limit_exceeded",
          "Yandex rank tracking limit exceeded",
          metricsSummary,
          "YANDEX_SEARCH_LIMIT_EXCEEDED"
        ),
      };
    }

    if (failedCount > 0) {
      return {
        checks,
        status: providerStatus("partial_success", "Yandex rank tracking partially succeeded", metricsSummary, "YANDEX_SEARCH_PARTIAL"),
      };
    }

    return {
      checks,
      status: providerStatus("connected", "Yandex rank checks completed successfully", metricsSummary),
    };
  }
}
