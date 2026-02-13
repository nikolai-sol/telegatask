export type CampaignStatus = "draft" | "planned" | "running" | "paused" | "finished";

export interface Campaign {
  id: string; // Firestore doc id
  teamId: string; // FK -> teams.id
  name: string;
  status: CampaignStatus;
  createdAt: number; // epoch ms
  createdByUserId: string; // FK -> users.id
}

