export type TaskStatus =
  | "incoming"
  | "new"
  | "in_progress"
  | "waiting"
  | "done"
  | "cancelled";

export type TaskSourceType =
  | "chat_command"
  | "chat_auto"
  | "forward"
  | "scan"
  | "manual";

export type TaskPriority = "low" | "normal" | "high" | "urgent";

export interface TaskReminder {
  at: string; // ISO timestamp — когда напомнить
  sent: boolean;
}

export interface TaskFollowUp {
  enabled: boolean;
  checkAfterHours: number; // через сколько часов проверить ответ
  lastCheckedAt?: string | null; // когда последний раз проверяли
  lastNotifiedAt?: string | null; // когда последний раз уведомили
}

export interface Task {
  id: string; // Firestore doc id
  sourceType: TaskSourceType;
  sourceChatId?: string | null; // FK -> chats.id
  sourceChatTitle?: string | null;
  sourceMessageId?: number | null; // Telegram message_id
  projectId?: string | null; // FK -> projects.id (inbox/tekuchka or linked project)

  createdByUserId: string; // FK -> users.id
  assignedUserId?: string | null; // FK -> users.id

  title: string;
  description: string;

  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string | null;

  reminders?: TaskReminder[];
  watchers?: string[]; // userId[] — кто хочет уведомление
  followUp?: TaskFollowUp | null;

  createdAt: string;
  updatedAt: string;
}
