/**
 * Usage tracking — счётчики использования для paywall.
 *
 * Хранит: orgId:YYYY-MM-DD → { skillId: count }
 *
 * ⚠️ TEST MODE: лимиты отключены. Перед продакшеном — вернуть значения.
 */

import { firestore } from "../config/firebase";
import type { PlanTier } from "../skills/types";

/** TEST MODE: все лимиты Infinity. Перед релизом — см. историю в git. */
const PLAN_LIMITS: Record<PlanTier, Record<string, number>> = {
  free: {
    "tasks.create": Infinity,
    "knowledge.add": Infinity,
    "ask": Infinity,
    "kb.save": Infinity,
    "task.create_from_kb": Infinity,
    "scan": Infinity,
    "digest": Infinity,
  },
  pro: {
    "tasks.create": Infinity,
    "knowledge.add": 200,
    "ask": 100,
    "kb.save": Infinity,
    "task.create_from_kb": Infinity,
    "scan": Infinity,
    "digest": 30,
  },
  team: {
    "tasks.create": Infinity,
    "knowledge.add": Infinity,
    "ask": 500,
    "kb.save": Infinity,
    "task.create_from_kb": Infinity,
    "scan": Infinity,
    "digest": Infinity,
  },
  enterprise: {
    "tasks.create": Infinity,
    "knowledge.add": Infinity,
    "ask": Infinity,
    "kb.save": Infinity,
    "task.create_from_kb": Infinity,
    "scan": Infinity,
    "digest": Infinity,
  },
};

const collection = firestore.collection("usageCounters");

/**
 * Получить ID документа счётчика: orgId:YYYY-MM
 */
function getDocId(orgId: string): string {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return `${orgId}:${month}`;
}

/**
 * Инкрементировать счётчик использования.
 */
export async function incrementUsage(
  orgId: string,
  skillId: string,
  amount: number = 1
): Promise<void> {
  const docId = getDocId(orgId);
  const docRef = collection.doc(docId);

  try {
    await firestore.runTransaction(async (tx) => {
      const doc = await tx.get(docRef);
      if (!doc.exists) {
        tx.set(docRef, {
          organizationId: orgId,
          month: docId.split(":")[1],
          counters: { [skillId]: amount },
          updatedAt: new Date().toISOString(),
        });
      } else {
        const data = doc.data()!;
        const counters = data.counters || {};
        counters[skillId] = (counters[skillId] || 0) + amount;
        tx.update(docRef, { counters, updatedAt: new Date().toISOString() });
      }
    });
  } catch (error) {
    // Non-critical — don't fail the operation
    console.error("[usage] Failed to increment", error);
  }
}

/**
 * Получить текущее использование.
 */
export async function getUsage(
  orgId: string,
  skillId: string
): Promise<number> {
  const docId = getDocId(orgId);
  try {
    const doc = await collection.doc(docId).get();
    if (!doc.exists) return 0;
    return doc.data()?.counters?.[skillId] ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Проверить, не превышен ли лимит.
 */
export async function checkUsageLimit(
  orgId: string,
  skillId: string,
  plan: PlanTier
): Promise<{ allowed: boolean; current: number; limit: number }> {
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  const limit = limits[skillId] ?? Infinity;

  if (limit === Infinity) {
    return { allowed: true, current: 0, limit };
  }

  if (limit === 0) {
    return { allowed: false, current: 0, limit: 0 };
  }

  const current = await getUsage(orgId, skillId);
  return { allowed: current < limit, current, limit };
}
