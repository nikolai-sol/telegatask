import { firestore } from "../../config/firebase";
import type { SeoCompanyConfig, SeoDeviceType } from "./types";

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
  const targetDeviceRaw = typeof data.targetDevice === "string" ? data.targetDevice.trim() : "";
  const targetDevice: SeoDeviceType | null =
    targetDeviceRaw === "desktop" || targetDeviceRaw === "mobile" ? targetDeviceRaw : null;
  return {
    id,
    teamId: String(data.teamId || ""),
    companyId: String(data.companyId || ""),
    domain: String(data.domain || ""),
    gscSiteUrl: typeof data.gscSiteUrl === "string" && data.gscSiteUrl.trim() ? data.gscSiteUrl.trim() : null,
    targetDomainAliases: toStringArray(data.targetDomainAliases),
    markets: toStringArray(data.markets),
    languages: toStringArray(data.languages),
    competitors: toStringArray(data.competitors),
    importantSections: toStringArray(data.importantSections),
    brandKeywords: toStringArray(data.brandKeywords),
    excludeKeywords: toStringArray(data.excludeKeywords),
    trackingKeywords: toStringArray(data.trackingKeywords),
    targetLocation: typeof data.targetLocation === "string" && data.targetLocation.trim() ? data.targetLocation.trim() : null,
    targetRegion: typeof data.targetRegion === "string" && data.targetRegion.trim() ? data.targetRegion.trim() : null,
    targetDevice,
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
  gscSiteUrl?: string | null;
  targetDomainAliases?: string[];
  markets?: string[];
  languages?: string[];
  competitors?: string[];
  importantSections?: string[];
  brandKeywords?: string[];
  excludeKeywords?: string[];
  trackingKeywords?: string[];
  targetLocation?: string | null;
  targetRegion?: string | null;
  targetDevice?: SeoDeviceType | null;
  createdByUserId: string;
}): Promise<SeoCompanyConfig> {
  const now = Date.now();
  const existing = await findSeoConfigByCompany(input.teamId, input.companyId);
  const payload = {
    teamId: input.teamId,
    companyId: input.companyId,
    domain: input.domain,
    gscSiteUrl:
      input.gscSiteUrl === undefined
        ? existing?.gscSiteUrl ?? null
        : typeof input.gscSiteUrl === "string" && input.gscSiteUrl.trim()
          ? input.gscSiteUrl.trim()
          : null,
    targetDomainAliases:
      input.targetDomainAliases === undefined ? existing?.targetDomainAliases || [] : toStringArray(input.targetDomainAliases),
    markets: input.markets === undefined ? existing?.markets || [] : toStringArray(input.markets),
    languages: input.languages === undefined ? existing?.languages || [] : toStringArray(input.languages),
    competitors: input.competitors === undefined ? existing?.competitors || [] : toStringArray(input.competitors),
    importantSections:
      input.importantSections === undefined ? existing?.importantSections || [] : toStringArray(input.importantSections),
    brandKeywords: input.brandKeywords === undefined ? existing?.brandKeywords || [] : toStringArray(input.brandKeywords),
    excludeKeywords: input.excludeKeywords === undefined ? existing?.excludeKeywords || [] : toStringArray(input.excludeKeywords),
    trackingKeywords:
      input.trackingKeywords === undefined ? existing?.trackingKeywords || [] : toStringArray(input.trackingKeywords),
    targetLocation:
      input.targetLocation === undefined
        ? existing?.targetLocation ?? null
        : typeof input.targetLocation === "string" && input.targetLocation.trim()
          ? input.targetLocation.trim()
          : null,
    targetRegion:
      input.targetRegion === undefined
        ? existing?.targetRegion ?? null
        : typeof input.targetRegion === "string" && input.targetRegion.trim()
          ? input.targetRegion.trim()
          : null,
    targetDevice:
      input.targetDevice === undefined
        ? existing?.targetDevice ?? null
        : input.targetDevice === "desktop" || input.targetDevice === "mobile"
          ? input.targetDevice
          : null,
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
  if (patch.gscSiteUrl !== undefined) {
    payload.gscSiteUrl = typeof patch.gscSiteUrl === "string" && patch.gscSiteUrl.trim() ? patch.gscSiteUrl.trim() : null;
  }
  if (Array.isArray(patch.targetDomainAliases)) payload.targetDomainAliases = toStringArray(patch.targetDomainAliases);
  if (Array.isArray(patch.markets)) payload.markets = toStringArray(patch.markets);
  if (Array.isArray(patch.languages)) payload.languages = toStringArray(patch.languages);
  if (Array.isArray(patch.competitors)) payload.competitors = toStringArray(patch.competitors);
  if (Array.isArray(patch.importantSections)) payload.importantSections = toStringArray(patch.importantSections);
  if (Array.isArray(patch.brandKeywords)) payload.brandKeywords = toStringArray(patch.brandKeywords);
  if (Array.isArray(patch.excludeKeywords)) payload.excludeKeywords = toStringArray(patch.excludeKeywords);
  if (Array.isArray(patch.trackingKeywords)) payload.trackingKeywords = toStringArray(patch.trackingKeywords);
  if (patch.targetLocation !== undefined) payload.targetLocation = typeof patch.targetLocation === "string" && patch.targetLocation.trim() ? patch.targetLocation.trim() : null;
  if (patch.targetRegion !== undefined) payload.targetRegion = typeof patch.targetRegion === "string" && patch.targetRegion.trim() ? patch.targetRegion.trim() : null;
  if (patch.targetDevice !== undefined) {
    payload.targetDevice = patch.targetDevice === "desktop" || patch.targetDevice === "mobile" ? patch.targetDevice : null;
  }
  await collection.doc(id).set(payload, { merge: true });
}
