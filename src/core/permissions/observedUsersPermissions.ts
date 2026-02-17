import type { CampaignRole } from "./campaignPermissions";

export function canListObservedUsers(role: CampaignRole): boolean {
  return role === "owner" || role === "account" || role === "project";
}

export function canManageObservedUsers(role: CampaignRole): boolean {
  return role === "owner" || role === "account";
}

/**
 * Batch promote is intentionally conservative:
 * - allowed target roles: project/viewer/account
 * - owner is NOT allowed in batch flow
 */
export function normalizeBatchPromoteRole(inputRole: string | null | undefined): CampaignRole | null {
  const role = String(inputRole || "").trim().toLowerCase();
  if (role === "project" || role === "viewer" || role === "account") return role;
  if (role === "") return "project";
  return null;
}
