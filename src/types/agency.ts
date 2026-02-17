// ============================================================
// AGENCY OS — Core Types
// ============================================================

export type UserRole = 'owner' | 'admin' | 'member';

export interface AgencyUser {
  id: string;
  telegramId: number;
  username?: string;
  firstName: string;
  lastName?: string;
  role: UserRole;
  createdAt: Date;
}

// ---- Company ------------------------------------------------

export type CompanyType = 'tender' | 'campaign' | 'internal';

export type TenderStatus = 'incoming' | 'structuring' | 'execution' | 'final' | 'won' | 'lost';
export type CampaignStatus = 'active' | 'optimization' | 'reporting' | 'ongoing' | 'completed';
export type InternalStatus = 'active' | 'completed';

export type CompanyStatus = TenderStatus | CampaignStatus | InternalStatus;

export interface Company {
  id: string;
  name: string;
  type: CompanyType;
  status: CompanyStatus;
  clientName?: string;
  description?: string;
  isFire: boolean;
  createdBy: string;
  convertedFrom?: string;  // если Campaign создана из Tender
  members: string[];
  aiContextId?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ---- Task ---------------------------------------------------

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked';
export type TaskPriority = 'low' | 'normal' | 'high' | 'fire';

export interface AgencyTask {
  id: string;
  companyId?: string;  // undefined = Ops / Inbox задача
  assignedTo?: string;
  createdBy: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  isFire: boolean;
  dueDate?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ---- Document -----------------------------------------------

export type DocumentType = 'link' | 'file' | 'brief' | 'strategy' | 'mediaplan' | 'report';

export interface AgencyDocument {
  id: string;
  companyId?: string;
  taskId?: string;
  title: string;
  type: DocumentType;
  url?: string;
  telegramFileId?: string;
  createdBy: string;
  createdAt: Date;
}

// ---- AI Context ---------------------------------------------

export type AIMode = 'tender' | 'campaign' | 'ops';

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface AIContext {
  id: string;
  companyId: string;
  mode: AIMode;
  messages: AIMessage[];
  summary?: string;
  updatedAt: Date;
}

// ---- Flow Status Maps ---------------------------------------

export const TENDER_STATUSES: TenderStatus[] = [
  'incoming', 'structuring', 'execution', 'final', 'won', 'lost',
];

export const CAMPAIGN_STATUSES: CampaignStatus[] = [
  'active', 'optimization', 'reporting', 'ongoing', 'completed',
];

export const STATUS_LABELS: Record<CompanyStatus, string> = {
  incoming: '📥 Incoming',
  structuring: '🔍 Structuring',
  execution: '⚙️ Execution',
  final: '📋 Final',
  won: '🏆 Won',
  lost: '❌ Lost',
  active: '🟢 Active',
  optimization: '🔄 Optimization',
  reporting: '📊 Reporting',
  ongoing: '♾️ Ongoing',
  completed: '✅ Completed',
};

export const TYPE_BADGES: Record<CompanyType, string> = {
  tender: 'TENDER',
  campaign: 'CAMPAIGN',
  internal: 'INTERNAL',
};
