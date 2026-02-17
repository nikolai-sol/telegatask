import type { CampaignRole } from "./campaignPermissions";

export type TeamStoredRole = "owner" | "admin" | "member" | "read_only";
export type TeamMemberStatus = "active" | "invited" | "disabled";

export function mapStoredRoleToCampaignRole(role: TeamStoredRole | null | undefined): CampaignRole {
  if (role === "owner") return "owner";
  if (role === "admin") return "account";
  if (role === "member") return "project";
  return "viewer";
}

export function mapCampaignRoleToStoredRole(role: CampaignRole): TeamStoredRole {
  if (role === "owner") return "owner";
  if (role === "account") return "admin";
  if (role === "project") return "member";
  return "read_only";
}

export function canListTeamMembers(role: CampaignRole): boolean {
  return role === "owner" || role === "account" || role === "project";
}

export function canManageTeamMembers(role: CampaignRole): boolean {
  return role === "owner" || role === "account";
}

export function statusSortRank(status: TeamMemberStatus): number {
  if (status === "active") return 0;
  if (status === "invited") return 1;
  return 2; // disabled
}

/**
 * Guard against leaving team with zero owners after role/status mutation.
 */
export function wouldLeaveNoOwners(input: {
  memberIds: string[];
  roles: Record<string, TeamStoredRole>;
  targetUserId: string;
  nextStatus: TeamMemberStatus;
  nextRole: TeamStoredRole;
}): boolean {
  const memberSet = new Set((input.memberIds || []).filter(Boolean));
  const roleMap = input.roles || {};
  let owners = 0;

  const considerIds = new Set<string>(memberSet);
  considerIds.add(input.targetUserId);

  for (const userId of considerIds) {
    let active = memberSet.has(userId);
    let role = (roleMap[userId] || "read_only") as TeamStoredRole;

    if (userId === input.targetUserId) {
      active = input.nextStatus === "active";
      role = input.nextRole;
    }

    if (!active) continue;
    if (role === "owner") owners += 1;
  }

  return owners < 1;
}

