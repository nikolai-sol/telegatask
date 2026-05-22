import { describe, expect, it } from "vitest";
import { canDeleteTask, canReadTask, canSetFire, canUpdateTask } from "./taskPermissions";

function t(overrides: Partial<Parameters<typeof canReadTask>[0]["task"]> = {}) {
  return {
    teamId: "team-1",
    visibility: "team" as const,
    createdByUserId: "u-created",
    assignedUserId: null as string | null,
    ...overrides,
  };
}

describe("taskPermissions", () => {
  it("viewer cannot read team task unless creator/assignee", () => {
    expect(canReadTask({ role: "viewer", userId: "me", task: t() })).toBe(false);
    expect(canReadTask({ role: "viewer", userId: "me", task: t({ createdByUserId: "me" }) })).toBe(true);
    expect(canReadTask({ role: "viewer", userId: "me", task: t({ assignedUserId: "me" }) })).toBe(true);
  });

  it("viewer cannot update/delete unless creator/assignee", () => {
    const notMine = t();
    expect(canUpdateTask({ role: "viewer", userId: "me", task: notMine })).toBe(false);
    expect(canDeleteTask({ role: "viewer", userId: "me", task: notMine })).toBe(false);

    const mine = t({ createdByUserId: "me" });
    expect(canUpdateTask({ role: "viewer", userId: "me", task: mine })).toBe(true);
    expect(canDeleteTask({ role: "viewer", userId: "me", task: mine })).toBe(true);
  });

  it("project can read team tasks", () => {
    expect(canReadTask({ role: "project", userId: "me", task: t() })).toBe(true);
  });

  it("project cannot read private unless creator/assignee", () => {
    expect(canReadTask({ role: "project", userId: "me", task: t({ visibility: "private" }) })).toBe(false);
    expect(canReadTask({ role: "project", userId: "me", task: t({ visibility: "private", createdByUserId: "me" }) })).toBe(true);
  });

  it("owner/account can read/update/delete private tasks", () => {
    const priv = t({ visibility: "private", createdByUserId: "u1", assignedUserId: "u2" });
    for (const role of ["owner", "account"] as const) {
      expect(canReadTask({ role, userId: "me", task: priv })).toBe(true);
      expect(canUpdateTask({ role, userId: "me", task: priv })).toBe(true);
      expect(canDeleteTask({ role, userId: "me", task: priv })).toBe(true);
    }
  });

  it("fire permission: only owner/account", () => {
    expect(canSetFire("project")).toBe(false);
    expect(canSetFire("viewer")).toBe(false);
    expect(canSetFire("owner")).toBe(true);
    expect(canSetFire("account")).toBe(true);
  });
});

