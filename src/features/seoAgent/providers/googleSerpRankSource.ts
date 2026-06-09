import type { GoogleRankCheck, SeoDeviceType, SeoRankProviderStatus } from "../types";
import { normalizeProviderDomain, SeoProviderError } from "./seoDataProvider";
import { isMatchingTargetDomain, normalizeResultDomain } from "./serpMatching";

type GoogleSerpRankRunResult = {
  checks: GoogleRankCheck[];
  status: SeoRankProviderStatus;
};

type DataForSeoItem = {
  type?: string;
  rank_group?: number;
  rank_absolute?: number;
  title?: string;
  description?: string;
  url?: string;
  domain?: string;
  is_featured_snippet?: boolean;
  xpath?: string;
};

type DataForSeoTaskResult = {
  keyword?: string;
  location_name?: string;
  language_name?: string;
  items?: DataForSeoItem[];
};

type DataForSeoTask = {
  status_code?: number;
  status_message?: string;
  data?: Record<string, unknown>;
  result?: DataForSeoTaskResult[];
  cost?: number;
};

type DataForSeoResponse = {
  status_code?: number;
  status_message?: string;
  tasks?: DataForSeoTask[];
};

function isoNow(): string {
  return new Date().toISOString();
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readDevice(value: unknown, fallback: SeoDeviceType): SeoDeviceType {
  return value === "mobile" ? "mobile" : fallback;
}

function readSearchLocation(value: unknown): string {
  return cleanString(value) || cleanString(process.env.DATAFORSEO_DEFAULT_LOCATION) || "Austria";
}

function readSearchLanguage(value: unknown): string {
  const rawLanguage = cleanString(value) || cleanString(process.env.DATAFORSEO_DEFAULT_LANGUAGE) || "German";
  const normalizedLanguage = rawLanguage.toLowerCase();
  const languageNameByCode: Record<string, string> = {
    de: "German",
    "de-at": "German",
    "de-de": "German",
    en: "English",
    "en-us": "English",
    "en-gb": "English",
    ru: "Russian",
    fr: "French",
    es: "Spanish",
    it: "Italian",
    nl: "Dutch",
    pl: "Polish",
  };

  return languageNameByCode[normalizedLanguage] || rawLanguage;
}

function readSearchDevice(value: unknown): SeoDeviceType {
  return readDevice(value, readDevice(process.env.DATAFORSEO_DEFAULT_DEVICE, "desktop"));
}

function dataForSeoAuthHeader(): string {
  const base64Auth = cleanString(process.env.DATAFORSEO_AUTH_BASE64);
  if (base64Auth) {
    return `Basic ${base64Auth}`;
  }
  const login = cleanString(process.env.DATAFORSEO_LOGIN);
  const password = cleanString(process.env.DATAFORSEO_PASSWORD);
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

function hasCredentials(): boolean {
  return Boolean(
    cleanString(process.env.DATAFORSEO_AUTH_BASE64) ||
      (cleanString(process.env.DATAFORSEO_LOGIN) && cleanString(process.env.DATAFORSEO_PASSWORD))
  );
}

function extractSerpFeatures(items: DataForSeoItem[]): string[] {
  return Array.from(
    new Set(
      items
        .map((item) => cleanString(item.type))
        .filter((value) => value && value !== "organic")
    )
  );
}

function buildMissingCredentialStatus(): SeoRankProviderStatus {
  return {
    state: "missing_credentials",
    message: "DataForSEO credentials are not configured",
    errorCode: "DATAFORSEO_MISSING_CREDENTIALS",
    checkedAt: isoNow(),
  };
}

function buildNoKeywordsStatus(): SeoRankProviderStatus {
  return {
    state: "no_keywords",
    message: "No tracking keywords were provided for Google rank checks",
    errorCode: "GOOGLE_SERP_NO_KEYWORDS",
    checkedAt: isoNow(),
  };
}

function providerStatusFromChecks(input: {
  checks: GoogleRankCheck[];
  failedCount: number;
  errorCode?: string;
  message?: string;
}): SeoRankProviderStatus {
  const foundCount = input.checks.filter((item) => item.found).length;
  const base = {
    checkedAt: isoNow(),
    metricsSummary: {
      queryCount: input.checks.length + input.failedCount,
      foundCount,
      missingCount: Math.max(0, input.checks.length - foundCount),
      failedCount: input.failedCount,
    },
  };

  if (input.failedCount > 0 && input.checks.length === 0) {
    return {
      state: "provider_error",
      message: input.message || "Google rank tracking provider failed for all requested keywords",
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      ...base,
    };
  }

  if (input.failedCount > 0 && input.checks.length > 0) {
    return {
      state: "partial_success",
      message: input.message || "Google rank checks partially succeeded",
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      ...base,
    };
  }

  return {
    state: "connected",
    message: "Google rank checks completed successfully",
    ...base,
  };
}

function mapProviderError(error: unknown): SeoProviderError {
  if (error instanceof SeoProviderError) return error;
  return new SeoProviderError({
    category: "google_serp_provider_error",
    safeMessage: "Google rank tracking provider failed",
    statusCode: 503,
    internalCause: error,
  });
}

export class GoogleSerpRankSource {
  async run(input: {
    targetDomain: string;
    targetDomainAliases?: string[];
    keywords: string[];
    location?: string | null;
    language?: string | null;
    device?: SeoDeviceType | null;
  }): Promise<GoogleSerpRankRunResult> {
    if (!hasCredentials()) {
      return { checks: [], status: buildMissingCredentialStatus() };
    }

    const keywords = Array.from(
      new Set(
        (input.keywords || [])
          .map((item) => cleanString(item))
          .filter(Boolean)
      )
    );
    if (keywords.length === 0) {
      return { checks: [], status: buildNoKeywordsStatus() };
    }

    const location = readSearchLocation(input.location);
    const language = readSearchLanguage(input.language);
    const device = readSearchDevice(input.device);
    const allowSubdomains = String(process.env.SEO_MATCH_SUBDOMAINS || "").trim().toLowerCase() === "true";

    const tasks = keywords.map((keyword) => ({
      keyword,
      location_name: location,
      language_name: language,
      device,
      os: device === "mobile" ? "android" : "windows",
      depth: 20,
    }));

    const providerTasks: DataForSeoTask[] = [];

    for (const task of tasks) {
      let response: Response;
      try {
        response = await fetch("https://api.dataforseo.com/v3/serp/google/organic/live/advanced", {
          method: "POST",
          headers: {
            Authorization: dataForSeoAuthHeader(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify([task]),
        });
      } catch (error) {
        throw new SeoProviderError({
          category: "google_serp_request_failed",
          safeMessage: "Google rank tracking request failed",
          statusCode: 503,
          internalCause: error,
        });
      }

      let payload: DataForSeoResponse;
      try {
        payload = (await response.json()) as DataForSeoResponse;
      } catch (error) {
        throw new SeoProviderError({
          category: "google_serp_invalid_json",
          safeMessage: "Google rank tracking returned invalid data",
          statusCode: 503,
          internalCause: error,
        });
      }

      if (!response.ok || !Array.isArray(payload.tasks)) {
        const statusCode = Number(payload.status_code || response.status || 0);
        if (statusCode === 40104) {
          throw new SeoProviderError({
            category: "google_serp_account_unverified",
            safeMessage: "DataForSEO account must be verified before Google rank tracking can run",
            statusCode: 503,
          });
        }
        if (statusCode === 402 || statusCode === 429) {
          throw new SeoProviderError({
            category: "google_serp_limit_exceeded",
            safeMessage: "Google rank tracking limit exceeded",
            statusCode: 503,
          });
        }
        providerTasks.push({
          status_code: statusCode,
          status_message: cleanString(payload.status_message) || "Google rank tracking provider error",
          data: task,
        });
        continue;
      }

      providerTasks.push(payload.tasks[0] || {
        status_code: Number(payload.status_code || 0),
        status_message: cleanString(payload.status_message) || "Google rank tracking provider returned no task",
        data: task,
      });
    }

    const checks: GoogleRankCheck[] = [];
    let failedCount = 0;
    let firstTaskErrorMessage = "";
    let firstTaskErrorCode = "";

    for (const [index, task] of providerTasks.entries()) {
      const keyword = keywords[index] || cleanString(task.result?.[0]?.keyword);
      const taskResult = Array.isArray(task.result) ? task.result[0] : undefined;
      if (!keyword) continue;

      if ((Number(task.status_code || 0) >= 40000 && !taskResult) || !taskResult || !Array.isArray(taskResult.items)) {
        failedCount += 1;
        if (!firstTaskErrorMessage) {
          firstTaskErrorMessage = cleanString(task.status_message) || "Google rank tracking provider error";
        }
        if (!firstTaskErrorCode) {
          firstTaskErrorCode = Number(task.status_code || 0) > 0 ? `DATAFORSEO_${Number(task.status_code)}` : "GOOGLE_SERP_TASK_ERROR";
        }
        continue;
      }

      const organicItems = taskResult.items.filter((item) => cleanString(item.type) === "organic");
      const matchedItem = organicItems.find((item) =>
        isMatchingTargetDomain({
          targetDomain: input.targetDomain,
          targetDomainAliases: input.targetDomainAliases,
          resultDomain: item.domain,
          resultUrl: item.url,
          allowSubdomains,
        })
      );
      const matchedPosition =
        typeof matchedItem?.rank_group === "number"
          ? matchedItem.rank_group
          : typeof matchedItem?.rank_absolute === "number"
            ? matchedItem.rank_absolute
            : undefined;
      const competitorsAbove = organicItems
        .filter((item) => {
          const position =
            typeof item.rank_group === "number"
              ? item.rank_group
              : typeof item.rank_absolute === "number"
                ? item.rank_absolute
                : null;
          if (matchedPosition === undefined || position === null) return false;
          return position < matchedPosition;
        })
        .slice(0, 5)
        .map((item) => ({
          position:
            typeof item.rank_group === "number"
              ? item.rank_group
              : typeof item.rank_absolute === "number"
                ? item.rank_absolute
                : 0,
          domain: normalizeResultDomain(item.domain || item.url || ""),
          url: cleanString(item.url),
          ...(cleanString(item.title) ? { title: cleanString(item.title) } : {}),
        }))
        .filter((item) => item.position > 0 && item.domain && item.url);

      checks.push({
        query: keyword,
        searchEngine: "google",
        provider: "dataforseo",
        targetDomain: normalizeProviderDomain(input.targetDomain),
        found: Boolean(matchedItem),
        ...(matchedPosition !== undefined ? { position: matchedPosition } : {}),
        ...(cleanString(matchedItem?.url) ? { matchedUrl: cleanString(matchedItem?.url) } : {}),
        ...(cleanString(matchedItem?.title) ? { title: cleanString(matchedItem?.title) } : {}),
        ...(cleanString(matchedItem?.description) ? { snippet: cleanString(matchedItem?.description) } : {}),
        ...(competitorsAbove.length > 0 ? { competitorsAbove } : {}),
        serpFeatures: extractSerpFeatures(taskResult.items),
        topResultDomains: organicItems
          .map((item) => normalizeResultDomain(item.domain || item.url || ""))
          .filter(Boolean)
          .slice(0, 5),
        location,
        language,
        device,
        checkedAt: isoNow(),
      });
    }

    return {
      checks,
      status: providerStatusFromChecks({
        checks,
        failedCount,
        ...(firstTaskErrorMessage ? { message: firstTaskErrorMessage } : {}),
        ...(firstTaskErrorCode ? { errorCode: firstTaskErrorCode } : {}),
      }),
    };
  }
}
