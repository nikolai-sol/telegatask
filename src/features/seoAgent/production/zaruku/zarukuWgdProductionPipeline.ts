import fs from "fs";
import path from "path";
import { firestore } from "../../../../config/firebase";
import { upsertSeoConfig } from "../../seoConfigRepository";
import { listSeoDraftTasksForRun, runSeoAnalysis } from "../../seoAgentService";
import { collectHomepageSnapshot } from "./collectors/homepageSnapshotCollector";
import { collectLocalLighthouse } from "./collectors/localLighthouseCollector";
import { collectSitemapSummary } from "./collectors/sitemapSummaryCollector";
import { collectYandexGenSearchProbes } from "./collectors/yandexGenSearchProbeCollector";
import { collectYandexPopularQueries } from "./collectors/yandexPopularQueriesCollector";
import { zarukuSeoProductionConfig } from "./zarukuSeoProductionConfig";
import { renderZarukuWgdHtmlReport } from "./zarukuWgdHtmlReportRenderer";

const zarukuConfig = zarukuSeoProductionConfig;

export type ZarukuWgdProductionPipelineResult = {
  runId: string;
  draftTaskCount: number;
  jsonPath: string;
  htmlPath: string;
};

export async function runZarukuWgdProductionPipeline(): Promise<ZarukuWgdProductionPipelineResult> {
  process.env.SEO_RANK_TRACKING_MAX_KEYWORDS = zarukuConfig.rankTrackingMaxKeywords;

  await firestore.collection("teams").doc(zarukuConfig.team.id).set(
    {
      name: zarukuConfig.team.name,
      memberIds: [zarukuConfig.user.id],
      roles: { [zarukuConfig.user.id]: "owner" },
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
  await firestore.collection("companies").doc(zarukuConfig.company.id).set(
    {
      teamId: zarukuConfig.team.id,
      name: zarukuConfig.company.name,
      type: zarukuConfig.company.type,
      restrictAccess: zarukuConfig.company.restrictAccess,
      status: zarukuConfig.company.status,
      createdAt: Date.now(),
      createdByUserId: zarukuConfig.user.id,
    },
    { merge: true }
  );

  const config = await upsertSeoConfig({
    teamId: zarukuConfig.team.id,
    companyId: zarukuConfig.company.id,
    domain: zarukuConfig.domain,
    gscSiteUrl: zarukuConfig.gscSiteUrl,
    targetDomainAliases: [...zarukuConfig.targetDomainAliases],
    markets: [zarukuConfig.market],
    languages: [zarukuConfig.language],
    competitors: [...zarukuConfig.competitors],
    importantSections: [...zarukuConfig.importantSections],
    brandKeywords: [...zarukuConfig.brandKeywords],
    excludeKeywords: [...zarukuConfig.excludeKeywords],
    trackingKeywords: [...zarukuConfig.trackingKeywords],
    targetLocation: zarukuConfig.targetLocation,
    targetRegion: zarukuConfig.targetRegion,
    targetDevice: zarukuConfig.targetDevice,
    createdByUserId: zarukuConfig.user.id,
  });

  const [page, sitemap, yandexQueries] = await Promise.all([
    collectHomepageSnapshot(zarukuConfig),
    collectSitemapSummary(zarukuConfig),
    collectYandexPopularQueries(zarukuConfig),
  ]);
  const lighthouse = collectLocalLighthouse(zarukuConfig);

  const run = await runSeoAnalysis({
    teamId: zarukuConfig.team.id,
    companyId: zarukuConfig.company.id,
    config,
    mode: "quick_audit",
    createdByUserId: zarukuConfig.user.id,
    sources: [...zarukuConfig.selectedSources],
    keywords: [...zarukuConfig.trackingKeywords],
    location: zarukuConfig.targetLocation,
    region: zarukuConfig.targetRegion,
    language: zarukuConfig.language,
    device: zarukuConfig.targetDevice,
  });
  const draftTasks = await listSeoDraftTasksForRun(zarukuConfig.team.id, run.id);

  const aiProbes = await collectYandexGenSearchProbes(zarukuConfig);

  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve(process.cwd(), "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `${zarukuConfig.reportNamePrefix}-${stamp}.json`);
  const htmlPath = path.join(outDir, `${zarukuConfig.reportNamePrefix}-${stamp}.html`);
  const payload = {
    run,
    draftTasks,
    page,
    sitemap,
    lighthouse,
    yandexQueries,
    aiProbes,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(htmlPath, renderZarukuWgdHtmlReport({ ...payload, jsonPath, htmlPath }));

  return { runId: run.id, draftTaskCount: draftTasks.length, jsonPath, htmlPath };
}
