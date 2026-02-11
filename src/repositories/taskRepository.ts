import { firestore } from "../config/firebase";
import { Task, TaskSourceType, TaskStatus } from "../models/task";

export interface CreateTaskInput {
  sourceType: TaskSourceType;
  sourceChatId?: string | null;
  sourceChatTitle?: string | null;
  sourceMessageId?: number | null;
  createdByUserId: string;
  assignedUserId?: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  dueDate?: string | null;
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const now = new Date().toISOString();

  const payload = {
    sourceType: input.sourceType,
    sourceChatId: input.sourceChatId ?? null,
    sourceChatTitle: input.sourceChatTitle ?? null,
    sourceMessageId: input.sourceMessageId ?? null,
    createdByUserId: input.createdByUserId,
    assignedUserId: input.assignedUserId ?? null,
    title: input.title,
    description: input.description,
    status: input.status,
    dueDate: input.dueDate ?? null,
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
  statuses: TaskStatus[] = ["incoming", "new", "in_progress"]
): Promise<Task[]> {
  const query = firestore
    .collection("tasks")
    .where("assignedUserId", "==", assigneeId)
    .where("status", "in", statuses);

  const snapshot = await query.get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      sourceType: data.sourceType,
      sourceChatId: data.sourceChatId ?? null,
      sourceChatTitle: data.sourceChatTitle ?? null,
      sourceMessageId: data.sourceMessageId ?? null,
      createdByUserId: data.createdByUserId,
      assignedUserId: data.assignedUserId ?? null,
      title: data.title,
      description: data.description,
      status: data.status,
      dueDate: data.dueDate ?? null,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    } as Task;
  });
}

export async function getTasksByChatId(
  chatId: string,
  statuses: TaskStatus[] = ["incoming", "new", "in_progress"],
  limitCount: number = 200
): Promise<Task[]> {
  const query = firestore
    .collection("tasks")
    .where("sourceChatId", "==", chatId)
    .where("status", "in", statuses)
    .limit(limitCount);

  const snapshot = await query.get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      sourceType: data.sourceType,
      sourceChatId: data.sourceChatId ?? null,
      sourceChatTitle: data.sourceChatTitle ?? null,
      sourceMessageId: data.sourceMessageId ?? null,
      createdByUserId: data.createdByUserId,
      assignedUserId: data.assignedUserId ?? null,
      title: data.title,
      description: data.description,
      status: data.status,
      dueDate: data.dueDate ?? null,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    } as Task;
  });
}

export async function getAllTasks(
  statuses: TaskStatus[] = ["incoming", "new", "in_progress"],
  limitCount: number = 200
): Promise<Task[]> {
  const query = firestore
    .collection("tasks")
    .where("status", "in", statuses)
    .limit(limitCount);

  const snapshot = await query.get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      sourceType: data.sourceType,
      sourceChatId: data.sourceChatId ?? null,
      sourceChatTitle: data.sourceChatTitle ?? null,
      sourceMessageId: data.sourceMessageId ?? null,
      createdByUserId: data.createdByUserId,
      assignedUserId: data.assignedUserId ?? null,
      title: data.title,
      description: data.description,
      status: data.status,
      dueDate: data.dueDate ?? null,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    } as Task;
  });
}

export async function getTasksByAssigneeIds(
  assigneeIds: string[],
  statuses: TaskStatus[] = ["incoming", "new", "in_progress"]
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
      if (tasksMap.has(doc.id)) {
        return;
      }
      const data = doc.data();
      tasksMap.set(doc.id, {
        id: doc.id,
        sourceType: data.sourceType,
        sourceChatId: data.sourceChatId ?? null,
        sourceChatTitle: data.sourceChatTitle ?? null,
        sourceMessageId: data.sourceMessageId ?? null,
        createdByUserId: data.createdByUserId,
        assignedUserId: data.assignedUserId ?? null,
        title: data.title,
        description: data.description,
        status: data.status,
        dueDate: data.dueDate ?? null,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      } as Task);
    });
  });

  return Array.from(tasksMap.values());
}

export async function getTasksByCreator(
  creatorId: string,
  statuses: TaskStatus[] = ["incoming", "new", "in_progress"]
): Promise<Task[]> {
  const query = firestore
    .collection("tasks")
    .where("createdByUserId", "==", creatorId)
    .where("status", "in", statuses);

  const snapshot = await query.get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      sourceType: data.sourceType,
      sourceChatId: data.sourceChatId ?? null,
      sourceChatTitle: data.sourceChatTitle ?? null,
      sourceMessageId: data.sourceMessageId ?? null,
      createdByUserId: data.createdByUserId,
      assignedUserId: data.assignedUserId ?? null,
      title: data.title,
      description: data.description,
      status: data.status,
      dueDate: data.dueDate ?? null,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    } as Task;
  });
}

export async function getTaskById(taskId: string): Promise<Task | null> {
  const docRef = firestore.collection("tasks").doc(taskId);
  const docSnap = await docRef.get();
  if (!docSnap.exists) {
    return null;
  }
  const data = docSnap.data() as any;
  return {
    id: docSnap.id,
    sourceType: data.sourceType,
    sourceChatId: data.sourceChatId ?? null,
    sourceChatTitle: data.sourceChatTitle ?? null,
    sourceMessageId: data.sourceMessageId ?? null,
    createdByUserId: data.createdByUserId,
    assignedUserId: data.assignedUserId ?? null,
    title: data.title,
    description: data.description,
    status: data.status,
    dueDate: data.dueDate ?? null,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
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

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      sourceType: data.sourceType,
      sourceChatId: data.sourceChatId ?? null,
      sourceChatTitle: data.sourceChatTitle ?? null,
      sourceMessageId: data.sourceMessageId ?? null,
      createdByUserId: data.createdByUserId,
      assignedUserId: data.assignedUserId ?? null,
      title: data.title,
      description: data.description,
      status: data.status,
      dueDate: data.dueDate ?? null,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    } as Task;
  });
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

export async function deleteTask(taskId: string): Promise<void> {
  const docRef = firestore.collection("tasks").doc(taskId);
  await docRef.delete();
}
