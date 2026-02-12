/**
 * Legacy handler for /k command.
 * Extracted from telegataskBot.ts.
 * Нормализовано под Knowledge v2: type/source/index/fileMeta через kb.add().
 */

import type { Context } from "telegraf";
import type { KBService } from "../../core/services/kb";
import type { Update } from "telegraf/typings/core/types/typegram";
import type { Message } from "telegraf/typings/core/types/typegram";
import type { Chat as TelegramChat } from "telegraf/typings/core/types/typegram";
import { upsertUserFromTelegramPayload } from "../../repositories/userRepository";
import { upsertChatFromTelegramPayload, getChatById, getChatByTelegramId } from "../../repositories/chatRepository";
import { logAction } from "../../repositories/actionLogRepository";
import {
  addKnowledgeEntry,
  findKnowledgeByDedupeKey,
} from "../../repositories/knowledgeRepository";
import { buildTelegramMessageLink } from "../../utils/telegramLink";
import { extractFileRefFromMessage } from "../../utils/fileRef";
import type { FileRefInfo } from "../../utils/fileRef";
import { getCommandVariants } from "../../config/commands";
import type { KnowledgeSourceTelegram } from "../../models/knowledge";

const K_CMD = getCommandVariants("k").map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

// ============================================================
// Shared state (used by handleForwardedMessage in bot)
// ============================================================

export const pendingKnowledgeForwards = new Map<
  number,
  {
    content: string;
    sourceChatId: string | null;
    sourceChatTitle: string | null;
    sourceMessageId: number | null;
    fileRef?: FileRefInfo | null;
  }
>();

// ============================================================
// Helpers
// ============================================================

function safeLogAction(
  action: Parameters<typeof logAction>[0]["action"],
  params: Omit<Parameters<typeof logAction>[0], "action">
): void {
  logAction({ action, ...params }).catch((err) =>
    console.error("[actionLog] failed to log", action, err)
  );
}

function normalizeTextForSearch(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function getMessageText(message?: Message): string | null {
  if (!message) return null;
  if ("text" in message && message.text) return message.text;
  if ("caption" in message && message.caption) return message.caption;
  return null;
}

function getChatTitle(chat?: TelegramChat | null): string | null {
  if (chat && "title" in chat && chat.title) return chat.title;
  return null;
}

async function buildKnowledgeSource(
  ctx: Context<Update>,
  repliedMessage: Message | undefined,
  forwardedMessage: { forward_from_chat?: TelegramChat; forward_from_message_id?: number } | null,
  sourceChatId: string | null,
  sourceMessageId: number | null
): Promise<KnowledgeSourceTelegram | null> {
  if (!sourceChatId || sourceMessageId == null) return null;

  let telegramChatId: number | undefined;
  let chatId = sourceChatId;
  let chatUsername: string | undefined;

  const msgChat = ctx.message && "chat" in ctx.message ? ctx.message.chat : null;
  const fwdChat = forwardedMessage?.forward_from_chat;

  if (fwdChat) {
    telegramChatId = fwdChat.id;
    chatUsername = "username" in fwdChat ? (fwdChat as { username?: string }).username : undefined;
    const chat = await upsertChatFromTelegramPayload({
      id: fwdChat.id,
      title: "title" in fwdChat ? fwdChat.title : undefined,
      type: fwdChat.type as "group" | "supergroup" | "channel" | "private",
    });
    chatId = chat.id;
  } else if (msgChat && (repliedMessage || ctx.message)) {
    const src = repliedMessage && "chat" in repliedMessage ? repliedMessage.chat : msgChat;
    telegramChatId = src.id;
    chatUsername = "username" in src ? (src as { username?: string }).username : undefined;
    const chat = await upsertChatFromTelegramPayload({
      id: src.id,
      title: "title" in src ? src.title : undefined,
      type: src.type as "group" | "supergroup" | "channel" | "private",
    });
    chatId = chat.id;
  } else {
    const chat = /^\d+$/.test(sourceChatId)
      ? await getChatByTelegramId(parseInt(sourceChatId, 10))
      : await getChatById(sourceChatId);
    if (chat) {
      chatId = chat.id;
      telegramChatId = chat.telegramChatId;
    }
  }

  const fromUserId = ctx.from
    ? (
        await upsertUserFromTelegramPayload({
          id: ctx.from.id,
          username: ctx.from.username ?? undefined,
          first_name: ctx.from.first_name ?? undefined,
          last_name: ctx.from.last_name ?? undefined,
        })
      ).id
    : undefined;

  return {
    kind: "telegram",
    chatId,
    telegramChatId,
    messageId: sourceMessageId,
    fromUserId,
    chatUsername,
  };
}

export async function buildKnowledgeSourceFromPending(
  sourceChatId: string | null,
  sourceMessageId: number | null,
  fromUserId: string
): Promise<KnowledgeSourceTelegram | null> {
  if (!sourceChatId || sourceMessageId == null) return null;
  const chat = /^\d+$/.test(sourceChatId)
    ? await getChatByTelegramId(parseInt(sourceChatId, 10))
    : await getChatById(sourceChatId);
  const chatId = chat?.id ?? sourceChatId;
  const telegramChatId = chat?.telegramChatId;
  return { kind: "telegram", chatId, telegramChatId, messageId: sourceMessageId, fromUserId };
}

// ============================================================
// Main handler: /k
// ============================================================

export async function handleKnowledgeLegacy(
  ctx: Context<Update>,
  kb: KBService
): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!ctx.from) return false;
  const rawText = message.text.trim();
  const kPattern = new RegExp(`^/(${K_CMD})!?(@\\S+)?\\s`, "i");
  const kPatternEol = new RegExp(`^/(${K_CMD})!?(@\\S+)?$`, "i");
  if (!kPattern.test(rawText) && !kPatternEol.test(rawText)) {
    return false;
  }

  const repliedMessage = "reply_to_message" in message ? message.reply_to_message : undefined;

  const forwardedMessage =
    "forward_from" in message || "forward_from_chat" in message
      ? (message as Message & { forward_from_chat?: TelegramChat; forward_from_message_id?: number })
      : null;

  const isBang = new RegExp(`^/(${K_CMD})!`, "i").test(rawText);
  let stripped = rawText.replace(new RegExp(`^/(${K_CMD})!?(@\\S+)?\\s*`, "i"), "");
  let isImportant = isBang;

  if (/^важно\b/i.test(stripped)) {
    isImportant = true;
    stripped = stripped.replace(/^важно\b[:\s-]*/i, "");
  }

  const replyText = getMessageText(repliedMessage);
  const forwardedText = forwardedMessage ? getMessageText(forwardedMessage) : null;
  const directFileRef = extractFileRefFromMessage(
    repliedMessage ?? (forwardedMessage as Message | undefined)
  );
  const pending = pendingKnowledgeForwards.get(ctx.from.id);
  const fileRef = directFileRef ?? pending?.fileRef ?? null;

  let content =
    replyText?.trim() || stripped.trim() || forwardedText?.trim() || "";
  let sourceChatId =
    forwardedMessage?.forward_from_chat?.id?.toString() ??
    ("chat" in message ? message.chat.id.toString() : null);
  let sourceChatTitle =
    getChatTitle(forwardedMessage?.forward_from_chat) ??
    ("chat" in message ? getChatTitle(message.chat) : null);
  let sourceMessageId =
    forwardedMessage?.forward_from_message_id ??
    (repliedMessage && "message_id" in repliedMessage
      ? repliedMessage.message_id
      : "message_id" in message
        ? message.message_id
        : 0);

  if (!content && pending) {
    content = pending.content;
    sourceChatId = pending.sourceChatId;
    sourceChatTitle = pending.sourceChatTitle;
    sourceMessageId = pending.sourceMessageId ?? sourceMessageId;
  }

  const isFileRef = !!fileRef;
  if (!content && !isFileRef) {
    await ctx.reply("Нужно указать текст после /k или ответить на сообщение/файл.");
    return true;
  }

  try {
    const user = await upsertUserFromTelegramPayload({
      id: ctx.from.id,
      username: ctx.from.username ?? undefined,
      first_name: ctx.from.first_name ?? undefined,
      last_name: ctx.from.last_name ?? undefined,
    });

    let item;
    if (isFileRef && fileRef) {
      const source = await buildKnowledgeSource(
        ctx,
        repliedMessage ?? undefined,
        forwardedMessage,
        sourceChatId,
        sourceMessageId
      );
      const sourceWithFileId = source ? { ...source, fileId: fileRef.fileId } : null;

      // Дедупликация: tg:<chatId>:<messageId>:<fileId>
      const dedupeKey = `tg:${sourceChatId ?? ""}:${sourceMessageId ?? ""}:${fileRef.fileId}`;
      const existing = await kb.findByDedupeKey(dedupeKey, user.id);
      if (existing) {
        const shortId = existing.id.slice(0, 8);
        const srcLink = existing.source ? buildTelegramMessageLink(existing.source) : "";
        const srcText = srcLink || `chat ${sourceChatId} / msg ${sourceMessageId}`;
        await ctx.reply(`Уже в базе #${shortId}. Source: ${srcText}`);
        pendingKnowledgeForwards.delete(ctx.from.id);
        return true;
      }

      const meta = [fileRef.mime, fileRef.size ? `${fileRef.size} B` : null]
        .filter(Boolean)
        .join(", ");
      const fileText = `File: ${fileRef.name || "file"}${meta ? ` (${meta})` : ""}${fileRef.caption ? ` — ${fileRef.caption}` : ""}`;
      item = await kb.add({
        type: "file_ref",
        text: normalizeTextForSearch(fileText),
        tags: isImportant ? ["important"] : [],
        importance: isImportant ? "important" : "normal",
        source: sourceWithFileId,
        fileMeta: { name: fileRef.name, size: fileRef.size, mime: fileRef.mime },
        createdByUserId: user.id,
        sourceChatId,
        sourceChatTitle,
        sourceMessageId: sourceMessageId ?? undefined,
        dedupeKey,
      });
      const shortId = item.id.slice(0, 8);
      const srcLink = item.source ? buildTelegramMessageLink(item.source) : "";
      const srcText = srcLink || `chat ${sourceChatId} / msg ${sourceMessageId}`;
      await ctx.reply(`Сохранено как file_ref #${shortId}. Source: ${srcText}`);
    } else {
      const isFromReplyOrForward = !!(repliedMessage || forwardedMessage);
      const type = isFromReplyOrForward ? "message" : "note";
      const tags = isImportant ? ["important"] : [];
      const source = await buildKnowledgeSource(
        ctx,
        repliedMessage ?? undefined,
        forwardedMessage,
        sourceChatId,
        sourceMessageId
      );

      // Дедупликация message/note: tgmsg:<chatId>:<messageId>
      if (sourceChatId != null && sourceMessageId != null) {
        const dedupeKey = `tgmsg:${sourceChatId}:${sourceMessageId}`;
        const existing = await kb.findByDedupeKey(dedupeKey, user.id);
        if (existing) {
          const shortId = existing.id.slice(0, 8);
          const srcLink = existing.source ? buildTelegramMessageLink(existing.source) : "";
          const srcText = srcLink || `chat ${sourceChatId} / msg ${sourceMessageId}`;
          await ctx.reply(`Уже в базе #${shortId}. Source: ${srcText}`);
          pendingKnowledgeForwards.delete(ctx.from.id);
          return true;
        }
      }

      const dedupeKey =
        sourceChatId != null && sourceMessageId != null
          ? `tgmsg:${sourceChatId}:${sourceMessageId}`
          : undefined;

      item = await kb.add({
        type,
        text: normalizeTextForSearch(content),
        tags,
        importance: isImportant ? "important" : "normal",
        source,
        createdByUserId: user.id,
        sourceChatId,
        sourceChatTitle,
        sourceMessageId: sourceMessageId ?? undefined,
        dedupeKey,
      });

      await ctx.reply("В знания добавлено.");
    }

    console.log("Knowledge item saved", item);
    safeLogAction("knowledge_added", {
      userId: user.id,
      targetId: item.id,
      targetType: "knowledge",
      payload: { type: item.type, importance: item.importance },
    });
    pendingKnowledgeForwards.delete(ctx.from.id);
  } catch (error) {
    console.error("Failed to handle /k command", error);
    await ctx.reply("Не удалось записать в базу знаний.");
  }

  return true;
}

// ============================================================
// Follow-up handler: "важно" (when pending exists, private chat)
// ============================================================

export async function handleKnowledgeImportantFollowup(
  ctx: Context<Update>
): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) return false;
  if (!ctx.from) return false;
  if (message.chat.type !== "private") return false;

  const pending = pendingKnowledgeForwards.get(ctx.from.id);
  if (!pending) return false;
  if (!/^(это\s+)?важно\b/i.test(message.text.trim())) return false;

  try {
    const user = await upsertUserFromTelegramPayload({
      id: ctx.from.id,
      username: ctx.from.username ?? undefined,
      first_name: ctx.from.first_name ?? undefined,
      last_name: ctx.from.last_name ?? undefined,
    });

    const source = await buildKnowledgeSourceFromPending(
      pending.sourceChatId,
      pending.sourceMessageId ?? null,
      user.id
    );

    // Дедупликация: tgmsg:<chatId>:<messageId>
    if (pending.sourceChatId != null && pending.sourceMessageId != null) {
      const dedupeKey = `tgmsg:${pending.sourceChatId}:${pending.sourceMessageId}`;
      const existing = await findKnowledgeByDedupeKey(dedupeKey, user.id);
      if (existing) {
        const shortId = existing.id.slice(0, 8);
        const srcLink = existing.source ? buildTelegramMessageLink(existing.source) : "";
        const srcText = srcLink || `chat ${pending.sourceChatId} / msg ${pending.sourceMessageId}`;
        await ctx.reply(`Уже в базе #${shortId}. Source: ${srcText}`);
        pendingKnowledgeForwards.delete(ctx.from.id);
        return true;
      }
    }

    const dedupeKey =
      pending.sourceChatId != null && pending.sourceMessageId != null
        ? `tgmsg:${pending.sourceChatId}:${pending.sourceMessageId}`
        : undefined;

    const item = await addKnowledgeEntry({
      type: "message",
      text: normalizeTextForSearch(pending.content),
      tags: ["important"],
      importance: "important",
      source,
      createdByUserId: user.id,
      sourceChatId: pending.sourceChatId,
      sourceChatTitle: pending.sourceChatTitle,
      sourceMessageId: pending.sourceMessageId ?? undefined,
      dedupeKey,
    });

    console.log("Knowledge item saved from important followup", item);
    safeLogAction("knowledge_added", {
      userId: user.id,
      targetId: item.id,
      targetType: "knowledge",
      payload: { type: "message", importance: "important" },
    });
    pendingKnowledgeForwards.delete(ctx.from.id);
    await ctx.reply("Сохранил важное в базу знаний.");
    return true;
  } catch (error) {
    console.error("Failed to handle important knowledge followup", error);
    await ctx.reply("Не удалось сохранить в базу знаний.");
    return true;
  }
}
