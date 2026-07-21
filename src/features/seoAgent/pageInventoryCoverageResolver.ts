export type SeoPageInventoryItem = {
  url: string;
  title?: string | null;
  h1?: string | null;
};

export type SeoPageInventoryCoverageCluster = {
  clusterId: string;
  query: string;
  section: string;
};

export type SeoPageInventoryCoverageConfig = {
  minCoveredTitleTokens: number;
  minPartialTitleTokens: number;
  stopWords?: readonly string[];
};

export type SeoPageInventoryCoverageResult = {
  verdict: "covered" | "partial" | "gap";
  matchingArticleUrl: string | null;
  matchedTitleTokens: string[];
  matchedSectionTokens: string[];
};

export const DEFAULT_PAGE_INVENTORY_COVERAGE_CONFIG: SeoPageInventoryCoverageConfig = {
  minCoveredTitleTokens: 2,
  minPartialTitleTokens: 1,
};

const DEFAULT_STOPWORDS = new Set([
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
  "адрес",
  "форум",
  "обсуждение",
  "отзывы",
  "отзыв",
  "вопрос",
  "ответ",
  "страница",
]);

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value: unknown): string {
  return cleanString(value)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSection(value: string): string {
  const cleaned = cleanString(value);
  if (!cleaned) return "/";
  const withLeadingSlash = cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

function pathnameForUrl(value: string): string {
  const cleaned = cleanString(value);
  if (!cleaned) return "/";
  try {
    return normalizeSection(new URL(cleaned).pathname);
  } catch {
    return normalizeSection(cleaned.replace(/^https?:\/\/[^/]+/i, ""));
  }
}

function tokens(value: unknown, stopWords: ReadonlySet<string>): string[] {
  return Array.from(new Set(
    normalizeText(value)
      .split(" ")
      .map(cleanString)
      .filter((token) => token.length >= 3 && !stopWords.has(token))
  ));
}

function sectionTokens(value: string, stopWords: ReadonlySet<string>): string[] {
  return tokens(value.replace(/\//g, " "), stopWords);
}

function scoreRank(verdict: SeoPageInventoryCoverageResult["verdict"]): number {
  if (verdict === "covered") return 3;
  if (verdict === "partial") return 2;
  return 1;
}

export function resolvePageInventoryCoverage(input: {
  cluster: SeoPageInventoryCoverageCluster;
  inventory: readonly SeoPageInventoryItem[];
  config?: Partial<SeoPageInventoryCoverageConfig>;
}): SeoPageInventoryCoverageResult {
  const config = {
    ...DEFAULT_PAGE_INVENTORY_COVERAGE_CONFIG,
    ...(input.config || {}),
  };
  const stopWords = new Set([...(config.stopWords || []), ...Array.from(DEFAULT_STOPWORDS)]);
  const clusterSection = normalizeSection(input.cluster.section);
  const queryTokens = tokens(input.cluster.query, stopWords);
  const clusterSectionTokens = sectionTokens(clusterSection, stopWords);
  let best: SeoPageInventoryCoverageResult = {
    verdict: "gap",
    matchingArticleUrl: null,
    matchedTitleTokens: [],
    matchedSectionTokens: [],
  };

  for (const page of input.inventory) {
    const pagePath = pathnameForUrl(page.url);
    const sameSection = pagePath === clusterSection || pagePath.startsWith(clusterSection);
    if (!sameSection) continue;

    const titleTokens = new Set(tokens(`${page.title || ""} ${page.h1 || ""}`, stopWords));
    const matchedTitleTokens = queryTokens.filter((token) => titleTokens.has(token));
    const matchedSectionTokens = clusterSectionTokens.filter((token) => pagePath.includes(token));
    const covered = matchedTitleTokens.length >= config.minCoveredTitleTokens;
    const partial = !covered && matchedTitleTokens.length >= config.minPartialTitleTokens;
    const verdict: SeoPageInventoryCoverageResult["verdict"] = covered ? "covered" : partial ? "partial" : "gap";
    const coverage: SeoPageInventoryCoverageResult = {
      verdict,
      matchingArticleUrl: verdict === "gap" ? null : page.url,
      matchedTitleTokens,
      matchedSectionTokens,
    };
    if (
      scoreRank(coverage.verdict) > scoreRank(best.verdict) ||
      (
        scoreRank(coverage.verdict) === scoreRank(best.verdict) &&
        coverage.matchedTitleTokens.length > best.matchedTitleTokens.length
      )
    ) {
      best = coverage;
    }
    if (best.verdict === "covered") break;
  }

  return best;
}
