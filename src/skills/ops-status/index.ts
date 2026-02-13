/**
 * Ops Status Skill — /ops
 * Superadmin-only quick view: scheduler cron last runs, auto-scan enabled chats, recent scan logs.
 */

import { Markup } from "telegraf";
import type { Skill, SkillResult } from "../types";
import type { SkillContext } from "../../core/context";
import { getSchedulerStats } from "../../services/scheduler";
import { listChatsForScan } from "../../repositories/chatRepository";
import { listActionLogs } from "../../repositories/actionLogRepository";

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isSuperAdminFromEnv(username?: string | null): boolean {
  const raw = process.env.SUPERADMINS || "";
  if (!raw) return false;
  const set = new Set(
    raw
      .split(",")
      .map((s) => s.trim().replace(/^@/, "").toLowerCase())
      .filter(Boolean)
  );
  if (!username) return false;
  return set.has(username.replace(/^@/, "").toLowerCase());
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
  } catch {
    return iso;
  }
}

async function buildOpsText(): Promise<string> {
  const scheduler = getSchedulerStats();
  const chats = await listChatsForScan();
  const logs = await listActionLogs(80);
  const scanLogs = logs.filter((l) => l.action === "scan_executed").slice(0, 5);
  const errorLogs = logs.filter((l) => l.action === "error").slice(0, 5);

  const s = scheduler;
  const lines = [
    `<b>Ops</b>`,
    `Server time: <code>${escapeHtml(new Date().toISOString())}</code>`,
    `Scheduler startedAt: <code>${escapeHtml(String(s.startedAt || "—"))}</code>`,
    `Cron jobs: <b>${s.jobsCount}</b>`,
    ``,
    `<b>Last runs</b>`,
    `auto_scan: ${fmt(s.lastRunAt.auto_scan)} (ok: ${fmt(s.lastOkAt.auto_scan)})`,
    `deadline_reminders: ${fmt(s.lastRunAt.deadline_reminders)} (ok: ${fmt(s.lastOkAt.deadline_reminders)})`,
    `followups: ${fmt(s.lastRunAt.followups)} (ok: ${fmt(s.lastOkAt.followups)})`,
    `unanswered_mentions: ${fmt(s.lastRunAt.unanswered_mentions)} (ok: ${fmt(s.lastOkAt.unanswered_mentions)})`,
    `morning_briefs: ${fmt(s.lastRunAt.morning_briefs)} (ok: ${fmt(s.lastOkAt.morning_briefs)})`,
    `evening_digests: ${fmt(s.lastRunAt.evening_digests)} (ok: ${fmt(s.lastOkAt.evening_digests)})`,
    ``,
    `<b>Auto-scan chats</b>: <b>${chats.length}</b>`,
    ...chats.slice(0, 10).map((c) => `• ${escapeHtml(c.title || "без названия")} (last: ${fmt(c.lastScannedAt)})`),
    ``,
    `<b>Recent scan_executed</b>: ${scanLogs.length ? "" : "—"}`,
    ...scanLogs.map((l) => `• ${fmt(l.createdAt)}: ${escapeHtml(JSON.stringify(l.payload || {}))}`),
    ``,
    `<b>Recent errors</b>: ${errorLogs.length ? "" : "—"}`,
    ...errorLogs.map((l) => `• ${fmt(l.createdAt)}: ${escapeHtml(JSON.stringify(l.payload || {}))}`),
  ];

  return lines.join("\n");
}

function kb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🔄 Refresh", "ops:refresh"), Markup.button.callback("✕ Close", "ops:close")],
  ]);
}

export const opsStatusSkill: Skill = {
  meta: {
    id: "ops-status",
    name: "Ops Status",
    description: "Superadmin: cron/scan status",
    version: "1.0.0",
    triggers: [
      { type: "command", command: "ops", aliases: ["ops_status"] },
      { type: "callback", prefix: "ops:" },
    ],
    permissions: { minPlan: "free", chatType: "any" },
  },

  async execute(ctx: SkillContext): Promise<SkillResult> {
    if (!isSuperAdminFromEnv(ctx.user.username ?? null)) {
      return { handled: true, messages: [{ text: "Access denied." }] };
    }

    if (ctx.triggerType === "command") {
      const text = await buildOpsText();
      await ctx.raw.reply(text, { parse_mode: "HTML", ...kb() });
      return { handled: true };
    }

    if (ctx.triggerType === "callback" && ctx.callbackData) {
      if (ctx.callbackData === "ops:close") {
        await ctx.raw.answerCbQuery().catch(() => {});
        await ctx.raw.editMessageText("Closed.").catch(() => {});
        return { handled: true };
      }
      if (ctx.callbackData === "ops:refresh") {
        const text = await buildOpsText();
        await ctx.raw.answerCbQuery("OK").catch(() => {});
        await ctx.raw.editMessageText(text, { parse_mode: "HTML", ...kb() }).catch(() => {});
        return { handled: true };
      }
    }

    return { handled: true };
  },
};
