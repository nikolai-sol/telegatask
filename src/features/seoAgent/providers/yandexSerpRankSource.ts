import type { SeoDeviceType, SeoRankProviderStatus, YandexRankCheck } from "../types";
import { normalizeProviderDomain, SeoProviderError } from "./seoDataProvider";
import { isMatchingTargetDomain, normalizeResultDomain } from "./serpMatching";

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

function isoNow(): string {
  return new Date().toISOString();
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

function decodeRawData(rawData: string): string {
  const value = cleanString(rawData);
  if (!value) return "";
  if (value.startsWith("<")) return value;
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8").trim();
    return decoded || value;
  } catch {
    return value;
  }
}

function hasCredentials(): boolean {
  return Boolean(cleanString(process.env.YANDEX_SEARCH_API_KEY) && cleanString(process.env.YANDEX_SEARCH_FOLDER_ID));
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

async function parseYandexResponse(response: Response): Promise<YandexSearchResponse> {
  try {
    return (await response.json()) as YandexSearchResponse;
  } catch (error) {
    throw new SeoProviderError({
      category: "yandex_serp_invalid_json",
      safeMessage: "Yandex rank tracking returned invalid data",
      statusCode: 503,
      internalCause: error,
    });
  }
}

async function pollDeferredResult(operationId: string, apiKey: string): Promise<YandexSearchResponse> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`https://operation.api.cloud.yandex.net/operations/${encodeURIComponent(operationId)}`, {
      headers: {
        Authorization: `Api-Key ${apiKey}`,
      },
    });
    const payload = await parseYandexResponse(response);
    if (payload.done && payload.response?.rawData) return payload;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new SeoProviderError({
    category: "yandex_serp_provider_error",
    safeMessage: "Yandex rank tracking deferred search did not finish in time",
    statusCode: 503,
  });
}

export class YandexSerpRankSource {
  async run(input: {
    targetDomain: string;
    targetDomainAliases?: string[];
    keywords: string[];
    region?: string | null;
    language?: string | null;
    device?: SeoDeviceType | null;
  }): Promise<YandexSerpRankRunResult> {
    if (!hasCredentials()) {
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

    const apiKey = cleanString(process.env.YANDEX_SEARCH_API_KEY);
    const folderId = cleanString(process.env.YANDEX_SEARCH_FOLDER_ID);
    const region = cleanString(input.region) || cleanString(process.env.YANDEX_SEARCH_DEFAULT_REGION) || "225";
    const language = cleanString(input.language) || cleanString(process.env.YANDEX_SEARCH_DEFAULT_LANGUAGE) || "ru";
    const { searchType, localization } = readSearchTypeAndLocalization(language);
    const device = readDevice(input.device || process.env.YANDEX_SEARCH_DEFAULT_DEVICE);
    const mode = cleanString(process.env.YANDEX_SEARCH_MODE).toLowerCase() === "sync" ? "sync" : "deferred";
    const allowSubdomains = String(process.env.SEO_MATCH_SUBDOMAINS || "").trim().toLowerCase() === "true";

    const checks: YandexRankCheck[] = [];
    let failedCount = 0;
    let limitExceeded = false;

    for (const keyword of keywords) {
      try {
        const response = await fetch(
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
                groupsOnPage: 20,
                docsInGroup: 1,
              },
              ...(region ? { region } : {}),
              l10n: localization,
              folderId,
              responseFormat: "FORMAT_XML",
            }),
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

        let payload = await parseYandexResponse(response);
        if (mode === "deferred") {
          const operationId = cleanString(payload.id);
          if (!operationId) {
            failedCount += 1;
            continue;
          }
          payload = await pollDeferredResult(operationId, apiKey);
        }

        const rawData = decodeRawData(cleanString(payload.response?.rawData));
        if (!rawData) {
          failedCount += 1;
          continue;
        }

        const entries = xmlEntries(rawData);
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
