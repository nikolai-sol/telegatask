/**
 * Reminders Service — напоминания о дедлайнах, follow-up, unanswered mentions.
 *
 * Cron вызывает runReminders() каждую минуту.
 */

import { Telegraf } from "telegraf";
import {
  getTasksWithDueDateBefore,
  getTasksByCreator,
  markReminderSent,
  updateTaskFollowUp,
  type CreateTaskInput,
} from "../repositories/taskRepository";
import { getUserById, listAllUsers } from "../repositories/userRepository";
import { listMessagesByChatAndTime } from "../repositories/messageRepository";
import { listChats } from "../repositories/chatRepository";
import { logAction } from "../repositories/actionLogRepository";
import { debugLog } from "../config/debug";
import type { Task } from "../models/task";
import type { TelegramUser } from "../models/telegramUser";

let botInstance: Telegraf | null = null;

export function setRemindersBotInstance(bot: Telegraf): void {
  botInstance = bot;
}

/**
 * Отправить личное сообщение пользователю через бота.
 */
async function sendDM(telegramId: number, text: string): Promise<boolean> {
  if (!botInstance) {
    console.error("[reminders] Bot instance not set");
    return false;
  }
  try {
    await botInstance.telegram.sendMessage(telegramId, text, { parse_mode: "HTML" });
    return true;
  } catch (error) {
    // User may not have started the bot or blocked it
    debugLog(`[reminders] Failed to send DM to ${telegramId}:`, error);
    return false;
  }
}

// ============================================================
// 1. Deadline Reminders
// ============================================================

/**
 * Проверяет задачи с приближающимися дедлайнами.
 * Если до дедлайна осталось <= remindBeforeHours — шлёт напоминание.
 */
export async function checkDeadlineReminders(): Promise<number> {
  let sent = 0;

  try {
    // Берём задачи с дедлайном в ближайшие 48 часов
    const horizon = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const tasks = await getTasksWithDueDateBefore(horizon);

    const now = Date.now();

    for (const task of tasks) {
      if (!task.dueDate || !task.assignedUserId) continue;

      const dueTime = new Date(task.dueDate).getTime();
      const hoursLeft = (dueTime - now) / (1000 * 60 * 60);

      // Загружаем assignee
      const assignee = await getUserById(task.assignedUserId);
      if (!assignee || assignee.telegramId <= 0) continue;

      const remindBefore = assignee.settings?.remindBeforeHours ?? 2;

      // Дедлайн уже прошёл — шлём "просроченную" напоминалку
      if (hoursLeft < 0) {
        // Не чаще раз в 4 часа
        if (task.reminders?.some((r) => r.sent && isRecent(r.at, 4 * 60))) continue;

        const text =
          `⏰ <b>Просрочена задача:</b>\n` +
          `${taskLabel(task)}\n` +
          `Дедлайн был: ${formatDate(task.dueDate)}\n` +
          (task.sourceChatTitle ? `Чат: ${task.sourceChatTitle}` : "");

        const ok = await sendDM(assignee.telegramId, text);
        if (ok) {
          sent++;
          await logAction({
            action: "reminder_sent",
            userId: task.assignedUserId,
            targetId: task.id,
            targetType: "task",
            payload: { type: "overdue", hoursOverdue: Math.abs(hoursLeft).toFixed(1) },
          }).catch(() => {});
        }
        continue;
      }

      // Дедлайн приближается
      if (hoursLeft <= remindBefore) {
        // Уже отправляли в ближайший час?
        if (task.reminders?.some((r) => r.sent && isRecent(r.at, 60))) continue;

        const text =
          `🔔 <b>Скоро дедлайн:</b>\n` +
          `${taskLabel(task)}\n` +
          `До дедлайна: ${hoursLeft.toFixed(1)}ч\n` +
          `Дедлайн: ${formatDate(task.dueDate)}\n` +
          (task.sourceChatTitle ? `Чат: ${task.sourceChatTitle}` : "");

        const ok = await sendDM(assignee.telegramId, text);
        if (ok) {
          sent++;
          await logAction({
            action: "reminder_sent",
            userId: task.assignedUserId,
            targetId: task.id,
            targetType: "task",
            payload: { type: "upcoming", hoursLeft: hoursLeft.toFixed(1) },
          }).catch(() => {});
        }
      }
    }
  } catch (error) {
    console.error("[reminders] Deadline check failed", error);
  }

  return sent;
}

// ============================================================
// 2. Follow-up: "Кто не ответил по задачам"
// ============================================================

/**
 * Проверяет outbox задачи: если назначена но нет обновления уже N часов — шлёт follow-up создателю.
 */
export async function checkFollowUps(): Promise<number> {
  let sent = 0;

  try {
    const users = await listAllUsers();

    for (const user of users) {
      if (user.telegramId <= 0) continue;

      const followUpHours = user.settings?.followUpAfterHours ?? 24;
      const cutoff = new Date(Date.now() - followUpHours * 60 * 60 * 1000).toISOString();

      // Задачи, которые я создал и которые не обновлялись давно
      const staleTasks = await getOutboxStaleTasks(user.id, cutoff);

      for (const task of staleTasks) {
        // Не уведомлять чаще раз в 12 часов по той же задаче
        if (task.followUp?.lastNotifiedAt && isRecent(task.followUp.lastNotifiedAt, 12 * 60)) {
          continue;
        }

        const assigneeLabel = task.assignedUserId
          ? await resolveUserLabel(task.assignedUserId)
          : "не назначен";

        const text =
          `📋 <b>Нет ответа по задаче:</b>\n` +
          `${taskLabel(task)}\n` +
          `Исполнитель: ${assigneeLabel}\n` +
          `Обновлено: ${formatDate(task.updatedAt)}\n` +
          (task.sourceChatTitle ? `Чат: ${task.sourceChatTitle}` : "");

        const ok = await sendDM(user.telegramId, text);
        if (ok) {
          sent++;
          // Обновляем lastNotifiedAt
          await updateTaskFollowUp(task.id, {
            enabled: true,
            checkAfterHours: followUpHours,
            lastCheckedAt: new Date().toISOString(),
            lastNotifiedAt: new Date().toISOString(),
          }).catch(() => {});

          await logAction({
            action: "followup_sent",
            userId: user.id,
            targetId: task.id,
            targetType: "task",
            payload: { assignedUserId: task.assignedUserId, staleHours: followUpHours },
          }).catch(() => {});
        }
      }
    }
  } catch (error) {
    console.error("[reminders] Follow-up check failed", error);
  }

  return sent;
}

/**
 * Задачи от пользователя, которые не обновлялись с cutoff.
 */
async function getOutboxStaleTasks(creatorId: string, cutoffIso: string): Promise<Task[]> {
  const tasks = await getTasksByCreator(creatorId, ["new", "in_progress", "waiting"]);
  return tasks.filter(
    (t) => t.assignedUserId && t.updatedAt < cutoffIso
  );
}

// ============================================================
// 3. "Мне не ответили" — unanswered mentions
// ============================================================

/**
 * Проверяет: кто-то @упомянул пользователя в чате,
 * а пользователь не ответил в течение N часов.
 */
export async function checkUnansweredMentions(): Promise<number> {
  let sent = 0;

  try {
    const users = await listAllUsers();
    const chats = await listChats(50);
    const groupChats = chats.filter(
      (c) => c.type === "group" || c.type === "supergroup"
    );

    if (!groupChats.length) return 0;

    const now = Date.now();

    for (const user of users) {
      if (user.telegramId <= 0 || !user.username) continue;

      const mentionHours = user.settings?.unansweredMentionHours ?? 4;
      const lookbackMs = mentionHours * 60 * 60 * 1000;
      const startTime = new Date(now - lookbackMs - 60 * 60 * 1000).toISOString(); // extra 1h buffer
      const endTime = new Date(now - lookbackMs).toISOString(); // messages older than N hours

      for (const chat of groupChats) {
        try {
          const messages = await listMessagesByChatAndTime(
            chat.telegramChatId,
            startTime,
            endTime,
            100
          );

          // Ищем сообщения, где @user упомянут
          const mentionsToMe = messages.filter(
            (msg) =>
              msg.mentionUsernames.includes(user.username!) &&
              msg.fromUserId !== user.id
          );

          if (!mentionsToMe.length) continue;

          // Проверяем, ответил ли пользователь после каждого mention
          const laterMessages = await listMessagesByChatAndTime(
            chat.telegramChatId,
            endTime,
            new Date().toISOString(),
            200
          );

          const myReplies = laterMessages.filter(
            (msg) => msg.fromUserId === user.id
          );

          // Если я отвечал после mention — ок
          if (myReplies.length > 0) continue;

          // Не отвечал — шлём уведомление (максимум 1 на чат)
          const firstMention = mentionsToMe[0];
          const text =
            `💬 <b>Вам не ответили:</b>\n` +
            `В чате "${chat.title}"\n` +
            `@${firstMention.fromUsername || firstMention.fromDisplayName} написал:\n` +
            `"${firstMention.text.slice(0, 150)}${firstMention.text.length > 150 ? "..." : ""}"\n` +
            `${formatDate(firstMention.createdAt)} — вы не ответили`;

          const ok = await sendDM(user.telegramId, text);
          if (ok) {
            sent++;
            await logAction({
              action: "unanswered_mention_sent",
              userId: user.id,
              payload: {
                chatId: chat.id,
                chatTitle: chat.title,
                mentionCount: mentionsToMe.length,
              },
            }).catch(() => {});
          }
        } catch (error) {
          debugLog(`[reminders] Unanswered check failed for chat ${chat.id}`, error);
        }
      }
    }
  } catch (error) {
    console.error("[reminders] Unanswered mentions check failed", error);
  }

  return sent;
}

// ============================================================
// Helpers
// ============================================================

function isRecent(isoStr: string, minutesThreshold: number): boolean {
  const time = new Date(isoStr).getTime();
  return Date.now() - time < minutesThreshold * 60 * 1000;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Moscow",
    });
  } catch {
    return iso;
  }
}

function taskLabel(task: Task): string {
  const desc =
    task.description.length > 120
      ? task.description.slice(0, 120) + "..."
      : task.description;
  const priority = task.priority !== "normal" ? ` [${task.priority}]` : "";
  return `${desc}${priority}`;
}

async function resolveUserLabel(userId: string): Promise<string> {
  const user = await getUserById(userId);
  if (!user) return userId;
  return user.username ? `@${user.username}` : user.displayName;
}
