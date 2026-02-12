/**
 * Ask Skill — /ask <вопрос>
 * RAG-ответ по базе знаний с помощью Gemini.
 */

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

export const askSkill: Skill = {
  meta: {
    id: "ask",
    name: "Ask AI",
    description: "Ответ на вопрос по базе знаний через Gemini",
    version: "1.0.0",
    triggers: [
      { type: "command", command: "ask", aliases: ["спроси", "вопрос"] },
    ],
    permissions: {
      minPlan: "free",
      chatType: "any",
    },
    menuEntry: {
      command: "ask",
      description: "Спросить AI по базе знаний",
    },
    keyboardButton: "/ask",
  },

  async execute(ctx: SkillContext): Promise<SkillResult> {
    const question = ctx.args.trim();
    if (!question) {
      return {
        handled: true,
        messages: [{ text: "Укажите вопрос: /ask <вопрос>" }],
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

      if (ctx.chatType !== "private") {
        const chat = ctx.chat;
        if (chat) {
          scope.chatId = chat.id;
          scope.telegramChatId = ctx.telegramChatId;
          const team = await getTeamByChatId(ctx.telegramChatId.toString());
          if (team) scope.teamId = team.id;
        }
      }

      // 2. Search knowledge base
      const items = await ctx.kb.search(scope);
      const keywords = extractSearchKeywords(question);
      const searchTerms = keywords.length > 0 ? keywords : [question.toLowerCase()];

      const scored = items
        .map((item: any) => {
          const textLower = item.text.toLowerCase();
          const matchCount = searchTerms.filter((kw) => textLower.includes(kw)).length;
          if (matchCount === 0) return null;
          const recencyScore = new Date(item.createdAt).getTime();
          return {
            item,
            score: matchCount * 10 + Math.log(1 + recencyScore / 1e12),
          };
        })
        .filter((x: any): x is NonNullable<typeof x> => x !== null)
        .sort((a: any, b: any) => b.score - a.score);

      const top10 = scored.slice(0, 10).map((s: any) => s.item);

      // 3. Ask Gemini
      const contextItems = top10.map((c: any) => ({
        id: c.id.slice(0, 8),
        text: c.text.slice(0, 500),
        source: c.sourceChatTitle || ctx.tg.buildMessageLink(c.source) || undefined,
      }));

      const answer = await ctx.llm.ask(question, contextItems);
      if (!answer) {
        return {
          handled: true,
          messages: [{ text: "Gemini недоступен. Укажите GEMINI_API_KEY." }],
        };
      }

      // 4. Format sources
      const top5 = top10.slice(0, 5);
      const sourceLines = top5.map((item: any, i: number) => {
        const link = ctx.tg.buildMessageLink(item.source);
        const src = link || ctx.tg.formatSource(item.source, item.sourceChatTitle);
        return `${i + 1}. ${item.text.slice(0, 80)}… — ${src}`;
      });
      const sourcesBlock = sourceLines.length
        ? "\n\nSources:\n" + sourceLines.join("\n")
        : "";

      // 5. Buttons: Save + Task + Open per source
      const buttons = top5.flatMap((item: any, i: number) => [
        [
          { text: `💾 ${i + 1}`, callbackData: `kb:save:${item.id}` },
          { text: `✅ ${i + 1}`, callbackData: `task:create:${item.id}` },
          { text: `🔗 ${i + 1}`, callbackData: `kb:open:${item.id}` },
        ],
      ]);

      return {
        handled: true,
        messages: [{ text: answer + sourcesBlock }],
        buttons,
        actions: [
          {
            type: "log_action",
            payload: {
              action: "ask_executed",
              userId: ctx.user.id,
              payload: {
                question: question.slice(0, 100),
                hitsCount: top10.length,
              },
            },
          },
        ],
      };
    } catch (error) {
      console.error("[skill:ask] Failed", error);
      return {
        handled: true,
        messages: [{ text: "Не удалось выполнить запрос." }],
      };
    }
  },
};
