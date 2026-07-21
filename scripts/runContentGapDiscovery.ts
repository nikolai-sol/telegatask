import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { buildContentGapDiscoveryReport, type ContentGapYandexSignal } from "../src/features/seoAgent/contentGapDiscovery";
import {
  buildForumDiscoveryQueries,
  buildForumThreadDiscoveryReport,
  type ForumDiscoveryClusterConfig,
  type ForumDiscoverySearchResult,
  type ForumThreadDiscoveryReport,
  type ForumThreadDiscoveryThread,
} from "../src/features/seoAgent/forumThreadDiscovery";
import {
  resolvePageInventoryCoverage,
  type SeoPageInventoryItem,
} from "../src/features/seoAgent/pageInventoryCoverageResolver";
import { normalizeResultDomain } from "../src/features/seoAgent/providers/serpMatching";
import { zarukuSeoProductionConfig } from "../src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig";

type YandexSearchResponse = {
  id?: string;
  done?: boolean;
  response?: {
    rawData?: string;
  };
};

const DEFAULT_MODIFIERS = ["форум", "обсуждение"];
const PREVIOUS_TASK_056_ARTIFACT = "reports/task-056-zaruku-forum-thread-discovery-2026-07-17.json";

const EXTRA_CLUSTERS: ForumDiscoveryClusterConfig[] = [
  {
    clusterId: "oncology_sanatorium",
    label: "санаторно-курортное лечение онкобольным",
    seedQuery: "санаторно курортное лечение онкобольным",
    section: "/obshie-temy/",
  },
];

const LEGACY_TASK_056_CLUSTERS: ForumDiscoveryClusterConfig[] = [
  {
    clusterId: "breast_disability",
    label: "инвалидность при раке молочной железы",
    seedQuery: "инвалидность при раке молочной железы",
    section: "/rak-molochnoj-zhelezy/",
  },
  {
    clusterId: "subungual_melanoma",
    label: "подногтевая меланома",
    seedQuery: "подногтевая меланома",
    section: "/melanoma/",
  },
  {
    clusterId: "lung_cancer_symptoms_treatment",
    label: "рак легкого симптомы лечение",
    seedQuery: "рак легкого симптомы лечение",
    section: "/rak-lyogkogo/",
  },
  {
    clusterId: "breast_rehab",
    label: "реабилитация восстановление после РМЖ",
    seedQuery: "реабилитация восстановление после рмж",
    section: "/rak-molochnoj-zhelezy/",
  },
  ...EXTRA_CLUSTERS,
];

const ZARUKU_SITEMAP_INVENTORY: SeoPageInventoryItem[] = [
  {
    url: "https://zaruku.ru/rak-molochnoj-zhelezy/invalidnost-pri-rake-molochnoj-zhelezy-kak-poluchit-i-kakie-preimushestva-ona-daet/",
    title: "Инвалидность при раке молочной железы",
    h1: "Инвалидность при раке молочной железы",
  },
  {
    url: "https://zaruku.ru/rak-molochnoj-zhelezy/reabilitaciya-posle-raka-molochnoj-zhelezy-5-napravlenij/",
    title: "Реабилитация после рака молочной железы",
    h1: "Реабилитация после рака молочной железы",
  },
  {
    url: "https://zaruku.ru/rak-molochnoj-zhelezy/diagnostika",
    title: "Диагностика рака молочной железы",
    h1: "Диагностика рака молочной железы",
  },
  {
    url: "https://zaruku.ru/rak-molochnoj-zhelezy/lechenie",
    title: "Лечение рака молочной железы",
    h1: "Лечение рака молочной железы",
  },
  {
    url: "https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/",
    title: "Подногтевая меланома",
    h1: "Подногтевая меланома: там, где не видно",
  },
  {
    url: "https://zaruku.ru/rak-lyogkogo/diagnostika",
    title: "Диагностика рака легкого",
    h1: "Диагностика рака легкого",
  },
  {
    url: "https://zaruku.ru/rak-lyogkogo/lechenie",
    title: "Лечение рака легкого",
    h1: "Лечение рака легкого",
  },
  {
    url: "https://zaruku.ru/rak-lyogkogo/pri-kakom-kashle-nuzhno-obsledovatsya-na-rak-legkogo/",
    title: "При каком кашле нужно обследоваться на рак легкого",
    h1: "При каком кашле нужно обследоваться на рак легкого",
  },
  {
    url: "https://zaruku.ru/rak-pecheni/invalidnost-pri-gepatocellyulyarnoj-karcinome-komu-polozhena-i-chto-daet-ee-poluchenie/",
    title: "Инвалидность при гепатоцеллюлярной карциноме",
    h1: "Инвалидность при гепатоцеллюлярной карциноме",
  },
  {
    url: "https://zaruku.ru/obshie-temy/kak-i-zachem-oformlyat-invalidnost-onkopacientam/",
    title: "Как и зачем оформлять инвалидность онкопациентам",
    h1: "Как и зачем оформлять инвалидность онкопациентам",
  },
  {
    url: "https://zaruku.ru/map/moskva/organization_1425/",
    title: "Онкологический центр в Сколково",
    h1: "Онкологический центр в Сколково",
  },
  {
    url: "https://zaruku.ru/map/sankt_peterburg/organization_959/",
    title: "ЦАОП Пушкинского района СПб",
    h1: "ЦАОП Пушкинского района",
  },
  {
    url: "https://zaruku.ru/kompleksnoe_genomnoe_profilirovanie/",
    title: "Комплексное геномное профилирование",
    h1: "Комплексное геномное профилирование опухоли",
  },
  {
    url: "https://zaruku.ru/vnimatelney_k_sebe/",
    title: "Внимательней к себе: как проверить себя на признаки рака",
    h1: "Как проверить себя на признаки рака",
  },
];

const YANDEX_SIGNAL_EVIDENCE: ContentGapYandexSignal[] = [
  {
    clusterId: "oncology_sanatorium",
    impressions: 7,
    clicks: 1,
    ctr: 14.29,
    source: "Notion TASK-065 WM baseline note: treatment_therapy cluster CTR 14.29%",
  },
];

const TASK_060_ACCEPTANCE_CLUSTERS: ForumDiscoveryClusterConfig[] = [
  {
    clusterId: "seed_map_skolkovo_oncology_center",
    label: "онкологический центр в сколково адрес",
    seedQuery: "онкологический центр в сколково адрес",
    section: "/map/",
  },
  {
    clusterId: "seed_map_pushkinsky_caop",
    label: "цаоп пушкинского района спб",
    seedQuery: "цаоп пушкинского района спб",
    section: "/map/",
  },
  {
    clusterId: "seed_kgp_definition",
    label: "комплексное геномное профилирование опухоли что это",
    seedQuery: "комплексное геномное профилирование опухоли что это",
    section: "/kompleksnoe_genomnoe_profilirovanie/",
  },
  {
    clusterId: "seed_kgp_who_needs",
    label: "кому нужно комплексное геномное профилирование опухоли",
    seedQuery: "кому нужно комплексное геномное профилирование опухоли",
    section: "/kompleksnoe_genomnoe_profilirovanie/",
  },
  {
    clusterId: "seed_self_check_screening",
    label: "как проверить себя на признаки рака",
    seedQuery: "как проверить себя на признаки рака",
    section: "/vnimatelney_k_sebe/",
  },
];

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readFlag(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  return cleanString(args[index + 1]) || null;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function requiredFlag(args: string[], name: string): string {
  const value = readFlag(args, name);
  if (!value) {
    throw new Error("Usage: runContentGapDiscovery --out <report.json> [--send-telegram] [--max-queries-per-cluster 2]");
  }
  return value;
}

function readNumberFlag(args: string[], name: string, defaultValue: number): number {
  const raw = readFlag(args, name);
  if (!raw) return defaultValue;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : defaultValue;
}

function task060ResolverAcceptanceChecks(): Array<{
  clusterId: string;
  query: string;
  section: string;
  verdict: "covered" | "partial" | "gap";
  matchingArticleUrl: string | null;
  matchedTitleTokens: string[];
}> {
  return TASK_060_ACCEPTANCE_CLUSTERS.map((cluster) => {
    const result = resolvePageInventoryCoverage({
      cluster: {
        clusterId: cluster.clusterId,
        query: cluster.seedQuery,
        section: cluster.section,
      },
      inventory: ZARUKU_SITEMAP_INVENTORY,
    });
    return {
      clusterId: cluster.clusterId,
      query: cluster.seedQuery,
      section: cluster.section,
      verdict: result.verdict,
      matchingArticleUrl: result.matchingArticleUrl,
      matchedTitleTokens: result.matchedTitleTokens,
    };
  });
}

function targetClusters(): ForumDiscoveryClusterConfig[] {
  const fromSemanticProfile = zarukuSeoProductionConfig.sectionRankTracking.seedClusters
    .filter((cluster) => zarukuSeoProductionConfig.semanticIntent.targetIntentClasses.includes(cluster.intentClass))
    .map((cluster) => ({
      clusterId: cluster.clusterId,
      label: cluster.query,
      seedQuery: cluster.query,
      section: cluster.section,
    }));
  const byId = new Map<string, ForumDiscoveryClusterConfig>();
  for (const cluster of [...fromSemanticProfile, ...EXTRA_CLUSTERS]) byId.set(cluster.clusterId, cluster);
  return Array.from(byId.values());
}

function decodeXmlText(value: string): string {
  return cleanString(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeRawData(rawData: string): string {
  const value = cleanString(rawData);
  if (!value) return "";
  if (value.startsWith("<")) return value;
  try {
    return Buffer.from(value, "base64").toString("utf8").trim() || value;
  } catch {
    return value;
  }
}

function xmlEntries(xml: string): Array<{ domain: string; url: string; title: string; snippet: string }> {
  const docs = Array.from(xml.matchAll(/<doc(?:\s[^>]*)?>[\s\S]*?<\/doc>/g)).map((match) => match[0]);
  return docs.map((doc) => {
    const url = decodeXmlText((doc.match(/<url>([\s\S]*?)<\/url>/i) || [])[1] || "");
    return {
      domain: normalizeResultDomain(url),
      url,
      title: decodeXmlText((doc.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || ""),
      snippet: decodeXmlText((doc.match(/<headline>([\s\S]*?)<\/headline>/i) || [])[1] || ""),
    };
  }).filter((entry) => entry.url);
}

async function parseYandexResponse(response: Response): Promise<YandexSearchResponse> {
  return (await response.json()) as YandexSearchResponse;
}

async function pollDeferredResult(operationId: string, apiKey: string): Promise<YandexSearchResponse> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`https://operation.api.cloud.yandex.net/operations/${encodeURIComponent(operationId)}`, {
      headers: { Authorization: `Api-Key ${apiKey}` },
    });
    if (!response.ok) break;
    const payload = await parseYandexResponse(response);
    if (payload.done && payload.response?.rawData) return payload;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return {};
}

async function searchYandex(query: string): Promise<Array<{ domain: string; url: string; title: string; snippet: string }>> {
  const apiKey = cleanString(process.env.YANDEX_SEARCH_API_KEY);
  const folderId = cleanString(process.env.YANDEX_SEARCH_FOLDER_ID);
  if (!apiKey || !folderId) throw new Error("YANDEX_SEARCH_API_KEY and YANDEX_SEARCH_FOLDER_ID are required");
  const mode = cleanString(process.env.YANDEX_SEARCH_MODE).toLowerCase() === "sync" ? "sync" : "deferred";
  const response = await fetch(`https://searchapi.api.cloud.yandex.net/v2/web/${mode === "sync" ? "search" : "searchAsync"}`, {
    method: "POST",
    headers: {
      Authorization: `Api-Key ${apiKey}`,
      "x-folder-id": folderId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: {
        searchType: "SEARCH_TYPE_RU",
        queryText: query,
        page: 0,
        fixTypoMode: "FIX_TYPO_MODE_ON",
      },
      groupSpec: {
        groupMode: "GROUP_MODE_FLAT",
        groupsOnPage: 10,
        docsInGroup: 1,
      },
      region: zarukuSeoProductionConfig.targetRegion,
      l10n: "LOCALIZATION_RU",
      folderId,
      responseFormat: "FORMAT_XML",
    }),
  });
  if (!response.ok) throw new Error(`Yandex Search API failed for "${query}": ${response.status}`);
  let payload = await parseYandexResponse(response);
  if (mode === "deferred") {
    const operationId = cleanString(payload.id);
    payload = operationId ? await pollDeferredResult(operationId, apiKey) : {};
  }
  const rawData = decodeRawData(cleanString(payload.response?.rawData));
  return rawData ? xmlEntries(rawData) : [];
}

function samplePreviousCoveredThreads(path: string, sampleSize: number): ForumThreadDiscoveryThread[] {
  if (!existsSync(path)) return [];
  const previous = JSON.parse(readFileSync(path, "utf8")) as ForumThreadDiscoveryReport;
  const covered = (previous.threads || []).filter((thread) => thread.coverage?.verdict === "covered");
  const byCluster = new Map<string, ForumThreadDiscoveryThread[]>();
  for (const thread of covered) {
    byCluster.set(thread.clusterId, [...(byCluster.get(thread.clusterId) || []), thread]);
  }
  const sample: ForumThreadDiscoveryThread[] = [];
  for (const clusterThreads of byCluster.values()) {
    sample.push(...clusterThreads.slice(0, 2));
    if (sample.length >= sampleSize) return sample.slice(0, sampleSize);
  }
  return sample.concat(covered.filter((thread) => !sample.includes(thread))).slice(0, sampleSize);
}

function reevaluatePreviousCoverage(path: string) {
  const sample = samplePreviousCoveredThreads(path, 10);
  if (!sample.length) {
    return {
      previousArtifactPath: path,
      sampledRows: 0,
      stillCovered: 0,
      downgradedToPartial: 0,
      downgradedToGap: 0,
      rows: [],
    };
  }
  const results: ForumDiscoverySearchResult[] = sample.map((thread) => ({
    query: thread.query,
    clusterId: thread.clusterId,
    domain: thread.sourceDomain,
    url: thread.url,
    title: thread.title,
    snippet: thread.questionText,
    position: thread.position,
  }));
  const report = buildForumThreadDiscoveryReport({
    generatedAt: new Date().toISOString(),
    source: "local_dry_run",
    clusters: LEGACY_TASK_056_CLUSTERS,
    results,
    coveragePages: [],
    inventoryPages: ZARUKU_SITEMAP_INVENTORY,
    semanticIntentConfig: zarukuSeoProductionConfig.semanticIntent,
  });
  const byUrl = new Map(report.threads.map((thread) => [thread.url, thread]));
  const rows = sample.map((thread) => {
    const next = byUrl.get(thread.url);
    return {
      clusterId: thread.clusterId,
      url: thread.url,
      title: thread.title,
      previousVerdict: "covered",
      newVerdict: next?.coverage.verdict || "dropped",
      matchingArticleUrl: next?.coverage.matchingArticleUrl || null,
    };
  });
  return {
    previousArtifactPath: path,
    sampledRows: rows.length,
    stillCovered: rows.filter((row) => row.newVerdict === "covered").length,
    downgradedToPartial: rows.filter((row) => row.newVerdict === "partial").length,
    downgradedToGap: rows.filter((row) => row.newVerdict === "gap" || row.newVerdict === "dropped").length,
    rows,
  };
}

async function sendTelegram(input: { token: string; chatId: string; text: string }): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${input.token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: input.chatId,
      text: input.text,
      disable_web_page_preview: true,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Telegram sendMessage failed: ${response.status} ${body}`);
  }
}

function renderTelegramBatch(input: { artifactPath: string; report: ReturnType<typeof buildContentGapDiscoveryReport> }): string {
  const topThemes = input.report.themes.slice(0, 8).map((theme, index) => {
    const signal = theme.rankingState === "unranked" ? "unranked: no WM signal" : `ranked: CTR ${theme.signal.yandexCtr ?? "n/a"}%`;
    return `${index + 1}. ${theme.theme} [${theme.verdict}] ${signal}, examples ${theme.frequency}`;
  }).join("\n") || "н/д";
  return [
    "TASK-060 content-gap inventory rerun",
    `themes: ${input.report.summary.themes}`,
    `ranked: ${input.report.summary.rankedThemes}; unranked: ${input.report.summary.unrankedThemes}`,
    `gaps: ${input.report.summary.gapThemes}; partial: ${input.report.summary.partialThemes}`,
    `public examples: ${input.report.summary.publicQuestionExamples}`,
    "",
    "Top themes:",
    topThemes,
    "",
    `Artifact: ${input.artifactPath}`,
    "Read-only: no buttons, no drafts, no Hermes, no writes.",
  ].join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const outPath = requiredFlag(args, "--out");
  const sendTelegramEnabled = hasFlag(args, "--send-telegram");
  const chatId = readFlag(args, "--chat-id") || cleanString(process.env.SEO_WEEKLY_TOP10_DEV_CHAT_ID);
  const token = cleanString(process.env.TELEGRAM_BOT_TOKEN);
  const maxQueriesPerCluster = readNumberFlag(args, "--max-queries-per-cluster", 2);
  const previousArtifactPath = readFlag(args, "--previous-artifact") || PREVIOUS_TASK_056_ARTIFACT;
  const generatedAt = new Date().toISOString();
  const clusters = targetClusters();
  const queries = buildForumDiscoveryQueries({ clusters, modifiers: DEFAULT_MODIFIERS, maxQueriesPerCluster });
  const results: ForumDiscoverySearchResult[] = [];
  const searchErrors: Array<{ query: string; message: string }> = [];

  for (const query of queries) {
    try {
      const entries = await searchYandex(query.query);
      entries.forEach((entry, index) => {
        results.push({
          query: query.query,
          clusterId: query.clusterId,
          domain: entry.domain,
          url: entry.url,
          title: entry.title,
          snippet: entry.snippet,
          position: index + 1,
        });
      });
    } catch (error) {
      searchErrors.push({ query: query.query, message: error instanceof Error ? error.message : String(error) });
    }
  }

  const discoveryReport = buildForumThreadDiscoveryReport({
    generatedAt,
    source: "yandex_search_api",
    clusters,
    results,
    coveragePages: [],
    inventoryPages: ZARUKU_SITEMAP_INVENTORY,
    semanticIntentConfig: zarukuSeoProductionConfig.semanticIntent,
    queries,
  });
  const contentGapReport = buildContentGapDiscoveryReport({
    generatedAt,
    discoveryReport,
    yandexSignals: YANDEX_SIGNAL_EVIDENCE,
  });
  const artifact = {
    ...contentGapReport,
    clusterCount: clusters.length,
    search: {
      queries: queries.length,
      rawResults: results.length,
      acceptedThreads: discoveryReport.summary.acceptedThreads,
      coveredThreads: discoveryReport.summary.coveredThreads,
      partialThreads: discoveryReport.summary.partialThreads,
      gapThreads: discoveryReport.summary.gapThreads,
      errors: searchErrors,
    },
    coverageRule: {
      covered: "same section + >=2 question-intent tokens matching article title/H1 tokens",
      partial: "same section + >=1 question-intent token matching article title/H1 tokens",
      gap: "no same-section title/H1 evidence in sitemap inventory pages",
      source: "shared pageInventoryCoverageResolver over Zaruku sitemap inventory snapshots",
    },
    task060ResolverAcceptanceChecks: task060ResolverAcceptanceChecks(),
    previousCoveredSampleReevaluation: reevaluatePreviousCoverage(previousArtifactPath),
    telegram: {
      requested: sendTelegramEnabled,
      sent: false,
      chatId: sendTelegramEnabled && chatId ? chatId : null,
    },
    sideEffects: {
      ...contentGapReport.sideEffects,
      telegramMessageSent: false,
      searchApiReads: true,
    },
  };

  if (sendTelegramEnabled) {
    if (!token || !chatId) throw new Error("TELEGRAM_BOT_TOKEN and SEO_WEEKLY_TOP10_DEV_CHAT_ID or --chat-id are required with --send-telegram");
    await sendTelegram({ token, chatId, text: renderTelegramBatch({ artifactPath: outPath, report: contentGapReport }) });
    artifact.telegram.sent = true;
    artifact.sideEffects.telegramMessageSent = true;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);

  console.log(JSON.stringify({
    outPath,
    clusterCount: artifact.clusterCount,
    search: artifact.search,
    summary: artifact.summary,
    topThemes: artifact.themes.slice(0, 8).map((theme) => ({
      theme: theme.theme,
      verdict: theme.verdict,
      frequency: theme.frequency,
      rankingState: theme.rankingState,
      score: theme.signal.score,
      yandexCtr: theme.signal.yandexCtr,
    })),
    previousCoveredSampleReevaluation: artifact.previousCoveredSampleReevaluation,
    telegramSent: artifact.telegram.sent,
    sideEffects: artifact.sideEffects,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
