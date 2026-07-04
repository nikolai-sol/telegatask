import type { ZarukuSeoProductionConfig } from "../zarukuSeoProductionConfig";
import {
  aiTargetPosition,
  cleanString,
  extractGenSearchAnswer,
  extractGenSearchSourceDetails,
  type YandexAiProbe,
} from "../zarukuWgdRunnerHelpers";

type YandexGenSearchEnv = Partial<
  Record<
    "YANDEX_GEN_SEARCH_IAM_TOKEN" | "YANDEX_GEN_SEARCH_API_KEY" | "YANDEX_GEN_SEARCH_FOLDER_ID" | "YANDEX_SEARCH_FOLDER_ID",
    string
  >
>;

type YandexGenSearchResponse = Pick<Response, "ok" | "status" | "text">;

export type YandexGenSearchFetch = (url: string, init: RequestInit) => Promise<YandexGenSearchResponse>;
export type YandexGenSearchSleep = (ms: number) => Promise<void>;

type ProbeConfig = Pick<
  ZarukuSeoProductionConfig,
  "aiProbeChannel" | "aiProbeQueries" | "aiProbeTargetDomain" | "aiProbeThrottleMs"
>;

type ProbeDeps = {
  env?: YandexGenSearchEnv;
  fetchImpl?: YandexGenSearchFetch;
  sleepImpl?: YandexGenSearchSleep;
};

function defaultFetch(url: string, init: RequestInit): Promise<YandexGenSearchResponse> {
  return fetch(url, init);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  const response = await input.fetchImpl("https://searchapi.api.cloud.yandex.net/v2/gen/search", {
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
  });
  const text = await response.text();
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
      result: cleanString(payload.message) || text.slice(0, 500) || `HTTP ${response.status}`,
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

export async function collectYandexGenSearchProbes(config: ProbeConfig, deps: ProbeDeps = {}): Promise<YandexAiProbe[]> {
  const env = deps.env || readProcessEnv();
  const fetchImpl = deps.fetchImpl || defaultFetch;
  const sleepImpl = deps.sleepImpl || defaultSleep;
  const queries = [...config.aiProbeQueries];
  const results: YandexAiProbe[] = [];
  for (const query of queries) {
    results.push(await runYandexGenSearchProbe({ query, config, env, fetchImpl }));
    if (query !== queries[queries.length - 1]) {
      await sleepImpl(config.aiProbeThrottleMs);
    }
  }
  return results;
}
