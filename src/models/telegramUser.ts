export interface UserSettings {
  morningBriefEnabled: boolean; // утренний бриф
  eveningDigestEnabled: boolean; // вечерний дайджест
  remindBeforeHours: number; // напомнить за N часов до дедлайна (default 2)
  followUpAfterHours: number; // follow-up если нет ответа (default 24)
  unansweredMentionHours: number; // "мне не ответили" — через N часов (default 4)
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  morningBriefEnabled: true,
  eveningDigestEnabled: true,
  remindBeforeHours: 2,
  followUpAfterHours: 24,
  unansweredMentionHours: 4,
};

export interface TelegramUser {
  id: string; // Firestore doc id
  telegramId: number; // Telegram user id
  username?: string | null; // @handle
  displayName: string; // Имя для отображения
  timezone?: string | null; // e.g. "Europe/Moscow" (default null = UTC)
  activeTeamId?: string | null; // выбранная команда для mini app / дефолтов
  settings: UserSettings;
  createdAt: string; // ISO-строка
  updatedAt: string; // ISO-строка
}
