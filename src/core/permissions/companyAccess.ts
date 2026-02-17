import type { TaskRole } from "./taskPermissions";
import type { Company } from "../../models/company";

export function canManageCompany(role: TaskRole): boolean {
  return role === "owner" || role === "account";
}

export function canAccessCompany(params: {
  role: TaskRole;
  company: Company;
  isMember: boolean;
  hasOwnTasks: boolean;
}): boolean {
  const { role, company, isMember, hasOwnTasks } = params;

  if (role === "owner" || role === "account") return true;

  if (company.restrictAccess) {
    // Restrict means "member-only" at company navigation level (MVP).
    return isMember;
  }

  if (role === "viewer") {
    // Viewer sees only their own tasks anyway; to avoid confusion, show only companies
    // where they are staffed or already have their own tasks.
    return isMember || hasOwnTasks;
  }

  // project
  return true;
}

export function canAccessTaskInCompany(params: {
  role: TaskRole;
  company: { restrictAccess: boolean } | null;
  isMember: boolean;
  isOwnTask: boolean;
}): boolean {
  const { role, company, isMember, isOwnTask } = params;

  // If we can't resolve company, don't block existing behavior.
  if (!company) return true;

  if (role === "owner" || role === "account") return true;
  if (role === "viewer") return isOwnTask;

  // project
  if (!company.restrictAccess) return true;
  return isMember || isOwnTask;
}
