import {
  classifySemanticIntent,
  normalizeSemanticIntentText,
  type SeoSemanticIntentClassification,
  type SeoSemanticIntentClassifierConfig,
} from "./semanticIntentClassifier";
import {
  resolvePageInventoryCoverage,
  type SeoPageInventoryCoverageConfig,
  type SeoPageInventoryItem,
} from "./pageInventoryCoverageResolver";

export type ForumDiscoveryClusterConfig = {
  clusterId: string;
  label: string;
  seedQuery: string;
  section: string;
};

export type ForumDiscoveryQuery = {
  clusterId: string;
  query: string;
  modifier: string;
};

export type ForumDiscoveryCoveragePage = {
  url: string;
  section: string;
  title: string;
  h1?: string;
  keywords: readonly string[];
};

export type ForumDiscoverySearchResult = {
  query: string;
  clusterId: string;
  domain: string;
  url: string;
  title?: string;
  snippet?: string;
  date?: string | null;
  position?: number | null;
};

export type ForumThreadCoverage = {
  verdict: "covered" | "partial" | "gap";
  matchingArticleUrl: string | null;
  matchedKeywordCount: number;
  matchedKeywords: string[];
  matchedTitleTokens: string[];
};

export type ForumThreadDiscoveryThread = {
  clusterId: string;
  clusterLabel: string;
  sourceDomain: string;
  url: string;
  title: string;
  questionText: string;
  date: string | null;
  query: string;
  position: number | null;
  intent: SeoSemanticIntentClassification;
  coverage: ForumThreadCoverage;
  safety: {
    neverAnswerable: boolean;
    competitorExcluded: boolean;
    authorPiiStored: false;
  };
};

export type ForumThreadDomainFrequency = {
  domain: string;
  threads: number;
  answerableThreads: number;
  gapThreads: number;
};

export type ForumThreadDiscoveryReport = {
  schemaVersion: "seo_os_forum_thread_discovery_v1";
  generatedAt: string;
  source: "fixture" | "yandex_search_api" | "local_dry_run";
  summary: {
    clusters: number;
    rawResults: number;
    acceptedThreads: number;
    coveredThreads: number;
    partialThreads: number;
    gapThreads: number;
    neverAnswerableThreads: number;
    competitorExcludedThreads: number;
  };
  queries: ForumDiscoveryQuery[];
  threads: ForumThreadDiscoveryThread[];
  domainFrequency: ForumThreadDomainFrequency[];
  noCoverageThreads: ForumThreadDiscoveryThread[];
  sideEffects: {
    firestoreWrites: false;
    mysqlWrites: false;
    hermesCalls: false;
    postingActions: false;
    answerDraftsCreated: false;
  };
  notes: string[];
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function normalizeSection(value: string): string {
  const cleaned = cleanString(value);
  if (!cleaned) return "/";
  const withLeadingSlash = cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

function normalizeDomain(value: string): string {
  const cleaned = cleanString(value).toLowerCase();
  if (!cleaned) return "";
  try {
    return new URL(cleaned.startsWith("http") ? cleaned : `https://${cleaned}`).hostname.replace(/^www\./, "");
  } catch {
    return cleaned.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

function isOwnDomain(domain: string): boolean {
  return normalizeDomain(domain) === "zaruku.ru";
}

function isLikelyThreadResult(result: ForumDiscoverySearchResult): boolean {
  if (isOwnDomain(result.domain) || isOwnDomain(result.url)) return false;
  const haystack = normalizeSemanticIntentText(
    `${result.domain} ${result.url} ${result.query} ${result.title || ""} ${result.snippet || ""}`
  );
  return [
    "forum",
    "форум",
    "thread",
    "topic",
    "otzovik",
    "отзовик",
    "irecommend",
    "woman",
    "babyblog",
    "pikabu",
    "dzen",
    "t me",
    "telegram",
    "обсуждение",
    "обсуждают",
    "отзывы",
    "отзыв",
    "вопрос",
    "ответ",
  ].some((token) => haystack.includes(token));
}

const COVERAGE_STOPWORDS = new Set([
  "как",
  "что",
  "это",
  "при",
  "для",
  "после",
  "если",
  "или",
  "про",
  "где",
  "кто",
  "кому",
  "нужно",
  "можно",
  "надо",
  "форум",
  "обсуждение",
  "отзывы",
  "отзыв",
  "вопрос",
  "ответ",
  "страница",
]);

function contentTokens(value: unknown): string[] {
  return Array.from(new Set(
    normalizeSemanticIntentText(value)
      .split(" ")
      .map(cleanString)
      .filter((token) => token.length >= 3 && !COVERAGE_STOPWORDS.has(token))
  ));
}

export function buildForumDiscoveryQueries(input: {
  clusters: readonly ForumDiscoveryClusterConfig[];
  modifiers: readonly string[];
  maxQueriesPerCluster: number;
}): ForumDiscoveryQuery[] {
  const maxQueriesPerCluster = Math.max(0, Math.floor(input.maxQueriesPerCluster));
  const modifiers = input.modifiers.map(cleanString).filter(Boolean).slice(0, maxQueriesPerCluster);
  const queries: ForumDiscoveryQuery[] = [];
  for (const cluster of input.clusters) {
    const seedQuery = cleanString(cluster.seedQuery);
    if (!seedQuery) continue;
    for (const modifier of modifiers) {
      queries.push({
        clusterId: cluster.clusterId,
        query: `${seedQuery} ${modifier}`,
        modifier,
      });
    }
  }
  return queries;
}

export function sanitizeForumThreadText(value: unknown): string {
  return stripTags(cleanString(value))
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email-redacted]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone-redacted]")
    .replace(/(^|\s)@[a-zA-Z0-9_]{4,}/g, "$1[handle-redacted]")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreCoverage(input: {
  cluster: ForumDiscoveryClusterConfig;
  result: ForumDiscoverySearchResult;
  page: ForumDiscoveryCoveragePage;
}): ForumThreadCoverage {
  const text = normalizeSemanticIntentText(
    `${input.cluster.label} ${input.cluster.seedQuery} ${input.result.title || ""} ${input.result.snippet || ""}`
  );
  const matchedKeywords = Array.from(
    new Set(input.page.keywords.filter((keyword) => {
      const normalizedKeyword = normalizeSemanticIntentText(keyword);
      return normalizedKeyword && ` ${text} `.includes(` ${normalizedKeyword} `);
    }))
  );
  const sameSection = normalizeSection(input.cluster.section) === normalizeSection(input.page.section);
  const articleTitleTokens = new Set(contentTokens(`${input.page.title} ${input.page.h1 || ""}`));
  const questionIntentTokens = contentTokens(`${input.cluster.seedQuery} ${input.result.title || ""} ${input.result.snippet || ""}`);
  const matchedTitleTokens = questionIntentTokens.filter((token) => articleTitleTokens.has(token));
  const covered = sameSection && matchedTitleTokens.length >= 2;
  const partial = sameSection && !covered && matchedKeywords.length >= 2;
  return {
    verdict: covered ? "covered" : partial ? "partial" : "gap",
    matchingArticleUrl: covered || partial ? input.page.url : null,
    matchedKeywordCount: matchedKeywords.length,
    matchedKeywords,
    matchedTitleTokens,
  };
}

function findCoverage(input: {
  cluster: ForumDiscoveryClusterConfig;
  result: ForumDiscoverySearchResult;
  coveragePages: readonly ForumDiscoveryCoveragePage[];
  inventoryPages?: readonly SeoPageInventoryItem[];
  inventoryCoverageConfig?: Partial<SeoPageInventoryCoverageConfig>;
  answerable: boolean;
}): ForumThreadCoverage {
  if (!input.answerable) {
    return {
      verdict: "gap",
      matchingArticleUrl: null,
      matchedKeywordCount: 0,
      matchedKeywords: [],
      matchedTitleTokens: [],
    };
  }
  if (input.inventoryPages?.length) {
    const coverage = resolvePageInventoryCoverage({
      cluster: {
        clusterId: input.cluster.clusterId,
        query: `${input.cluster.seedQuery} ${input.result.title || ""} ${input.result.snippet || ""}`,
        section: input.cluster.section,
      },
      inventory: input.inventoryPages,
      config: input.inventoryCoverageConfig,
    });
    return {
      verdict: coverage.verdict,
      matchingArticleUrl: coverage.matchingArticleUrl,
      matchedKeywordCount: coverage.matchedTitleTokens.length,
      matchedKeywords: [...coverage.matchedTitleTokens],
      matchedTitleTokens: coverage.matchedTitleTokens,
    };
  }
  let best: ForumThreadCoverage = {
    verdict: "gap",
    matchingArticleUrl: null,
    matchedKeywordCount: 0,
    matchedKeywords: [],
    matchedTitleTokens: [],
  };
  for (const page of input.coveragePages) {
    const coverage = scoreCoverage({ cluster: input.cluster, result: input.result, page });
    const bestRank = best.verdict === "covered" ? 3 : best.verdict === "partial" ? 2 : 1;
    const coverageRank = coverage.verdict === "covered" ? 3 : coverage.verdict === "partial" ? 2 : 1;
    if (
      coverageRank > bestRank ||
      (coverageRank === bestRank && coverage.matchedKeywordCount > best.matchedKeywordCount)
    ) {
      best = coverage;
    }
    if (best.verdict === "covered") break;
  }
  return best;
}

function domainFrequency(threads: ForumThreadDiscoveryThread[]): ForumThreadDomainFrequency[] {
  const byDomain = new Map<string, ForumThreadDomainFrequency>();
  for (const thread of threads) {
    const existing = byDomain.get(thread.sourceDomain) || {
      domain: thread.sourceDomain,
      threads: 0,
      answerableThreads: 0,
      gapThreads: 0,
    };
    existing.threads += 1;
    if (!thread.safety.neverAnswerable && !thread.safety.competitorExcluded) existing.answerableThreads += 1;
    if (thread.coverage.verdict === "gap") existing.gapThreads += 1;
    byDomain.set(thread.sourceDomain, existing);
  }
  return Array.from(byDomain.values()).sort((a, b) => b.threads - a.threads || a.domain.localeCompare(b.domain));
}

export function buildForumThreadDiscoveryReport(input: {
  generatedAt: string;
  source: ForumThreadDiscoveryReport["source"];
  clusters: readonly ForumDiscoveryClusterConfig[];
  results: readonly ForumDiscoverySearchResult[];
  coveragePages: readonly ForumDiscoveryCoveragePage[];
  inventoryPages?: readonly SeoPageInventoryItem[];
  inventoryCoverageConfig?: Partial<SeoPageInventoryCoverageConfig>;
  semanticIntentConfig: SeoSemanticIntentClassifierConfig;
  queries?: readonly ForumDiscoveryQuery[];
}): ForumThreadDiscoveryReport {
  const clustersById = new Map(input.clusters.map((cluster) => [cluster.clusterId, cluster]));
  const threads: ForumThreadDiscoveryThread[] = [];
  for (const result of input.results) {
    const cluster = clustersById.get(result.clusterId);
    if (!cluster || !isLikelyThreadResult(result)) continue;
    const title = sanitizeForumThreadText(result.title || "");
    const snippet = sanitizeForumThreadText(result.snippet || "");
    const intent = classifySemanticIntent(`${title} ${snippet} ${cluster.label}`, input.semanticIntentConfig);
    const answerable = intent.intentClass !== "drug_compliance" && intent.intentClass !== "competitor_brand";
    threads.push({
      clusterId: cluster.clusterId,
      clusterLabel: cluster.label,
      sourceDomain: normalizeDomain(result.domain || result.url),
      url: cleanString(result.url),
      title,
      questionText: sanitizeForumThreadText(`${title} ${snippet}`),
      date: cleanString(result.date) || null,
      query: cleanString(result.query),
      position: typeof result.position === "number" ? result.position : null,
      intent,
      coverage: findCoverage({
        cluster,
        result,
        coveragePages: input.coveragePages,
        inventoryPages: input.inventoryPages,
        inventoryCoverageConfig: input.inventoryCoverageConfig,
        answerable,
      }),
      safety: {
        neverAnswerable: intent.intentClass === "drug_compliance",
        competitorExcluded: intent.intentClass === "competitor_brand",
        authorPiiStored: false,
      },
    });
  }

  const coveredThreads = threads.filter((thread) => thread.coverage.verdict === "covered").length;
  const partialThreads = threads.filter((thread) => thread.coverage.verdict === "partial").length;
  const gapThreads = threads.filter((thread) => thread.coverage.verdict === "gap").length;
  const neverAnswerableThreads = threads.filter((thread) => thread.safety.neverAnswerable).length;
  const competitorExcludedThreads = threads.filter((thread) => thread.safety.competitorExcluded).length;

  return {
    schemaVersion: "seo_os_forum_thread_discovery_v1",
    generatedAt: input.generatedAt,
    source: input.source,
    summary: {
      clusters: input.clusters.length,
      rawResults: input.results.length,
      acceptedThreads: threads.length,
      coveredThreads,
      partialThreads,
      gapThreads,
      neverAnswerableThreads,
      competitorExcludedThreads,
    },
    queries: [...(input.queries || [])],
    threads,
    domainFrequency: domainFrequency(threads),
    noCoverageThreads: threads.filter((thread) => thread.coverage.verdict === "gap"),
    sideEffects: {
      firestoreWrites: false,
      mysqlWrites: false,
      hermesCalls: false,
      postingActions: false,
      answerDraftsCreated: false,
    },
    notes: [
      "Read-only forum/thread discovery boundary.",
      "No reply drafts, no Hermes calls, no posting actions, no account actions.",
      "Only sanitized thread title/snippet text is stored; usernames, profiles and author fields are not collected.",
      "Drug-compliance and competitor-brand matches remain in the recon report but are excluded from the answerable set.",
    ],
  };
}
