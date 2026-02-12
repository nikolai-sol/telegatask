/**
 * Knowledge Add Skill — /k
 * Сохранение в базу знаний (note, message, file_ref).
 * Использует legacy handler (reply/forward/file_ref/pending).
 */

import type { Skill, SkillResult } from "../types";
import type { SkillContext } from "../../core/context";
import { handleKnowledgeLegacy } from "../../legacy/knowledge/handleKnowledge";

export const knowledgeAddSkill: Skill = {
  meta: {
    id: "knowledge-add",
    name: "Knowledge Add",
    description: "Добавить в базу знаний (текст, reply, forward, файл)",
    version: "1.0.0",
    triggers: [{ type: "command", command: "k", aliases: ["знания", "в_знания"] }],
    permissions: {
      minPlan: "free",
      chatType: "any",
    },
    menuEntry: {
      command: "k",
      description: "В знания",
    },
    keyboardButton: "/k",
  },

  async execute(ctx: SkillContext): Promise<SkillResult> {
    // Legacy handler sends replies itself; kb.add() ensures Knowledge v2 (type/source/index)
    await handleKnowledgeLegacy(ctx.raw, ctx.kb);
    return { handled: true };
  },
};
