import type { ZarukuSeoProductionConfig } from "../zarukuSeoProductionConfig";
import {
  aiTargetPosition,
  cleanString,
  extractGenSearchAnswer,
  extractGenSearchSourceDetails,
  type YandexAiProbe,
} from "../zarukuWgdRunnerHelpers";
import {
  fetchBoundedProviderText,
  ProviderDeadlineError,
  withProviderDeadline,
  type BoundedProviderResponse,
} from "../../../providers/boundedProviderHttp";

type YandexGenSearchEnv = Partial<
  Record<
    "YANDEX_GEN_SEARCH_IAM_TOKEN" | "YANDEX_GEN_SEARCH_API_KEY" | "YANDEX_GEN_SEARCH_FOLDER_ID" | "YANDEX_SEARCH_FOLDER_ID",
    string
  >
>;

type YandexGenSearchResponse = Pick<Response, "ok" | "status"> & BoundedProviderResponse;

export type YandexGenSearchFetch = (url: string, init: RequestInit) => Promise<YandexGenSearchResponse>;
export type YandexGenSearchSleep = (ms: number) => Promise<void>;

type ProbeConfig = Pick<
  ZarukuSeoProductionConfig,
  "aiProbeChannel" | "aiProbeQueries" | "aiProbeTargetDomain" | "aiProbeThrottleMs"
>;

export type ProbeDeps = {
  env?: YandexGenSearchEnv;
  fetchImpl?: YandexGenSearchFetch;
  sleepImpl?: YandexGenSearchSleep;
  requestTimeoutMs?: number;
  overallTimeoutMs?: number;
  maxResponseBytes?: number;
};

export const YANDEX_GEN_SEARCH_REQUEST_TIMEOUT_MS = 20_000;
export const YANDEX_GEN_SEARCH_OVERALL_TIMEOUT_MS = 90_000;
export const YANDEX_GEN_SEARCH_MAX_RESPONSE_BYTES = 1024 * 1024;

function defaultFetch(url: string, init: RequestInit): Promise<YandexGenSearchResponse> {
  return fetch(url, init);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function boundedDependencyValue(value: number | undefined, maximum: number): number {
  if (!Number.isFinite(value)) return maximum;
  return Math.min(maximum, Math.max(1, Math.floor(value!)));
}

function readProcessEnv(): YandexGenSearchEnv {
  return {
    YANDEX_GEN_SEARCH_IAM_TOKEN: process.env.YANDEX_GEN_SEARCH_IAM_TOKEN,
    YANDEX_GEN_SEARCH_API_KEY: process.env.YANDEX_GEN_SEARCH_API_KEY,
    YANDEX_GEN_SEARCH_FOLDER_ID: process.env.YANDEX_GEN_SEARCH_FOLDER_ID,
    YANDEX_SEARCH_FOLDER_ID: process.env.YANDEX_SEARCH_FOLDER_ID,
  };
}

function yandexGenSearchAuthHeader(env: YandexGenSearchEnv): string {
  const iamToken = cleanString(env.YANDEX_GEN_SEARCH_IAM_TOKEN);
  if (iamToken) return `Bearer ${iamToken}`;
  const apiKey = cleanString(env.YANDEX_GEN_SEARCH_API_KEY);
  if (apiKey) return `Api-Key ${apiKey}`;
  return "";
}

async function runYandexGenSearchProbe(input: {
  query: string;
  config: ProbeConfig;
  env: YandexGenSearchEnv;
  fetchImpl: YandexGenSearchFetch;
  requestTimeoutMs: number;
  maxResponseBytes: number;
}): Promise<YandexAiProbe> {
  const authHeader = yandexGenSearchAuthHeader(input.env);
  const folderId = cleanString(input.env.YANDEX_GEN_SEARCH_FOLDER_ID) || cleanString(input.env.YANDEX_SEARCH_FOLDER_ID);
  if (!authHeader || !folderId) {
    return {
      channel: input.config.aiProbeChannel,
      status: "not_configured",
      query: input.query,
      result: "Missing YANDEX_GEN_SEARCH_API_KEY or YANDEX_GEN_SEARCH_IAM_TOKEN and folder id.",
      sources: [],
      sourceDetails: [],
      usedSources: [],
      targetFound: false,
      targetUsed: false,
      sourcePosition: null,
      usedSourcePosition: null,
    };
  }

  const { response, text } = await fetchBoundedProviderText(
    (url, init) => input.fetchImpl(url, init || {}),
    "https://searchapi.api.cloud.yandex.net/v2/gen/search",
    {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        folderId,
        messages: [
          {
            role: "ROLE_USER",
            content: input.query,
          },
        ],
        responseFormat: "RESP_FORMAT_JSON",
      }),
    },
    { timeoutMs: input.requestTimeoutMs, maximumBytes: input.maxResponseBytes }
  );
  let payload: Record<string, unknown> = {};
  try {
    const parsed = text ? JSON.parse(text) : {};
    payload = Array.isArray(parsed) ? { items: parsed } : (parsed as Record<string, unknown>);
  } catch {
    payload = {};
  }

  if (response.status === 403) {
    return {
      channel: input.config.aiProbeChannel,
      status: "permission_denied",
      query: input.query,
      result: "Permission denied. Grant search-api.webSearch.user to the service account/API key on the configured Yandex Cloud folder.",
      sources: [],
      sourceDetails: [],
      usedSources: [],
      targetFound: false,
      targetUsed: false,
      sourcePosition: null,
      usedSourcePosition: null,
    };
  }
  if (!response.ok) {
    return {
      channel: input.config.aiProbeChannel,
      status: "failed",
      query: input.query,
      result: "Yandex generative search request failed.",
      sources: [],
      sourceDetails: [],
      usedSources: [],
      targetFound: false,
      targetUsed: false,
      sourcePosition: null,
      usedSourcePosition: null,
    };
  }

  const sourceDetails = extractGenSearchSourceDetails(payload);
  const sourcePosition = aiTargetPosition(sourceDetails, false, input.config.aiProbeTargetDomain);
  const usedSourcePosition = aiTargetPosition(sourceDetails, true, input.config.aiProbeTargetDomain);
  return {
    channel: input.config.aiProbeChannel,
    status: "checked",
    query: input.query,
    result: extractGenSearchAnswer(payload),
    sources: sourceDetails.map((source) => source.url || source.title).filter(Boolean).slice(0, 8),
    sourceDetails,
    usedSources: sourceDetails.filter((source) => source.used).map((source) => source.url || source.title).filter(Boolean),
    targetFound: sourcePosition !== null,
    targetUsed: usedSourcePosition !== null,
    sourcePosition,
    usedSourcePosition,
  };
}

function failedProbe(query: string, config: ProbeConfig): YandexAiProbe {
  return {
    channel: config.aiProbeChannel,
    status: "failed",
    query,
    result: "Yandex generative search request failed.",
    sources: [],
    sourceDetails: [],
    usedSources: [],
    targetFound: false,
    targetUsed: false,
    sourcePosition: null,
    usedSourcePosition: null,
  };
}

export async function collectYandexGenSearchProbes(config: ProbeConfig, deps: ProbeDeps = {}): Promise<YandexAiProbe[]> {
  const env = deps.env || readProcessEnv();
  const fetchImpl = deps.fetchImpl || defaultFetch;
  const sleepImpl = deps.sleepImpl || defaultSleep;
  const requestTimeoutMs = boundedDependencyValue(deps.requestTimeoutMs, YANDEX_GEN_SEARCH_REQUEST_TIMEOUT_MS);
  const overallTimeoutMs = boundedDependencyValue(deps.overallTimeoutMs, YANDEX_GEN_SEARCH_OVERALL_TIMEOUT_MS);
  const maxResponseBytes = boundedDependencyValue(deps.maxResponseBytes, YANDEX_GEN_SEARCH_MAX_RESPONSE_BYTES);
  const queries = [...config.aiProbeQueries];
  const results: YandexAiProbe[] = [];
  const overallDeadline = Date.now() + overallTimeoutMs;
  for (const query of queries) {
    const remaining = overallDeadline - Date.now();
    if (remaining <= 0) {
      results.push(failedProbe(query, config));
      continue;
    }
    try {
      results.push(await withProviderDeadline(
        runYandexGenSearchProbe({
          query,
          config,
          env,
          fetchImpl,
          requestTimeoutMs: Math.min(requestTimeoutMs, remaining),
          maxResponseBytes,
        }),
        remaining
      ));
    } catch {
      results.push(failedProbe(query, config));
    }
    if (query !== queries[queries.length - 1]) {
      const sleepBudget = overallDeadline - Date.now();
      if (sleepBudget <= 0) continue;
      try {
        await withProviderDeadline(sleepImpl(Math.min(config.aiProbeThrottleMs, sleepBudget)), sleepBudget);
      } catch (error) {
        if (!(error instanceof ProviderDeadlineError)) throw error;
      }
    }
  }
  return results;
}
