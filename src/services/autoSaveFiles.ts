/**
 * Auto-save файлов в базу знаний.
 * Когда пользователь постит файл в чате (группа или личка) — сохраняем как file_ref.
 */

import type { Context } from "telegraf";
import type { Update } from "telegraf/typings/core/types/typegram";
import { extractFileRefFromMessage } from "../utils/fileRef";
import { upsertUserFromTelegramPayload } from "../repositories/userRepository";
import { upsertChatFromTelegramPayload } from "../repositories/chatRepository";
import { addKnowledgeEntry, findKnowledgeByDedupeKey } from "../repositories/knowledgeRepository";
import { logAction } from "../repositories/actionLogRepository";
import { serializeError } from "../utils/serializeError";

function normalizeTextForSearch(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function getChatTitle(chat: unknown): string | null {
  if (chat && typeof chat === "object" && "title" in chat && (chat as { title?: string }).title) {
    return (chat as { title: string }).title;
  }
  return null;
}

/**
 * Автосохранение файла в knowledge, если сообщение содержит document/photo/video/audio.
 * Вызывается из обработчика сообщений бота.
 */
export async function autoSaveFilesToKnowledge(ctx: Context<Update>): Promise<void> {
  const message = ctx.message;
  if (!message || !("chat" in message) || !ctx.from) {
    return;
  }

  const fileRef = extractFileRefFromMessage(message);
  if (!fileRef) {
    return;
  }

  try {
    const user = await upsertUserFromTelegramPayload({
      id: ctx.from.id,
      username: ctx.from.username ?? undefined,
      first_name: ctx.from.first_name ?? undefined,
      last_name: ctx.from.last_name ?? undefined,
    });

    const chatInfo = message.chat;
    const chat = await upsertChatFromTelegramPayload({
      id: chatInfo.id,
      title: "title" in chatInfo ? chatInfo.title : undefined,
      type: chatInfo.type as "group" | "supergroup" | "private",
    });

    const sourceChatId = chat.id;
    const sourceChatTitle = chat.title ?? getChatTitle(chatInfo) ?? null;
    const sourceMessageId = "message_id" in message ? message.message_id : 0;

    const dedupeKey = `tg:${sourceChatId}:${sourceMessageId}:${fileRef.fileId}`;
    const existing = await findKnowledgeByDedupeKey(dedupeKey, user.id);
    if (existing) {
      return; // уже есть, тихо пропускаем
    }

    const meta = [fileRef.mime, fileRef.size ? `${fileRef.size} B` : null]
      .filter(Boolean)
      .join(", ");
    const fileText = `File: ${fileRef.name || "file"}${meta ? ` (${meta})` : ""}${fileRef.caption ? ` — ${fileRef.caption}` : ""}`;

    const source: Record<string, unknown> = {
      kind: "telegram",
      chatId: sourceChatId,
      telegramChatId: chatInfo.id,
      messageId: sourceMessageId,
      fromUserId: user.id,
      fileId: fileRef.fileId,
    };
    const chatUsername =
      "username" in chatInfo ? (chatInfo as { username?: string }).username : undefined;
    if (chatUsername) source.chatUsername = chatUsername;

    const fileMeta: Record<string, unknown> = {};
    if (fileRef.name) fileMeta.name = fileRef.name;
    if (fileRef.size != null) fileMeta.size = fileRef.size;
    if (fileRef.mime) fileMeta.mime = fileRef.mime;

    const item = await addKnowledgeEntry({
      type: "file_ref",
      text: normalizeTextForSearch(fileText),
      tags: [],
      importance: "normal",
      source: source as any,
      fileMeta: Object.keys(fileMeta).length ? (fileMeta as any) : null,
      createdByUserId: user.id,
      sourceChatId,
      sourceChatTitle,
      sourceMessageId,
      dedupeKey,
    });

    logAction({
      action: "knowledge_added",
      userId: user.id,
      targetId: item.id,
      targetType: "knowledge",
      payload: { type: "file_ref", from: "auto_save" },
    }).catch(() => {});

    // Короткое подтверждение только в личке, в группах — тихо
    if (message.chat.type === "private") {
      await ctx.reply(`Сохранил файл в знания #${item.id.slice(0, 8)}`);
    }
  } catch (error) {
    console.error("[autoSaveFiles] Failed", error);
    const payload = {
      where: "autoSaveFilesToKnowledge",
      messageId: "message_id" in message ? message.message_id : null,
      telegramChatId: "chat" in message ? message.chat.id : null,
      chatType: "chat" in message ? message.chat.type : null,
      fileId: fileRef?.fileId ?? null,
      fileName: fileRef?.name ?? null,
      err: serializeError(error),
    };
    // Note: actionLogs.userId expects internal userId, but here we might not have it.
    // Store telegramUserId in payload for debugging; internal userId can be resolved later if needed.
    logAction({
      action: "error",
      userId: null,
      targetType: "knowledge",
      payload: { ...payload, telegramUserId: ctx.from?.id ?? null },
    }).catch(() => {});
  }
}
