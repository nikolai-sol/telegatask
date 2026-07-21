import { describe, expect, test } from "vitest";
import { buildContentGapDiscoveryReport } from "./contentGapDiscovery";
import { buildForumThreadDiscoveryReport, type ForumDiscoveryClusterConfig, type ForumDiscoverySearchResult } from "./forumThreadDiscovery";
import { zarukuSeoProductionConfig } from "./production/zaruku/zarukuSeoProductionConfig";

const clusters: ForumDiscoveryClusterConfig[] = [
  {
    clusterId: "oncology_sanatorium",
    label: "санаторно-курортное лечение онкобольным",
    seedQuery: "санаторно курортное лечение онкобольным",
    section: "/obshie-temy/",
  },
  {
    clusterId: "breast_recovery",
    label: "восстановление после рмж",
    seedQuery: "восстановление после рмж",
    section: "/rak-molochnoj-zhelezy/",
  },
];

const results: ForumDiscoverySearchResult[] = [
  {
    query: "санаторно курортное лечение онкобольным форум",
    clusterId: "oncology_sanatorium",
    domain: "forum.example",
    url: "https://forum.example/thread/sanatorium-1",
    title: "Можно ли онкобольным в санаторий?",
    snippet: "Обсуждение санаторно-курортного лечения после онкологии",
    position: 1,
  },
  {
    query: "санаторно курортное лечение онкобольным обсуждение",
    clusterId: "oncology_sanatorium",
    domain: "forum.example",
    url: "https://forum.example/thread/sanatorium-2",
    title: "Путевка после лечения рака",
    snippet: "Вопрос про санаторий и противопоказания",
    position: 2,
  },
  {
    query: "восстановление после рмж форум",
    clusterId: "breast_recovery",
    domain: "forum.example",
    url: "https://forum.example/thread/recovery-1",
    title: "Восстановление после РМЖ",
    snippet: "Как вернуться к обычной жизни",
    position: 1,
  },
];

describe("contentGapDiscovery", () => {
  test("groups non-covered public questions by theme and ranks with Yandex signal evidence", () => {
    const discoveryReport = buildForumThreadDiscoveryReport({
      generatedAt: "2026-07-18T00:00:00.000Z",
      source: "fixture",
      clusters,
      results,
      coveragePages: [
        {
          url: "https://zaruku.ru/rak-molochnoj-zhelezy/reabilitaciya-posle-raka-molochnoj-zhelezy-5-napravlenij/",
          section: "/rak-molochnoj-zhelezy/",
          title: "Реабилитация после рака молочной железы",
          keywords: ["восстановление", "рмж"],
        },
      ],
      semanticIntentConfig: zarukuSeoProductionConfig.semanticIntent,
    });
    const report = buildContentGapDiscoveryReport({
      generatedAt: "2026-07-18T00:00:00.000Z",
      discoveryReport,
      yandexSignals: [
        {
          clusterId: "oncology_sanatorium",
          impressions: 7,
          clicks: 1,
          ctr: 14.29,
          source: "task_065_fixture",
        },
      ],
    });

    expect(report.summary).toMatchObject({
      themes: 2,
      gapThemes: 1,
      partialThemes: 1,
      publicQuestionExamples: 3,
    });
    expect(report.themes[0]).toMatchObject({
      theme: "санаторно-курортное лечение онкобольным",
      verdict: "gap",
      frequency: 2,
      existingArticleUrl: null,
      rankingState: "ranked",
      signal: {
        yandexCtr: 14.29,
        yandexImpressions: 7,
      },
    });
    expect(report.rankedThemes.map((theme) => theme.clusterId)).toEqual(["oncology_sanatorium"]);
    expect(report.unrankedThemes.map((theme) => theme.clusterId)).toEqual(["breast_recovery"]);
    expect(report.themes[0].exampleQuestions[0]).toMatchObject({
      sourceDomain: "forum.example",
      authorPiiStored: false,
    });
    expect(report.themes.find((theme) => theme.clusterId === "breast_recovery")).toMatchObject({
      verdict: "partial",
      existingArticleUrl:
        "https://zaruku.ru/rak-molochnoj-zhelezy/reabilitaciya-posle-raka-molochnoj-zhelezy-5-napravlenij/",
    });
    expect(report.sideEffects).toMatchObject({
      firestoreWrites: false,
      mysqlWrites: false,
      hermesCalls: false,
      postingActions: false,
      answerDraftsCreated: false,
    });
  });

  test("does not rank no-signal themes by forum frequency", () => {
    const discoveryReport = buildForumThreadDiscoveryReport({
      generatedAt: "2026-07-18T00:00:00.000Z",
      source: "fixture",
      clusters,
      results,
      coveragePages: [],
      semanticIntentConfig: zarukuSeoProductionConfig.semanticIntent,
    });
    const report = buildContentGapDiscoveryReport({
      generatedAt: "2026-07-18T00:00:00.000Z",
      discoveryReport,
      yandexSignals: [
        {
          clusterId: "breast_recovery",
          impressions: 1,
          clicks: 0,
          ctr: 0,
          source: "wm_fixture",
        },
      ],
    });

    expect(report.rankedThemes.map((theme) => theme.clusterId)).toEqual(["breast_recovery"]);
    expect(report.unrankedThemes.map((theme) => theme.clusterId)).toEqual(["oncology_sanatorium"]);
    expect(report.unrankedThemes[0]).toMatchObject({
      frequency: 2,
      rankingState: "unranked",
      signal: { score: null, source: null },
    });
  });
});
