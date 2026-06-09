import { firestore } from "../../config/firebase";
import type { SeoDraftTask, SeoDraftTaskStatus, SeoEvidence } from "./types";

const collection = firestore.collection("seoDraftTasks");

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function normalizeStatus(value: unknown): SeoDraftTaskStatus {
  const raw = String(value || "").trim();
  if (raw === "approved" || raw === "rejected") return raw;
  return "draft";
}

function normalizeEvidence(value: unknown): SeoEvidence[] {
  if (!Array.isArray(value)) return [];
  const evidence: SeoEvidence[] = [];
  for (const item of value) {
    const data = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const source = String(data.source || "").trim() as SeoEvidence["source"];
    const message = String(data.message || "").trim();
    if (!source || !message) continue;
    evidence.push({
      source,
      ...(typeof data.metric === "string" && data.metric.trim() ? { metric: data.metric.trim() } : {}),
      ...(data.value !== undefined && (typeof data.value === "string" || typeof data.value === "number" || typeof data.value === "boolean" || data.value === null)
        ? { value: data.value }
        : {}),
      ...(typeof data.url === "string" && data.url.trim() ? { url: data.url.trim() } : {}),
      ...(typeof data.query === "string" && data.query.trim() ? { query: data.query.trim() } : {}),
      message,
      ...(typeof data.collectedAt === "string" || typeof data.collectedAt === "number" ? { collectedAt: data.collectedAt } : {}),
    });
  }
  return evidence;
}

function docToSeoDraftTask(id: string, data: FirebaseFirestore.DocumentData): SeoDraftTask {
  const now = new Date().toISOString();
  return {
    id,
    teamId: String(data.teamId || ""),
    companyId: String(data.companyId || data.suggestedCompanyId || ""),
    runId: String(data.runId || ""),
    domain: String(data.domain || ""),
    sourceType: data.sourceType === "recommendation" ? "recommendation" : "opportunity",
    sourceId: typeof data.sourceId === "string" && data.sourceId.trim() ? data.sourceId.trim() : null,
    sourceFindingId:
      typeof data.sourceFindingId === "string" && data.sourceFindingId.trim() ? data.sourceFindingId.trim() : null,
    evidence: normalizeEvidence(data.evidence),
    labels: Array.isArray(data.labels) ? data.labels : [],
    title: String(data.title || ""),
    description: String(data.description || ""),
    priority: data.priority === "priority" || data.priority === "fire" ? data.priority : "normal",
    status: normalizeStatus(data.status),
    targetKeywords: toStringArray(data.targetKeywords),
    suggestedCompanyId:
      typeof data.suggestedCompanyId === "string" && data.suggestedCompanyId.trim()
        ? data.suggestedCompanyId.trim()
        : null,
    realTaskId: typeof data.realTaskId === "string" && data.realTaskId.trim() ? data.realTaskId.trim() : null,
    convertedAt: typeof data.convertedAt === "string" && data.convertedAt ? data.convertedAt : null,
    convertedByUserId:
      typeof data.convertedByUserId === "string" && data.convertedByUserId.trim()
        ? data.convertedByUserId.trim()
        : null,
    createdAt: typeof data.createdAt === "string" && data.createdAt ? data.createdAt : now,
    updatedAt: typeof data.updatedAt === "string" && data.updatedAt ? data.updatedAt : now,
  };
}

export async function createSeoDraftTasks(input: {
  teamId: string;
  tasks: Array<Omit<SeoDraftTask, "id">>;
}): Promise<SeoDraftTask[]> {
  const created = await Promise.all(
    input.tasks.map(async (task) => {
      const safeTask = {
        ...task,
        teamId: input.teamId,
        companyId: task.companyId || task.suggestedCompanyId || "",
      };
      const ref = await collection.add(safeTask);
      return { id: ref.id, ...safeTask };
    })
  );
  return created;
}

export async function listSeoDraftTasksByRun(teamId: string, runId: string): Promise<SeoDraftTask[]> {
  const snapshot = await collection.where("teamId", "==", teamId).where("runId", "==", runId).get();
  return snapshot.docs.map((doc) => docToSeoDraftTask(doc.id, doc.data()));
}

export async function findSeoDraftTaskById(teamId: string, draftTaskId: string): Promise<SeoDraftTask | null> {
  const snap = await collection.doc(draftTaskId).get();
  if (!snap.exists) return null;

  const task = docToSeoDraftTask(snap.id, snap.data() || {});
  if (task.teamId !== teamId) return null;
  return task;
}

export async function updateSeoDraftTaskStatus(input: {
  teamId: string;
  draftTaskId: string;
  status: SeoDraftTaskStatus;
}): Promise<SeoDraftTask | null> {
  const existing = await findSeoDraftTaskById(input.teamId, input.draftTaskId);
  if (!existing) return null;

  const updatedAt = new Date().toISOString();
  await collection.doc(input.draftTaskId).set(
    {
      status: input.status,
      updatedAt,
    },
    { merge: true }
  );

  return {
    ...existing,
    status: input.status,
    updatedAt,
  };
}

export async function markSeoDraftTaskConverted(input: {
  teamId: string;
  draftTaskId: string;
  realTaskId: string;
  convertedByUserId: string;
}): Promise<SeoDraftTask | null> {
  const existing = await findSeoDraftTaskById(input.teamId, input.draftTaskId);
  if (!existing) return null;

  const updatedAt = new Date().toISOString();
  const convertedAt = updatedAt;
  await collection.doc(input.draftTaskId).set(
    {
      realTaskId: input.realTaskId,
      convertedAt,
      convertedByUserId: input.convertedByUserId,
      updatedAt,
    },
    { merge: true }
  );

  return {
    ...existing,
    realTaskId: input.realTaskId,
    convertedAt,
    convertedByUserId: input.convertedByUserId,
    updatedAt,
  };
}
