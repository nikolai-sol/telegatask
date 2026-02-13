/**
 * Skill Registry — регистрирует все скиллы в роутере.
 *
 * Чтобы добавить новый скилл:
 * 1. Создай папку src/skills/my-skill/
 * 2. Создай index.ts, экспортирующий Skill
 * 3. Импортируй и добавь в registerAllSkills()
 */

import type { SkillRouter } from "../core/router";

// Skill imports
import { askSkill } from "./ask";
import { chatsControlSkill } from "./chats-control";
import { scanSkill } from "./scan";
import { knowledgeSkill } from "./knowledge";
import { knowledgeAddSkill } from "./knowledge-add";
import { kbActionsSkill } from "./kb-actions";
import { taskActionsSkill } from "./task-actions";
import { digestSkill } from "./digest";
import { teamAdminSkill } from "./team-admin";
import { opsStatusSkill } from "./ops-status";
import { projectAdminSkill } from "./project-admin";
import { emelyaSkill } from "./emelya";

/**
 * Зарегистрировать все скиллы.
 */
export function registerAllSkills(router: SkillRouter): void {
  router.register(askSkill);
  router.register(chatsControlSkill);
  router.register(scanSkill);
  router.register(knowledgeSkill);
  router.register(knowledgeAddSkill);
  router.register(kbActionsSkill);
  router.register(taskActionsSkill);
  router.register(digestSkill);
  router.register(teamAdminSkill);
  router.register(opsStatusSkill);
  router.register(projectAdminSkill);
  router.register(emelyaSkill);

  // Добавляй новые скиллы здесь:
  // router.register(myNewSkill);

  console.log(`[registry] ${router.getSkills().length} skills registered`);
}
