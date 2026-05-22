import { describe, expect, it } from "vitest";
import {
  canListObservedUsers,
  canManageObservedUsers,
  normalizeBatchPromoteRole,
} from "./observedUsersPermissions";

describe("observedUsersPermissions", () => {
  it("viewer cannot list observed users", () => {
    expect(canListObservedUsers("viewer")).toBe(false);
    expect(canListObservedUsers("project")).toBe(true);
  });

  it("only owner/account can manage observed users", () => {
    expect(canManageObservedUsers("owner")).toBe(true);
    expect(canManageObservedUsers("account")).toBe(true);
    expect(canManageObservedUsers("project")).toBe(false);
  });

  it("batch promote forbids owner role", () => {
    expect(normalizeBatchPromoteRole("project")).toBe("project");
    expect(normalizeBatchPromoteRole("viewer")).toBe("viewer");
    expect(normalizeBatchPromoteRole("account")).toBe("account");
    expect(normalizeBatchPromoteRole("owner")).toBeNull();
    expect(normalizeBatchPromoteRole("")).toBe("project");
  });
});
