export type TaskStatus =
  | "incoming"
  | "new"
  | "in_progress"
  | "done"
  | "cancelled";

export type TaskSourceType = "chat_command" | "chat_auto" | "forward";

export interface Task {
  id: string; // Firestore doc id
  sourceType: TaskSourceType;
  sourceChatId?: string | null; // FK -> chats.id
  sourceChatTitle?: string | null;
  sourceMessageId?: number | null; // Telegram message_id

  createdByUserId: string; // FK -> users.id
  assignedUserId?: string | null; // FK -> users.id

  title: string;
  description: string;

  status: TaskStatus;
  dueDate?: string | null;

  createdAt: string;
  updatedAt: string;
}
