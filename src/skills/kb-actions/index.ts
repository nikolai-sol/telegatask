/**
 * KB Actions Skill — callback prefix kb:
 * Save to KB: kb:save:<knowledgeId>
 */

import type { Skill, SkillResult } from "../types";
import type { SkillContext } from "../../core/context";
import { assertKnowledgeAccess } from "../../core/permissions";
import { incrementUsage } from "../../core/usage";

export const kbActionsSkill: Skill = {
  meta: {
    id: "kb-actions",
    name: "KB Actions",
    description: "Кнопки Save to KB",
    version: "1.0.0",
    triggers: [{ type: "callback", prefix: "kb:" }],
    permissions: {
      minPlan: "free",
      chatType: "any",
    },
  },

  async execute(ctx: SkillContext): Promise<SkillResult> {
    const data = ctx.callbackData;
    if (!data || !data.startsWith("kb:")) return { handled: false };

    // kb:open:<id> — показать ссылку на источник
    if (data.startsWith("kb:open:")) {
      const id = data.slice("kb:open:".length).trim();
      if (!id) {
        await ctx.raw.answerCbQuery("Ошибка");
        return { handled: true };
      }
      try {
        const item = await ctx.kb.getById(id);
        if (!item) {
          await ctx.raw.answerCbQuery("Не найдено");
          return { handled: true };
        }
        const access = await assertKnowledgeAccess(ctx, item);
        if (!access.allowed) {
          await ctx.raw.answerCbQuery("Нет доступа");
          return { handled: true };
        }
        const sourceLine = ctx.tg.formatSourceLine(item);
        const hasLink = !!ctx.tg.buildMessageLink(item.source);
        await ctx.raw.answerCbQuery(hasLink ? "Ссылка ниже" : "Источник в приватном чате");
        await ctx.raw.reply(`🔗 ${sourceLine}`, { parse_mode: "HTML" });
      } catch (error) {
        console.error("[skill:kb-actions] kb:open failed", error);
        await ctx.raw.answerCbQuery("Ошибка");
      }
      return { handled: true };
    }

    // kb:save:<id>
    if (!data.startsWith("kb:save:")) return { handled: false };

    const payload = data.slice("kb:save:".length).trim();
    if (!payload) {
      await ctx.raw.answerCbQuery("Ошибка: нет id");
      return { handled: true };
    }

    try {
      const item = await ctx.kb.getById(payload);
      if (!item) {
        await ctx.raw.answerCbQuery("Запись не найдена");
        return { handled: true };
      }

      const access = await assertKnowledgeAccess(ctx, item);
      if (!access.allowed) {
        await ctx.raw.answerCbQuery("Нет доступа");
        await ctx.raw.reply(access.reason ?? "Нет доступа к этой записи.");
        return { handled: true };
      }

      await ctx.raw.answerCbQuery("✓ Уже в базе знаний");
      incrementUsage("default", "kb.save").catch(() => {});
      const sourceLine = ctx.tg.formatSourceLine(item);
      await ctx.raw.reply(
        `Запись уже в базе: #${item.id.slice(0, 8)}\n${item.text.slice(0, 120)}…\n${sourceLine}`,
        { parse_mode: "HTML" }
      );
    } catch (error) {
      console.error("[skill:kb-actions] Failed", error);
      await ctx.raw.answerCbQuery("Ошибка");
    }

    return { handled: true };
  },
};
