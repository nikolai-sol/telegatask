import { firestore } from "../../config/firebase";
import type { SeoDeviceType } from "./types";
import type { SeoRankHistoryRecord } from "./sectionRankTracking";

export const SEO_RANK_HISTORY_WRITES_FLAG = "SEO_RANK_HISTORY_WRITES";
export const SEO_RANK_HISTORY_COLLECTION = "seoRankHistory";

const collection = firestore.collection(SEO_RANK_HISTORY_COLLECTION);

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(cleanString).filter(Boolean);
}

function docToRecord(id: string, data: FirebaseFirestore.DocumentData): SeoRankHistoryRecord {
  return {
    id,
    teamId: cleanString(data.teamId),
    runId: cleanString(data.runId),
    domain: cleanString(data.domain),
    searchEngine: "yandex",
    provider: "yandex_search_api",
    clusterId: cleanString(data.clusterId),
    query: cleanString(data.query),
    section: cleanString(data.section),
    intentClass: cleanString(data.intentClass),
    checkedAt: cleanString(data.checkedAt),
    serpPosition: typeof data.serpPosition === "number" ? data.serpPosition : null,
    found: Boolean(data.found),
    matchedUrl: cleanString(data.matchedUrl) || null,
    topResultDomains: toStringArray(data.topResultDomains),
    region: cleanString(data.region) || null,
    language: cleanString(data.language) || null,
    device: data.device === "mobile" || data.device === "desktop" ? data.device as SeoDeviceType : null,
  };
}

export function seoRankHistoryWritesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[SEO_RANK_HISTORY_WRITES_FLAG] === "1";
}

export async function persistSeoRankHistoryRecords(input: {
  writesEnabled: boolean;
  records: SeoRankHistoryRecord[];
}): Promise<{
  written: number;
  records: SeoRankHistoryRecord[];
  sideEffects: {
    firestoreWrites: boolean;
  };
}> {
  if (!input.writesEnabled || input.records.length === 0) {
    return {
      written: 0,
      records: [],
      sideEffects: {
        firestoreWrites: false,
      },
    };
  }

  const batch = firestore.batch();
  for (const record of input.records) {
    batch.set(collection.doc(record.id), record, { merge: false });
  }
  await batch.commit();
  return {
    written: input.records.length,
    records: input.records,
    sideEffects: {
      firestoreWrites: true,
    },
  };
}

export async function listPreviousSeoRankHistoryRecords(input: {
  teamId: string;
  domain: string;
  beforeRunId: string;
  limit?: number;
}): Promise<SeoRankHistoryRecord[]> {
  const snapshot = await collection
    .where("teamId", "==", input.teamId)
    .where("domain", "==", input.domain)
    .get();
  return snapshot.docs
    .map((doc) => docToRecord(doc.id, doc.data()))
    .filter((record) => record.runId !== input.beforeRunId)
    .sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))
    .slice(0, input.limit || 500);
}

export async function listSeoRankHistoryRecords(input: {
  teamId: string;
  domain: string;
  limit?: number;
}): Promise<SeoRankHistoryRecord[]> {
  const snapshot = await collection
    .where("teamId", "==", input.teamId)
    .where("domain", "==", input.domain)
    .get();
  return snapshot.docs
    .map((doc) => docToRecord(doc.id, doc.data()))
    .sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))
    .slice(0, input.limit || 500);
}
