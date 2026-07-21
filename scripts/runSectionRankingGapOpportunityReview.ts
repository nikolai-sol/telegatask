import "dotenv/config";
import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import "../src/config/firebase";
import { zarukuSeoProductionConfig } from "../src/features/seoAgent/production/zaruku/zarukuSeoProductionConfig";
import { buildSectionRankingGapOpportunities } from "../src/features/seoAgent/sectionRankingGapOpportunityEngine";
import { listSeoRankHistoryRecords } from "../src/features/seoAgent/sectionRankHistoryRepository";
import { listWeeklyTop10ApprovalDecisionsByTeam } from "../src/features/seoAgent/weeklyTop10ApprovalDecisionRepository";
import { buildWeeklyTop10OpportunityId, buildWeeklyTop10InputsFromApprovalDecisions } from "../src/features/seoAgent/weeklyTop10ApprovalDecision";
import { generateWeeklyTop10Digest } from "../src/features/seoAgent/weeklyTop10Generator";
import { buildWeeklyTop10TelegramApprovalMessageV2, type WeeklyTop10TelegramApprovalEvidenceV2 } from "../src/features/seoAgent/weeklyTop10TelegramApprovalMessageV2";
import type { SeoOpportunity } from "../src/features/seoAgent/types";

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readFlag(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  return cleanString(args[index + 1]) || null;
}

function requiredFlag(args: string[], name: string): string {
  const value = readFlag(args, name);
  if (!value) {
    throw new Error("Usage: runSectionRankingGapOpportunityReview --out <task-047.json> --run-id <runId>");
  }
  return value;
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
    serpPosition: typeof opportunity.evidence?.find((item) => item.metric === "serp_position")?.value === "number"
      ? opportunity.evidence?.find((item) => item.metric === "serp_position")?.value as number
      : null,
    ctr: null,
    impressions: null,
    opportunityType: opportunity.opportunityType || null,
    medicalReviewRequired: evidenceValue(opportunity, "section") !== "/map/",
  };
}

async function main() {
  const args = process.argv.slice(2);
  const outPath = requiredFlag(args, "--out");
  const runId = requiredFlag(args, "--run-id");
  const generatedAt = new Date().toISOString();
  const rankConfig = zarukuSeoProductionConfig.sectionRankTracking;

  const records = await listSeoRankHistoryRecords({
    teamId: zarukuSeoProductionConfig.team.id,
    domain: zarukuSeoProductionConfig.domain,
    limit: 500,
  });
  const decisions = await listWeeklyTop10ApprovalDecisionsByTeam(zarukuSeoProductionConfig.team.id);
  const review = buildSectionRankingGapOpportunities({
    generatedAt,
    domain: zarukuSeoProductionConfig.domain,
    records,
    decisions,
    config: {
      sectionRankingGapMaxPosition: rankConfig.sectionRankingGapMaxPosition,
      rankSmoothingRuns: rankConfig.rankSmoothingRuns,
      decisionCooldownDays: rankConfig.decisionCooldownDays,
      sectionPriorities: rankConfig.sectionPriorities,
    },
  });
  const digestInputs = buildWeeklyTop10InputsFromApprovalDecisions({
    opportunities: review.opportunities,
    decisions,
  });
  const digest = generateWeeklyTop10Digest(digestInputs, { now: generatedAt });
  const digestMessages = digest.items.map((item, index) => {
    const opportunity = review.opportunities.find((candidate) => candidate.title === item.title);
    if (!opportunity) return null;
    return buildWeeklyTop10TelegramApprovalMessageV2({
      item,
      evidence: evidenceForOpportunity(opportunity),
      teamId: zarukuSeoProductionConfig.team.id,
      runId,
      draftTaskId: `t47${index + 1}`,
    });
  }).filter(Boolean);

  const artifact = {
    schemaVersion: "seo_os_section_ranking_gap_opportunity_review_v1",
    generatedAt,
    runId,
    domain: zarukuSeoProductionConfig.domain,
    teamId: zarukuSeoProductionConfig.team.id,
    source: "local_opt_in",
    inputs: {
      rankHistoryRecords: records.length,
      approvalDecisions: decisions.length,
    },
    review,
    digest: {
      summary: digest.summary,
      items: digest.items,
      messages: digestMessages,
      telegramMessagesSent: false,
      approvalCommandExecuted: false,
    },
    sideEffects: {
      firestoreWrites: false,
      telegramMessagesSent: false,
      approvalCommandExecuted: false,
      productionPipelineRun: false,
      schedulerCronChanged: false,
    },
    notes: [
      "Local opt-in review only.",
      "Gap opportunities are generated from RankHistory records and rendered through digest v2 preview messages.",
      "No Telegram send, approval execution, scheduler or production pipeline changes.",
    ],
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        outPath,
        rankHistoryRecords: records.length,
        approvalDecisions: decisions.length,
        generatedOpportunities: review.summary.generated,
        bySection: review.summary.bySection,
        digestSummary: digest.summary,
        sideEffects: artifact.sideEffects,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
