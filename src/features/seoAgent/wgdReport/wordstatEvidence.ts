import type { PageEvidence, WgdReportOptions } from "./types";

const WORDSTAT_BASE = "https://searchapi.api.cloud.yandex.net/v2/wordstat";
const MAX_SEEDS = 10;
const MAX_PHRASES = 20;
const MAX_ENRICHED_GAPS = 3;
const REQUEST_TIMEOUT_MS = 15_000;

export type WordstatCoverageState = "covered" | "partial" | "missing" | "not_measured";
export type WordstatCollectionState = "success" | "partial" | "unavailable" | "not_applicable";

export type WordstatPhrase = { phrase: string; count: number | null };
export type WordstatDynamicsPoint = { date: string; count: number | null; share?: number | null };
export type WordstatRegionPoint = {
  regionId: string;
  regionName?: string;
  count: number | null;
  share?: number | null;
  affinityIndex?: number | null;
};

export type WordstatSeedEvidence = {
  seed: string;
  totalCount: number | null;
  phrases: WordstatPhrase[];
  measured?: boolean;
  dynamics?: WordstatDynamicsPoint[];
  regions?: WordstatRegionPoint[];
};

export type WordstatDemandCluster = WordstatSeedEvidence & {
  brand: boolean;
  coverage: WordstatCoverageState;
  bestPage: string | null;
  matchedFields: string[];
  tokenRatio: number;
};

export type WordstatPrimaryRecommendation = {
  seed: string;
  demand: number | null;
  coverage: "partial" | "missing";
  bestPage: string | null;
  action: string;
};

export type WordstatEvidence = {
  status: { state: WordstatCollectionState; message: string; checkedAt: string };
  clusters: WordstatDemandCluster[];
  primaryRecommendation: WordstatPrimaryRecommendation | null;
  requestCount: number;
  limitations: string[];
};

export type WordstatEvidenceEnv = {
  YANDEX_SEARCH_API_KEY?: string;
  YANDEX_SEARCH_FOLDER_ID?: string;
};

export type WordstatFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type WordstatEvidenceDeps = {
  env?: WordstatEvidenceEnv;
  fetch?: WordstatFetch;
  now?: () => Date;
  brandKeys?: string[];
};

type AnalyzeWordstatInput = {
  checkedAt: string;
  options: WgdReportOptions;
  pages: PageEvidence[];
  seeds: WordstatSeedEvidence[];
  brandKeys?: string[];
  statusState?: WordstatCollectionState;
  statusMessage?: string;
  requestCount?: number;
  limitations?: string[];
};

/** Parse only JSON values that are safe non-negative integer counters. */
export function parseWordstatCount(value: unknown): number | null {
  const number = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value.trim())
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function normalizeText(value: unknown): string {
  return typeof value === "string"
    ? value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    : "";
}

function tokens(value: unknown): string[] {
  return [...new Set(normalizeText(value).split(" ").filter((token) => token.length >= 2))];
}

function pageSignals(page: PageEvidence): Array<{ field: string; text: string }> {
  return [
    { field: "title", text: normalizeText(page.title) },
    { field: "description", text: normalizeText(page.description) },
    { field: "h1", text: normalizeText(page.headings?.h1?.join(" ")) },
    { field: "h2", text: normalizeText(page.headings?.h2?.join(" ")) },
    { field: "h3", text: normalizeText(page.headings?.h3?.join(" ")) },
  ].filter((signal) => signal.text);
}

function pageMatch(seed: WordstatSeedEvidence, page: PageEvidence): {
  coverage: Exclude<WordstatCoverageState, "not_measured">;
  ratio: number;
  fields: string[];
} {
  const seedTokens = tokens(seed.seed);
  const signals = pageSignals(page);
  const combined = tokens(signals.map((signal) => signal.text).join(" "));
  const matched = seedTokens.filter((token) => combined.includes(token));
  const ratio = seedTokens.length ? matched.length / seedTokens.length : 0;
  const fields = signals
    .filter((signal) => seedTokens.some((token) => tokens(signal.text).includes(token)))
    .map((signal) => signal.field);
  const relatedPhraseMatch = seed.phrases
    .filter((item) => item.count === null || item.count > 0)
    .some((item) => {
      const phrase = normalizeText(item.phrase);
      return phrase.length > 0 && signals.some((signal) => signal.text.includes(phrase));
    });
  const coverage = seedTokens.length > 0 && matched.length === seedTokens.length && relatedPhraseMatch
    ? "covered"
    : matched.length >= 2 && ratio >= 0.5
      ? "partial"
      : "missing";
  return { coverage, ratio, fields };
}

function brandCandidates(options: WgdReportOptions, pages: PageEvidence[], explicit: string[] = []): string[] {
  const labels = options.domain.toLocaleLowerCase("ru-RU").split(".").slice(0, -1)
    .flatMap((label) => [label, ...label.split(/[-_]/)]);
  const homepage = pages.find((page) => {
    try {
      return new URL(page.finalUrl || page.requestedUrl).pathname === "/";
    } catch {
      return false;
    }
  });
  const shortSignals = [homepage?.title, ...(homepage?.headings?.h1 || [])]
    .flatMap((value) => {
      const valueTokens = tokens(value);
      return valueTokens.length > 0 && valueTokens.length <= 5 ? [normalizeText(value)] : [];
    });
  return [...new Set([...labels, ...shortSignals, ...explicit].map(normalizeText).filter(Boolean))];
}

function isBrandSeed(seed: string, candidates: string[]): boolean {
  const normalized = normalizeText(seed);
  const seedTokens = tokens(seed);
  return candidates.some((candidate) => {
    if (candidate.length >= 4 && normalized.includes(candidate)) return true;
    const candidateTokens = tokens(candidate);
    return candidateTokens.length >= 2 && candidateTokens.every((token) => seedTokens.includes(token));
  });
}

function coverageRank(value: WordstatCoverageState): number {
  return value === "covered" ? 3 : value === "partial" ? 2 : value === "missing" ? 1 : 0;
}

function primaryRecommendation(clusters: WordstatDemandCluster[]): WordstatPrimaryRecommendation | null {
  const eligible = clusters
    .map((cluster, index) => ({ cluster, index }))
    .filter(({ cluster }) => !cluster.brand && (cluster.coverage === "partial" || cluster.coverage === "missing"))
    .sort((left, right) => {
      const demand = (right.cluster.totalCount ?? -1) - (left.cluster.totalCount ?? -1);
      if (demand) return demand;
      if (left.cluster.coverage !== right.cluster.coverage) return left.cluster.coverage === "missing" ? -1 : 1;
      return left.index - right.index;
    });
  const winner = eligible[0]?.cluster;
  if (!winner || (winner.coverage !== "partial" && winner.coverage !== "missing")) return null;
  return {
    seed: winner.seed,
    demand: winner.totalCount,
    coverage: winner.coverage,
    bestPage: winner.bestPage,
    action: winner.coverage === "missing"
      ? `Создать или расширить посадочную страницу под спрос «${winner.seed}».`
      : `Усилить наиболее релевантную страницу под спрос «${winner.seed}».`,
  };
}

/** Compare Wordstat demand clusters with visible SEO signals without affecting report scoring. */
export function analyzeWordstatDemand(input: AnalyzeWordstatInput): WordstatEvidence {
  const candidates = brandCandidates(input.options, input.pages, input.brandKeys);
  const clusters = input.seeds.map((seed): WordstatDemandCluster => {
    if (seed.measured === false) {
      return { ...seed, brand: isBrandSeed(seed.seed, candidates), coverage: "not_measured", bestPage: null, matchedFields: [], tokenRatio: 0 };
    }
    const matches = input.pages.map((page, index) => ({ page, index, ...pageMatch(seed, page) }))
      .sort((left, right) => coverageRank(right.coverage) - coverageRank(left.coverage)
        || right.ratio - left.ratio
        || right.fields.length - left.fields.length
        || (left.page.discoveryOrder ?? left.index) - (right.page.discoveryOrder ?? right.index));
    const best = matches[0];
    return {
      ...seed,
      brand: isBrandSeed(seed.seed, candidates),
      coverage: best?.coverage || "missing",
      bestPage: best && best.coverage !== "missing" ? best.page.finalUrl || best.page.requestedUrl : null,
      matchedFields: best?.fields || [],
      tokenRatio: best?.ratio || 0,
    };
  });
  const state = input.statusState || (clusters.some((item) => item.coverage === "not_measured") ? "partial" : "success");
  return {
    status: {
      state,
      message: input.statusMessage || (state === "success" ? "Wordstat demand collected." : "Wordstat demand is incomplete."),
      checkedAt: input.checkedAt,
    },
    clusters,
    primaryRecommendation: primaryRecommendation(clusters),
    requestCount: input.requestCount || 0,
    limitations: input.limitations || [],
  };
}

function readArray(payload: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) if (Array.isArray(payload[key])) return payload[key] as unknown[];
  const response = payload.response;
  return response && typeof response === "object" ? readArray(response as Record<string, unknown>, keys) : [];
}

function readValue(payload: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (key in payload) return payload[key];
  const response = payload.response;
  return response && typeof response === "object" ? readValue(response as Record<string, unknown>, keys) : undefined;
}

function parsePhrase(value: unknown): WordstatPhrase | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const phrase = [item.phrase, item.query, item.text].find((entry) => typeof entry === "string") as string | undefined;
  return phrase?.trim() ? { phrase: phrase.trim(), count: parseWordstatCount(item.count ?? item.shows ?? item.value) } : null;
}

function parseDynamics(payload: Record<string, unknown>): WordstatDynamicsPoint[] {
  return readArray(payload, ["dynamics", "items", "results"]).slice(0, 13).flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const date = [item.date, item.period, item.month].find((entry) => typeof entry === "string") as string | undefined;
    return date ? [{ date, count: parseWordstatCount(item.count ?? item.shows ?? item.value), share: finiteNumber(item.share) }] : [];
  });
}

function parseRegions(payload: Record<string, unknown>): WordstatRegionPoint[] {
  return readArray(payload, ["regions", "items", "results"]).slice(0, 20).flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const regionId = String(item.regionId ?? item.id ?? "").trim();
    if (!regionId) return [];
    const regionName = [item.regionName, item.name].find((entry) => typeof entry === "string") as string | undefined;
    return [{
      regionId,
      ...(regionName ? { regionName } : {}),
      count: parseWordstatCount(item.count ?? item.shows ?? item.value),
      share: finiteNumber(item.share),
      affinityIndex: finiteNumber(item.affinityIndex ?? item.affinity),
    }];
  });
}

function completedMonths(now: Date): { fromDate: string; toDate: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 12, 1));
  return { fromDate: start.toISOString().slice(0, 10), toDate: end.toISOString().slice(0, 10) };
}

/** Collect bounded Wordstat evidence directly through Yandex Search API. */
export async function collectWordstatEvidence(
  options: WgdReportOptions,
  pages: PageEvidence[],
  deps: WordstatEvidenceDeps = {}
): Promise<WordstatEvidence> {
  const now = deps.now?.() || new Date();
  const checkedAt = now.toISOString();
  const uniqueSeeds = [...new Set(options.keywords.map((seed) => seed.trim()).filter(Boolean))].slice(0, MAX_SEEDS);
  if (options.market !== "RU" && !options.language.toLowerCase().startsWith("ru")) {
    return analyzeWordstatDemand({ checkedAt, options, pages, seeds: uniqueSeeds.map((seed) => ({ seed, totalCount: null, phrases: [], measured: false })), statusState: "not_applicable", statusMessage: "Wordstat applies to Russian-market reports.", brandKeys: deps.brandKeys });
  }
  const env = deps.env || process.env;
  const apiKey = env.YANDEX_SEARCH_API_KEY?.trim();
  const folderId = env.YANDEX_SEARCH_FOLDER_ID?.trim();
  if (!apiKey || !folderId) {
    return analyzeWordstatDemand({
      checkedAt,
      options,
      pages,
      seeds: uniqueSeeds.map((seed) => ({ seed, totalCount: null, phrases: [], measured: false })),
      statusState: "unavailable",
      statusMessage: "Wordstat credentials are unavailable.",
      brandKeys: deps.brandKeys,
      limitations: ["Wordstat demand was not measured; run the supplied phrases manually in Yandex Wordstat."],
    });
  }
  const fetcher = deps.fetch || globalThis.fetch;
  let requestCount = 0;
  let failures = 0;
  const request = async (method: "topRequests" | "dynamics" | "regions", body: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
    requestCount += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetcher(`${WORDSTAT_BASE}/${method}`, {
        method: "POST",
        headers: { Authorization: `Api-Key ${apiKey}`, "x-folder-id": folderId, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("provider unavailable");
      const payload = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid provider response");
      return payload as Record<string, unknown>;
    } catch {
      failures += 1;
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const seeds: WordstatSeedEvidence[] = [];
  for (const seed of uniqueSeeds) {
    const payload = await request("topRequests", { phrase: seed, regionIds: [Number(options.region) || 225], pageSize: MAX_PHRASES });
    if (!payload) {
      seeds.push({ seed, totalCount: null, phrases: [], measured: false });
      continue;
    }
    seeds.push({
      seed,
      totalCount: parseWordstatCount(readValue(payload, ["totalCount", "count", "shows"])),
      phrases: readArray(payload, ["topRequests", "requests", "results", "items"]).map(parsePhrase).filter((item): item is WordstatPhrase => Boolean(item)).slice(0, MAX_PHRASES),
    });
  }
  let analysis = analyzeWordstatDemand({ checkedAt, options, pages, seeds, brandKeys: deps.brandKeys });
  const gaps = analysis.clusters
    .filter((cluster) => !cluster.brand && (cluster.coverage === "missing" || cluster.coverage === "partial"))
    .sort((left, right) => (right.totalCount ?? -1) - (left.totalCount ?? -1) || (left.coverage === "missing" ? -1 : 1))
    .slice(0, MAX_ENRICHED_GAPS);
  const period = completedMonths(now);
  for (const gap of gaps) {
    const target = seeds.find((seed) => seed.seed === gap.seed)!;
    const dynamics = await request("dynamics", { phrase: gap.seed, regionIds: [Number(options.region) || 225], ...period });
    const regions = await request("regions", { phrase: gap.seed });
    if (dynamics) target.dynamics = parseDynamics(dynamics);
    if (regions) target.regions = parseRegions(regions);
  }
  const successful = requestCount - failures;
  const state: WordstatCollectionState = successful === 0 ? "unavailable" : failures > 0 ? "partial" : "success";
  analysis = analyzeWordstatDemand({
    checkedAt,
    options,
    pages,
    seeds,
    brandKeys: deps.brandKeys,
    statusState: state,
    statusMessage: state === "success" ? "Wordstat demand collected." : state === "partial" ? "Wordstat demand was collected partially." : "Wordstat demand is unavailable.",
    requestCount,
    limitations: failures ? [`${failures} Wordstat request(s) were unavailable; valid evidence was preserved.`] : [],
  });
  return analysis;
}
