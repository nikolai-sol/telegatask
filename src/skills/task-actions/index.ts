/**
 * Task Actions Skill — callback prefix task:
 * Create: task:create:<knowledgeId>
 * Done: task:done:<taskId>
 * Delete: task:del:<taskId>
 */

import type { Skill, SkillResult } from "../types";
import type { SkillContext } from "../../core/context";
import { assertKnowledgeAccess } from "../../core/permissions";
import {
  createTask,
  getTaskById,
  updateTaskStatus,
  deleteTask,
} from "../../repositories/taskRepository";
import { logAction } from "../../repositories/actionLogRepository";
import { checkUsageLimit, incrementUsage } from "../../core/usage";

export const taskActionsSkill: Skill = {
  meta: {
    id: "task-actions",
    name: "Task Actions",
    description: "Кнопки Create / Done / Del",
    version: "1.0.0",
    triggers: [{ type: "callback", prefix: "task:" }],
    permissions: {
      minPlan: "free",
      chatType: "any",
    },
  },

  async execute(ctx: SkillContext): Promise<SkillResult> {
    const data = ctx.callbackData;
    if (!data || !data.startsWith("task:")) return { handled: false };

    // task:done:<taskId>
    if (data.startsWith("task:done:")) {
      const taskId = data.slice("task:done:".length).trim();
      if (!taskId) {
        await ctx.raw.answerCbQuery("Ошибка");
        return { handled: true };
      }
      try {
        const task = await getTaskById(taskId);
        if (!task) {
          await ctx.raw.answerCbQuery("Задача не найдена");
          return { handled: true };
        }
        if (task.assignedUserId !== ctx.user.id && task.createdByUserId !== ctx.user.id) {
          await ctx.raw.answerCbQuery("Нет доступа");
          return { handled: true };
        }
        await updateTaskStatus(taskId, "done");
        logAction({
          action: "task_status_updated",
          userId: ctx.user.id,
          targetId: taskId,
          targetType: "task",
          payload: { status: "done" },
        }).catch(() => {});
        await ctx.raw.answerCbQuery("✓ Выполнено");
        await ctx.raw.reply(`Задача #${taskId.slice(0, 8)} отмечена выполненной.`);
      } catch (error) {
        console.error("[skill:task-actions] task:done failed", error);
        await ctx.raw.answerCbQuery("Ошибка");
      }
      return { handled: true };
    }

    // task:del:<taskId>
    if (data.startsWith("task:del:")) {
      const taskId = data.slice("task:del:".length).trim();
      if (!taskId) {
        await ctx.raw.answerCbQuery("Ошибка");
        return { handled: true };
      }
      try {
        const task = await getTaskById(taskId);
        if (!task) {
          await ctx.raw.answerCbQuery("Задача не найдена");
          return { handled: true };
        }
        if (task.assignedUserId !== ctx.user.id && task.createdByUserId !== ctx.user.id) {
          await ctx.raw.answerCbQuery("Нет доступа");
          return { handled: true };
        }
        await deleteTask(taskId);
        logAction({
          action: "task_deleted",
          userId: ctx.user.id,
          targetId: taskId,
          targetType: "task",
        }).catch(() => {});
        await ctx.raw.answerCbQuery("✓ Удалено");
        await ctx.raw.reply(`Задача #${taskId.slice(0, 8)} удалена.`);
      } catch (error) {
        console.error("[skill:task-actions] task:del failed", error);
        await ctx.raw.answerCbQuery("Ошибка");
      }
      return { handled: true };
    }

    // task:create:<knowledgeId>
    if (!data.startsWith("task:create:")) {
      return { handled: false };
    }

    const knowledgeId = data.slice("task:create:".length).trim();
    if (!knowledgeId) {
      await ctx.raw.answerCbQuery("Ошибка: нет id");
      return { handled: true };
    }

    try {
      const item = await ctx.kb.getById(knowledgeId);
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

      // Usage: task.create_from_kb
      const orgId = "default"; // TODO: resolve from user org
      const plan = "free";
      const usageCheck = await checkUsageLimit(orgId, "task.create_from_kb", plan);
      if (!usageCheck.allowed) {
        await ctx.raw.answerCbQuery("Лимит исчерпан");
        await ctx.raw.reply(
          `⚠️ Лимит: ${usageCheck.current}/${usageCheck.limit} в месяц.\nПерейдите на Pro: /upgrade`
        );
        return { handled: true };
      }

      const description = item.text.slice(0, 2000);
      const task = await createTask({
        sourceType: "chat_command",
        sourceChatId: item.sourceChatId ?? undefined,
        sourceChatTitle: item.sourceChatTitle ?? undefined,
        sourceMessageId: item.sourceMessageId ?? undefined,
        createdByUserId: ctx.user.id,
        assignedUserId: null,
        title: "",
        description,
        status: "new",
      });

      logAction({
        action: "task_created",
        userId: ctx.user.id,
        targetId: task.id,
        targetType: "task",
        payload: { fromKnowledgeId: knowledgeId },
      }).catch(() => {});
      await incrementUsage(orgId, "task.create_from_kb");

      await ctx.raw.answerCbQuery("✓ Задача создана");
      await ctx.raw.reply(
        `Задача #${task.id.slice(0, 8)}\n${description.slice(0, 150)}${description.length > 150 ? "…" : ""}`,
        { parse_mode: "HTML" }
      );
    } catch (error) {
      console.error("[skill:task-actions] Failed", error);
      await ctx.raw.answerCbQuery("Ошибка");
    }

    return { handled: true };
  },
};
