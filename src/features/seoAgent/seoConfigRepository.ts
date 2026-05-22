import { firestore } from "../../config/firebase";
import type { SeoCompanyConfig } from "./types";

const collection = firestore.collection("seoCompanyConfigs");

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function docToSeoCompanyConfig(
  id: string,
  data: FirebaseFirestore.DocumentData
): SeoCompanyConfig {
  const now = Date.now();
  return {
    id,
    teamId: String(data.teamId || ""),
    companyId: String(data.companyId || ""),
    domain: String(data.domain || ""),
    markets: toStringArray(data.markets),
    languages: toStringArray(data.languages),
    competitors: toStringArray(data.competitors),
    importantSections: toStringArray(data.importantSections),
    brandKeywords: toStringArray(data.brandKeywords),
    excludeKeywords: toStringArray(data.excludeKeywords),
    createdAt: typeof data.createdAt === "number" ? data.createdAt : now,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : now,
    createdByUserId: String(data.createdByUserId || ""),
  };
}

export async function findSeoConfigByCompany(
  teamId: string,
  companyId: string
): Promise<SeoCompanyConfig | null> {
  const snap = await collection
    .where("teamId", "==", teamId)
    .where("companyId", "==", companyId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return docToSeoCompanyConfig(doc.id, doc.data());
}

export async function upsertSeoConfig(input: {
  teamId: string;
  companyId: string;
  domain: string;
  markets?: string[];
  languages?: string[];
  competitors?: string[];
  importantSections?: string[];
  brandKeywords?: string[];
  excludeKeywords?: string[];
  createdByUserId: string;
}): Promise<SeoCompanyConfig> {
  const now = Date.now();
  const existing = await findSeoConfigByCompany(input.teamId, input.companyId);
  const payload = {
    teamId: input.teamId,
    companyId: input.companyId,
    domain: input.domain,
    markets: toStringArray(input.markets),
    languages: toStringArray(input.languages),
    competitors: toStringArray(input.competitors),
    importantSections: toStringArray(input.importantSections),
    brandKeywords: toStringArray(input.brandKeywords),
    excludeKeywords: toStringArray(input.excludeKeywords),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    createdByUserId: existing?.createdByUserId || input.createdByUserId,
  };

  if (existing) {
    await collection.doc(existing.id).set(payload, { merge: true });
    return { id: existing.id, ...payload };
  }

  const ref = await collection.add(payload);
  return { id: ref.id, ...payload };
}

export async function patchSeoConfig(
  id: string,
  patch: Partial<Omit<SeoCompanyConfig, "id" | "teamId" | "companyId" | "createdAt" | "createdByUserId">>
): Promise<void> {
  const payload: Record<string, unknown> = { updatedAt: Date.now() };
  if (typeof patch.domain === "string") payload.domain = patch.domain;
  if (Array.isArray(patch.markets)) payload.markets = toStringArray(patch.markets);
  if (Array.isArray(patch.languages)) payload.languages = toStringArray(patch.languages);
  if (Array.isArray(patch.competitors)) payload.competitors = toStringArray(patch.competitors);
  if (Array.isArray(patch.importantSections)) payload.importantSections = toStringArray(patch.importantSections);
  if (Array.isArray(patch.brandKeywords)) payload.brandKeywords = toStringArray(patch.brandKeywords);
  if (Array.isArray(patch.excludeKeywords)) payload.excludeKeywords = toStringArray(patch.excludeKeywords);
  await collection.doc(id).set(payload, { merge: true });
}
