import { describe, expect, test } from "vitest";
import liveClusters from "./fixtures/sectionRankTracking/liveClusters.json";
import { zarukuSeoProductionConfig } from "./production/zaruku/zarukuSeoProductionConfig";
import {
  buildSeoRankDashboardExport,
  buildSeoRankHistoryRecords,
  buildSeoSectionRankTrackingList,
  type SeoRankHistoryRecord,
  type SeoSectionRankTrackingConfig,
  type SeoSectionRankTrackingLiveCluster,
} from "./sectionRankTracking";
import type { YandexRankCheck } from "./types";

const config: SeoSectionRankTrackingConfig = {
  maxSerpRequestsPerRun: 3,
  alertDropThreshold: 5,
  estimatedCostPerRequestRub: null,
  regionContract: {
    facilityFallbackRegion: "225",
    regionByIntent: {
      medical_informational: "225",
      facility_navigational: "225",
      supportive_trust: "225",
      own_brand: "225",
    },
    facilityRegionMap: [
      { geoToken: "спб", region: "2" },
      { geoToken: "пушкинского района", region: "2" },
      { geoToken: "онкологический центр", region: "225" },
    ],
  },
  seedClusters: [
    {
      clusterId: "seed_melanoma",
      section: "/melanoma/",
      query: "подногтевая меланома фото",
      priority: 1,
      intentClass: "medical_informational",
    },
    {
      clusterId: "seed_support",
      section: "/obraz_zhizni_pri_onkologii/",
      query: "поддержка онкопациентов",
      priority: 3,
      intentClass: "supportive_trust",
    },
  ],
};

describe("sectionRankTracking", () => {
  test("builds a capped tracking list from seed and live target clusters", () => {
    const list = buildSeoSectionRankTrackingList({
      config,
      liveClusters: liveClusters as SeoSectionRankTrackingLiveCluster[],
      targetIntentClasses: ["medical_informational", "facility_navigational", "supportive_trust"],
    });

    expect(list).toHaveLength(3);
    expect(list.map((item) => item.query)).toEqual([
      "подногтевая меланома фото",
      "онкологический центр в сколково адрес",
      "поддержка онкопациентов",
    ]);
    expect(list[0]).toMatchObject({
      query: "подногтевая меланома фото",
      section: "/melanoma/",
      source: "seed_and_live_cluster",
    });
    expect(list.some((item) => item.query === "инвитро рак лечение")).toBe(false);
  });

  test("resolves facility region from geo token and marks fallback when unknown", () => {
    const facilityMapConfig: SeoSectionRankTrackingConfig = {
      ...config,
      maxSerpRequestsPerRun: 2,
      seedClusters: [
        {
          clusterId: "seed_spb_clinic",
          section: "/map/",
          query: "цаоп пушкинского района спб",
          priority: 2,
          intentClass: "facility_navigational",
        },
        {
          clusterId: "seed_unknown_city",
          section: "/map/",
          query: "онкоцентр в сургуте",
          priority: 2,
          intentClass: "facility_navigational",
        },
      ],
      regionContract: {
        ...config.regionContract,
        facilityRegionMap: [{ geoToken: "спб", region: "2" }],
        facilityFallbackRegion: "225",
      },
    };

    const list = buildSeoSectionRankTrackingList({
      config: facilityMapConfig,
      liveClusters: [],
      targetIntentClasses: ["facility_navigational"],
    });

    const spb = list.find((item) => item.query === "цаоп пушкинского района спб");
    const unknown = list.find((item) => item.query === "онкоцентр в сургуте");
    expect(spb).toMatchObject({
      region: "2",
      regionSource: "facility_geo",
      regionFallback: false,
    });
    expect(unknown).toMatchObject({
      region: "225",
      regionSource: "facility_fallback",
      regionFallback: true,
    });
  });

  test("builds RankHistory records from SERP checks without merging Webmaster position", () => {
    const list = buildSeoSectionRankTrackingList({
      config,
      liveClusters: liveClusters as SeoSectionRankTrackingLiveCluster[],
      targetIntentClasses: ["medical_informational", "facility_navigational", "supportive_trust"],
    });
    const checks: YandexRankCheck[] = [
      {
        query: "подногтевая меланома фото",
        searchEngine: "yandex",
        provider: "yandex_search_api",
        targetDomain: "zaruku.ru",
        found: true,
        position: 16,
        matchedUrl: "https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/",
        topResultDomains: ["example.ru", "zaruku.ru"],
        device: "desktop",
        checkedAt: "2026-07-10T10:00:00.000Z",
      },
    ];
    const records = buildSeoRankHistoryRecords({
      teamId: "zaruku",
      runId: "run1",
      domain: "zaruku.ru",
      trackingList: list,
      rankChecks: checks,
    });

    expect(records[0]).toMatchObject({
      query: "подногтевая меланома фото",
      serpPosition: 16,
      found: true,
      matchedUrl: "https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/",
    });
    expect(records[1].serpPosition).toBeNull();
  });

  test("exports was/became deltas and rank_drop_alert records only in the dashboard", () => {
    const current: SeoRankHistoryRecord[] = [
      {
        id: "current_1",
        teamId: "zaruku",
        runId: "run2",
        domain: "zaruku.ru",
        searchEngine: "yandex",
        provider: "yandex_search_api",
        clusterId: "query_cluster_001",
        query: "подногтевая меланома фото",
        section: "/melanoma/",
        intentClass: "medical_informational",
        checkedAt: "2026-07-17T10:00:00.000Z",
        serpPosition: 12,
        found: true,
        matchedUrl: "https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/",
        topResultDomains: [],
        region: "225",
        language: "ru",
        device: "desktop",
      },
    ];
    const previous: SeoRankHistoryRecord[] = [
      {
        ...current[0],
        id: "previous_1",
        runId: "run1",
        checkedAt: "2026-07-10T10:00:00.000Z",
        serpPosition: 6,
      },
    ];
    const exportPayload = buildSeoRankDashboardExport({
      generatedAt: "2026-07-17T10:01:00.000Z",
      domain: "zaruku.ru",
      runId: "run2",
      currentRecords: current,
      previousRecords: previous,
      alertDropThreshold: 5,
    });

    expect(exportPayload.schemaVersion).toBe("seo_os_rank_history_dashboard_export_v1");
    expect(exportPayload.sections[0].items[0]).toMatchObject({
      previousPosition: 6,
      currentPosition: 12,
      delta: 6,
    });
    expect(exportPayload.alerts).toEqual([
      {
        type: "rank_drop_alert",
        clusterId: "query_cluster_001",
        query: "подногтевая меланома фото",
        section: "/melanoma/",
        previousPosition: 6,
        currentPosition: 12,
        delta: 6,
        threshold: 5,
      },
    ]);
  });

  test("treats not_found as no_data for smoothed deltas and avoids false drop alerts", () => {
    const current: SeoRankHistoryRecord[] = [
      {
        id: "current_1",
        teamId: "zaruku",
        runId: "run2",
        domain: "zaruku.ru",
        searchEngine: "yandex",
        provider: "yandex_search_api",
        clusterId: "query_cluster_001",
        query: "подногтевая меланома фото",
        section: "/melanoma/",
        intentClass: "medical_informational",
        checkedAt: "2026-07-10T12:00:00.000Z",
        serpPosition: null,
        found: false,
        matchedUrl: null,
        topResultDomains: [],
        region: "225",
        language: "ru",
        device: "desktop",
      },
    ];
    const previous: SeoRankHistoryRecord[] = [
      {
        ...current[0],
        id: "previous_1",
        runId: "run1",
        checkedAt: "2026-07-10T10:00:00.000Z",
        serpPosition: 19,
        found: true,
      },
    ];

    const exportPayload = buildSeoRankDashboardExport({
      generatedAt: "2026-07-10T12:01:00.000Z",
      domain: "zaruku.ru",
      runId: "run2",
      currentRecords: current,
      previousRecords: previous,
      alertDropThreshold: 5,
      rankSmoothingRuns: 2,
    });

    expect(exportPayload.sections[0].items[0]).toMatchObject({
      previousPosition: null,
      currentPosition: null,
      delta: null,
    });
    expect(exportPayload.alerts).toEqual([]);
    expect(exportPayload.notes).toContain(
      "rank_drop_alert deltas use the configured smoothing window; not_found is treated as no_data, not as a ranking drop."
    );
  });

  test("does not compare positions across regions for the same cluster", () => {
    const current: SeoRankHistoryRecord[] = [
      {
        id: "current_1",
        teamId: "zaruku",
        runId: "run2",
        domain: "zaruku.ru",
        searchEngine: "yandex",
        provider: "yandex_search_api",
        clusterId: "query_cluster_001",
        query: "подногтевая меланома фото",
        section: "/melanoma/",
        intentClass: "medical_informational",
        checkedAt: "2026-07-17T10:00:00.000Z",
        serpPosition: 12,
        found: true,
        matchedUrl: "https://zaruku.ru/melanoma/podnogtevaya-melanoma-tam-gde-ne-vidno/",
        topResultDomains: [],
        region: "225",
        language: "ru",
        device: "desktop",
      },
    ];
    const previous: SeoRankHistoryRecord[] = [
      {
        ...current[0],
        id: "previous_1",
        runId: "run1",
        checkedAt: "2026-07-10T10:00:00.000Z",
        serpPosition: 6,
        region: "2",
      },
    ];
    const exportPayload = buildSeoRankDashboardExport({
      generatedAt: "2026-07-17T10:01:00.000Z",
      domain: "zaruku.ru",
      runId: "run2",
      currentRecords: current,
      previousRecords: previous,
      alertDropThreshold: 5,
    });

    expect(exportPayload.sections[0].items[0]).toMatchObject({
      currentPosition: 12,
      previousPosition: null,
      delta: null,
      region: "225",
    });
  });

  test("production tracking list includes live-traffic priority sections within weekly budget", () => {
    const list = buildSeoSectionRankTrackingList({
      config: zarukuSeoProductionConfig.sectionRankTracking,
      liveClusters: liveClusters as SeoSectionRankTrackingLiveCluster[],
      targetIntentClasses: zarukuSeoProductionConfig.semanticIntent.targetIntentClasses,
    });
    const sections = new Set(list.map((item) => item.section));

    expect(list.length).toBeLessThanOrEqual(zarukuSeoProductionConfig.sectionRankTracking.weeklyRunMaxSerpRequests);
    expect(sections.has("/rak-molochnoj-zhelezy/")).toBe(true);
    expect(sections.has("/rak-lyogkogo/")).toBe(true);
    expect(list.filter((item) => item.section === "/rak-molochnoj-zhelezy/").length).toBeGreaterThanOrEqual(5);
    expect(list.filter((item) => item.section === "/rak-lyogkogo/").length).toBeGreaterThanOrEqual(5);
  });
});
