import { firestore } from "../config/firebase";
import {
  Task,
  TaskSourceType,
  TaskStatus,
  TaskPriority,
  TaskFollowUp,
  TaskReminder,
} from "../models/task";

/** Normalize Firestore doc to Task with defaults for new fields */
function docToTask(id: string, data: FirebaseFirestore.DocumentData): Task {
  return {
    id,
    sourceType: data.sourceType ?? "chat_command",
    sourceChatId: data.sourceChatId ?? null,
    sourceChatTitle: data.sourceChatTitle ?? null,
    sourceMessageId: data.sourceMessageId ?? null,
    projectId: data.projectId ?? null,
    createdByUserId: data.createdByUserId,
    assignedUserId: data.assignedUserId ?? null,
    title: data.title ?? "",
    description: data.description ?? "",
    status: data.status ?? "incoming",
    priority: data.priority ?? "normal",
    dueDate: data.dueDate ?? null,
    reminders: data.reminders ?? [],
    watchers: data.watchers ?? [],
    followUp: data.followUp ?? null,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export interface CreateTaskInput {
  sourceType: TaskSourceType;
  sourceChatId?: string | null;
  sourceChatTitle?: string | null;
  sourceMessageId?: number | null;
  projectId?: string | null;
  createdByUserId: string;
  assignedUserId?: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  reminders?: TaskReminder[];
  watchers?: string[];
  followUp?: TaskFollowUp | null;
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const now = new Date().toISOString();

  // Auto-generate reminders from dueDate if none provided
  const reminders = input.reminders ?? [];

  const payload = {
    sourceType: input.sourceType,
    sourceChatId: input.sourceChatId ?? null,
    sourceChatTitle: input.sourceChatTitle ?? null,
    sourceMessageId: input.sourceMessageId ?? null,
    projectId: input.projectId ?? null,
    createdByUserId: input.createdByUserId,
    assignedUserId: input.assignedUserId ?? null,
    title: input.title,
    description: input.description,
    status: input.status,
    priority: input.priority ?? "normal",
    dueDate: input.dueDate ?? null,
    reminders,
    watchers: input.watchers ?? [],
    followUp: input.followUp ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const docRef = await firestore.collection("tasks").add(payload);

  return {
    id: docRef.id,
    ...payload,
  };
}

export async function getTasksByAssignee(
  assigneeId: string,
  statuses: TaskStatus[] = ["incoming", "new", "in_progress", "waiting"]
): Promise<Task[]> {
  const query = firestore
    .collection("tasks")
    .where("assignedUserId", "==", assigneeId)
    .where("status", "in", statuses);

  const snapshot = await query.get();
  return snapshot.docs.map((doc) => docToTask(doc.id, doc.data()));
}

export async function getTasksByChatId(
  chatId: string,
  statuses: TaskStatus[] = ["incoming", "new", "in_progress", "waiting"],
  limitCount: number = 200
): Promise<Task[]> {
  const query = firestore
    .collection("tasks")
    .where("sourceChatId", "==", chatId)
    .where("status", "in", statuses)
    .limit(limitCount);

  const snapshot = await query.get();
  return snapshot.docs.map((doc) => docToTask(doc.id, doc.data()));
}

export async function getAllTasks(
  statuses: TaskStatus[] = ["incoming", "new", "in_progress", "waiting"],
  limitCount: number = 200
): Promise<Task[]> {
  const query = firestore
    .collection("tasks")
    .where("status", "in", statuses)
    .limit(limitCount);

  const snapshot = await query.get();
  return snapshot.docs.map((doc) => docToTask(doc.id, doc.data()));
}

export async function getTasksByAssigneeIds(
  assigneeIds: string[],
  statuses: TaskStatus[] = ["incoming", "new", "in_progress", "waiting"]
): Promise<Task[]> {
  const uniqueIds = Array.from(new Set(assigneeIds));

  const queries = uniqueIds.map((id) =>
    firestore
      .collection("tasks")
      .where("assignedUserId", "==", id)
      .where("status", "in", statuses)
      .get()
  );

  const snapshots = await Promise.all(queries);
  const tasksMap = new Map<string, Task>();

  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((doc) => {
      if (tasksMap.has(doc.id)) return;
      tasksMap.set(doc.id, docToTask(doc.id, doc.data()));
    });
  });

  return Array.from(tasksMap.values());
}

export async function getTasksByCreator(
  creatorId: string,
  statuses: TaskStatus[] = ["incoming", "new", "in_progress", "waiting"]
): Promise<Task[]> {
  const query = firestore
    .collection("tasks")
    .where("createdByUserId", "==", creatorId)
    .where("status", "in", statuses);

  const snapshot = await query.get();
  return snapshot.docs.map((doc) => docToTask(doc.id, doc.data()));
}

export async function getTaskById(taskId: string): Promise<Task | null> {
  const docRef = firestore.collection("tasks").doc(taskId);
  const docSnap = await docRef.get();
  if (!docSnap.exists) return null;
  const data = docSnap.data();
  if (!data) return null;
  return docToTask(docSnap.id, data);
}

export async function getTasksBySourceMessage(
  sourceChatId: string,
  sourceMessageId: number
): Promise<Task[]> {
  const snapshot = await firestore
    .collection("tasks")
    .where("sourceChatId", "==", sourceChatId)
    .where("sourceMessageId", "==", sourceMessageId)
    .get();

  return snapshot.docs.map((doc) => docToTask(doc.id, doc.data()));
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus
): Promise<void> {
  const docRef = firestore.collection("tasks").doc(taskId);
  await docRef.update({
    status,
    updatedAt: new Date().toISOString(),
  });
}

export async function updateTaskPriority(
  taskId: string,
  priority: TaskPriority
): Promise<void> {
  const docRef = firestore.collection("tasks").doc(taskId);
  await docRef.update({
    priority,
    updatedAt: new Date().toISOString(),
  });
}

export async function updateTaskProject(
  taskId: string,
  projectId: string | null
): Promise<void> {
  const docRef = firestore.collection("tasks").doc(taskId);
  await docRef.update({
    projectId: projectId ?? null,
    updatedAt: new Date().toISOString(),
  });
}

export async function updateTaskFollowUp(
  taskId: string,
  followUp: TaskFollowUp
): Promise<void> {
  const docRef = firestore.collection("tasks").doc(taskId);
  await docRef.update({
    followUp,
    updatedAt: new Date().toISOString(),
  });
}

export async function markReminderSent(
  taskId: string,
  reminderIndex: number
): Promise<void> {
  const task = await getTaskById(taskId);
  if (!task || !task.reminders || !task.reminders[reminderIndex]) return;

  const updated = [...task.reminders];
  updated[reminderIndex] = { ...updated[reminderIndex], sent: true };

  await firestore.collection("tasks").doc(taskId).update({
    reminders: updated,
    updatedAt: new Date().toISOString(),
  });
}

/** Задачи для digest: созданные в период, просроченные, на сегодня */
export async function getTasksForDigest(
  chatId: string,
  fromIso: string,
  toIso: string,
  nowIso: string
): Promise<Task[]> {
  const all = await getTasksByChatId(chatId, ["incoming", "new", "in_progress", "waiting"], 300);
  const todayStart = nowIso.slice(0, 10) + "T00:00:00.000Z";
  const todayEnd = nowIso.slice(0, 10) + "T23:59:59.999Z";

  return all.filter((t) => {
    const createdInPeriod = t.createdAt >= fromIso && t.createdAt <= toIso;
    const overdue = t.dueDate && t.dueDate < nowIso && t.status !== "done";
    const dueToday = t.dueDate && t.dueDate >= todayStart && t.dueDate <= todayEnd;
    return createdInPeriod || overdue || dueToday;
  });
}

/** Задачи с дедлайном до указанной даты (не done/cancelled) */
export async function getTasksWithDueDateBefore(
  beforeIso: string,
  statuses: TaskStatus[] = ["incoming", "new", "in_progress", "waiting"]
): Promise<Task[]> {
  const snapshot = await firestore
    .collection("tasks")
    .where("status", "in", statuses)
    .where("dueDate", "<=", beforeIso)
    .limit(500)
    .get();

  return snapshot.docs.map((doc) => docToTask(doc.id, doc.data()));
}

/** Задачи со статусом waiting и включённым followUp */
export async function getTasksWaitingForFollowUp(): Promise<Task[]> {
  const snapshot = await firestore
    .collection("tasks")
    .where("status", "==", "waiting")
    .where("followUp.enabled", "==", true)
    .limit(500)
    .get();

  return snapshot.docs.map((doc) => docToTask(doc.id, doc.data()));
}

/** Задачи, созданные пользователем без ответа (outbox active) */
export async function getOutboxActiveTasksOlderThan(
  creatorId: string,
  olderThanIso: string
): Promise<Task[]> {
  const snapshot = await firestore
    .collection("tasks")
    .where("createdByUserId", "==", creatorId)
    .where("status", "in", ["new", "in_progress", "waiting"])
    .where("updatedAt", "<", olderThanIso)
    .limit(200)
    .get();

  return snapshot.docs.map((doc) => docToTask(doc.id, doc.data()));
}

export async function deleteTask(taskId: string): Promise<void> {
  const docRef = firestore.collection("tasks").doc(taskId);
  await docRef.delete();
}
