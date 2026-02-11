export interface Chat {
  id: string; // Firestore doc id
  telegramChatId: number;
  title: string;
  type: "group" | "supergroup" | "channel" | "private";
  defaultProjectId?: string | null;
  createdAt: string;
  updatedAt: string;
}
