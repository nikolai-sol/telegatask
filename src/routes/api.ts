/**
 * REST API for Telegram Mini App
 * All routes require valid Telegram WebApp initData
 */
import { Router, Request, Response } from "express";
import { webAppAuthMiddleware } from "../middleware/validateWebApp";
import {
  getTasksByAssigneeIds,
  getTasksByCreator,
  getTaskById,
  updateTaskStatus,
  deleteTask,
  createTask,
  updateTaskProject,
  updateTaskFields,
} from "../repositories/taskRepository";
import {
  getUserByTelegramId,
  getUserByUsername,
  upsertUserByUsername,
  getUsersByIds,
  getUserById,
  updateUserActiveTeamId,
} from "../repositories/userRepository";
import { logAction, listActionLogs } from "../repositories/actionLogRepository";
import { listTeamsByMemberId } from "../repositories/teamRepository";
import { createProject, listProjectsByTeamId } from "../repositories/projectRepository";
import { listChatsForScan } from "../repositories/chatRepository";
import { getSchedulerStats } from "../services/scheduler";

const router = Router();

/** Resolve internal userId from Telegram id */
async function resolveUserId(telegramId: number): Promise<string | null> {
  const user = await getUserByTelegramId(telegramId);
  return user?.id ?? null;
}

async function resolveActiveTeamId(userId: string): Promise<string | null> {
  const user = await getUserById(userId);
  if (user?.activeTeamId) return user.activeTeamId;

  const teams = await listTeamsByMemberId(userId, 20);
  const first = teams[0]?.id ?? null;
  if (first) {
    updateUserActiveTeamId(userId, first).catch(() => {});
  }
  return first;
}

async function ensureTekuchkaProject(teamId: string): Promise<string> {
  const projects = await listProjectsByTeamId(teamId);
  const existing = projects.find((p) => (p.name || "").toLowerCase() === "текучка");
  if (existing) return existing.id;
  const created = await createProject({ name: "Текучка", description: "Inbox / текучка", teamId });
  return created.id;
}

function extractFirstMention(text: string): string | null {
  const match = text.match(/(^|\\s)@([a-zA-Z0-9_]{3,32})\\b/);
  return match ? match[2] : null;
}

function isSuperAdminFromEnv(username?: string | null): boolean {
  const raw = process.env.SUPERADMINS || "";
  if (!raw) return false;
  const set = new Set(
    raw
      .split(",")
      .map((s) => s.trim().replace(/^@/, "").toLowerCase())
      .filter(Boolean)
  );
  if (!username) return false;
  return set.has(username.replace(/^@/, "").toLowerCase());
}

// ─── GET /api/admin/ops ───
router.get("/api/admin/ops", webAppAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const tgUser = req.webAppData!.user;

    if (!isSuperAdminFromEnv(tgUser.username ?? null)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const chats = await listChatsForScan();
    const scheduler = getSchedulerStats();
    const logs = await listActionLogs(80);

    const scanLogs = logs.filter((l) => l.action === "scan_executed").slice(0, 10);
    const digestLogs = logs.filter((l) => l.action === "digest_run").slice(0, 10);
    const errorLogs = logs.filter((l) => l.action === "error").slice(0, 20);

    res.json({
      ok: true,
      serverTime: new Date().toISOString(),
      scheduler,
      autoScan: {
        enabledChatsCount: chats.length,
        chats: chats.map((c) => ({
          id: c.id,
          telegramChatId: c.telegramChatId,
          title: c.title,
          lastScannedAt: c.lastScannedAt ?? null,
          scanIntervalMin: c.scanIntervalMin ?? 30,
        })),
      },
      recent: {
        scan_executed: scanLogs,
        digest_run: digestLogs,
        errors: errorLogs,
      },
    });
  } catch (err) {
    console.error("[API] GET /api/admin/ops error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /api/tasks ───
router.get("/api/tasks", webAppAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const tgUser = req.webAppData!.user;
    const userId = await resolveUserId(tgUser.id);

    if (!userId) {
      res.status(404).json({ error: "User not found. Send /start to the bot first." });
      return;
    }

    const activeTeamId = await resolveActiveTeamId(userId);
    if (!activeTeamId) {
      res.json({ tasks: [] });
      return;
    }

    // Fetch tasks where user is assignee or creator (all statuses for Mini App)
    const allStatuses: Array<"incoming" | "new" | "in_progress" | "waiting" | "done" | "cancelled"> =
      ["incoming", "new", "in_progress", "waiting", "done", "cancelled"];

    const assigneeIds = [userId];
    if (tgUser.username) {
      assigneeIds.push(`username-${tgUser.username.toLowerCase()}`);
    }

    const [assigned, created] = await Promise.all([
      getTasksByAssigneeIds(assigneeIds, allStatuses, activeTeamId),
      getTasksByCreator(userId, allStatuses, activeTeamId),
    ]);

    // Merge and dedupe
    const seen = new Set<string>();
    const tasks = [];
    for (const t of [...assigned, ...created]) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        tasks.push(t);
      }
    }

    // Sort: active first, then by priority, then by date
    const prioOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    const activeStatuses = new Set(["incoming", "new", "in_progress", "waiting"]);

    tasks.sort((a, b) => {
      const aActive = activeStatuses.has(a.status) ? 0 : 1;
      const bActive = activeStatuses.has(b.status) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;

      const pa = prioOrder[a.priority] ?? 2;
      const pb = prioOrder[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;

      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    res.json({ tasks });
  } catch (err) {
    console.error("[API] GET /api/tasks error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /api/teams ───
router.get("/api/teams", webAppAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const tgUser = req.webAppData!.user;
    const userId = await resolveUserId(tgUser.id);
    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const teams = await listTeamsByMemberId(userId, 50);
    const user = await getUserById(userId);
    res.json({
      teams: teams.map((t) => ({ id: t.id, name: t.name })),
      activeTeamId: user?.activeTeamId ?? null,
    });
  } catch (err) {
    console.error("[API] GET /api/teams error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /api/teams/active ───
router.post("/api/teams/active", webAppAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const tgUser = req.webAppData!.user;
    const userId = await resolveUserId(tgUser.id);
    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const teamId = typeof req.body?.teamId === "string" ? req.body.teamId.trim() : "";
    if (!teamId) {
      res.status(400).json({ error: "Missing teamId" });
      return;
    }

    const teams = await listTeamsByMemberId(userId, 50);
    if (!teams.find((t) => t.id === teamId)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    await updateUserActiveTeamId(userId, teamId);
    res.json({ ok: true, activeTeamId: teamId });
  } catch (err) {
    console.error("[API] POST /api/teams/active error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /api/projects ───
router.get("/api/projects", webAppAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const tgUser = req.webAppData!.user;
    const userId = await resolveUserId(tgUser.id);
    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const activeTeamId = await resolveActiveTeamId(userId);
    if (!activeTeamId) {
      res.json({ projects: [], activeTeamId: null });
      return;
    }

    // Ensure inbox exists for the team
    await ensureTekuchkaProject(activeTeamId);
    const projects = await listProjectsByTeamId(activeTeamId);
    const visible = projects.filter((p) => {
      const allowed = (p as any).allowedMemberIds;
      if (!allowed || !Array.isArray(allowed) || allowed.length === 0) return true;
      return allowed.includes(userId);
    });
    res.json({
      activeTeamId,
      projects: visible.map((p) => ({ id: p.id, name: p.name })),
    });
  } catch (err) {
    console.error("[API] GET /api/projects error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── GET /api/users/suggest?q=... ───
router.get("/api/users/suggest", webAppAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const tgUser = req.webAppData!.user;
    const userId = await resolveUserId(tgUser.id);
    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const q = String(req.query.q ?? "").replace(/^@/, "").trim().toLowerCase();
    if (!q) {
      res.json({ users: [] });
      return;
    }

    const teams = await listTeamsByMemberId(userId, 50);
    const memberIds = new Set<string>();
    teams.forEach((t) => (t.memberIds ?? []).forEach((id) => memberIds.add(id)));
    memberIds.add(userId); // always include self

    const members = await getUsersByIds(Array.from(memberIds));
    const users = members
      .filter((u) => u.telegramId !== -1)
      .filter((u) => (u.username ?? "").toLowerCase().startsWith(q))
      .slice(0, 10)
      .map((u) => ({ id: u.id, username: u.username, displayName: u.displayName }));

    res.json({ users });
  } catch (err) {
    console.error("[API] GET /api/users/suggest error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /api/tasks ───
router.post("/api/tasks", webAppAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const tgUser = req.webAppData!.user;
    const userId = await resolveUserId(tgUser.id);

    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const rawTitle = typeof req.body?.title === "string" ? req.body.title : "";
    const rawText = typeof req.body?.text === "string" ? req.body.text : "";
    const title = (rawTitle || rawText).trim();
    if (!title) {
      res.status(400).json({ error: "Missing title" });
      return;
    }

    const mention = extractFirstMention(title);
    let assignedUserId: string | null = null;
    if (mention) {
      const existing = await getUserByUsername(mention);
      if (existing && existing.telegramId !== -1) {
        assignedUserId = existing.id;
      } else {
        const placeholder = await upsertUserByUsername(mention);
        assignedUserId = placeholder.id;
      }
    }

    const activeTeamId = await resolveActiveTeamId(userId);
    if (!activeTeamId) {
      res.status(400).json({ error: "No active team set. Use /team or Settings to select a team." });
      return;
    }
    const projectId = activeTeamId ? await ensureTekuchkaProject(activeTeamId) : null;

    const task = await createTask({
      sourceType: "manual",
      createdByUserId: userId,
      assignedUserId,
      projectId,
      title,
      description: title,
      status: assignedUserId ? "new" : "incoming",
      priority: "normal",
      dueDate: null,
    });

    logAction({
      action: "task_created",
      userId,
      targetId: task.id,
      targetType: "task",
      payload: { source: "mini_app", assignedUserId },
    }).catch(() => {});

    res.json({ ok: true, task });
  } catch (err) {
    console.error("[API] POST /api/tasks error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /api/tasks/:id/project ───
router.post("/api/tasks/:id/project", webAppAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tgUser = req.webAppData!.user;
    const userId = await resolveUserId(tgUser.id);

    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const activeTeamId = await resolveActiveTeamId(userId);
    if (!activeTeamId) {
      res.status(400).json({ error: "No active team set" });
      return;
    }

    const projectId = typeof req.body?.projectId === "string" ? req.body.projectId : null;

    const task = await getTaskById(id);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    if (task.teamId !== activeTeamId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    if (task.createdByUserId !== userId && task.assignedUserId !== userId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    await updateTaskProject(id, projectId);
    res.json({ ok: true, projectId: projectId ?? null });
  } catch (err) {
    console.error("[API] POST /api/tasks/:id/project error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /api/tasks/:id/status ───
router.post("/api/tasks/:id/status", webAppAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const tgUser = req.webAppData!.user;
    const userId = await resolveUserId(tgUser.id);

    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const activeTeamId = await resolveActiveTeamId(userId);
    if (!activeTeamId) {
      res.status(400).json({ error: "No active team set" });
      return;
    }

    const validStatuses = ["incoming", "new", "in_progress", "waiting", "done", "cancelled"];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }

    const task = await getTaskById(id);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    if (task.teamId !== activeTeamId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    // Permission check: only owner or assignee
    if (task.createdByUserId !== userId && task.assignedUserId !== userId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    await updateTaskStatus(id, status);

    logAction({
      action: "task_status_updated",
      userId,
      targetId: id,
      targetType: "task",
      payload: { status, source: "mini_app" },
    }).catch(() => {});

    res.json({ ok: true, status });
  } catch (err) {
    console.error("[API] POST /api/tasks/:id/status error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── DELETE /api/tasks/:id ───
router.delete("/api/tasks/:id", webAppAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tgUser = req.webAppData!.user;
    const userId = await resolveUserId(tgUser.id);

    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const activeTeamId = await resolveActiveTeamId(userId);
    if (!activeTeamId) {
      res.status(400).json({ error: "No active team set" });
      return;
    }

    const task = await getTaskById(id);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    if (task.teamId !== activeTeamId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    // Permission check
    if (task.createdByUserId !== userId && task.assignedUserId !== userId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    await deleteTask(id);

    logAction({
      action: "task_deleted",
      userId,
      targetId: id,
      targetType: "task",
      payload: { source: "mini_app" },
    }).catch(() => {});

    res.json({ ok: true });
  } catch (err) {
    console.error("[API] DELETE /api/tasks/:id error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── PATCH /api/tasks/:id ───
router.patch("/api/tasks/:id", webAppAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tgUser = req.webAppData!.user;
    const userId = await resolveUserId(tgUser.id);

    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const activeTeamId = await resolveActiveTeamId(userId);
    if (!activeTeamId) {
      res.status(400).json({ error: "No active team set" });
      return;
    }

    const task = await getTaskById(id);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    if (task.teamId !== activeTeamId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    if (task.createdByUserId !== userId && task.assignedUserId !== userId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const titleRaw = typeof req.body?.title === "string" ? req.body.title.trim() : undefined;
    const dueDateRaw =
      req.body?.dueDate === null || typeof req.body?.dueDate === "string" ? req.body.dueDate : undefined;
    const priorityRaw = typeof req.body?.priority === "string" ? req.body.priority : undefined;

    const validPriorities = ["low", "normal", "high", "urgent"];
    if (priorityRaw !== undefined && !validPriorities.includes(priorityRaw)) {
      res.status(400).json({ error: "Invalid priority" });
      return;
    }

    const patch: any = {};
    if (titleRaw !== undefined) {
      patch.title = titleRaw;
      // Keep legacy description in sync for now (many flows still use description).
      patch.description = titleRaw;
    }
    if (dueDateRaw !== undefined) patch.dueDate = dueDateRaw;
    if (priorityRaw !== undefined) patch.priority = priorityRaw;

    await updateTaskFields(id, patch);

    logAction({
      action: "task_updated",
      userId,
      targetId: id,
      targetType: "task",
      payload: { patch: Object.keys(patch), source: "mini_app" },
    }).catch(() => {});

    res.json({ ok: true });
  } catch (err) {
    console.error("[API] PATCH /api/tasks/:id error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
