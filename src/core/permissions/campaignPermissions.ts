import { getTeamById } from "../../repositories/teamRepository";

export type CampaignRole = "owner" | "account" | "project" | "viewer";

export type CampaignRolePermissions = {
  view: boolean;
  edit: boolean;
  finance: boolean;
  manage: boolean;
};

export function getRolePermissions(role: CampaignRole): CampaignRolePermissions {
  switch (role) {
    case "owner":
      return { view: true, edit: true, finance: true, manage: true };
    case "account":
      return { view: true, edit: true, finance: true, manage: false };
    case "project":
      return { view: true, edit: true, finance: false, manage: false };
    case "viewer":
    default:
      return { view: true, edit: false, finance: false, manage: false };
  }
}

/**
 * Derive campaign role from existing team roles.
 *
 * Current Team.roles supports: owner | admin | member | read_only
 * We map them to campaign roles:
 * - owner -> owner
 * - admin -> account
 * - member -> project
 * - read_only/unknown -> viewer
 */
export async function getUserRoleInTeam(userId: string, teamId: string): Promise<CampaignRole> {
  const team = await getTeamById(teamId);
  const r = team?.roles?.[userId] ?? null;
  if (r === "owner") return "owner";
  if (r === "admin") return "account";
  if (r === "member") return "project";
  return "viewer";
}

