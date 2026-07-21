import { describe, expect, it } from "vitest";
import inputRecords from "./fixtures/yandexQueryClusterReview/inputRecords.json";
import { zarukuSeoProductionConfig } from "./production/zaruku/zarukuSeoProductionConfig";
import type { YandexSerpQueryUrlEvidenceRecord } from "./yandexSerpQueryUrlEvidenceMapper";
import { buildYandexQueryClusterReview, buildYandexQueryClusters } from "./yandexQueryClusterReview";

describe("buildYandexQueryClusterReview", () => {
  it("clusters melanoma query variants and shares deterministic URL evidence", () => {
    const review = buildYandexQueryClusterReview({
      records: inputRecords as YandexSerpQueryUrlEvidenceRecord[],
      classifierConfig: zarukuSeoProductionConfig.semanticIntent,
      clusterConfig: zarukuSeoProductionConfig.queryCluster,
      targetDomain: zarukuSeoProductionConfig.domain,
      targetDomainAliases: [...zarukuSeoProductionConfig.targetDomainAliases],
      market: zarukuSeoProductionConfig.market,
      language: zarukuSeoProductionConfig.language,
    });

    expect(review.summary.clusters).toBe(1);
    expect(review.clusters[0].memberQueries).toEqual([
      "подногтевая меланома фото",
      "подногтевая меланома на большом пальце ноги фото",
    ]);
    expect(review.clusters[0].urlEvidence?.matchedUrl).toBe(
      "https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/"
    );
    expect(review.clusterRecords[0].page).toBe("https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/");
    expect(review.opportunities).toHaveLength(1);
    expect(review.opportunities[0].targetUrl).toBe(
      "https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/"
    );
    expect(review.qualityGate.summary.opportunitiesWithTargetUrl).toBe(1);
  });

  it("flags mixed-intent clusters and resolves them by semantic intent priority", () => {
    const records = [
      {
        source: "yandex_webmaster",
        dimension: "query",
        key: "гемотест рак лечение",
        query: "гемотест рак лечение",
        page: null,
        sourceRank: 1,
        impressions: 100,
        clicks: 1,
        ctr: 1,
        averagePosition: 8,
      },
      {
        source: "yandex_webmaster",
        dimension: "query",
        key: "рак лечение",
        query: "рак лечение",
        page: null,
        sourceRank: 2,
        impressions: 80,
        clicks: 2,
        ctr: 2.5,
        averagePosition: 7,
      },
    ] as YandexSerpQueryUrlEvidenceRecord[];

    const clusters = buildYandexQueryClusters({
      records,
      classifierConfig: zarukuSeoProductionConfig.semanticIntent,
      clusterConfig: zarukuSeoProductionConfig.queryCluster,
    });

    expect(clusters).toHaveLength(1);
    expect(clusters[0].mixedIntentFlag).toBe(true);
    expect(clusters[0].mixedIntentClasses).toEqual(["competitor_brand", "medical_informational"]);
    expect(clusters[0].intentClass).toBe("competitor_brand");
  });
});
