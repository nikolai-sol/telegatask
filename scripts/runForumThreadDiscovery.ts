import "dotenv/config";
import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import {
  buildForumDiscoveryQueries,
  buildForumThreadDiscoveryReport,
  type ForumDiscoveryClusterConfig,
  type ForumDiscoveryCoveragePage,
  type ForumDiscoverySearchResult,
} from "../src/features/seoAgent/forumThreadDiscovery";
import { normalizeResultDomain } from "../src/features/seoAgent/providers/serpMatching";
import { zarukuSeoProductionConfig } from "../src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig";

type YandexSearchResponse = {
  id?: string;
  done?: boolean;
  response?: {
    rawData?: string;
  };
};

const DEFAULT_CLUSTERS: ForumDiscoveryClusterConfig[] = [
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
    label: "рак лёгкого симптомы лечение",
    seedQuery: "рак легкого симптомы лечение",
    section: "/rak-lyogkogo/",
  },
  {
    clusterId: "breast_rehab",
    label: "реабилитация восстановление после РМЖ",
    seedQuery: "реабилитация восстановление после рмж",
    section: "/rak-molochnoj-zhelezy/",
  },
  {
    clusterId: "oncology_sanatorium",
    label: "санаторно-курортное лечение онкобольным",
    seedQuery: "санаторно курортное лечение онкобольным",
    section: "/obshie-temy/",
  },
];

const DEFAULT_MODIFIERS = ["форум", "обсуждение", "отзывы"];

const ZARUKU_COVERAGE_PAGES: ForumDiscoveryCoveragePage[] = [
  {
    url: "https://zaruku.ru/rak-molochnoj-zhelezy/invalidnost-pri-rake-molochnoj-zhelezy-kak-poluchit-i-kakie-preimushestva-ona-daet/",
    section: "/rak-molochnoj-zhelezy/",
    title: "Инвалидность при раке молочной железы",
    keywords: ["инвалидность", "рак", "молочной", "железы", "рмж"],
  },
  {
    url: "https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/",
    section: "/melanoma/",
    title: "Подногтевая меланома",
    keywords: ["подногтевая", "меланома", "ногтя", "фото"],
  },
  {
    url: "https://zaruku.ru/rak-lyogkogo/pri-kakom-kashle-nuzhno-obsledovatsya-na-rak-legkogo/",
    section: "/rak-lyogkogo/",
    title: "При каком кашле нужно обследоваться на рак легкого",
    keywords: ["рак", "легкого", "симптомы", "кашель"],
  },
  {
    url: "https://zaruku.ru/rak-lyogkogo/ot-narkoza-do-vypiski-chto-proizojdet-posle-operacii-na-legkom/",
    section: "/rak-lyogkogo/",
    title: "Что произойдет после операции на легком",
    keywords: ["рак", "легкого", "лечение", "операции"],
  },
  {
    url: "https://zaruku.ru/rak-molochnoj-zhelezy/reabilitaciya-posle-raka-molochnoj-zhelezy-5-napravlenij/",
    section: "/rak-molochnoj-zhelezy/",
    title: "Реабилитация после рака молочной железы",
    keywords: ["реабилитация", "восстановление", "рмж", "молочной", "железы"],
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
    throw new Error(
      "Usage: runForumThreadDiscovery --out <report.json> [--send-telegram] [--chat-id <id>] [--max-clusters 5] [--max-queries-per-cluster 3]"
    );
  }
  return value;
}

function readNumberFlag(args: string[], name: string, defaultValue: number): number {
  const raw = readFlag(args, name);
  if (!raw) return defaultValue;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : defaultValue;
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
    const title = decodeXmlText((doc.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "");
    const snippet = decodeXmlText((doc.match(/<headline>([\s\S]*?)<\/headline>/i) || [])[1] || "");
    return {
      domain: normalizeResultDomain(url),
      url,
      title,
      snippet,
    };
  }).filter((entry) => entry.url);
}

async function parseYandexResponse(response: Response): Promise<YandexSearchResponse> {
  return (await response.json()) as YandexSearchResponse;
}

async function pollDeferredResult(operationId: string, apiKey: string): Promise<YandexSearchResponse> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`https://operation.api.cloud.yandex.net/operations/${encodeURIComponent(operationId)}`, {
      headers: {
        Authorization: `Api-Key ${apiKey}`,
      },
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
  if (!apiKey || !folderId) {
    throw new Error("YANDEX_SEARCH_API_KEY and YANDEX_SEARCH_FOLDER_ID are required for live TASK-056 recon");
  }
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
  if (!response.ok) {
    throw new Error(`Yandex Search API failed for "${query}": ${response.status}`);
  }
  let payload = await parseYandexResponse(response);
  if (mode === "deferred") {
    const operationId = cleanString(payload.id);
    payload = operationId ? await pollDeferredResult(operationId, apiKey) : {};
  }
  const rawData = decodeRawData(cleanString(payload.response?.rawData));
  return rawData ? xmlEntries(rawData) : [];
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

function renderTelegramBatch(input: {
  artifactPath: string;
  summary: ReturnType<typeof buildForumThreadDiscoveryReport>["summary"];
  domainFrequency: ReturnType<typeof buildForumThreadDiscoveryReport>["domainFrequency"];
  noCoverageThreads: ReturnType<typeof buildForumThreadDiscoveryReport>["noCoverageThreads"];
}): string {
  const domains = input.domainFrequency
    .slice(0, 5)
    .map((item) => `${item.domain}: ${item.threads} тред., answerable ${item.answerableThreads}, gaps ${item.gapThreads}`)
    .join("\n") || "н/д";
  const gaps = input.noCoverageThreads
    .slice(0, 6)
    .map((thread, index) => `${index + 1}. ${thread.clusterLabel} -> ${thread.sourceDomain}\n${thread.url}`)
    .join("\n") || "н/д";
  return [
    "TASK-056 read-only forum/TG recon",
    `clusters: ${input.summary.clusters}`,
    `raw results: ${input.summary.rawResults}`,
    `accepted threads: ${input.summary.acceptedThreads}`,
    `covered: ${input.summary.coveredThreads}; gaps: ${input.summary.gapThreads}`,
    `never_answerable: ${input.summary.neverAnswerableThreads}; competitor_excluded: ${input.summary.competitorExcludedThreads}`,
    "",
    "Domain frequency:",
    domains,
    "",
    "No-coverage candidates:",
    gaps,
    "",
    `Artifact: ${input.artifactPath}`,
    "No drafts, no Hermes, no posting actions, no reply buttons.",
  ].join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const outPath = requiredFlag(args, "--out");
  const sendTelegramEnabled = hasFlag(args, "--send-telegram");
  const chatId = readFlag(args, "--chat-id") || cleanString(process.env.SEO_WEEKLY_TOP10_DEV_CHAT_ID);
  const token = cleanString(process.env.TELEGRAM_BOT_TOKEN);
  const maxClusters = readNumberFlag(args, "--max-clusters", 5);
  const maxQueriesPerCluster = readNumberFlag(args, "--max-queries-per-cluster", 3);
  const generatedAt = new Date().toISOString();
  const clusters = DEFAULT_CLUSTERS.slice(0, maxClusters);
  const queries = buildForumDiscoveryQueries({
    clusters,
    modifiers: DEFAULT_MODIFIERS,
    maxQueriesPerCluster,
  });
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
      searchErrors.push({
        query: query.query,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const report = buildForumThreadDiscoveryReport({
    generatedAt,
    source: "yandex_search_api",
    clusters,
    results,
    coveragePages: ZARUKU_COVERAGE_PAGES,
    semanticIntentConfig: zarukuSeoProductionConfig.semanticIntent,
    queries,
  });
  const artifact = {
    ...report,
    searchErrors,
    telegram: {
      requested: sendTelegramEnabled,
      sent: false,
      chatId: sendTelegramEnabled && chatId ? chatId : null,
    },
    sideEffects: {
      ...report.sideEffects,
      telegramMessageSent: false,
      productionPipelineRun: false,
      searchApiReads: true,
    },
  };

  if (sendTelegramEnabled) {
    if (!token || !chatId) {
      throw new Error("TELEGRAM_BOT_TOKEN and SEO_WEEKLY_TOP10_DEV_CHAT_ID or --chat-id are required with --send-telegram");
    }
    await sendTelegram({
      token,
      chatId,
      text: renderTelegramBatch({
        artifactPath: outPath,
        summary: report.summary,
        domainFrequency: report.domainFrequency,
        noCoverageThreads: report.noCoverageThreads,
      }),
    });
    artifact.telegram.sent = true;
    artifact.sideEffects.telegramMessageSent = true;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);

  console.log(JSON.stringify({
    outPath,
    summary: artifact.summary,
    topDomains: artifact.domainFrequency.slice(0, 5),
    searchErrors: searchErrors.length,
    telegramSent: artifact.telegram.sent,
    sideEffects: artifact.sideEffects,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
