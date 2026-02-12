/**
 * Knowledge v2 — единый формат для note, message, file_ref, link, decision
 */

export type KnowledgeType =
  | "note"
  | "message"
  | "file_ref"
  | "link"
  | "decision";

export type KnowledgeVisibility = "personal" | "team" | "chat";

export interface KnowledgeSourceTelegram {
  kind: "telegram";
  chatId: string; // Firestore chats.id or telegramChatId for link
  telegramChatId?: number; // для генерации ссылки
  messageId: number;
  fromUserId?: string;
  fileId?: string; // Telegram file_id для file_ref
  chatUsername?: string; // для публичных: t.me/username/msgId
}

export interface KnowledgeFileMeta {
  name?: string;
  size?: number;
  mime?: string;
}

export interface KnowledgeIndex {
  status: "referenced" | "indexed" | "mirrored";
  updatedAt?: string;
}

/** Новый формат Knowledge v2 */
export interface KnowledgeItemV2 {
  id: string;
  type: KnowledgeType;
  source?: KnowledgeSourceTelegram | null;
  text: string; // нормализованный текст для поиска
  title?: string | null;
  tags?: string[];
  projectId?: string | null;
  teamId?: string | null;
  visibility?: KnowledgeVisibility;
  importance?: "normal" | "important";
  fileMeta?: KnowledgeFileMeta | null;
  index?: KnowledgeIndex | null;

  createdByUserId: string;
  sourceChatId?: string | null; // legacy, для обратной совместимости
  sourceChatTitle?: string | null;
  sourceMessageId?: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Legacy-совместимый интерфейс: читаем из Firestore как есть */
export interface KnowledgeDocRaw {
  // v2
  type?: KnowledgeType;
  source?: KnowledgeSourceTelegram | null;
  text?: string;
  title?: string | null;
  tags?: string[];
  projectId?: string | null;
  teamId?: string | null;
  visibility?: KnowledgeVisibility;
  importance?: "normal" | "important";
  fileMeta?: KnowledgeFileMeta | null;
  index?: KnowledgeIndex | null;
  // legacy
  content?: string;
  isImportant?: boolean;
  createdByUserId: string;
  sourceChatId?: string | null;
  sourceChatTitle?: string | null;
  sourceMessageId?: number | null;
  createdAt: string;
  updatedAt: string;
}
