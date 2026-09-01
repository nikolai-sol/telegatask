import type { SeoSourceName } from "../types";
import { MockSeoDataProvider } from "./mockSeoDataProvider";
import { SeoProviderNotConfiguredError, type SeoDataProvider } from "./seoDataProvider";
import { SistrixSeoDataProvider } from "./sistrixSeoDataProvider";

const ALL_SOURCE_NAMES: SeoSourceName[] = [
  "mock",
  "sistrix",
  "pagespeed",
  "crawler",
  "gsc",
  "yandex_webmaster",
  "google_serp_rank",
  "yandex_serp_rank",
];

const SOURCE_ALIASES: Record<string, SeoSourceName> = {
  mock: "mock",
  sistrix: "sistrix",
  pagespeed: "pagespeed",
  psi: "pagespeed",
  crawler: "crawler",
  basic_crawler: "crawler",
  gsc: "gsc",
  search_console: "gsc",
  google_search_console: "gsc",
  owned_search_console: "gsc",
  yandex_webmaster: "yandex_webmaster",
  yandex_webmaster_tools: "yandex_webmaster",
  yandex_search_console: "yandex_webmaster",
  google_serp_rank: "google_serp_rank",
  google_rank: "google_serp_rank",
  google_rank_tracking: "google_serp_rank",
  yandex_serp_rank: "yandex_serp_rank",
  yandex_rank: "yandex_serp_rank",
  yandex_rank_tracking: "yandex_serp_rank",
};

export type SeoSourceMode = "single" | "multi";

export type SeoSourceSelection = {
  mode: SeoSourceMode;
  selectedSources: SeoSourceName[];
  allSources: SeoSourceName[];
};

function normalizeRequestedSources(values: string[]): SeoSourceName[] {
  const deduped = new Set<SeoSourceName>();

  for (const value of values) {
    const source = SOURCE_ALIASES[String(value || "").trim().toLowerCase()];
    if (!source) {
      throw new SeoProviderNotConfiguredError(`Unsupported SEO data source: ${String(value || "").trim()}`);
    }
    deduped.add(source);
  }

  return Array.from(deduped);
}

function parseEnvSourceList(raw: string): string[] {
  return String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function resolveSeoSourceSelection(explicitSources?: string[]): SeoSourceSelection {
  if (Array.isArray(explicitSources) && explicitSources.length > 0) {
    return {
      mode: "multi",
      selectedSources: normalizeRequestedSources(explicitSources),
      allSources: ALL_SOURCE_NAMES,
    };
  }

  const envSources = parseEnvSourceList(process.env.SEO_DATA_SOURCES || "");
  const enabledSources = parseEnvSourceList(process.env.SEO_ENABLED_SOURCES || "");
  const effectiveSources = enabledSources.length > 0 ? enabledSources : envSources;
  if (effectiveSources.length > 0) {
    return {
      mode: "multi",
      selectedSources: normalizeRequestedSources(effectiveSources),
      allSources: ALL_SOURCE_NAMES,
    };
  }

  const provider = String(process.env.SEO_DATA_PROVIDER || "mock").trim().toLowerCase();
  if (!provider || provider === "mock") {
    return {
      mode: "multi",
      selectedSources: ["crawler", "pagespeed", "google_serp_rank"],
      allSources: ALL_SOURCE_NAMES,
    };
  }
  if (provider === "sistrix") {
    return {
      mode: "single",
      selectedSources: ["sistrix"],
      allSources: ALL_SOURCE_NAMES,
    };
  }

  throw new SeoProviderNotConfiguredError(`Unsupported SEO_DATA_PROVIDER: ${provider}`);
}

export function isRankingSource(source: SeoSourceName): source is "mock" | "sistrix" {
  return source === "mock" || source === "sistrix";
}

export function createRankingProvider(source: "mock" | "sistrix"): SeoDataProvider {
  if (source === "mock") return new MockSeoDataProvider();
  return new SistrixSeoDataProvider();
}
