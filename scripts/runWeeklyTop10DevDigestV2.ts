import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import "../src/config/firebase";
import { buildWeeklyTop10ApprovalDecisionId, buildWeeklyTop10InputsFromApprovalDecisions, buildWeeklyTop10OpportunityId, persistWeeklyTop10ApprovalDecision, type WeeklyTop10ApprovalDecisionRecord } from "../src/features/seoAgent/weeklyTop10ApprovalDecision";
import { listWeeklyTop10ApprovalDecisionsByTeam, weeklyTop10ApprovalDecisionFirestoreStore, weeklyTop10ApprovalDecisionWritesEnabled } from "../src/features/seoAgent/weeklyTop10ApprovalDecisionRepository";
import { generateWeeklyTop10Digest, type WeeklyTop10DigestItem } from "../src/features/seoAgent/weeklyTop10Generator";
import { buildWeeklyTop10TelegramApprovalMessageV2, type WeeklyTop10TelegramApprovalEvidenceV2 } from "../src/features/seoAgent/weeklyTop10TelegramApprovalMessageV2";
import { planWeeklyTop10TelegramApprovalTelegrafAdapter } from "../src/features/seoAgent/weeklyTop10TelegramApprovalTelegrafAdapter";
import type { SeoOpportunity } from "../src/features/seoAgent/types";

type QueryClusterArtifact = {
  clusterReview: {
    opportunities: SeoOpportunity[];
    clusters: Array<{
      clusterId: string;
      primaryQuery: string;
      intentClass: string;
      memberQueries: string[];
      aggregate: {
        impressions: number | null;
        ctr: number | null;
        averagePosition: number | null;
      };
      urlEvidence: {
        matchedUrl: string;
        serpPosition: number | null;
      } | null;
    }>;
  };
};

type SentDigestMessage = {
  itemRank: number;
  draftTaskId: string;
  opportunityId: string;
  clusterId: string | null;
  messageId: number;
  callbacks: string[];
};

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
    throw new Error(
      "Usage: runWeeklyTop10DevDigestV2 --cluster-review <task-043.json> --out <task-045.json> --team-id <teamId> --run-id <runId> [--chat-id <telegramChatId>] [--capture-ms <ms>] [--reject-reason <text>]"
    );
  }
  return value;
}

function readNumberFlag(args: string[], name: string, fallback: number): number {
  const value = Number(readFlag(args, name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function callbackAction(data: string): "approve" | "reject" | "open" | "convert" | "unknown" {
  const code = data.split(":")[2];
  if (code === "a") return "approve";
  if (code === "r") return "reject";
  if (code === "o") return "open";
  if (code === "c") return "convert";
  return "unknown";
}

function clusterForOpportunity(artifact: QueryClusterArtifact, opportunity: SeoOpportunity) {
  const query = cleanString(opportunity.targetKeywords[0]);
  return artifact.clusterReview.clusters.find((cluster) =>
    cluster.primaryQuery === query || cluster.memberQueries.includes(query)
  ) || null;
}

function evidenceForOpportunity(input: {
  artifact: QueryClusterArtifact;
  opportunity: SeoOpportunity;
}): WeeklyTop10TelegramApprovalEvidenceV2 {
  const cluster = clusterForOpportunity(input.artifact, input.opportunity);
  return {
    opportunityId: buildWeeklyTop10OpportunityId(input.opportunity),
    clusterId: cluster?.clusterId || null,
    query: cleanString(input.opportunity.targetKeywords[0]) || input.opportunity.title,
    intentClass: cluster?.intentClass || null,
    targetUrl: input.opportunity.targetUrl || cluster?.urlEvidence?.matchedUrl || null,
    webmasterAveragePosition: cluster?.aggregate.averagePosition ?? null,
    serpPosition: cluster?.urlEvidence?.serpPosition ?? null,
    ctr: cluster?.aggregate.ctr ?? null,
    impressions: cluster?.aggregate.impressions ?? null,
    opportunityType: input.opportunity.opportunityType || null,
    medicalReviewRequired: cluster?.intentClass === "medical_informational",
  };
}

async function telegramCall(token: string, method: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json() as { ok: boolean; description?: string; result?: unknown };
  if (!json.ok) throw new Error(`${method} failed: ${json.description}`);
  return json.result;
}

async function getUpdates(token: string, input: { offset?: number; timeout?: number }) {
  const params = new URLSearchParams({
    limit: "100",
    timeout: String(input.timeout ?? 0),
    allowed_updates: JSON.stringify(["callback_query", "message"]),
  });
  if (input.offset) params.set("offset", String(input.offset));
  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?${params.toString()}`);
  const json = await res.json() as { ok: boolean; description?: string; result?: any[] };
  if (!json.ok) throw new Error(`getUpdates failed: ${json.description}`);
  return json.result || [];
}

async function nextUpdateOffset(token: string): Promise<number | undefined> {
  const updates = await getUpdates(token, { timeout: 0 });
  const maxUpdateId = updates.reduce((max, update) => Math.max(max, update.update_id || 0), 0);
  return maxUpdateId > 0 ? maxUpdateId + 1 : undefined;
}

function decisionRecordFromPersisted(result: Awaited<ReturnType<typeof persistWeeklyTop10ApprovalDecision>>): WeeklyTop10ApprovalDecisionRecord | null {
  return result.decision ? { ...result.decision } : null;
}

async function main() {
  const args = process.argv.slice(2);
  const clusterReviewPath = requiredFlag(args, "--cluster-review");
  const outPath = requiredFlag(args, "--out");
  const teamId = requiredFlag(args, "--team-id");
  const runId = requiredFlag(args, "--run-id");
  const chatId = readFlag(args, "--chat-id") || process.env.SEO_WEEKLY_TOP10_DEV_CHAT_ID;
  const captureMs = readNumberFlag(args, "--capture-ms", 180_000);
  const rejectReason = readFlag(args, "--reject-reason") || "Требует медицинского/редакторского ревью перед постановкой задачи.";
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  if (!chatId) throw new Error("SEO_WEEKLY_TOP10_DEV_CHAT_ID or --chat-id is required");

  const artifact = JSON.parse(readFileSync(clusterReviewPath, "utf8")) as QueryClusterArtifact;
  const existingDecisions = await listWeeklyTop10ApprovalDecisionsByTeam(teamId);
  const initialInputs = buildWeeklyTop10InputsFromApprovalDecisions({
    opportunities: artifact.clusterReview.opportunities,
    decisions: existingDecisions,
  });
  const digest = generateWeeklyTop10Digest(initialInputs, { now: new Date().toISOString() });
  const offset = await nextUpdateOffset(token);
  const sentMessages: SentDigestMessage[] = [];
  const evidenceByDraftTask = new Map<string, WeeklyTop10TelegramApprovalEvidenceV2>();

  for (const [index, item] of digest.items.entries()) {
    const opportunity = artifact.clusterReview.opportunities.find((candidate) => candidate.title === item.title);
    if (!opportunity) continue;
    const draftTaskId = `t45${index + 1}`;
    const evidence = evidenceForOpportunity({ artifact, opportunity });
    const message = buildWeeklyTop10TelegramApprovalMessageV2({
      item,
      evidence,
      teamId,
      runId,
      draftTaskId,
    });
    const result = await telegramCall(token, "sendMessage", {
      chat_id: chatId,
      text: message.text,
      reply_markup: {
        inline_keyboard: message.buttons.map((row) =>
          row.map((button) => ({ text: button.text, callback_data: button.callbackData }))
        ),
      },
      disable_web_page_preview: true,
    });
    evidenceByDraftTask.set(draftTaskId, evidence);
    sentMessages.push({
      itemRank: item.rank,
      draftTaskId,
      opportunityId: evidence.opportunityId,
      clusterId: evidence.clusterId || null,
      messageId: result.message_id,
      callbacks: message.buttons.flat().map((button) => button.callbackData),
    });
  }

  const captured: Array<Record<string, unknown>> = [];
  let currentOffset = offset;
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  while (Date.now() - startedMs < captureMs && captured.filter((item) => item.action === "approve" || item.action === "reject").length < Math.min(2, sentMessages.length)) {
    const updates = await getUpdates(token, { offset: currentOffset, timeout: 25 });
    for (const update of updates) {
      currentOffset = Math.max(currentOffset || 0, (update.update_id || 0) + 1);
      const callback = update.callback_query;
      const data = cleanString(callback?.data);
      if (!data.startsWith("seo10:")) continue;
      if (String(callback?.message?.chat?.id || "") !== String(chatId)) continue;
      const action = callbackAction(data);
      if (action !== "approve" && action !== "reject") continue;

      const [, , , , callbackRunId, draftTaskId] = data.split(":");
      if (callbackRunId !== runId) continue;
      const evidence = evidenceByDraftTask.get(draftTaskId);
      if (!evidence) continue;
      const plan = planWeeklyTop10TelegramApprovalTelegrafAdapter({
        callbackData: data,
        telegramUserId: callback?.from?.id || null,
        userId: `telegram:${callback?.from?.id || "unknown"}`,
        role: "seo_manager",
      });
      const persisted = await persistWeeklyTop10ApprovalDecision(weeklyTop10ApprovalDecisionFirestoreStore, {
        writesEnabled: weeklyTop10ApprovalDecisionWritesEnabled(),
        teamId,
        runId,
        opportunityId: evidence.opportunityId,
        clusterId: evidence.clusterId || null,
        draftTaskId,
        decision: action === "approve" ? "approved" : "rejected",
        rejectReason: action === "reject" ? rejectReason : null,
        reviewer: {
          userId: `telegram:${callback?.from?.id || "unknown"}`,
          telegramUserId: callback?.from?.id || null,
        },
        decidedAt: new Date().toISOString(),
        callbackData: data,
      });

      await telegramCall(token, "answerCallbackQuery", {
        callback_query_id: callback.id,
        text: persisted.answerText,
        show_alert: false,
      });
      await telegramCall(token, "sendMessage", {
        chat_id: chatId,
        text: [
          persisted.answerText,
          action === "approve" ? "План готов: approve_draft_task. Команда не выполнена." : `Причина отказа: ${rejectReason}`,
        ].join("\n"),
      });
      captured.push({
        updateId: update.update_id,
        callbackQueryId: callback.id,
        fromId: callback?.from?.id || null,
        messageId: callback?.message?.message_id || null,
        data,
        action,
        plan,
        persistence: {
          status: persisted.status,
          decision: decisionRecordFromPersisted(persisted),
          sideEffects: persisted.sideEffects,
        },
      });
      console.log(JSON.stringify({ captured: captured.length, action, persistenceStatus: persisted.status }, null, 2));
    }
  }

  const finalDecisions = await listWeeklyTop10ApprovalDecisionsByTeam(teamId);
  const secondInputs = buildWeeklyTop10InputsFromApprovalDecisions({
    opportunities: artifact.clusterReview.opportunities,
    decisions: finalDecisions,
    previouslyPresentedOpportunityIds: sentMessages.map((message) => message.opportunityId),
  });
  const secondDigest = generateWeeklyTop10Digest(secondInputs, { now: new Date().toISOString() });
  const completedAt = new Date().toISOString();
  const output = {
    schemaVersion: "seo_os_task_045_weekly_top10_approval_persistence_transcript_v1",
    generatedAt: completedAt,
    clusterReviewPath,
    teamId,
    runId,
    writesEnabled: weeklyTop10ApprovalDecisionWritesEnabled(),
    initialDecisionCount: existingDecisions.length,
    digest,
    sentMessages,
    callbackCapture: {
      startedAt,
      completedAt,
      durationMs: Date.now() - startedMs,
      captured,
    },
    secondDigest: {
      inputs: secondInputs.map((input) => ({
        opportunityId: buildWeeklyTop10OpportunityId(input.opportunity),
        title: input.opportunity.title,
        state: input.state || "new",
      })),
      digest: secondDigest,
    },
    sideEffects: {
      telegramMessagesSent: sentMessages.length > 0,
      firestoreWrites: captured.some((item) => (item.persistence as any)?.sideEffects?.firestoreWrite),
      approvalCommandExecuted: false,
      weeklyDigestPersisted: false,
      productionPipelineRun: false,
    },
    notes: [
      "Dev-mode TASK-045 runner only.",
      "Approval decisions are persisted only when SEO_WEEKLY_TOP10_APPROVAL_DECISION_WRITES=1.",
      "Approve/reject callbacks create decision records but do not execute approval commands.",
      "Second digest is generated from persisted decisions to verify decided items are excluded.",
    ],
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({
    outPath,
    sentMessages: sentMessages.length,
    capturedCallbacks: captured.length,
    secondDigestSummary: secondDigest.summary,
    sideEffects: output.sideEffects,
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => process.exit(process.exitCode || 0), 250);
  });
