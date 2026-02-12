/**
 * KB Service — Knowledge Base operations для скиллов.
 */

import {
  addKnowledgeEntry,
  getKnowledgeById,
  findKnowledgeByDedupeKey,
  listKnowledgeByUser,
  listKnowledgeForSearch,
  listImportantKnowledgeForDigest,
} from "../../repositories/knowledgeRepository";

export interface KBSearchOptions {
  userId: string;
  chatId?: string;
  telegramChatId?: number;
  projectId?: string;
  teamId?: string;
  limit?: number;
}

export class KBService {
  async add(params: Parameters<typeof addKnowledgeEntry>[0]) {
    return addKnowledgeEntry(params);
  }

  async getById(id: string) {
    return getKnowledgeById(id);
  }

  async findByDedupeKey(dedupeKey: string, userId: string) {
    return findKnowledgeByDedupeKey(dedupeKey, userId);
  }

  async listByUser(userId: string, limit?: number) {
    return listKnowledgeByUser(userId, limit);
  }

  async search(options: KBSearchOptions) {
    return listKnowledgeForSearch({
      userId: options.userId,
      chatId: options.chatId,
      telegramChatId: options.telegramChatId,
      projectId: options.projectId,
      teamId: options.teamId,
      limit: options.limit ?? 200,
    });
  }

  async listImportantForDigest(scope: Parameters<typeof listImportantKnowledgeForDigest>[0]) {
    return listImportantKnowledgeForDigest(scope);
  }
}
