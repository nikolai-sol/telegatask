import { firestore } from "../config/firebase";

export type CompanyMember = {
  id: string;
  companyId: string;
  userId: string;
  addedByUserId: string;
  createdAt: number;
};

const collection = firestore.collection("companyMembers");

function memberDocId(companyId: string, userId: string): string {
  return `${companyId}_${userId}`;
}

function docToMember(doc: FirebaseFirestore.QueryDocumentSnapshot): CompanyMember {
  const data = doc.data() || {};
  return {
    id: doc.id,
    companyId: String(data.companyId || ""),
    userId: String(data.userId || ""),
    addedByUserId: String(data.addedByUserId || ""),
    createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
  };
}

export async function listCompanyMembers(companyId: string, limitCount: number = 500): Promise<CompanyMember[]> {
  const snap = await collection.where("companyId", "==", companyId).limit(limitCount).get();
  if (snap.empty) return [];
  return snap.docs.map(docToMember);
}

export async function addCompanyMember(companyId: string, userId: string, addedByUserId: string): Promise<void> {
  const id = memberDocId(companyId, userId);
  const payload = {
    companyId,
    userId,
    addedByUserId,
    createdAt: Date.now(),
  };
  // Idempotent (same doc id).
  await collection.doc(id).set(payload, { merge: true });
}

export async function removeCompanyMember(companyId: string, userId: string): Promise<void> {
  const id = memberDocId(companyId, userId);
  await collection.doc(id).delete();
}

export async function isCompanyMember(companyId: string, userId: string): Promise<boolean> {
  const id = memberDocId(companyId, userId);
  const snap = await collection.doc(id).get();
  return snap.exists;
}

export async function listCompanyIdsForUser(userId: string, limitCount: number = 1000): Promise<string[]> {
  const snap = await collection.where("userId", "==", userId).limit(limitCount).get();
  if (snap.empty) return [];
  const out = new Set<string>();
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const companyId = String(data.companyId || "");
    if (companyId) out.add(companyId);
  }
  return Array.from(out);
}

