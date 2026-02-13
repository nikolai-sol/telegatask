/**
 * Scanner Service — Auto-scan чатов каждые N минут.
 *
 * Для каждого чата с captureMode="auto_scan":
 * 1. Берёт сообщения из messages за период с lastScannedAt
 * 2. Отправляет в Gemini → извлечение задач
 * 3. Дедупликация по sourceMessageId
 * 4. Создание задач
 * 5. Уведомление owner'у в личку
 */

import { listChatsForScan, updateChatLastScanned } from "../repositories/chatRepository";
import { listMessagesByChatAndTime, type ChatMessage } from "../repositories/messageRepository";
import { createTask, getTasksBySourceMessage } from "../repositories/taskRepository";
import { upsertUserByUsername } from "../repositories/userRepository";
import { extractTasksWithGemini, type GeminiTaskExtractionInput } from "./gemini";
import { logAction } from "../repositories/actionLogRepository";
import { debugLog } from "../config/debug";
import { getDefaultProjectIdForTelegramChat } from "../core/projects/getDefaultProjectIdForTelegramChat";

/** Результат скана одного чата */
interface ScanResult {
  chatId: string;
  chatTitle: string;
  messagesScanned: number;
  tasksCreated: number;
  tasksSkipped: number;
}

/**
 * Основная функция скана — вызывается cron'ом.
 * Сканирует все чаты с captureMode="auto_scan".
 */
export async function runAutoScan(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];

  try {
    const chats = await listChatsForScan();
    if (!chats.length) {
      debugLog("[scanner] No chats configured for auto_scan");
      // Still log that scan tick ran (useful for ops).
      await logAction({
        action: "scan_executed",
        payload: {
          chatsScanned: 0,
          totalMessages: 0,
          totalTasksCreated: 0,
          note: "no_auto_scan_chats",
        },
      }).catch(() => {});
      return results;
    }

    debugLog(`[scanner] Found ${chats.length} chats to scan`);

    for (const chat of chats) {
      try {
        const result = await scanSingleChat(chat.id, chat.telegramChatId, chat.title, chat.lastScannedAt);
        results.push(result);

        // Обновляем lastScannedAt
        await updateChatLastScanned(chat.id);

        debugLog(`[scanner] Chat "${chat.title}": ${result.tasksCreated} tasks created, ${result.tasksSkipped} skipped`);
      } catch (error) {
        console.error(`[scanner] Failed to scan chat ${chat.id} ("${chat.title}")`, error);
        results.push({
          chatId: chat.id,
          chatTitle: chat.title,
          messagesScanned: 0,
          tasksCreated: 0,
          tasksSkipped: 0,
        });
      }
    }

    // Логируем общий результат
    const totalCreated = results.reduce((sum, r) => sum + r.tasksCreated, 0);
    const totalScanned = results.reduce((sum, r) => sum + r.messagesScanned, 0);
    await logAction({
      action: "scan_executed",
      payload: {
        chatsScanned: results.length,
        totalMessages: totalScanned,
        totalTasksCreated: totalCreated,
      },
    }).catch(() => {});

    console.log(`[scanner] Scan complete: ${results.length} chats, ${totalCreated} tasks created`);
  } catch (error) {
    console.error("[scanner] Fatal error during auto-scan", error);
  }

  return results;
}

/**
 * Сканировать один конкретный чат.
 */
async function scanSingleChat(
  chatId: string,
  telegramChatId: number,
  chatTitle: string,
  lastScannedAt: string | null | undefined
): Promise<ScanResult> {
  const now = new Date();
  const telegramChatIdStr = String(telegramChatId);
  const defaultProjectId = await getDefaultProjectIdForTelegramChat(telegramChatIdStr);

  // Период: от lastScannedAt (или 1 час назад если первый скан)
  const defaultStart = new Date(now.getTime() - 60 * 60 * 1000); // 1 час назад
  const startTime = lastScannedAt ? new Date(lastScannedAt) : defaultStart;

  // Не сканировать больше чем 6 часов назад (safety limit)
  const maxLookback = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const effectiveStart = startTime > maxLookback ? startTime : maxLookback;

  const messages = await listMessagesByChatAndTime(
    telegramChatId,
    effectiveStart.toISOString(),
    now.toISOString(),
    300
  );

  if (!messages.length) {
    return {
      chatId,
      chatTitle,
      messagesScanned: 0,
      tasksCreated: 0,
      tasksSkipped: 0,
    };
  }

  // Фильтруем команды бота (начинаются с /)
  const filteredMessages = messages.filter(
    (msg) => msg.text && !msg.text.trim().startsWith("/")
  );

  if (!filteredMessages.length) {
    return {
      chatId,
      chatTitle,
      messagesScanned: messages.length,
      tasksCreated: 0,
      tasksSkipped: 0,
    };
  }

  // Ограничиваем до 80 сообщений для Gemini
  const maxMessages = 80;
  const messageWindow =
    filteredMessages.length > maxMessages
      ? filteredMessages.slice(filteredMessages.length - maxMessages)
      : filteredMessages;

  // Готовим для Gemini
  const geminiInput: GeminiTaskExtractionInput[] = messageWindow.map((msg) => ({
    messageId: msg.messageId,
    fromUsername: msg.fromUsername,
    fromDisplayName: msg.fromDisplayName,
    text: msg.text,
  }));

  const extractedTasks = await extractTasksWithGemini(geminiInput, now);

  if (!extractedTasks || !extractedTasks.length) {
    return {
      chatId,
      chatTitle,
      messagesScanned: messages.length,
      tasksCreated: 0,
      tasksSkipped: 0,
    };
  }

  // Создаём мэп сообщений для lookups
  const messageMap = new Map<number, ChatMessage>();
  messages.forEach((msg) => messageMap.set(msg.messageId, msg));

  let tasksCreated = 0;
  let tasksSkipped = 0;

  for (const task of extractedTasks) {
    const sourceMessage = messageMap.get(task.messageId);
    if (!sourceMessage) {
      tasksSkipped++;
      continue;
    }

    // Дедупликация: проверяем, есть ли уже задача от этого сообщения
    const existing = await getTasksBySourceMessage(chatId, task.messageId);
    if (existing.length > 0) {
      tasksSkipped++;
      continue;
    }

    const description = task.description?.trim() || sourceMessage.text.trim();
    const assignees = (task.assignees || []).filter(Boolean);
    const dueDate = task.dueDate || null;

    if (assignees.length > 0) {
      for (const username of assignees) {
        const assignee = await upsertUserByUsername(username);
        const created = await createTask({
          telegramChatId: telegramChatIdStr,
          sourceType: "scan",
          sourceChatId: chatId,
          sourceChatTitle: chatTitle,
          sourceMessageId: task.messageId,
          projectId: defaultProjectId,
          createdByUserId: sourceMessage.fromUserId,
          assignedUserId: assignee.id,
          title: "",
          description,
          status: "new",
          dueDate,
        });
        await logAction({
          action: "task_created",
          userId: sourceMessage.fromUserId,
          targetId: created.id,
          targetType: "task",
          payload: { assignedUserId: assignee.id, sourceType: "scan" },
        }).catch(() => {});
        tasksCreated++;
      }
    } else {
      const created = await createTask({
        telegramChatId: telegramChatIdStr,
        sourceType: "scan",
        sourceChatId: chatId,
        sourceChatTitle: chatTitle,
        sourceMessageId: task.messageId,
        projectId: defaultProjectId,
        createdByUserId: sourceMessage.fromUserId,
        assignedUserId: null,
        title: "",
        description,
        status: "incoming",
        dueDate,
      });
      await logAction({
        action: "task_created",
        userId: sourceMessage.fromUserId,
        targetId: created.id,
        targetType: "task",
        payload: { sourceType: "scan" },
      }).catch(() => {});
      tasksCreated++;
    }
  }

  return {
    chatId,
    chatTitle,
    messagesScanned: messages.length,
    tasksCreated,
    tasksSkipped,
  };
}
