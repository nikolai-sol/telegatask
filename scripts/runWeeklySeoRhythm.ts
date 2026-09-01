import "dotenv/config";
import { spawn } from "child_process";
import { createHash } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import "../src/config/firebase";
import { buildSeoGlobalReport } from "../src/features/seoAgent/globalReportAssembler";
import { GoogleSearchConsoleSeoSource } from "../src/features/seoAgent/providers/googleSearchConsoleSeoSource";
import { YandexSerpRankSource } from "../src/features/seoAgent/providers/yandexSerpRankSource";
import { zarukuSeoProductionConfig } from "../src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig";
import { normalizeSearchPerformanceSnapshot } from "../src/features/seoAgent/searchPerformanceNormalizer";
import { generateSearchPerformanceOpportunities } from "../src/features/seoAgent/searchPerformanceOpportunityEngine";
import {
  buildSeoRankDashboardExport,
  buildSeoRankHistoryRecords,
  buildSeoSectionRankTrackingList,
  type SeoSectionRankTrackingListItem,
  type SeoSectionRankTrackingLiveCluster,
} from "../src/features/seoAgent/sectionRankTracking";
import {
  listSeoRankHistoryRecords,
  listPreviousSeoRankHistoryRecords,
  persistSeoRankHistoryRecords,
  seoRankHistoryWritesEnabled,
} from "../src/features/seoAgent/sectionRankHistoryRepository";
import { buildSectionRankingGapOpportunities } from "../src/features/seoAgent/sectionRankingGapOpportunityEngine";
import {
  buildSeoWeeklyRhythmWindow,
  runWeeklySeoRhythm,
  type WeeklySeoRhythmDigestMessage,
} from "../src/features/seoAgent/weeklySeoRhythm";
import { weeklySeoRhythmFirestoreStore } from "../src/features/seoAgent/weeklySeoRhythmRepository";
import { buildWeeklyTop10InputsFromApprovalDecisions, buildWeeklyTop10OpportunityId } from "../src/features/seoAgent/weeklyTop10ApprovalDecision";
import { listWeeklyTop10ApprovalDecisionsByTeam } from "../src/features/seoAgent/weeklyTop10ApprovalDecisionRepository";
import {
  buildWeeklyTop10NoNewOpportunitiesLifeSign,
  generateWeeklyTop10Digest,
} from "../src/features/seoAgent/weeklyTop10Generator";
import { buildWeeklyTop10TelegramApprovalMessageV2, type WeeklyTop10TelegramApprovalEvidenceV2 } from "../src/features/seoAgent/weeklyTop10TelegramApprovalMessageV2";
import { collectYandexMetrikaSectionTraffic } from "../src/features/seoAgent/yandexMetrikaReportCollector";
import { callTelegramApi } from "../src/features/seoAgent/telegramApiTransport";
import type { SeoOpportunity } from "../src/features/seoAgent/types";

type QueryClusterReviewArtifact = {
  clusterReview?: {
    clusters?: SeoSectionRankTrackingLiveCluster[];
  };
};

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

function nestedRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

type TrackingSetByRun = {
  schemaVersion: "seo_os_section_rank_tracking_set_v1";
  generatedAt: string;
  runId: string;
  runWeekKey: string;
  dataWeekKey: string;
  itemCount: number;
  seedDerivedCount: number;
  liveDerivedCount: number;
  seedFallbackCount: number;
  checksum: string;
  items: Array<{
    clusterId: string;
    query: string;
    section: string;
    intentClass: string;
    source: SeoSectionRankTrackingListItem["source"];
    region: string;
    regionSource: SeoSectionRankTrackingListItem["regionSource"];
    regionFallback: boolean;
  }>;
};

type YandexRegionRunSummary = {
  region: string;
  requestCount: number;
  checkedCount: number;
  state: string;
};

function buildRegionTrackingMap(trackingList: SeoSectionRankTrackingListItem[]): Map<string, SeoSectionRankTrackingListItem[]> {
  const map = new Map<string, SeoSectionRankTrackingListItem[]>();
  for (const item of trackingList) {
    const region = cleanString(item.region) || "225";
    map.set(region, [...(map.get(region) || []), item]);
  }
  return map;
}

function buildTrackingSetSnapshot(input: {
  runId: string;
  runWeekKey: string;
  dataWeekKey: string;
  trackingList: SeoSectionRankTrackingListItem[];
  requestCount: number;
  regionSummaries: YandexRegionRunSummary[];
}): TrackingSetByRun & { requestCount: number; regionSummaries: YandexRegionRunSummary[] } {
  const items = input.trackingList
    .map((item) => ({
      clusterId: item.clusterId,
      query: item.query,
      section: item.section,
      intentClass: item.intentClass,
      source: item.source,
      region: item.region,
      regionSource: item.regionSource,
      regionFallback: item.regionFallback,
    }))
    .sort((a, b) => {
      const sectionDiff = a.section.localeCompare(b.section);
      if (sectionDiff) return sectionDiff;
      return a.query.localeCompare(b.query);
    });
  const checksum = createHash("sha256").update(JSON.stringify(items)).digest("hex");
  const seedDerivedCount = items.filter((item) => item.source !== "live_cluster").length;
  const liveDerivedCount = items.filter((item) => item.source === "live_cluster").length;
  const seedFallbackCount = items.filter((item) => item.regionFallback).length;
  return {
    schemaVersion: "seo_os_section_rank_tracking_set_v1",
    generatedAt: new Date().toISOString(),
    runId: input.runId,
    runWeekKey: input.runWeekKey,
    dataWeekKey: input.dataWeekKey,
    itemCount: items.length,
    seedDerivedCount,
    liveDerivedCount,
    seedFallbackCount,
    checksum,
    items,
    requestCount: input.requestCount,
    regionSummaries: input.regionSummaries,
  };
}

function readLiveClusters(path: string): SeoSectionRankTrackingLiveCluster[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as QueryClusterReviewArtifact;
  const clusters = parsed.clusterReview?.clusters;
  if (!Array.isArray(clusters)) throw new Error(`No clusterReview.clusters found in ${path}`);
  return clusters;
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function evidenceValue(opportunity: SeoOpportunity, metric: string): string | null {
  const value = opportunity.evidence?.find((item) => item.metric === metric)?.value;
  return cleanString(value) || null;
}

function evidenceNumber(opportunity: SeoOpportunity, metric: string): number | null {
  const value = opportunity.evidence?.find((item) => item.metric === metric)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function evidenceUrl(opportunity: SeoOpportunity, metric: string): string | null {
  return cleanString(opportunity.evidence?.find((item) => item.metric === metric)?.url) || null;
}

function evidenceForOpportunity(opportunity: SeoOpportunity): WeeklyTop10TelegramApprovalEvidenceV2 {
  const serpValue = opportunity.evidence?.find((item) => item.metric === "serp_position")?.value;
  const bindingQuery = evidenceValue(opportunity, "target_url_binding");
  return {
    opportunityId: buildWeeklyTop10OpportunityId(opportunity),
    clusterId: cleanString(opportunity.sourceFindingId?.replace(/^rank_gap_/, "")) || null,
    section: evidenceValue(opportunity, "section"),
    query: cleanString(opportunity.targetKeywords[0]) || opportunity.title,
    seedQueries: [...opportunity.targetKeywords],
    intentClass: null,
    targetUrl: opportunity.targetUrl || evidenceUrl(opportunity, "target_url_binding") || null,
    targetUrlBindingSourceQuery: bindingQuery,
    targetUrlBindingSerpPosition: evidenceNumber(opportunity, "target_url_binding_serp_position"),
    webmasterAveragePosition: null,
    serpPosition: typeof serpValue === "number" ? serpValue : null,
    ctr: null,
    impressions: null,
    opportunityType: opportunity.opportunityType || null,
    medicalReviewRequired: evidenceValue(opportunity, "section") !== "/map/",
    advisory: null,
  };
}

async function telegramCall(token: string, method: string, body: Record<string, unknown>): Promise<any> {
  return callTelegramApi({
    token,
    method,
    body,
    onRetry: (message) => console.warn(`[telegram] ${message}`),
  });
}

export async function runWeeklySeoRhythmCli(args = process.argv.slice(2)) {
  const triggeredAt = readFlag(args, "--now") || new Date().toISOString();
  const window = buildSeoWeeklyRhythmWindow(triggeredAt);
  const now = triggeredAt;
  const outDir = readFlag(args, "--out-dir") || "reports";
  const clusterReviewPath =
    readFlag(args, "--cluster-review") ||
    process.env.SEO_WEEKLY_RHYTHM_CLUSTER_REVIEW_PATH ||
    "reports/task-043-zaruku-yandex-query-cluster-review-2026-07-07.json";
  const chatId = readFlag(args, "--chat-id") || process.env.SEO_WEEKLY_TOP10_DEV_CHAT_ID;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const simulateFailureStage = readFlag(args, "--simulate-failure-stage");
  const dryRunNoTelegram = hasFlag(args, "--dry-run-no-telegram");
  const digestChatId = !dryRunNoTelegram && chatId && Number.isFinite(Number(chatId)) ? Number(chatId) : null;
  const dashboardExportPostChain = process.env.SEO_MYSQL_DASHBOARD_POST_CHAIN === "1" || hasFlag(args, "--mysql-dashboard-post-chain");
  const globalReportPostChain =
    process.env.SEO_GLOBAL_REPORT_POST_CHAIN === "1"
    || hasFlag(args, "--global-report-post-chain")
    || dashboardExportPostChain;

  const rankConfig = zarukuSeoProductionConfig.sectionRankTracking;
  const liveClusters = readLiveClusters(clusterReviewPath);
  let lastArtifactPath: string | null = null;

  const result = await runWeeklySeoRhythm({
    now,
    window,
    env: process.env,
    config: {
      weeklyRunMaxSerpRequests: rankConfig.weeklyRunMaxSerpRequests,
    },
    deps: {
      store: weeklySeoRhythmFirestoreStore,
      async buildTrackingList() {
        if (simulateFailureStage === "tracking_list") throw new Error("simulated tracking_list failure");
        return buildSeoSectionRankTrackingList({
          config: rankConfig,
          liveClusters,
          targetIntentClasses: zarukuSeoProductionConfig.semanticIntent.targetIntentClasses,
        });
      },
      async runRankTracking(input) {
        if (simulateFailureStage === "rank_tracking") throw new Error("simulated rank_tracking failure");
        const previousRecords = await listPreviousSeoRankHistoryRecords({
          teamId: zarukuSeoProductionConfig.team.id,
          domain: zarukuSeoProductionConfig.domain,
          beforeRunId: input.runId,
        });
        const rankSource = new YandexSerpRankSource();
        const regionSummaries: YandexRegionRunSummary[] = [];
        const checks: Awaited<ReturnType<YandexSerpRankSource["run"]>>["checks"] = [];
        for (const [region, items] of buildRegionTrackingMap(input.trackingList).entries()) {
          const rankTracking = await rankSource.run({
            targetDomain: zarukuSeoProductionConfig.domain,
            targetDomainAliases: [...zarukuSeoProductionConfig.targetDomainAliases],
            keywords: items.map((item) => item.query),
            region,
            language: zarukuSeoProductionConfig.language,
            device: zarukuSeoProductionConfig.targetDevice,
          });
          regionSummaries.push({
            region,
            requestCount: items.length,
            checkedCount: rankTracking.checks.length,
            state: rankTracking.status.state,
          });
          checks.push(...rankTracking.checks);
        }
        const trackingSetVersion = buildTrackingSetSnapshot({
          runId: input.runId,
          runWeekKey: input.runWeekKey,
          dataWeekKey: input.dataWeekKey,
          trackingList: input.trackingList,
          requestCount: input.trackingList.length,
          regionSummaries,
        });
        const records = buildSeoRankHistoryRecords({
          teamId: zarukuSeoProductionConfig.team.id,
          runId: input.runId,
          domain: zarukuSeoProductionConfig.domain,
          trackingList: input.trackingList,
          rankChecks: checks,
        });
        const persistence = await persistSeoRankHistoryRecords({
          writesEnabled: seoRankHistoryWritesEnabled(),
          records,
        });
        const dashboard = buildSeoRankDashboardExport({
          generatedAt: new Date().toISOString(),
          domain: zarukuSeoProductionConfig.domain,
          runId: input.runId,
          currentRecords: records,
          previousRecords,
          alertDropThreshold: rankConfig.alertDropThreshold,
          rankSmoothingRuns: rankConfig.rankSmoothingRuns,
        });
        return {
          requestCount: input.trackingList.length,
          recordsWritten: persistence.written,
          artifact: {
            trackingList: input.trackingList,
            trackingSetVersion,
            rankTracking: {
              checks,
              regions: regionSummaries,
            },
            rankHistory: {
              writesEnabled: seoRankHistoryWritesEnabled(),
              previousRecordCount: previousRecords.length,
              written: persistence.written,
              records,
            },
            dashboard,
          },
        };
      },
      async collectSearchPerformance(input) {
        const snapshot = await new GoogleSearchConsoleSeoSource().getSnapshot(zarukuSeoProductionConfig.domain, {
          teamId: zarukuSeoProductionConfig.team.id,
          siteUrl: zarukuSeoProductionConfig.gscSiteUrl,
        });
        const records = normalizeSearchPerformanceSnapshot({
          source: "gsc",
          snapshot,
        });
        const opportunities = generateSearchPerformanceOpportunities(records, {
          market: zarukuSeoProductionConfig.market,
          language: zarukuSeoProductionConfig.language,
        });
        return {
          records: records.length,
          opportunities: opportunities.length,
          artifact: {
            schemaVersion: "seo_os_weekly_search_performance_v1",
            generatedAt: new Date().toISOString(),
            runId: input.runId,
            weekKey: input.weekKey,
            source: "gsc",
            snapshot,
            records,
            opportunities,
            sideEffects: {
              gscApiReads: true,
              firestoreWrites: false,
              telegramMessagesSent: false,
              productionPipelineRun: false,
            },
          },
        };
      },
      async buildGapDigest(input) {
        if (simulateFailureStage === "gap_digest") throw new Error("simulated gap_digest failure");
        const records = await listSeoRankHistoryRecords({
          teamId: zarukuSeoProductionConfig.team.id,
          domain: zarukuSeoProductionConfig.domain,
          limit: 500,
        });
        const decisions = await listWeeklyTop10ApprovalDecisionsByTeam(zarukuSeoProductionConfig.team.id);
        const review = buildSectionRankingGapOpportunities({
          generatedAt: new Date().toISOString(),
          domain: zarukuSeoProductionConfig.domain,
          records,
          decisions,
          config: {
            sectionRankingGapMaxPosition: rankConfig.sectionRankingGapMaxPosition,
            rankSmoothingRuns: rankConfig.rankSmoothingRuns,
            decisionCooldownDays: rankConfig.decisionCooldownDays,
            sectionPriorities: rankConfig.sectionPriorities,
            targetUrlBindingMinSharedTokens: rankConfig.targetUrlBindingMinSharedTokens,
          },
        });
        const digestInputs = buildWeeklyTop10InputsFromApprovalDecisions({
          opportunities: review.opportunities,
          decisions,
        });
        const digest = generateWeeklyTop10Digest(digestInputs, { now: new Date().toISOString() });
        const messages = digest.items.map((item, index) => {
          const opportunity = review.opportunities.find((candidate) => candidate.title === item.title);
          if (!opportunity) return null;
          return buildWeeklyTop10TelegramApprovalMessageV2({
            item,
            evidence: evidenceForOpportunity(opportunity),
            teamId: zarukuSeoProductionConfig.team.id,
            runId: input.runId,
            draftTaskId: `w48${index + 1}`,
          });
        }).filter(Boolean) as WeeklySeoRhythmDigestMessage[];
        if (!messages.length && digest.summary.noNewOpportunities) {
          messages.push({
            text: buildWeeklyTop10NoNewOpportunitiesLifeSign({
              runWeekKey: input.runWeekKey,
              onControlCount: digest.watchlist.length,
              watchlist: digest.watchlist,
            }),
            buttons: [],
            metadata: {
              schema: "weekly_top10_empty_life_sign_v1",
              runWeekKey: input.runWeekKey,
              dataWeekKey: input.dataWeekKey,
              noNewOpportunities: true,
              watchlistCount: digest.watchlist.length,
            },
          });
        }
        return {
          opportunityCount: review.summary.generated,
          messages,
          artifact: {
            review,
            advisoryEnrichment: {
              enabled: false,
              mode: "async_mysql_mac_worker",
              state: "advisory_pending",
              summary: {
                requested: 0,
                enriched: 0,
                degraded: 0,
                complianceRejected: 0,
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
              },
              failures: [],
              boundary: "outside_weekly_chain",
            },
            digest: {
              summary: digest.summary,
              items: digest.items,
              messages,
            },
          },
        };
      },
      async sendDigest(messages) {
        if (simulateFailureStage === "digest_delivery") throw new Error("simulated digest_delivery failure");
        if (dryRunNoTelegram) return messages.map((_, index) => ({ messageId: 10_000 + index }));
        if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
        if (!chatId) throw new Error("SEO_WEEKLY_TOP10_DEV_CHAT_ID or --chat-id is required");
        const sent = [];
        for (const message of messages) {
          const result = await telegramCall(token, "sendMessage", {
            chat_id: chatId,
            text: message.text,
            reply_markup: {
              inline_keyboard: (message.buttons || []).map((row) =>
                row.map((button: any) => ({ text: button.text, callback_data: button.callbackData }))
              ),
            },
            disable_web_page_preview: true,
          });
          sent.push({ messageId: result.message_id });
        }
        return sent;
      },
      async sendServiceMessage(text) {
        if (dryRunNoTelegram) return { messageId: 99_999 };
        if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
        if (!chatId) throw new Error("SEO_WEEKLY_TOP10_DEV_CHAT_ID or --chat-id is required");
        const result = await telegramCall(token, "sendMessage", {
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        });
        return { messageId: result.message_id };
      },
      async writeArtifact(input) {
        const path = `${outDir}/task-048-zaruku-weekly-seo-rhythm-${input.weekKey}.json`;
        const artifact = {
          ...input.artifact,
          domain: zarukuSeoProductionConfig.domain,
          teamId: zarukuSeoProductionConfig.team.id,
          clusterReviewPath,
          digestChatId,
          source: "weekly_cron_or_manual_trigger",
          sideEffects: {
            ...input.artifact.sideEffects,
            productionChatDelivery: false,
          },
        };
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`);
        lastArtifactPath = path;
        return { path };
      },
      buildGlobalReport: globalReportPostChain
        ? async (input) => {
          const generatedAt = new Date().toISOString();
          const metrika = await collectYandexMetrikaSectionTraffic({
            generatedAt,
            weekKey: input.weekKey,
            domain: zarukuSeoProductionConfig.domain,
            config: zarukuSeoProductionConfig.metrikaReport,
          });
          const decisions = await listWeeklyTop10ApprovalDecisionsByTeam(zarukuSeoProductionConfig.team.id);
          const rankTrackingArtifact = nestedRecord(input.weeklyArtifact.rankTrackingArtifact);
          if (!rankTrackingArtifact.dashboard) {
            throw new Error("weekly artifact does not contain rankTrackingArtifact.dashboard");
          }
          const globalReport = buildSeoGlobalReport({
            generatedAt,
            weekKey: input.weekKey,
            runId: input.runId,
            domain: zarukuSeoProductionConfig.domain,
            teamId: zarukuSeoProductionConfig.team.id,
            rankDashboard: rankTrackingArtifact.dashboard as any,
            weeklyRhythmArtifact: {
              ...input.weeklyArtifact,
              digestChatId,
            },
            decisions,
            metrika: metrika.report,
            searchPerformance: nestedRecord(input.weeklyArtifact).searchPerformanceArtifact,
          });
          const rawPath = `${outDir}/raw/task-049-zaruku-metrika-raw-${input.weekKey}.json`;
          const reportPath = `${outDir}/task-049-zaruku-global-report-${input.weekKey}.json`;
          mkdirSync(dirname(rawPath), { recursive: true });
          writeFileSync(rawPath, `${JSON.stringify(metrika.rawSnapshot, null, 2)}\n`);
          writeFileSync(reportPath, `${JSON.stringify({
            ...globalReport,
            source: "weekly_read_only_post_chain",
            inputs: {
              rawMetrikaSnapshotPath: rawPath,
              approvalDecisions: decisions.length,
              searchPerformanceRecords: globalReport.layers.searchPerformance.summary.records,
              searchPerformanceOpportunities: globalReport.layers.searchPerformance.summary.opportunities,
            },
            sideEffects: {
              ...globalReport.sideEffects,
              firestoreReads: true,
              metrikaApiReads: metrika.rawSnapshot.requestCount,
              reportArtifactsWritten: true,
            },
          }, null, 2)}\n`);
          return {
            path: reportPath,
            metrikaStatus: metrika.report.status,
          };
        }
        : undefined,
      exportDashboard: dashboardExportPostChain
        ? async (input) => {
          if (simulateFailureStage === "dashboard_export") throw new Error("simulated dashboard_export failure");
          if (!input.globalReportPath) {
            return {
              status: "export_pending",
              path: null,
              error: "global report artifact is required before MySQL dashboard export.",
            };
          }
          const outPath = `${outDir}/task-061-zaruku-mysql-dashboard-export-${input.runWeekKey}-data-${input.dataWeekKey}.json`;
          const sqlOutPath = `${outDir}/task-061-zaruku-mysql-dashboard-export-${input.runWeekKey}-data-${input.dataWeekKey}.sql`;
          const exportArgs = [
            "-r",
            "ts-node/register/transpile-only",
            "scripts/runSeoMysqlDashboardExport.ts",
            "--global-report",
            input.globalReportPath,
            "--out",
            outPath,
            "--sql-out",
            sqlOutPath,
          ];
          if (process.env[zarukuSeoProductionConfig.mysqlDashboardExport.writesFlag] === "1") {
            exportArgs.push("--execute");
          }
          await new Promise<void>((resolve, reject) => {
            const child = spawn(process.execPath, exportArgs, {
              cwd: process.cwd(),
              stdio: ["ignore", "inherit", "inherit"],
              env: process.env,
            });
            child.on("error", reject);
            child.on("exit", (code) => {
              if (code === 0) resolve();
              else reject(new Error(`MySQL dashboard export script exited with code ${code}`));
            });
          });
          const artifact = nestedRecord(readJsonFile(outPath));
          return {
            status: artifact.status === "exported" ? "exported" : "export_pending",
            path: outPath,
            error: cleanString(artifact.error) || null,
          };
        }
        : undefined,
    },
  });

  console.log(JSON.stringify({ ...result, artifactPath: result.artifactPath || lastArtifactPath }, null, 2));
}

if (require.main === module) {
  runWeeklySeoRhythmCli().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
