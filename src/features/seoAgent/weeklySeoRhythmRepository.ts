import { firestore } from "../../config/firebase";
import type { WeeklySeoRhythmApprovalTarget, WeeklySeoRhythmRunRecord, WeeklySeoRhythmStore } from "./weeklySeoRhythm";

export const WEEKLY_SEO_RHYTHM_RUN_COLLECTION = "seoWeeklyRhythmRuns";

const collection = firestore.collection(WEEKLY_SEO_RHYTHM_RUN_COLLECTION);

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number");
}

function toApprovalTargets(value: unknown): WeeklySeoRhythmApprovalTarget[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const data = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const draftTaskId = cleanString(data.draftTaskId);
    const callbackData = cleanString(data.callbackData);
    const opportunityId = cleanString(data.opportunityId);
    if (!draftTaskId || !callbackData || !opportunityId) return [];
    return [{
      draftTaskId,
      callbackData,
      opportunityId,
      clusterId: cleanString(data.clusterId) || null,
    }];
  });
}

function docToRun(data: FirebaseFirestore.DocumentData): WeeklySeoRhythmRunRecord {
  return {
    weekKey: cleanString(data.weekKey),
    runWeekKey: cleanString(data.runWeekKey) || cleanString(data.weekKey) || undefined,
    dataWeekKey: cleanString(data.dataWeekKey) || cleanString(data.weekKey) || undefined,
    runId: cleanString(data.runId),
    status: data.status === "completed" || data.status === "failed" ? data.status : "running",
    lockOwner: cleanString(data.lockOwner) || null,
    startedAt: cleanString(data.startedAt),
    completedAt: cleanString(data.completedAt) || null,
    failedAt: cleanString(data.failedAt) || null,
    failureStage: cleanString(data.failureStage) as WeeklySeoRhythmRunRecord["failureStage"] || null,
    failureMessage: cleanString(data.failureMessage) || null,
    digestMessageIds: toNumberArray(data.digestMessageIds),
    artifactPath: cleanString(data.artifactPath) || null,
    approvalTargets: toApprovalTargets(data.approvalTargets),
  };
}

export const weeklySeoRhythmFirestoreStore: WeeklySeoRhythmStore = {
  async getRun(input) {
    const snapshot = await collection.doc(input.weekKey).get();
    if (!snapshot.exists) return null;
    return docToRun(snapshot.data() || {});
  },

  async createRun(record) {
    await collection.doc(record.weekKey).set(record, { merge: false });
    return record;
  },

  async updateRun(input) {
    await collection.doc(input.weekKey).set(input.patch, { merge: true });
    const snapshot = await collection.doc(input.weekKey).get();
    return docToRun(snapshot.data() || {});
  },
};
