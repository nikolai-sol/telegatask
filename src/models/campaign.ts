export type CampaignStatus = "draft" | "planned" | "running" | "paused" | "finished" | "archived";

export interface Campaign {
  id: string; // Firestore doc id
  teamId: string; // FK -> teams.id
  name: string;
  status: CampaignStatus;
  plannedBudget?: number | null;
  spent?: number;
  currency?: string; // e.g. "EUR"
  createdAt: number; // epoch ms
  createdByUserId: string; // FK -> users.id
}
