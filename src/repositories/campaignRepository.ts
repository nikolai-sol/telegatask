import { firestore } from "../config/firebase";
import type { Campaign, CampaignStatus } from "../models/campaign";

const collection = firestore.collection("campaigns");

function docToCampaign(id: string, data: FirebaseFirestore.DocumentData): Campaign {
  return {
    id,
    teamId: data.teamId ?? "",
    name: data.name ?? "",
    status: (data.status ?? "draft") as CampaignStatus,
    plannedBudget: typeof data.plannedBudget === "number" ? data.plannedBudget : null,
    spent: typeof data.spent === "number" ? data.spent : 0,
    currency: typeof data.currency === "string" && data.currency.trim() ? data.currency.trim().toUpperCase() : "EUR",
    createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
    createdByUserId: data.createdByUserId ?? "",
  };
}

export async function createCampaign(input: {
  teamId: string;
  name: string;
  status?: CampaignStatus;
  createdByUserId: string;
  plannedBudget?: number | null;
  spent?: number;
  currency?: string;
}): Promise<Campaign> {
  const now = Date.now();
  const payload = {
    teamId: input.teamId,
    name: input.name,
    status: input.status ?? "draft",
    plannedBudget: typeof input.plannedBudget === "number" ? input.plannedBudget : null,
    spent: typeof input.spent === "number" ? input.spent : 0,
    currency: typeof input.currency === "string" && input.currency.trim() ? input.currency.trim().toUpperCase() : "EUR",
    createdAt: now,
    createdByUserId: input.createdByUserId,
  };

  const docRef = await collection.add(payload);
  return docToCampaign(docRef.id, payload);
}

export async function getCampaignById(id: string): Promise<Campaign | null> {
  const snap = await collection.doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;
  return docToCampaign(snap.id, data);
}

export async function listCampaignsByTeamId(teamId: string, limitCount: number = 200): Promise<Campaign[]> {
  const snap = await collection
    .where("teamId", "==", teamId)
    .orderBy("createdAt", "desc")
    .limit(limitCount)
    .get();

  return snap.docs.map((d) => docToCampaign(d.id, d.data()));
}

export async function updateCampaign(
  id: string,
  patch: { name?: string; status?: CampaignStatus; plannedBudget?: number | null; spent?: number; currency?: string }
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (typeof patch.name === "string") update.name = patch.name;
  if (typeof patch.status === "string") update.status = patch.status;
  if (patch.plannedBudget === null) update.plannedBudget = null;
  if (typeof patch.plannedBudget === "number") update.plannedBudget = patch.plannedBudget;
  if (typeof patch.spent === "number") update.spent = patch.spent;
  if (typeof patch.currency === "string" && patch.currency.trim()) update.currency = patch.currency.trim().toUpperCase();
  if (Object.keys(update).length === 0) return;
  await collection.doc(id).update(update);
}

export async function deleteCampaign(id: string): Promise<void> {
  await collection.doc(id).delete();
}
