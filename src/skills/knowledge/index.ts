/**
 * Knowledge Skill — /k, /ksearch
 * Сохранение и поиск по базе знаний.
 *
 * Note: /k handler остаётся в основном боте из-за сложной логики
 * (reply, forward, file_ref, pending). Здесь — /ksearch.
 */

import { Markup } from "telegraf";
import type { Skill, SkillResult } from "../types";
import type { SkillContext } from "../../core/context";
import {
  upsertChatFromTelegramPayload,
} from "../../repositories/chatRepository";
import {
  getTeamByChatId,
} from "../../repositories/teamRepository";

const STOP_WORDS = new Set([
  "и", "в", "на", "с", "по", "для", "из", "к", "о", "у",
  "это", "что", "как", "the", "a", "an", "is", "are", "of", "to", "in",
]);

function extractSearchKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\wа-яё\s]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

export const knowledgeSkill: Skill = {
  meta: {
    id: "knowledge",
    name: "Knowledge Search",
    description: "Поиск по базе знаний",
    version: "1.0.0",
    triggers: [
      { type: "command", command: "ksearch", aliases: ["поиск"] },
    ],
    permissions: {
      minPlan: "free",
      chatType: "any",
    },
    menuEntry: {
      command: "ksearch",
      description: "Поиск по базе знаний",
    },
    keyboardButton: "/ksearch",
  },

  async execute(ctx: SkillContext): Promise<SkillResult> {
    const query = ctx.args.trim();
    if (!query) {
      return {
        handled: true,
        messages: [{ text: "Укажите запрос: /ksearch <текст>" }],
      };
    }

    try {
      // 1. Determine scope
      const scope: {
        userId: string;
        chatId?: string;
        telegramChatId?: number;
        teamId?: string;
        limit: number;
      } = {
        userId: ctx.user.id,
        limit: 500,
      };

      if (ctx.chatType !== "private" && ctx.chat) {
        scope.chatId = ctx.chat.id;
        scope.telegramChatId = ctx.telegramChatId;
        const team = await getTeamByChatId(ctx.telegramChatId.toString());
        if (team) scope.teamId = team.id;
      }

      // 2. Search
      const items = await ctx.kb.search(scope);
      const keywords = extractSearchKeywords(query);
      const searchTerms = keywords.length > 0 ? keywords : [query.toLowerCase()];

      const scored = items
        .map((item: any) => {
          const textLower = item.text.toLowerCase();
          const matchCount = searchTerms.filter((kw: string) => textLower.includes(kw)).length;
          if (matchCount === 0) return null;
          const recencyScore = new Date(item.createdAt).getTime();
          return {
            item,
            score: matchCount * 10 + Math.log(1 + recencyScore / 1e12),
          };
        })
        .filter((x: any): x is NonNullable<typeof x> => x !== null)
        .sort((a: any, b: any) => b.score - a.score);

      const limit = 10;
      const trimmed = scored.slice(0, limit).map((s: any) => s.item);

      if (!trimmed.length) {
        return {
          handled: true,
          messages: [{ text: "В базе знаний совпадений не найдено." }],
        };
      }

      // 3. Format results
      const lines = trimmed.map((item: any, idx: number) => {
        const prefix = item.importance === "important" ? "⭐ " : "";
        const typeLabel = `[${item.type}]`;
        const excerpt = item.text.length > 120 ? `${item.text.slice(0, 120)}…` : item.text;
        const srcLink = ctx.tg.buildMessageLink(item.source);
        const srcText = srcLink || ctx.tg.formatSource(item.source, item.sourceChatTitle);
        return `${idx + 1}. ${prefix}${typeLabel} ${excerpt} (id=${item.id.slice(0, 8)})\n   Source: ${srcText}`;
      });

      const header =
        scored.length > limit
          ? `Найдено ${scored.length}. Топ ${limit}:`
          : `Найдено ${scored.length}:`;
      const text = `${header}\n${lines.join("\n")}`;

      // Buttons: Save + Task + Open per result (top 5)
      const top5 = trimmed.slice(0, 5);
      const buttonRows = top5.flatMap((item: any, i: number) => [
        [
          Markup.button.callback(`💾 ${i + 1}`, `kb:save:${item.id}`),
          Markup.button.callback(`✅ ${i + 1}`, `task:create:${item.id}`),
          Markup.button.callback(`🔗 ${i + 1}`, `kb:open:${item.id}`),
        ],
      ]);
      const keyboard = Markup.inlineKeyboard(buttonRows);

      // Send to PM in group context
      if (ctx.chatType !== "private") {
        await ctx.raw.telegram.sendMessage(ctx.telegramUserId, text, keyboard);
        await ctx.raw.reply("Отправил результаты поиска в личку.");
      } else {
        await ctx.raw.reply(text, keyboard);
      }

      return {
        handled: true,
        actions: [
          {
            type: "log_action",
            payload: {
              action: "knowledge_search",
              userId: ctx.user.id,
              payload: { query, hits: trimmed.length },
            },
          },
        ],
      };
    } catch (error) {
      console.error("[skill:knowledge] Failed", error);
      return {
        handled: true,
        messages: [{ text: "Не удалось выполнить поиск по базе знаний." }],
      };
    }
  },
};
