/**
 * Emelya Skill — /emelya
 *
 * Placeholder entrypoint for "voice-first project kickoff".
 * Full implementation is tracked in docs/FEATURE-PLAN.md.
 */

import type { Skill, SkillResult } from "../types";
import type { SkillContext } from "../../core/context";
import { logAction } from "../../repositories/actionLogRepository";

export const emelyaSkill: Skill = {
  meta: {
    id: "emelya",
    name: "Emelya",
    description: "Емеля-режим (voice-first) — planned",
    version: "0.1.0",
    triggers: [
      { type: "command", command: "emelya", aliases: ["emelia"] },
      { type: "text", pattern: /^емеля$/i, priority: 20 },
    ],
    permissions: { minPlan: "free", chatType: "any", minRole: null },
    menuEntry: { command: "emelya", description: "Емеля-режим (проект голосом) — soon" },
    keyboardButton: "Емеля",
  },

  async execute(ctx: SkillContext): Promise<SkillResult> {
    logAction({
      action: "emelya_requested",
      userId: ctx.user.id,
      targetId: ctx.chat?.id ?? null,
      targetType: "chat",
      payload: {
        telegramChatId: ctx.telegramChatId,
        chatType: ctx.chatType,
        source: ctx.triggerType,
      },
    }).catch(() => {});

    return {
      handled: true,
      messages: [
        {
          parseMode: "HTML",
          text:
            `<b>Емеля-режим</b>\n\n` +
            `Сейчас это заглушка.\n` +
            `План: <code>docs/FEATURE-PLAN.md</code>\n\n` +
            `Что будет:\n` +
            `1) голосом описываете проект\n` +
            `2) бот создаёт проект и добавляет команду\n` +
            `3) вы вместе формируете задачи\n` +
            `4) проект закрывается командой`,
        },
      ],
    };
  },
};

