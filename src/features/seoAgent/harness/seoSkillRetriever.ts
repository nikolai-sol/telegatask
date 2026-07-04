import type {
  SeoCrawlerSnapshot,
  SeoKeywordInsight,
  SeoOpportunity,
  SeoPageSpeedSnapshot,
  SeoRankTrackingSnapshot,
  SeoRecommendation,
  SeoSearchConsoleSnapshot,
  SeoSourceStatus,
  SeoTechnicalSnapshot,
} from "../types";
import { SEO_SKILL_LIBRARY, type SeoProceduralSkill } from "./seoSkillLibrary";

export type NormalizedSeoSourceOutputs = {
  searchConsole?: SeoSearchConsoleSnapshot;
  yandexWebmaster?: SeoSearchConsoleSnapshot;
  pagespeed?: SeoPageSpeedSnapshot;
  crawler?: SeoCrawlerSnapshot;
  rankTracking?: SeoRankTrackingSnapshot;
  keywords?: SeoKeywordInsight[];
  opportunities?: SeoOpportunity[];
  recommendations?: SeoRecommendation[];
  technical?: SeoTechnicalSnapshot;
  sourceStatuses?: SeoSourceStatus[];
};

export type RetrievedSeoSkill = SeoProceduralSkill & {
  score: number;
};

function textParts(input: { domain: string; outputs: NormalizedSeoSourceOutputs }): string[] {
  const parts = [input.domain];
  const { outputs } = input;

  for (const status of outputs.sourceStatuses || []) {
    parts.push(status.source, status.status, status.message, status.errorCode || "");
  }
  for (const item of outputs.technical?.highlights || []) parts.push(item);
  for (const item of outputs.keywords || []) parts.push(item.keyword, item.currentUrl || "", item.type);
  for (const item of outputs.opportunities || []) {
    parts.push(item.title, item.description, item.reasoning || "", item.recommendedAction || "", item.type, item.opportunityType || "");
  }
  for (const item of outputs.recommendations || []) parts.push(item.title, item.description, item.type);
  for (const query of outputs.searchConsole?.topQueries || []) parts.push(query);
  for (const page of outputs.searchConsole?.topPages || []) parts.push(page);
  for (const query of outputs.yandexWebmaster?.topQueries || []) parts.push(query);
  for (const page of outputs.yandexWebmaster?.topPages || []) parts.push(page);

  const crawler = outputs.crawler;
  if (crawler) {
    if (crawler.hasTitle === false) parts.push("missing title metadata");
    if (crawler.hasMetaDescription === false) parts.push("missing meta description metadata");
    if (crawler.hasH1 === false) parts.push("missing h1 metadata");
    if (crawler.isIndexable === false) parts.push("blocked noindex indexable");
    if (crawler.robotsTxtReachable === false || crawler.sitemapXmlReachable === false) parts.push("robots sitemap blocked");
  }

  const pagespeed = outputs.pagespeed;
  if (pagespeed) {
    if (pagespeed.performanceScore !== null) parts.push("pagespeed performance lighthouse core web vitals");
    if (pagespeed.largestContentfulPaintMs !== null) parts.push("lcp largest contentful paint");
    if (pagespeed.largestContentfulPaintMs !== null && pagespeed.largestContentfulPaintMs > 2500) parts.push("low mobile lcp slow");
  }

  if ((outputs.searchConsole?.impressions || 0) > 0) parts.push("gsc impressions search console");
  if (outputs.searchConsole?.ctr !== null && outputs.searchConsole?.ctr !== undefined && outputs.searchConsole.ctr < 2) {
    parts.push("low ctr snippet");
  }
  if ((outputs.yandexWebmaster?.impressions || 0) > 0) parts.push("yandex webmaster impressions search demand");
  if (
    outputs.yandexWebmaster?.ctr !== null &&
    outputs.yandexWebmaster?.ctr !== undefined &&
    outputs.yandexWebmaster.ctr < 2
  ) {
    parts.push("low yandex ctr snippet");
  }

  return parts;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function scoreSkill(skill: SeoProceduralSkill, haystack: string): number {
  let score = 0;
  for (const phrase of skill.triggerKeywords) {
    const normalizedPhrase = phrase.toLowerCase();
    if (haystack.includes(normalizedPhrase)) {
      score += normalizedPhrase.includes(" ") ? 3 : 2;
      continue;
    }
    const tokens = tokenize(normalizedPhrase);
    for (const token of tokens) {
      if (token.length > 2 && haystack.includes(token)) score += 1;
    }
  }
  return score;
}

export function retrieveSeoSkills(input: {
  domain: string;
  normalizedSourceOutputs: NormalizedSeoSourceOutputs;
  limit?: number;
}): RetrievedSeoSkill[] {
  const limit = Math.max(1, Math.min(3, input.limit || 3));
  const haystack = textParts({ domain: input.domain, outputs: input.normalizedSourceOutputs }).join(" ").toLowerCase();

  return SEO_SKILL_LIBRARY.map((skill) => ({ ...skill, score: scoreSkill(skill, haystack) }))
    .filter((skill) => skill.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}
