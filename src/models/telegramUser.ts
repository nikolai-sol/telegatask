export interface TelegramUser {
  id: string; // Firestore doc id
  telegramId: number; // Telegram user id
  username?: string | null; // @handle
  displayName: string; // Имя для отображения
  createdAt: string; // ISO-строка
  updatedAt: string; // ISO-строка
}
