import { describe, expect, test } from "vitest";
import {
  buildWeeklyTop10TelegramApprovalMessageV2,
  mergeHermesAdvisoryIntoTelegramText,
} from "./weeklyTop10TelegramApprovalMessageV2";
import type { WeeklyTop10DigestItem } from "./weeklyTop10Generator";

const item: WeeklyTop10DigestItem = {
  rank: 0,
  state: "new",
  title: "Improve Yandex Webmaster rankings for \"подногтевая меланома фото\"",
  priority: "high",
  confidenceScore: 89,
  targetKeywords: ["подногтевая меланома фото"],
  recommendedAction: "Improve the page/query match.",
  evidenceCount: 1,
  sourceKeys: [
    "yandex_webmaster:search_performance:подногтевая меланома фото:https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/",
  ],
};

describe("weeklyTop10TelegramApprovalMessageV2", () => {
  test("inserts Hermes advisory before the deterministic action and is idempotent", () => {
    const advisory = {
      source: "hermes" as const,
      generatedAt: "2026-07-21T10:00:00.000Z",
      recommendationText: "Добавить понятный блок о признаках.",
      coveredIntents: ["признаки заболевания"],
      internalLinkSuggestions: ["Ссылка из раздела меланомы"],
      medicalReviewText: "Требуется медицинское ревью.",
      complianceStatus: "passed" as const,
      tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimated: true },
    };
    const base = "SEO-кандидат #1\nSERP: позиция 12\nЧто сделать: обновить страницу";
    const once = mergeHermesAdvisoryIntoTelegramText(base, advisory);

    expect(once).toContain("Hermes-рекомендация: Добавить понятный блок о признаках.");
    expect(once.indexOf("Hermes-рекомендация:")).toBeLessThan(once.indexOf("Что сделать:"));
    expect(mergeHermesAdvisoryIntoTelegramText(once, advisory)).toBe(once);
  });
  test("renders a Russian evidence-rich digest message without Convert by default", () => {
    const message = buildWeeklyTop10TelegramApprovalMessageV2({
      item,
      teamId: "zaruku",
      runId: "run1",
      draftTaskId: "d1",
      evidence: {
        opportunityId: "seo_opp_1",
        clusterId: "query_cluster_001",
        query: "подногтевая меланома фото",
        intentClass: "medical_informational",
        targetUrl: "https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/",
        webmasterAveragePosition: 9.25,
        serpPosition: 16,
        ctr: 3.205128,
        impressions: 312,
        opportunityType: "content_optimization",
        medicalReviewRequired: true,
      },
    });

    expect(message.metadata.schema).toBe("weekly_top10_telegram_approval_message_v2");
    expect(message.text).toContain("SEO-возможность #1: подногтевая меланома фото");
    expect(message.text).toContain("Интент: medical_informational; медревью: требуется");
    expect(message.text).toContain("URL: https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/");
    expect(message.text).toContain("показы 312");
    expect(message.text).toContain("CTR 3.21%");
    expect(message.text).toContain("ср. позиция 9.25");
    expect(message.text).toContain("SERP: позиция 16");
    expect(message.text).toContain("медицинский материал");
    expect(message.buttons.flat().map((button) => button.text)).toEqual(["Одобрить", "Отклонить", "Открыть"]);
  });

  test("can include Convert only when explicitly enabled", () => {
    const message = buildWeeklyTop10TelegramApprovalMessageV2({
      item,
      teamId: "zaruku",
      runId: "run1",
      draftTaskId: "d1",
      includeConvertButton: true,
      evidence: {
        opportunityId: "seo_opp_1",
        query: "онкологический центр в сколково адрес",
        intentClass: "facility_navigational",
        targetUrl: "https://zaruku.ru/map/moskva/organization_1425/",
        webmasterAveragePosition: 9.42,
        serpPosition: 12,
        ctr: 0.990099,
        impressions: 202,
        opportunityType: "content_optimization",
        medicalReviewRequired: false,
      },
    });

    expect(message.buttons.flat().map((button) => button.text)).toEqual(["Одобрить", "Отклонить", "Открыть", "Convert"]);
    expect(message.text).toContain("карточку учреждения");
  });

  test("renders section ranking gap evidence with section and seed queries", () => {
    const message = buildWeeklyTop10TelegramApprovalMessageV2({
      item: {
        ...item,
        title: "Закрыть ranking gap: подногтевая меланома фото",
        targetKeywords: ["подногтевая меланома фото", "подногтевая меланома на ноге фото"],
      },
      teamId: "zaruku",
      runId: "run47",
      draftTaskId: "d47",
      evidence: {
        opportunityId: "seo_opp_gap_1",
        clusterId: "seed_melanoma_podnogtevaya",
        section: "/melanoma/",
        query: "подногтевая меланома фото",
        seedQueries: ["подногтевая меланома фото", "подногтевая меланома на ноге фото"],
        intentClass: "medical_informational",
        targetUrl: null,
        serpPosition: null,
        opportunityType: "section_ranking_gap",
        medicalReviewRequired: true,
      },
    });

    expect(message.text).toContain("Раздел: /melanoma/");
    expect(message.text).toContain("Запросы: подногтевая меланома фото; подногтевая меланома на ноге фото");
    expect(message.text).toContain("ranking gap раздела");
    expect(message.metadata.evidence.opportunityType).toBe("section_ranking_gap");
  });

  test("renders bound and unbound section ranking gaps as distinct decisions", () => {
    const bound = buildWeeklyTop10TelegramApprovalMessageV2({
      item: {
        ...item,
        title: "Закрыть ranking gap: меланома на ногте фото",
        recommendedAction: "Доработать существующую страницу под кластер.",
      },
      teamId: "zaruku",
      runId: "run51",
      draftTaskId: "d51",
      evidence: {
        opportunityId: "seo_opp_gap_bound",
        clusterId: "query_cluster_008",
        section: "/melanoma/",
        query: "меланома на ногте фото",
        seedQueries: ["меланома на ногте фото", "меланома ногтя фото"],
        targetUrl: "https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/",
        targetUrlBindingSourceQuery: "меланома ногтя фото",
        targetUrlBindingSerpPosition: 19,
        opportunityType: "section_ranking_gap",
        medicalReviewRequired: true,
      },
    });
    const unbound = buildWeeklyTop10TelegramApprovalMessageV2({
      item: {
        ...item,
        title: "Закрыть ranking gap: новая тема",
        recommendedAction: "Создать или выбрать целевую страницу.",
      },
      teamId: "zaruku",
      runId: "run51",
      draftTaskId: "d52",
      evidence: {
        opportunityId: "seo_opp_gap_new",
        clusterId: "query_cluster_999",
        section: "/content/",
        query: "новая тема",
        seedQueries: ["новая тема"],
        targetUrl: null,
        opportunityType: "section_ranking_gap",
        medicalReviewRequired: false,
      },
    });

    expect(bound.text).toContain("Тип gap: доработать существующую страницу");
    expect(bound.text).toContain("URL найден по варианту: меланома ногтя фото, SERP позиция 19");
    expect(unbound.text).toContain("Тип gap: страницы нет — кандидат на новый контент");
    expect(unbound.text).toContain("URL verdict: URL не найден в выдаче");
    expect(unbound.text).toContain("SERP: не найден в выдаче");
    expect(unbound.text).toContain("Интент: не классифицирован");
    expect(unbound.text).not.toContain("Интент: н/д");
  });

  test("renders Hermes advisory text as LLM-generated without replacing deterministic facts", () => {
    const message = buildWeeklyTop10TelegramApprovalMessageV2({
      item,
      teamId: "zaruku",
      runId: "run52",
      draftTaskId: "d52",
      evidence: {
        opportunityId: "seo_opp_gap_bound",
        clusterId: "query_cluster_008",
        section: "/melanoma/",
        query: "меланома на ногте фото",
        seedQueries: ["меланома на ногте фото"],
        targetUrl: "https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/",
        opportunityType: "section_ranking_gap",
        medicalReviewRequired: true,
        advisory: {
          source: "hermes",
          generatedAt: "2026-07-12T12:00:00.000Z",
          recommendationText: "Доработать блок про признаки на ногте и добавить внутренние ссылки.",
          coveredIntents: ["фото-признаки"],
          internalLinkSuggestions: ["Ссылка из melanoma hub"],
          medicalReviewText: "Требуется медревью.",
          complianceStatus: "passed",
          tokenUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, estimated: false },
        },
      },
    });

    expect(message.text).toContain("Hermes-рекомендация: Доработать блок про признаки на ногте");
    expect(message.text).toContain("Покрытые интенты: фото-признаки");
    expect(message.text).toContain("Внутренние ссылки: Ссылка из melanoma hub");
    expect(message.text).toContain("Медицинское ревью: Требуется медревью.");
    expect(message.text).toContain("URL: https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/");
  });
});
