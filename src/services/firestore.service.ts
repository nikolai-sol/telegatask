import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import type { Company, AgencyTask, AIContext, CompanyType, AIMode } from '../types/agency';

const db = getFirestore();

// ============================================================
// Companies
// ============================================================

export async function createCompany(
  data: Omit<Company, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Company> {
  const ref = db.collection('companies').doc();
  const now = Timestamp.now();
  const company = { ...data, createdAt: now, updatedAt: now };
  await ref.set(company);
  return { id: ref.id, ...company, createdAt: now.toDate(), updatedAt: now.toDate() };
}

export async function getCompany(id: string): Promise<Company | null> {
  const doc = await db.collection('companies').doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() } as Company;
}

export async function updateCompanyStatus(id: string, status: string): Promise<void> {
  await db.collection('companies').doc(id).update({
    status,
    updatedAt: Timestamp.now(),
  });
}

export async function getCompaniesByType(type: CompanyType): Promise<Company[]> {
  const snap = await db
    .collection('companies')
    .where('type', '==', type)
    .orderBy('updatedAt', 'desc')
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Company);
}

export async function convertTenderToCampaign(
  tenderId: string,
  copyTasks = false
): Promise<Company> {
  const tender = await getCompany(tenderId);
  if (!tender || tender.type !== 'tender') throw new Error('Not a tender');

  const campaign = await createCompany({
    name: tender.name,
    type: 'campaign',
    status: 'active',
    clientName: tender.clientName,
    description: tender.description,
    isFire: false,
    createdBy: tender.createdBy,
    convertedFrom: tenderId,
    members: tender.members,
    metadata: { ...tender.metadata, convertedAt: new Date().toISOString() },
  });

  await updateCompanyStatus(tenderId, 'won');

  if (copyTasks) {
    const tasks = await getTasksByCompany(tenderId);
    for (const task of tasks) {
      await createAgencyTask({
        companyId: campaign.id,
        title: task.title,
        description: task.description,
        status: 'todo',
        priority: task.priority,
        isFire: false,
        createdBy: task.createdBy,
      });
    }
  }

  return campaign;
}

// ============================================================
// Agency Tasks  (collection: agency_tasks — не конфликтует с tasks)
// ============================================================

export async function createAgencyTask(
  data: Omit<AgencyTask, 'id' | 'createdAt' | 'updatedAt'>
): Promise<AgencyTask> {
  const ref = db.collection('agency_tasks').doc();
  const now = Timestamp.now();
  const task = { ...data, createdAt: now, updatedAt: now };
  await ref.set(task);
  return { id: ref.id, ...task, createdAt: now.toDate(), updatedAt: now.toDate() };
}

export async function getTasksByCompany(companyId: string): Promise<AgencyTask[]> {
  const snap = await db
    .collection('agency_tasks')
    .where('companyId', '==', companyId)
    .orderBy('createdAt', 'desc')
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as AgencyTask);
}

export async function getInboxTasks(): Promise<AgencyTask[]> {
  // Ops задачи — без companyId (null)
  const snap = await db
    .collection('agency_tasks')
    .where('companyId', '==', null)
    .where('status', '!=', 'done')
    .orderBy('status')
    .orderBy('createdAt', 'desc')
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as AgencyTask);
}

export async function getFireAgencyTasks(): Promise<AgencyTask[]> {
  const snap = await db
    .collection('agency_tasks')
    .where('isFire', '==', true)
    .where('status', '!=', 'done')
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as AgencyTask);
}

export async function updateAgencyTaskStatus(id: string, status: string): Promise<void> {
  const now = Timestamp.now();
  const update: Record<string, unknown> = { status, updatedAt: now };
  if (status === 'done') update.completedAt = now;
  await db.collection('agency_tasks').doc(id).update(update);
}

export async function updateAgencyTaskFire(id: string, isFire: boolean): Promise<void> {
  await db.collection('agency_tasks').doc(id).update({
    isFire,
    priority: isFire ? 'fire' : 'normal',
    updatedAt: Timestamp.now(),
  });
}

// ============================================================
// AI Contexts
// ============================================================

export async function getOrCreateAIContext(
  companyId: string,
  mode: AIMode
): Promise<AIContext> {
  const snap = await db
    .collection('ai_contexts')
    .where('companyId', '==', companyId)
    .where('mode', '==', mode)
    .limit(1)
    .get();

  if (!snap.empty) {
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() } as AIContext;
  }

  const ref = db.collection('ai_contexts').doc();
  const context: Omit<AIContext, 'id'> = {
    companyId,
    mode,
    messages: [],
    updatedAt: new Date(),
  };
  await ref.set(context);
  return { id: ref.id, ...context };
}

export async function appendAIMessage(
  contextId: string,
  message: { role: 'user' | 'assistant'; content: string }
): Promise<void> {
  await db.collection('ai_contexts').doc(contextId).update({
    messages: FieldValue.arrayUnion({ ...message, timestamp: Date.now() }),
    updatedAt: Timestamp.now(),
  });
}
