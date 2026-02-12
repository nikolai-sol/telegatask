/**
 * Digest Skill — /digest [today|yesterday|week]
 * Сводка по чату за период: сообщения, задачи, важные знания.
 */

import type { Skill, SkillResult } from "../types";
import type { SkillContext } from "../../core/context";
import { getChatById } from "../../repositories/chatRepository";
import { listMessagesByChatAndTime } from "../../repositories/messageRepository";
import { getTasksForDigest } from "../../repositories/taskRepository";
import type { KnowledgeItemV2 } from "../../models/knowledge";
import { logAction } from "../../repositories/actionLogRepository";
import { getTeamByChatId } from "../../repositories/teamRepository";

type Period = "today" | "yesterday" | "week";

function parsePeriod(raw: string): Period {
  const s = raw.toLowerCase().trim();
  if (s === "yesterday" || s === "вчера") return "yesterday";
  if (s === "week" || s === "неделя") return "week";
  return "today";
}

function getPeriodBounds(period: Period): { fromIso: string; toIso: string } {
  const now = new Date();
  const toIso = now.toISOString();

  const pad = (n: number) => String(n).padStart(2, "0");

  if (period === "today") {
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const d = now.getDate();
    const fromIso = `${y}-${pad(m)}-${pad(d)}T00:00:00.000Z`;
    return { fromIso, toIso };
  }

  if (period === "yesterday") {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const y = yesterday.getFullYear();
    const m = yesterday.getMonth() + 1;
    const d = yesterday.getDate();
    const fromIso = `${y}-${pad(m)}-${pad(d)}T00:00:00.000Z`;
    const toIso = `${y}-${pad(m)}-${pad(d)}T23:59:59.999Z`;
    return { fromIso, toIso };
  }

  // week: last 7 days
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const y = weekAgo.getFullYear();
  const m = weekAgo.getMonth() + 1;
  const d = weekAgo.getDate();
  const fromIso = `${y}-${pad(m)}-${pad(d)}T00:00:00.000Z`;
  return { fromIso, toIso };
}

function periodLabel(period: Period): string {
  if (period === "today") return "сегодня";
  if (period === "yesterday") return "вчера";
  return "неделя";
}

async function runDigest(
  ctx: SkillContext,
  chat: { id: string; title: string; telegramChatId: number },
  period: Period
): Promise<SkillResult> {
  const { fromIso, toIso } = getPeriodBounds(period);
  const nowIso = new Date().toISOString();

  try {
    const messages = await listMessagesByChatAndTime(
      chat.telegramChatId,
      fromIso,
      toIso,
      400
    );

    const tasks = await getTasksForDigest(chat.id, fromIso, toIso, nowIso);

    const team = await getTeamByChatId(String(chat.telegramChatId));
    const scope = {
      userId: ctx.user.id,
      chatId: chat.id,
      telegramChatId: chat.telegramChatId,
      teamId: team?.id,
      fromIso,
      toIso,
    };
    const knowledgeItems = await ctx.kb.listImportantForDigest(scope);

    const messagesContext = messages
      .slice(-80)
      .map((m) => `${m.fromDisplayName || "user"}: ${m.text.slice(0, 300)}`)
      .join("\n");

    const tasksSummary = tasks
      .map(
        (t) =>
          `- [${t.status}] ${t.title}${t.dueDate ? ` (до ${t.dueDate.slice(0, 10)})` : ""}`
      )
      .join("\n");
    const knowledgeSummary = knowledgeItems
      .slice(0, 20)
      .map((k) => `- #${k.id.slice(0, 8)}: ${k.text.slice(0, 150)}`)
      .join("\n");

    const prompt = `Ты — аналитик. Создай структурированный дайджест по данным за период.

Период: ${fromIso} — ${toIso}
Чат: ${chat.title}

Сообщения (последние):
${messagesContext || "(нет)"}

Задачи (созданные в период / просроченные / на сегодня):
${tasksSummary || "(нет)"}

Важные знания:
${knowledgeSummary || "(нет)"}

Верни ТОЛЬКО валидный JSON без markdown:
{
  "highlights": ["краткие главные пункты"],
  "decisions": ["принятые решения"],
  "newTasks": ["новые/предложенные задачи"],
  "risks": ["риски и проблемы"],
  "nextSteps": ["следующие шаги"],
  "sources": [
    { "kind": "knowledge", "knowledgeId": "полный id из knowledgeCandidates" }
  ]
}

В sources указывай только knowledgeId из списка: ${knowledgeItems.map((k) => k.id).join(", ")}.
Максимум 5 sources.`;

    const jsonStr = await ctx.llm.generate(prompt, true);
    if (!jsonStr) {
      return {
        handled: true,
        messages: [{ text: "Gemini недоступен. Укажите GEMINI_API_KEY." }],
      };
    }

    let parsed: {
      highlights?: string[];
      decisions?: string[];
      newTasks?: string[];
      risks?: string[];
      nextSteps?: string[];
      sources?: { kind: string; knowledgeId?: string }[];
    };
    try {
      const cleaned = jsonStr.replace(/^```json?\s*|\s*```$/g, "").trim();
      parsed = JSON.parse(cleaned) as typeof parsed;
    } catch {
      return {
        handled: true,
        messages: [{ text: "Не удалось разобрать ответ Gemini." }],
      };
    }

    const highlights = parsed.highlights ?? [];
    const decisions = parsed.decisions ?? [];
    const newTasks = parsed.newTasks ?? [];
    const risks = parsed.risks ?? [];
    const nextSteps = parsed.nextSteps ?? [];
    const sources = (parsed.sources ?? []).slice(0, 5);

    const blocks: string[] = [];
    if (highlights.length) blocks.push("📌 Highlights\n" + highlights.map((h) => `• ${h}`).join("\n"));
    if (decisions.length) blocks.push("✅ Решения\n" + decisions.map((d) => `• ${d}`).join("\n"));
    if (newTasks.length) blocks.push("📋 Задачи\n" + newTasks.map((t) => `• ${t}`).join("\n"));
    if (risks.length) blocks.push("⚠️ Риски\n" + risks.map((r) => `• ${r}`).join("\n"));
    if (nextSteps.length) blocks.push("➡️ След. шаги\n" + nextSteps.map((s) => `• ${s}`).join("\n"));

    const header = `📊 Digest • ${periodLabel(period)} • ${chat.title}`;
    let body = blocks.join("\n\n") || "Нет данных за период.";

    const sourceItems: { id: string; item: KnowledgeItemV2 }[] = [];
    for (const src of sources) {
      if (src.kind === "knowledge" && src.knowledgeId) {
        const item = await ctx.kb.getById(src.knowledgeId);
        if (item) sourceItems.push({ id: src.knowledgeId, item });
      }
    }

    const sourceLines = sourceItems.map(({ item }) =>
      `• ${item.text.slice(0, 60)}… — ${ctx.tg.formatSourceLine(item)}`
    );
    if (sourceLines.length) {
      body += "\n\n<b>Sources</b>\n" + sourceLines.join("\n");
    }

    const top5Sources = sourceItems.slice(0, 5);
    const buttons = top5Sources.map(({ id }, i) => [
      { text: `🔗 ${i + 1}`, callbackData: `kb:open:${id}` },
      { text: `💾 ${i + 1}`, callbackData: `kb:save:${id}` },
      { text: `✅ ${i + 1}`, callbackData: `task:create:${id}` },
    ]);

    logAction({
      action: "digest_run",
      userId: ctx.user.id,
      targetId: chat.id,
      targetType: "chat",
      payload: {
        period,
        chatId: chat.id,
        messagesCount: messages.length,
        sourcesCount: sourceItems.length,
      },
    }).catch(() => {});

    return {
      handled: true,
      callbackAnswer: "Готово",
      messages: [{ text: `${header}\n\n${body}`, parseMode: "HTML" }],
      buttons: buttons.length ? buttons : undefined,
    };
  } catch (error) {
    console.error("[skill:digest] Failed", error);
    return {
      handled: true,
      messages: [{ text: "Не удалось сформировать дайджест." }],
    };
  }
}

export const digestSkill: Skill = {
  meta: {
    id: "digest",
    name: "Digest",
    description: "Сводка по чату за период",
    version: "1.0.0",
    triggers: [
      { type: "command", command: "digest", aliases: ["дайджест"] },
      { type: "callback", prefix: "digest:chat:" },
    ],
    permissions: {
      minPlan: "free",
      chatType: "any",
    },
    menuEntry: {
      command: "digest",
      description: "Дайджест по чату",
    },
    keyboardButton: "/digest",
  },

  async execute(ctx: SkillContext): Promise<SkillResult> {
    // ========== Callback: digest:chat:<chatId>:<period> ==========
    const data = ctx.callbackData;
    if (data?.startsWith("digest:chat:")) {
      const parts = data.slice("digest:chat:".length).split(":");
      const chatId = parts[0];
      const period = (parts[1] ?? "today") as Period;

      if (!chatId) {
        return { handled: true, callbackAnswer: "Ошибка", messages: [{ text: "Чат не указан." }] };
      }

      const chat = await getChatById(chatId);
      if (!chat) {
        return { handled: true, callbackAnswer: "Чат не найден", messages: [{ text: "Чат не найден." }] };
      }

      return runDigest(ctx, chat, period);
    }

    // ========== Command: /digest [period] ==========
    const period = parsePeriod(ctx.args || "");
    const periodKey = period;

    // В группе — digest по текущему чату
    if (ctx.chatType !== "private" && ctx.chat) {
      return runDigest(ctx, ctx.chat, periodKey);
    }

    // В личке — показать выбор чата
    const chats = await ctx.tg.listChats(50);
    const groupChats = chats.filter((c) => c.type === "group" || c.type === "supergroup");
    if (!groupChats.length) {
      return {
        handled: true,
        messages: [{ text: "Нет групповых чатов. Добавьте бота в группу." }],
      };
    }

    const buttons = groupChats.slice(0, 10).map((chat) => [
      {
        text: (chat.title || chat.id).slice(0, 30),
        callbackData: `digest:chat:${chat.id}:${periodKey}`,
      },
    ]);

    return {
      handled: true,
      skipUsageIncrement: true,
      messages: [
        {
          text: `Выберите чат для дайджеста (${periodLabel(periodKey)}):`,
          parseMode: "HTML",
        },
      ],
      buttons,
    };
  },

};
