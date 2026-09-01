import { describe, expect, test } from "vitest";
import { zarukuSeoProductionConfig } from "./zarukuSeoProductionConfig";

describe("zarukuSeoProductionConfig", () => {
  test("enables the safe GSC activation path for Zaruku", () => {
    expect(zarukuSeoProductionConfig.gscSiteUrl).toBe("https://zaruku.ru/");
    expect(zarukuSeoProductionConfig.selectedSources).toEqual([
      "crawler",
      "gsc",
      "yandex_webmaster",
      "yandex_serp_rank",
    ]);
    expect(zarukuSeoProductionConfig.yandexQueryHistoryWindowDays).toBe(28);
    expect(zarukuSeoProductionConfig.yandexSerpQueryUrlEvidenceEnabled).toBe(false);
    expect(zarukuSeoProductionConfig.yandexSerpQueryUrlEvidenceTopN).toBe(30);
    expect(zarukuSeoProductionConfig.semanticIntent.targetIntentClasses).toEqual([
      "medical_informational",
      "facility_navigational",
      "supportive_trust",
    ]);
    expect(zarukuSeoProductionConfig.semanticIntent.competitorBrandTokens).toContain("гемотест");
    expect(zarukuSeoProductionConfig.semanticIntent.drugComplianceTokens).toContain("ритуксимаб");
    expect(zarukuSeoProductionConfig.queryCluster.jaccardThreshold).toBe(0.6);
    expect(zarukuSeoProductionConfig.queryCluster.sharedHeadTokenCount).toBe(2);
    expect(zarukuSeoProductionConfig.sectionRankTracking.maxSerpRequestsPerRun).toBe(50);
    expect(zarukuSeoProductionConfig.sectionRankTracking.alertDropThreshold).toBe(5);
    expect(zarukuSeoProductionConfig.sectionRankTracking.rankSmoothingRuns).toBe(2);
    expect(zarukuSeoProductionConfig.sectionRankTracking.sectionRankingGapMaxPosition).toBe(20);
    expect(zarukuSeoProductionConfig.sectionRankTracking.decisionCooldownDays).toBe(30);
    expect(zarukuSeoProductionConfig.sectionRankTracking.targetUrlBindingMinSharedTokens).toBe(2);
    expect(zarukuSeoProductionConfig.sectionRankTracking.seedClusters.map((cluster) => cluster.query)).toContain(
      "подногтевая меланома фото"
    );
    expect(zarukuSeoProductionConfig.sectionRankTracking.seedClusters.map((cluster) => cluster.clusterId)).toEqual(
      expect.arrayContaining(["seed_limfoma", "seed_medialib"])
    );
    const breastCancerSeeds = zarukuSeoProductionConfig.sectionRankTracking.seedClusters.filter(
      (cluster) => cluster.section === "/rak-molochnoj-zhelezy/"
    );
    const lungCancerSeeds = zarukuSeoProductionConfig.sectionRankTracking.seedClusters.filter(
      (cluster) => cluster.section === "/rak-lyogkogo/"
    );
    expect(breastCancerSeeds.length).toBeGreaterThanOrEqual(5);
    expect(breastCancerSeeds.length).toBeLessThanOrEqual(8);
    expect(lungCancerSeeds.length).toBeGreaterThanOrEqual(5);
    expect(lungCancerSeeds.length).toBeLessThanOrEqual(8);
    const forbiddenDrugTokens = zarukuSeoProductionConfig.semanticIntent.drugComplianceTokens;
    const newPrioritySeeds = [...breastCancerSeeds, ...lungCancerSeeds];
    expect(
      newPrioritySeeds.some((cluster) =>
        forbiddenDrugTokens.some((token) => cluster.query.toLowerCase().includes(token))
      )
    ).toBe(false);
    expect(zarukuSeoProductionConfig.metrikaReport.readsFlag).toBe("SEO_METRIKA_REPORT_READS");
    expect(zarukuSeoProductionConfig.metrikaReport.counterIdEnvVar).toBe("YANDEX_METRIKA_COUNTER_ID");
    expect(zarukuSeoProductionConfig.metrikaReport.sectionUrlPatterns.map((rule) => rule.section)).toContain("/map/");
    expect(zarukuSeoProductionConfig.metrikaReport.sectionUrlPatterns.map((rule) => rule.section)).toEqual(
      expect.arrayContaining([
        "/kompleksnoe_genomnoe_profilirovanie/",
        "/vnimatelney_k_sebe/",
        "/medialib/",
        "/limfoma/",
        "/rak-mochevogo-puzyrya/",
        "/obshie-temy/",
        "/pitanie/",
        "/neudobnye-voprosy/",
        "/content/",
      ])
    );
    expect(zarukuSeoProductionConfig.sectionRankTracking.sectionPriorities).toMatchObject({
      "/kompleksnoe_genomnoe_profilirovanie/": 1,
      "/vnimatelney_k_sebe/": 2,
    });
    expect(zarukuSeoProductionConfig.sectionRankTracking.seedClusters.map((cluster) => cluster.clusterId)).toEqual(
      expect.arrayContaining(["seed_kgp_definition", "seed_kgp_who_needs", "seed_self_check_screening"])
    );
    expect(zarukuSeoProductionConfig.mysqlDashboardExport.writesFlag).toBe("SEO_MYSQL_DASHBOARD_EXPORT");
    expect(zarukuSeoProductionConfig.mysqlDashboardExport.analyticsAccountId).toBe(66624469);
    expect(zarukuSeoProductionConfig.mysqlDashboardExport.tables.positionsWeekly).toBe("seo_positions_weekly");
    expect(zarukuSeoProductionConfig.mysqlDashboardExport.tables.sectionPatterns).toBe("seo_section_patterns");
    expect(zarukuSeoProductionConfig.mysqlDashboardExport.tables.aiVisibility).toBe("seo_ai_visibility");
    expect(zarukuSeoProductionConfig.mysqlDashboardExport.tables.sovWeekly).toBe("seo_sov_weekly");
    expect(zarukuSeoProductionConfig.mysqlDashboardExport.tables.advisoryJobs).toBe("seo_advisory_jobs");
    expect(zarukuSeoProductionConfig.approvalTaskExecution.writesFlag).toBe("SEO_APPROVAL_TASK_EXECUTION");
    expect(zarukuSeoProductionConfig.approvalTaskExecution.notionTokenEnvVar).toBe("NOTION_API_TOKEN");
    expect(zarukuSeoProductionConfig.approvalTaskExecution.notionParentPageId).toBe(
      "3917f8d546908107bca1c0614c070ce2"
    );
    expect(zarukuSeoProductionConfig.approvalTaskExecution.statuses.needsTargetPage).toBe("needs_target_page");
  });
});
