import { describe, expect, test } from "vitest";
import {
  canListTeamMembers,
  canManageTeamMembers,
  mapCampaignRoleToStoredRole,
  mapStoredRoleToCampaignRole,
  wouldLeaveNoOwners,
} from "./teamRoleMap";

describe("teamRoleMap", () => {
  test("role mapping is consistent", () => {
    expect(mapStoredRoleToCampaignRole("owner")).toBe("owner");
    expect(mapStoredRoleToCampaignRole("admin")).toBe("account");
    expect(mapStoredRoleToCampaignRole("member")).toBe("project");
    expect(mapStoredRoleToCampaignRole("read_only")).toBe("viewer");

    expect(mapCampaignRoleToStoredRole("owner")).toBe("owner");
    expect(mapCampaignRoleToStoredRole("account")).toBe("admin");
    expect(mapCampaignRoleToStoredRole("project")).toBe("member");
    expect(mapCampaignRoleToStoredRole("viewer")).toBe("read_only");
  });

  test("viewer cannot list team members, project can list but cannot manage", () => {
    expect(canListTeamMembers("viewer")).toBe(false);
    expect(canListTeamMembers("project")).toBe(true);
    expect(canManageTeamMembers("project")).toBe(false);
    expect(canManageTeamMembers("account")).toBe(true);
  });

  test("last owner guard blocks removing the only owner", () => {
    const input = {
      memberIds: ["u1", "u2"],
      roles: { u1: "owner", u2: "member" } as Record<string, any>,
      targetUserId: "u1",
      nextStatus: "disabled" as const,
      nextRole: "owner" as const,
    };
    expect(wouldLeaveNoOwners(input)).toBe(true);
  });

  test("last owner guard allows when another owner remains", () => {
    const input = {
      memberIds: ["u1", "u2"],
      roles: { u1: "owner", u2: "owner" } as Record<string, any>,
      targetUserId: "u1",
      nextStatus: "disabled" as const,
      nextRole: "owner" as const,
    };
    expect(wouldLeaveNoOwners(input)).toBe(false);
  });
});

