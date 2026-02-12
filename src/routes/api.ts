/**
 * REST API for Telegram Mini App
 * All routes require valid Telegram WebApp initData
 */
import { Router, Request, Response } from "express";
import { webAppAuthMiddleware } from "../middleware/validateWebApp";
import {
  getTasksByAssignee,
  getTasksByCreator,
  getTaskById,
  updateTaskStatus,
  deleteTask,
} from "../repositories/taskRepository";
import { getUserByTelegramId } from "../repositories/userRepository";
import { logAction } from "../repositories/actionLogRepository";

const router = Router();

/** Resolve internal userId from Telegram id */
async function resolveUserId(telegramId: number): Promise<string | null> {
  const user = await getUserByTelegramId(telegramId);
  return user?.id ?? null;
}

// ─── GET /api/tasks ───
router.get("/api/tasks", webAppAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const tgUser = req.webAppData!.user;
    const userId = await resolveUserId(tgUser.id);

    if (!userId) {
      res.status(404).json({ error: "User not found. Send /start to the bot first." });
      return;
    }

    // Fetch tasks where user is assignee or creator (all statuses for Mini App)
    const allStatuses: Array<"incoming" | "new" | "in_progress" | "waiting" | "done" | "cancelled"> =
      ["incoming", "new", "in_progress", "waiting", "done", "cancelled"];
    const [assigned, created] = await Promise.all([
      getTasksByAssignee(userId, allStatuses),
      getTasksByCreator(userId, allStatuses),
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

    const task = await getTaskById(id);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
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

export default router;
