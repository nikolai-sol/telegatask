import { firestore } from "../config/firebase";
import type { Company, CompanyStatus, CompanyType } from "../models/company";

const collection = firestore.collection("companies");

function docToCompany(id: string, data: FirebaseFirestore.DocumentData): Company {
  const typeRaw = typeof data.type === "string" ? data.type : "campaign";
  const statusRaw = typeof data.status === "string" ? data.status : "active";
  const type = (typeRaw === "tender" || typeRaw === "campaign" || typeRaw === "internal") ? typeRaw : "campaign";
  const status = (statusRaw === "active" || statusRaw === "archived") ? statusRaw : "active";
  const restrictAccess = Boolean(data.restrictAccess);

  return {
    id,
    teamId: data.teamId ?? "",
    name: data.name ?? "",
    type: type as CompanyType,
    status: status as CompanyStatus,
    restrictAccess,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
    createdByUserId: data.createdByUserId ?? "",
  };
}

export async function createCompany(input: {
  teamId: string;
  name: string;
  type?: CompanyType;
  status?: CompanyStatus;
  restrictAccess?: boolean;
  createdByUserId: string;
}): Promise<Company> {
  const now = Date.now();
  const payload = {
    teamId: input.teamId,
    name: input.name,
    type: input.type ?? "campaign",
    status: input.status ?? "active",
    restrictAccess: Boolean(input.restrictAccess),
    createdAt: now,
    createdByUserId: input.createdByUserId,
  };

  const docRef = await collection.add(payload);
  return docToCompany(docRef.id, payload);
}

export async function getOrCreateInternalCompany(teamId: string, createdByUserId: string): Promise<Company> {
  const snap = await collection
    .where("teamId", "==", teamId)
    .where("type", "==", "internal")
    .where("name", "==", "Internal")
    .limit(1)
    .get();

  if (!snap.empty) {
    const doc = snap.docs[0];
    return docToCompany(doc.id, doc.data());
  }

  return createCompany({
    teamId,
    name: "Internal",
    type: "internal",
    status: "active",
    createdByUserId,
  });
}

export async function getCompanyById(id: string): Promise<Company | null> {
  const snap = await collection.doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;
  return docToCompany(snap.id, data);
}

export async function listCompaniesByTeamId(
  teamId: string,
  options?: { includeArchived?: boolean }
): Promise<Company[]> {
  const snap = await collection
    .where("teamId", "==", teamId)
    .limit(500)
    .get();

  const items = snap.docs
    .map((d) => docToCompany(d.id, d.data()))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  if (options?.includeArchived) return items;
  return items.filter((c) => c.status !== "archived");
}

export async function updateCompany(
  id: string,
  patch: { name?: string; type?: CompanyType; status?: CompanyStatus; restrictAccess?: boolean }
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (typeof patch.name === "string") update.name = patch.name;
  if (typeof patch.type === "string") update.type = patch.type;
  if (typeof patch.status === "string") update.status = patch.status;
  if (typeof patch.restrictAccess === "boolean") update.restrictAccess = patch.restrictAccess;
  if (Object.keys(update).length === 0) return;
  await collection.doc(id).update(update);
}

export async function getCompaniesByIds(companyIds: string[]): Promise<Company[]> {
  const unique = Array.from(new Set((companyIds || []).filter(Boolean)));
  if (unique.length === 0) return [];

  const chunkSize = 10;
  const result: Company[] = [];

  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const refs = chunk.map((id) => collection.doc(id));
    // @ts-ignore - typings for getAll are present on firestore instance.
    const snaps = await firestore.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const data = snap.data();
      if (!data) continue;
      result.push(docToCompany(snap.id, data));
    }
  }

  return result;
}

export async function archiveCompany(id: string): Promise<void> {
  await collection.doc(id).update({ status: "archived" });
}
