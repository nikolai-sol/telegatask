import { describe, expect, test } from "vitest";
import { canAccessCompany, canAccessTaskInCompany } from "./companyAccess";

function company(restrictAccess: boolean) {
  return {
    id: "c1",
    teamId: "t1",
    name: "Acme",
    type: "campaign",
    status: "active",
    restrictAccess,
    createdAt: Date.now(),
    createdByUserId: "u0",
  } as any;
}

describe("companyAccess", () => {
  test("owner/account can access any company", () => {
    expect(canAccessCompany({ role: "owner", company: company(true), isMember: false, hasOwnTasks: false })).toBe(true);
    expect(canAccessCompany({ role: "account", company: company(false), isMember: false, hasOwnTasks: false })).toBe(true);
  });

  test("project access: restricted => member only", () => {
    expect(canAccessCompany({ role: "project", company: company(true), isMember: false, hasOwnTasks: true })).toBe(false);
    expect(canAccessCompany({ role: "project", company: company(true), isMember: true, hasOwnTasks: false })).toBe(true);
    expect(canAccessCompany({ role: "project", company: company(false), isMember: false, hasOwnTasks: false })).toBe(true);
  });

  test("viewer access: restricted => member only; open => member OR own tasks", () => {
    expect(canAccessCompany({ role: "viewer", company: company(true), isMember: false, hasOwnTasks: true })).toBe(false);
    expect(canAccessCompany({ role: "viewer", company: company(true), isMember: true, hasOwnTasks: false })).toBe(true);
    expect(canAccessCompany({ role: "viewer", company: company(false), isMember: false, hasOwnTasks: false })).toBe(false);
    expect(canAccessCompany({ role: "viewer", company: company(false), isMember: true, hasOwnTasks: false })).toBe(true);
    expect(canAccessCompany({ role: "viewer", company: company(false), isMember: false, hasOwnTasks: true })).toBe(true);
  });

  test("task-in-company: project in restricted can read only member or own task; viewer only own task", () => {
    const restrictedMeta = { restrictAccess: true };
    expect(canAccessTaskInCompany({ role: "project", company: restrictedMeta, isMember: false, isOwnTask: false })).toBe(false);
    expect(canAccessTaskInCompany({ role: "project", company: restrictedMeta, isMember: true, isOwnTask: false })).toBe(true);
    expect(canAccessTaskInCompany({ role: "project", company: restrictedMeta, isMember: false, isOwnTask: true })).toBe(true);
    expect(canAccessTaskInCompany({ role: "viewer", company: restrictedMeta, isMember: true, isOwnTask: false })).toBe(false);
    expect(canAccessTaskInCompany({ role: "viewer", company: restrictedMeta, isMember: false, isOwnTask: true })).toBe(true);
  });
});

