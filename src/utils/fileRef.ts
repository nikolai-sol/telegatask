/**
 * Извлечение file_ref из Telegram message.
 * Используется в legacy/knowledge и auto-save файлов.
 */

import type { Message } from "telegraf/typings/core/types/typegram";

function getMessageText(message?: Message): string | null {
  if (!message) return null;
  if ("text" in message && message.text) return message.text;
  if ("caption" in message && message.caption) return message.caption;
  return null;
}

export interface FileRefInfo {
  fileId: string;
  name?: string;
  size?: number;
  mime?: string;
  caption?: string;
}

export function extractFileRefFromMessage(
  message: Message | undefined
): FileRefInfo | null {
  if (!message) return null;
  if ("document" in message && message.document) {
    const d = message.document;
    return {
      fileId: d.file_id,
      name: d.file_name,
      size: d.file_size,
      mime: d.mime_type,
      caption: getMessageText(message) ?? undefined,
    };
  }
  if ("photo" in message && message.photo?.length) {
    const p = message.photo[message.photo.length - 1];
    return {
      fileId: p.file_id,
      size: p.file_size,
      caption: getMessageText(message) ?? undefined,
    };
  }
  if ("video" in message && message.video) {
    const v = message.video;
    return {
      fileId: v.file_id,
      name: v.file_name,
      size: v.file_size,
      mime: v.mime_type,
      caption: getMessageText(message) ?? undefined,
    };
  }
  if ("audio" in message && message.audio) {
    const a = message.audio;
    return {
      fileId: a.file_id,
      name: a.file_name,
      size: a.file_size,
      mime: a.mime_type,
      caption: getMessageText(message) ?? undefined,
    };
  }
  return null;
}
