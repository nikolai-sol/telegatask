import { firestore } from "../../config/firebase";

const collection = firestore.collection("seoProviderCredentials");

function credentialDocId(teamId: string): string {
  return `gsc__${teamId.trim()}`;
}

export type StoredGscCredential = {
  provider: "gsc";
  teamId: string;
  refreshToken: string;
  scope: string | null;
  tokenType: string | null;
  verifiedSiteUrls: string[];
  lastValidatedSiteUrl: string | null;
  createdAt: number;
  updatedAt: number;
};

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function docToStoredGscCredential(data: FirebaseFirestore.DocumentData | undefined): StoredGscCredential | null {
  if (!data) return null;
  return {
    provider: "gsc",
    teamId: String(data.teamId || ""),
    refreshToken: typeof data.refreshToken === "string" ? data.refreshToken.trim() : "",
    scope: typeof data.scope === "string" && data.scope.trim() ? data.scope.trim() : null,
    tokenType: typeof data.tokenType === "string" && data.tokenType.trim() ? data.tokenType.trim() : null,
    verifiedSiteUrls: toStringArray(data.verifiedSiteUrls),
    lastValidatedSiteUrl:
      typeof data.lastValidatedSiteUrl === "string" && data.lastValidatedSiteUrl.trim()
        ? data.lastValidatedSiteUrl.trim()
        : null,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : Date.now(),
  };
}

export async function getStoredGscCredential(teamId: string): Promise<StoredGscCredential | null> {
  if (!teamId.trim()) return null;
  const snap = await collection.doc(credentialDocId(teamId)).get();
  const credential = docToStoredGscCredential(snap.data());
  if (!credential || credential.teamId !== teamId) return null;
  return credential;
}

export async function upsertStoredGscCredential(input: {
  teamId: string;
  refreshToken: string;
  scope?: string | null;
  tokenType?: string | null;
  verifiedSiteUrls?: string[];
  lastValidatedSiteUrl?: string | null;
}): Promise<StoredGscCredential> {
  if (!input.teamId.trim()) {
    throw new Error("GSC credential requires teamId");
  }
  const now = Date.now();
  const existing = await getStoredGscCredential(input.teamId);
  const payload = {
    provider: "gsc" as const,
    teamId: input.teamId,
    refreshToken: input.refreshToken.trim(),
    scope: typeof input.scope === "string" && input.scope.trim() ? input.scope.trim() : existing?.scope ?? null,
    tokenType:
      typeof input.tokenType === "string" && input.tokenType.trim() ? input.tokenType.trim() : existing?.tokenType ?? null,
    verifiedSiteUrls: Array.from(new Set([...(existing?.verifiedSiteUrls || []), ...(input.verifiedSiteUrls || [])])),
    lastValidatedSiteUrl:
      typeof input.lastValidatedSiteUrl === "string" && input.lastValidatedSiteUrl.trim()
        ? input.lastValidatedSiteUrl.trim()
        : existing?.lastValidatedSiteUrl ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await collection.doc(credentialDocId(input.teamId)).set(payload, { merge: true });
  return payload;
}
