import type {
  SeoRankProviderStatus,
  SeoSearchConsoleSnapshot,
  YandexRankCheck,
} from "../types";
import type { YandexAiProbe, YandexAiSource } from "../production/zaruku/zarukuWgdRunnerHelpers";
import {
  collectYandexGenSearchProbes,
} from "../production/zaruku/collectors/yandexGenSearchProbeCollector";
import {
  YandexSerpRankSource,
  type YandexSerpFetch,
  type YandexSerpRankEnv,
} from "../providers/yandexSerpRankSource";
import type { WgdReportOptions } from "./types";
import { withProviderDeadline } from "../providers/boundedProviderHttp";

export type YandexEvidenceEnv = YandexSerpRankEnv & Partial<Record<
  | "YANDEX_GEN_SEARCH_IAM_TOKEN"
  | "YANDEX_GEN_SEARCH_API_KEY"
  | "YANDEX_GEN_SEARCH_FOLDER_ID",
  string | undefined
>>;

export type ManualQueryRow = {
  source: "yandex_search" | "alice_ai";
  query: string;
  reason: string;
};

export type AiSampleVisibility = {
  used: number;
  checked: number;
  rate: number | null;
};

export type YandexEvidence = {
  serpChecks: YandexRankCheck[];
  serpStatus: SeoRankProviderStatus;
  aiProbes: YandexAiProbe[];
  aiSampleVisibility: AiSampleVisibility;
  manualQueries: ManualQueryRow[];
  yandexWebmasterSnapshot?: SeoSearchConsoleSnapshot;
  gscSnapshot?: SeoSearchConsoleSnapshot;
  limitations: string[];
};

type AiProbeConfig = {
  aiProbeChannel: string;
  aiProbeQueries: readonly string[];
  aiProbeTargetDomain: string;
  aiProbeThrottleMs: number;
};

type AiCollector = (
  config: AiProbeConfig,
  deps?: {
    env?: YandexEvidenceEnv;
    overallTimeoutMs?: number;
  }
) => Promise<YandexAiProbe[]>;

export type YandexEvidenceDeps = {
  env?: YandexEvidenceEnv;
  serpSource?: Pick<YandexSerpRankSource, "run">;
  serpFetch?: YandexSerpFetch;
  collectAiProbes?: AiCollector;
  ownerAccess?: { yandexWebmaster: boolean; gsc: boolean };
  getYandexWebmasterSnapshot?: (options: WgdReportOptions) => Promise<SeoSearchConsoleSnapshot | undefined>;
  getGscSnapshot?: (options: WgdReportOptions) => Promise<SeoSearchConsoleSnapshot | undefined>;
  now?: () => Date;
  serpOverallTimeoutMs?: number;
  aiOverallTimeoutMs?: number;
  ownerTimeoutMs?: number;
};

const AI_CHANNEL = "Yandex Search API generative response";
const AI_THROTTLE_MS = 1300;
const AI_LIMITATION = "Alice AI visibility is a controlled sample and is not an official Yandex Webmaster metric.";
const DEFAULT_SERP_OVERALL_TIMEOUT_MS = 80_000;
const DEFAULT_AI_OVERALL_TIMEOUT_MS = 100_000;
const DEFAULT_OWNER_TIMEOUT_MS = 30_000;
const MAX_ALICE_ANSWER_LENGTH = 1200;
const MAX_EVIDENCE_URL_LENGTH = 2048;
const MAX_AI_SOURCES = 8;
const OMITTED_ALICE_ANSWER = "Alice AI answer was not retained because it was not safe natural-language evidence.";

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function boundedDependencyValue(value: number | undefined, maximum: number): number {
  if (!Number.isFinite(value)) return maximum;
  return Math.min(maximum, Math.max(1, Math.floor(value!)));
}

function processEnv(): YandexEvidenceEnv {
  return {
    YANDEX_SEARCH_API_KEY: process.env.YANDEX_SEARCH_API_KEY,
    YANDEX_SEARCH_FOLDER_ID: process.env.YANDEX_SEARCH_FOLDER_ID,
    YANDEX_SEARCH_DEFAULT_REGION: process.env.YANDEX_SEARCH_DEFAULT_REGION,
    YANDEX_SEARCH_DEFAULT_LANGUAGE: process.env.YANDEX_SEARCH_DEFAULT_LANGUAGE,
    YANDEX_SEARCH_DEFAULT_DEVICE: process.env.YANDEX_SEARCH_DEFAULT_DEVICE,
    YANDEX_SEARCH_MODE: process.env.YANDEX_SEARCH_MODE,
    SEO_MATCH_SUBDOMAINS: process.env.SEO_MATCH_SUBDOMAINS,
    YANDEX_GEN_SEARCH_IAM_TOKEN: process.env.YANDEX_GEN_SEARCH_IAM_TOKEN,
    YANDEX_GEN_SEARCH_API_KEY: process.env.YANDEX_GEN_SEARCH_API_KEY,
    YANDEX_GEN_SEARCH_FOLDER_ID: process.env.YANDEX_GEN_SEARCH_FOLDER_ID,
  };
}

function hasSearchCredentials(env: YandexEvidenceEnv): boolean {
  return Boolean(clean(env.YANDEX_SEARCH_API_KEY) && clean(env.YANDEX_SEARCH_FOLDER_ID));
}

function hasAiCredentials(env: YandexEvidenceEnv): boolean {
  const auth = clean(env.YANDEX_GEN_SEARCH_IAM_TOKEN) || clean(env.YANDEX_GEN_SEARCH_API_KEY);
  const folder = clean(env.YANDEX_GEN_SEARCH_FOLDER_ID) || clean(env.YANDEX_SEARCH_FOLDER_ID);
  return Boolean(auth && folder);
}

function safeHttpUrl(value: string): string {
  const text = clean(value);
  if (!/^https?:\/\//i.test(text) || text.length > MAX_EVIDENCE_URL_LENGTH) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function safeOwnerIdentity(value: string | null | undefined): string | null {
  const text = clean(value);
  if (!text) return null;
  if (/^sc-domain:[a-z\d.-]+$/i.test(text) || /^https?:[^/:]+:\d+$/i.test(text)) return text;
  return safeHttpUrl(text) || null;
}

function redactSecretText(value: string): string {
  return value
    .replace(/\b(?:authorization\s*[:=]\s*)?(?:bearer|api-key)\s+[a-z\d._~+/=-]+/gi, "[REDACTED]")
    .replace(/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi, "[REDACTED]");
}

function safeNaturalLanguage(value: unknown, maximumLength = MAX_ALICE_ANSWER_LENGTH): string {
  const raw = clean(value).normalize("NFKC");
  if (!raw) return OMITTED_ALICE_ANSWER;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return OMITTED_ALICE_ANSWER;
  } catch {
    // Ordinary natural-language prose is not JSON.
  }
  if (/^(?:error|exception|stack trace)\b\s*[:={]/i.test(raw)
    || /["']?(?:error|error_description|stack|trace)["']?\s*:/i.test(raw)
    || /-----BEGIN [A-Z ]+PRIVATE KEY-----/.test(raw)) {
    return OMITTED_ALICE_ANSWER;
  }
  const withoutUrls = raw.replace(/https?:\/\/[^\s<>{}"']+/gi, "[link omitted]");
  const sanitized = redactSecretText(withoutUrls)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[<>`{}]/g, " ")
    .replace(/[^\p{L}\p{N}\p{M}\p{P}\p{Zs}\r\n\t]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!sanitized || (sanitized.match(/[\p{L}\p{N}]/gu) || []).length < 3) return OMITTED_ALICE_ANSWER;
  if (sanitized.length <= maximumLength) return sanitized;
  return `${sanitized.slice(0, Math.max(1, maximumLength - 1)).trimEnd()}…`;
}

function safeSourceTitle(value: unknown): string {
  const text = safeNaturalLanguage(value, 200);
  return text === OMITTED_ALICE_ANSWER ? "" : text;
}

function safeRankCheck(check: YandexRankCheck): YandexRankCheck {
  return {
    ...check,
    ...(check.checkedDepth !== undefined ? { checkedDepth: check.checkedDepth } : {}),
    ...(check.matchedUrl ? { matchedUrl: safeHttpUrl(check.matchedUrl) } : {}),
    ...(check.competitorsAbove ? {
      competitorsAbove: check.competitorsAbove
        .slice(0, 5)
        .map((item) => ({ ...item, url: safeHttpUrl(item.url) })),
    } : {}),
    ...(check.topResultDomains ? { topResultDomains: check.topResultDomains.slice(0, 5).map(clean).filter(Boolean) } : {}),
  };
}

function safeAiSource(source: YandexAiSource): YandexAiSource {
  return {
    url: safeHttpUrl(source.url),
    title: safeSourceTitle(source.title),
    used: Boolean(source.used),
  };
}

function safePosition(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function safeProbe(probe: YandexAiProbe): YandexAiProbe {
  if (probe.status !== "checked") {
    return {
      channel: AI_CHANNEL,
      status: probe.status,
      query: clean(probe.query).slice(0, 1000),
      result: "Alice AI probe did not return reportable evidence.",
      sources: [],
      sourceDetails: [],
      usedSources: [],
      targetFound: false,
      targetUsed: false,
      sourcePosition: null,
      usedSourcePosition: null,
    };
  }
  return {
    channel: AI_CHANNEL,
    status: "checked",
    query: clean(probe.query).slice(0, 1000),
    result: safeNaturalLanguage(probe.result),
    sources: probe.sources.map(safeHttpUrl).filter(Boolean).slice(0, MAX_AI_SOURCES),
    sourceDetails: probe.sourceDetails.map(safeAiSource).filter((source) => Boolean(source.url)).slice(0, MAX_AI_SOURCES),
    usedSources: probe.usedSources.map(safeHttpUrl).filter(Boolean).slice(0, MAX_AI_SOURCES),
    targetFound: Boolean(probe.targetFound),
    targetUsed: Boolean(probe.targetUsed),
    sourcePosition: safePosition(probe.sourcePosition),
    usedSourcePosition: safePosition(probe.usedSourcePosition),
  };
}

function safeMetrics(
  metrics: SeoRankProviderStatus["metricsSummary"]
): SeoRankProviderStatus["metricsSummary"] | undefined {
  if (!metrics) return undefined;
  const entries = Object.entries(metrics).filter(([, value]) =>
    typeof value === "number" || typeof value === "boolean" || value === null
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function safeStatus(
  status: SeoRankProviderStatus,
  now: Date
): SeoRankProviderStatus {
  const messageByState: Record<SeoRankProviderStatus["state"], string> = {
    connected: "Yandex rank checks completed successfully.",
    missing_credentials: "Yandex Search API credentials are not configured.",
    no_keywords: "No Yandex rank-check keywords were provided.",
    provider_error: "Yandex rank checks were unavailable.",
    limit_exceeded: "Yandex rank-check quota was unavailable.",
    partial_success: "Yandex rank checks returned partial evidence.",
  };
  const metricsSummary = safeMetrics(status.metricsSummary);
  return {
    state: status.state,
    message: messageByState[status.state],
    checkedAt: now.toISOString(),
    ...(metricsSummary ? { metricsSummary } : {}),
  };
}

function unavailableStatus(now: Date, state: "missing_credentials" | "provider_error"): SeoRankProviderStatus {
  return {
    state,
    message: state === "missing_credentials"
      ? "Yandex Search API credentials are not configured."
      : "Yandex rank checks were unavailable.",
    checkedAt: now.toISOString(),
  };
}

function manualRow(source: ManualQueryRow["source"], query: string, reason: string): ManualQueryRow {
  return { source, query, reason };
}

function safeSnapshot(snapshot: SeoSearchConsoleSnapshot): SeoSearchConsoleSnapshot {
  return {
    ...snapshot,
    property: safeOwnerIdentity(snapshot.property),
    siteUrl: safeOwnerIdentity(snapshot.siteUrl),
    topPages: snapshot.topPages.map(safeHttpUrl).filter(Boolean),
  };
}

async function optionalSnapshot(
  getter: YandexEvidenceDeps["getYandexWebmasterSnapshot"] | YandexEvidenceDeps["getGscSnapshot"],
  options: WgdReportOptions,
  timeoutMs: number
): Promise<SeoSearchConsoleSnapshot | undefined> {
  if (!getter) return undefined;
  try {
    const snapshot = await withProviderDeadline(Promise.resolve().then(() => getter(options)), timeoutMs);
    return snapshot ? safeSnapshot(snapshot) : undefined;
  } catch {
    return undefined;
  }
}

/** Collect bounded, report-safe Yandex evidence using existing providers. */
export async function collectYandexEvidence(
  options: WgdReportOptions,
  deps: YandexEvidenceDeps = {}
): Promise<YandexEvidence> {
  const env = deps.env || processEnv();
  const now = deps.now?.() || new Date();
  const manualQueries: ManualQueryRow[] = [];
  const serpOverallTimeoutMs = boundedDependencyValue(deps.serpOverallTimeoutMs, DEFAULT_SERP_OVERALL_TIMEOUT_MS);
  const aiOverallTimeoutMs = boundedDependencyValue(deps.aiOverallTimeoutMs, DEFAULT_AI_OVERALL_TIMEOUT_MS);
  const ownerTimeoutMs = boundedDependencyValue(deps.ownerTimeoutMs, DEFAULT_OWNER_TIMEOUT_MS);
  let serpChecks: YandexRankCheck[] = [];
  let serpStatus: SeoRankProviderStatus;

  if (!hasSearchCredentials(env)) {
    serpStatus = unavailableStatus(now, "missing_credentials");
    manualQueries.push(...options.keywords.map((query) =>
      manualRow("yandex_search", query, "Yandex Search API credentials are not configured.")));
  } else {
    try {
      const result = await withProviderDeadline((deps.serpSource || new YandexSerpRankSource({
        env,
        fetchImpl: deps.serpFetch,
        overallTimeoutMs: serpOverallTimeoutMs,
      })).run({
        targetDomain: options.domain,
        keywords: [...options.keywords],
        region: options.region || "225",
        language: options.language || "ru",
        device: "desktop",
      }), serpOverallTimeoutMs);
      serpChecks = result.checks.map(safeRankCheck);
      serpStatus = safeStatus(result.status, now);
      const completedQueries = new Set(serpChecks.map((item) => item.query));
      manualQueries.push(...options.keywords
        .filter((query) => !completedQueries.has(query))
        .map((query) => manualRow("yandex_search", query, "No reportable Yandex SERP result was returned.")));
    } catch {
      serpStatus = unavailableStatus(now, "provider_error");
      manualQueries.push(...options.keywords.map((query) =>
        manualRow("yandex_search", query, "Yandex SERP evidence was unavailable.")));
    }
  }

  let aiProbes: YandexAiProbe[] = [];
  if (!hasAiCredentials(env)) {
    manualQueries.push(...options.aiQueries.map((query) =>
      manualRow("alice_ai", query, "Yandex generative search credentials are not configured.")));
  } else {
    try {
      const collectAiProbes: AiCollector = deps.collectAiProbes ||
        (collectYandexGenSearchProbes as unknown as AiCollector);
      const collected = await withProviderDeadline(collectAiProbes(
        {
          aiProbeChannel: AI_CHANNEL,
          aiProbeQueries: [...options.aiQueries],
          aiProbeTargetDomain: options.domain,
          aiProbeThrottleMs: AI_THROTTLE_MS,
        },
        { env, overallTimeoutMs: aiOverallTimeoutMs }
      ), aiOverallTimeoutMs);
      aiProbes = collected.map(safeProbe);
      const checkedQueries = new Set(aiProbes.filter((item) => item.status === "checked").map((item) => item.query));
      manualQueries.push(...options.aiQueries
        .filter((query) => !checkedQueries.has(query))
        .map((query) => manualRow("alice_ai", query, "Alice AI probe evidence was unavailable.")));
    } catch {
      manualQueries.push(...options.aiQueries.map((query) =>
        manualRow("alice_ai", query, "Alice AI probe evidence was unavailable.")));
    }
  }

  const checked = aiProbes.filter((item) => item.status === "checked").length;
  const used = aiProbes.filter((item) => item.status === "checked" && item.targetUsed).length;
  const [yandexWebmasterSnapshot, gscSnapshot] = await Promise.all([
    optionalSnapshot(
      deps.ownerAccess?.yandexWebmaster ? deps.getYandexWebmasterSnapshot : undefined,
      options,
      ownerTimeoutMs
    ),
    optionalSnapshot(deps.ownerAccess?.gsc ? deps.getGscSnapshot : undefined, options, ownerTimeoutMs),
  ]);

  return {
    serpChecks,
    serpStatus,
    aiProbes,
    aiSampleVisibility: { used, checked, rate: checked > 0 ? used / checked : null },
    manualQueries,
    ...(yandexWebmasterSnapshot ? { yandexWebmasterSnapshot } : {}),
    ...(gscSnapshot ? { gscSnapshot } : {}),
    limitations: [AI_LIMITATION],
  };
}
