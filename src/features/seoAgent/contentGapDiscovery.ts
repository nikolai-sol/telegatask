import type { ForumThreadDiscoveryReport, ForumThreadDiscoveryThread } from "./forumThreadDiscovery";

export type ContentGapYandexSignal = {
  clusterId: string;
  impressions?: number | null;
  clicks?: number | null;
  ctr?: number | null;
  source: string;
};

export type ContentGapExampleQuestion = {
  sourceDomain: string;
  url: string;
  title: string;
  questionText: string;
  authorPiiStored: false;
};

export type ContentGapTheme = {
  themeId: string;
  theme: string;
  clusterId: string;
  clusterLabel: string;
  verdict: "partial" | "gap";
  existingArticleUrl: string | null;
  frequency: number;
  exampleQuestions: ContentGapExampleQuestion[];
  rankingState: "ranked" | "unranked";
  signal: {
    score: number | null;
    yandexImpressions: number | null;
    yandexClicks: number | null;
    yandexCtr: number | null;
    source: string | null;
  };
};

export type ContentGapDiscoveryReport = {
  schemaVersion: "seo_os_content_gap_discovery_v1";
  generatedAt: string;
  sourceReportSchema: ForumThreadDiscoveryReport["schemaVersion"];
  summary: {
    sourceThreads: number;
    nonCoveredThreads: number;
    themes: number;
    rankedThemes: number;
    unrankedThemes: number;
    gapThemes: number;
    partialThemes: number;
    publicQuestionExamples: number;
  };
  themes: ContentGapTheme[];
  rankedThemes: ContentGapTheme[];
  unrankedThemes: ContentGapTheme[];
  sideEffects: {
    firestoreWrites: false;
    mysqlWrites: false;
    hermesCalls: false;
    postingActions: false;
    answerDraftsCreated: false;
    productionPipelineRun: false;
  };
  notes: string[];
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stableThemeId(thread: ForumThreadDiscoveryThread): string {
  const articleKey = cleanString(thread.coverage.matchingArticleUrl)
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9а-яА-ЯёЁ]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return [thread.clusterId, thread.coverage.verdict, articleKey].filter(Boolean).join("__");
}

function signalScore(input: { signal: ContentGapYandexSignal | null; verdict: "partial" | "gap" }): number | null {
  if (!input.signal) return null;
  const ctr = typeof input.signal?.ctr === "number" ? input.signal.ctr : 0;
  const impressions = typeof input.signal?.impressions === "number" ? input.signal.impressions : 0;
  const clicks = typeof input.signal?.clicks === "number" ? input.signal.clicks : 0;
  const verdictBonus = input.verdict === "gap" ? 25 : 10;
  return Math.round((ctr * 3 + Math.log10(impressions + 1) * 5 + clicks * 2 + verdictBonus) * 100) / 100;
}

function toExample(thread: ForumThreadDiscoveryThread): ContentGapExampleQuestion {
  return {
    sourceDomain: thread.sourceDomain,
    url: thread.url,
    title: thread.title,
    questionText: thread.questionText,
    authorPiiStored: false,
  };
}

export function buildContentGapDiscoveryReport(input: {
  generatedAt: string;
  discoveryReport: ForumThreadDiscoveryReport;
  yandexSignals?: readonly ContentGapYandexSignal[];
}): ContentGapDiscoveryReport {
  const signalsByCluster = new Map((input.yandexSignals || []).map((signal) => [signal.clusterId, signal]));
  const grouped = new Map<string, ForumThreadDiscoveryThread[]>();

  for (const thread of input.discoveryReport.threads) {
    if (thread.safety.neverAnswerable || thread.safety.competitorExcluded) continue;
    if (thread.coverage.verdict === "covered") continue;
    const key = stableThemeId(thread);
    grouped.set(key, [...(grouped.get(key) || []), thread]);
  }

  const themes = Array.from(grouped.entries()).map(([themeId, threads]): ContentGapTheme => {
    const first = threads[0];
    const signal = signalsByCluster.get(first.clusterId) || null;
    const frequency = threads.length;
    const verdict = first.coverage.verdict === "partial" ? "partial" : "gap";
    return {
      themeId,
      theme: first.clusterLabel,
      clusterId: first.clusterId,
      clusterLabel: first.clusterLabel,
      verdict,
      existingArticleUrl: verdict === "partial" ? first.coverage.matchingArticleUrl : null,
      frequency,
      exampleQuestions: threads.slice(0, 5).map(toExample),
      rankingState: signal ? "ranked" : "unranked",
      signal: {
        score: signalScore({ signal, verdict }),
        yandexImpressions: typeof signal?.impressions === "number" ? signal.impressions : null,
        yandexClicks: typeof signal?.clicks === "number" ? signal.clicks : null,
        yandexCtr: typeof signal?.ctr === "number" ? signal.ctr : null,
        source: signal?.source || null,
      },
    };
  });
  const rankedThemes = themes
    .filter((theme) => theme.rankingState === "ranked")
    .sort((a, b) => (b.signal.score || 0) - (a.signal.score || 0) || a.theme.localeCompare(b.theme));
  const unrankedThemes = themes
    .filter((theme) => theme.rankingState === "unranked")
    .sort((a, b) => a.theme.localeCompare(b.theme));
  const orderedThemes = [...rankedThemes, ...unrankedThemes];

  return {
    schemaVersion: "seo_os_content_gap_discovery_v1",
    generatedAt: input.generatedAt,
    sourceReportSchema: input.discoveryReport.schemaVersion,
    summary: {
      sourceThreads: input.discoveryReport.threads.length,
      nonCoveredThreads: input.discoveryReport.threads.filter((thread) => thread.coverage.verdict !== "covered").length,
      themes: orderedThemes.length,
      rankedThemes: rankedThemes.length,
      unrankedThemes: unrankedThemes.length,
      gapThemes: orderedThemes.filter((theme) => theme.verdict === "gap").length,
      partialThemes: orderedThemes.filter((theme) => theme.verdict === "partial").length,
      publicQuestionExamples: orderedThemes.reduce((sum, theme) => sum + theme.exampleQuestions.length, 0),
    },
    themes: orderedThemes,
    rankedThemes,
    unrankedThemes,
    sideEffects: {
      firestoreWrites: false,
      mysqlWrites: false,
      hermesCalls: false,
      postingActions: false,
      answerDraftsCreated: false,
      productionPipelineRun: false,
    },
    notes: [
      "Read-only content-gap discovery report built from public search recon mechanics.",
      "Only partial/gap coverage verdicts are included; fully covered threads are excluded from the gap backlog.",
      "Coverage rule requires article title/H1 token overlap for covered; same-section keyword overlap without title/H1 match is partial.",
      "Themes with Yandex Webmaster signal are ranked by that signal only; no-signal themes are listed separately as unranked.",
      "No Firestore/MySQL writes, no Hermes calls, no drafts, no posting actions, no cron changes.",
    ],
  };
}
