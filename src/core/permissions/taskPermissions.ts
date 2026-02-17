export type TaskRole = "owner" | "account" | "project" | "viewer";

export type TaskPermissionsTask = {
  visibility: "private" | "team";
  createdByUserId: string;
  assignedUserId?: string | null;
  teamId: string;
};

export function canSetFire(role: TaskRole): boolean {
  return role === "owner" || role === "account";
}

export function canReadTask(params: { role: TaskRole; userId: string; task: TaskPermissionsTask }): boolean {
  const { role, userId, task } = params;

  if (role === "owner" || role === "account") return true;

  const isMine = task.createdByUserId === userId || task.assignedUserId === userId;
  if (task.visibility === "private") return isMine;

  // team visibility
  if (role === "viewer") return isMine;
  return true;
}

export function canUpdateTask(params: { role: TaskRole; userId: string; task: TaskPermissionsTask }): boolean {
  const { role, userId, task } = params;

  if (!canReadTask({ role, userId, task })) return false;
  if (role === "owner" || role === "account") return true;

  return task.createdByUserId === userId || task.assignedUserId === userId;
}

export function canDeleteTask(params: { role: TaskRole; userId: string; task: TaskPermissionsTask }): boolean {
  // Keep delete permissions consistent with update permissions (MVP).
  return canUpdateTask(params);
}
