import { getState, setState } from "../../core/store.js";
import * as api from "./tasks.api.js";
import { showToast } from "../shared/toast.js";
import { fetchCampaigns } from "../campaigns/campaigns.api.js";

const tg = window.Telegram?.WebApp;

function haptic(kind) {
  try {
    tg?.HapticFeedback?.impactOccurred?.(kind);
  } catch {
    // ignore
  }
}

function getTasks() {
  const s = getState() || {};
  return Array.isArray(s.tasks) ? s.tasks : [];
}

function setTasks(tasks) {
  setState({ tasks });
}

const inFlight = new Map(); // taskId -> true

export function cleanupTasksActions() {
  if (pendingDelete) {
    clearTimeout(pendingDelete.timerId);
    pendingDelete = null;
  }
  inFlight.clear();
}

export async function loadTasks(opts = {}) {
  const scope = String(opts?.scope || (getState() || {}).tasksScope || "my").trim().toLowerCase() || "my";
  setState({ loading: true, tasksScope: scope });
  try {
    const data = await api.fetchTasks({ scope });
    const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
    const activeTeamRole = data?.activeTeamRole || null;
    const usersById = (data && typeof data === "object" && data.usersById && typeof data.usersById === "object")
      ? data.usersById
      : {};
    const projectsById = (data && typeof data === "object" && data.projectsById && typeof data.projectsById === "object")
      ? data.projectsById
      : {};
    setState({ tasks, usersById, projectsById, activeTeamRole, loading: false, tasksScope: data?.scope || scope });

    // In Team scope, preload campaign names for grouping.
    if ((data?.scope || scope) === "team") {
      fetchCampaigns()
        .then((res) => {
          const campaigns = Array.isArray(res?.campaigns) ? res.campaigns : [];
          setState({ campaigns });
        })
        .catch(() => {});
    }
  } catch (err) {
    if (err?.status === 403 && scope === "team") {
      // Fallback to "my" if user has no permission.
      showToast("Нет доступа к задачам команды");
      setState({ tasksScope: "my" });
      try {
        const data = await api.fetchTasks({ scope: "my" });
        setState({
          tasks: Array.isArray(data?.tasks) ? data.tasks : [],
          usersById: (data && typeof data === "object" && data.usersById && typeof data.usersById === "object") ? data.usersById : {},
          projectsById: (data && typeof data === "object" && data.projectsById && typeof data.projectsById === "object") ? data.projectsById : {},
          activeTeamRole: data?.activeTeamRole || null,
          loading: false,
          tasksScope: "my",
        });
        return;
      } catch {
        // continue to error state in UI
      }
    }
    setState({ loading: false });
    throw err;
  }
}

export async function toggleDone(taskId) {
  if (!taskId) return;
  if (inFlight.has(taskId)) return;
  inFlight.set(taskId, true);

  const prevTasks = getTasks();
  const task = prevTasks.find((t) => t.id === taskId);
  if (!task) {
    inFlight.delete(taskId);
    return;
  }

  const prevStatus = task.status;
  const nextStatus = prevStatus === "done" ? "incoming" : "done";
  const nextTasks = prevTasks.map((t) => (t.id === taskId ? { ...t, status: nextStatus } : t));
  haptic("light");
  setTasks(nextTasks);

  try {
    await api.updateTaskStatus(taskId, nextStatus);
    showToast("Сохранено");
  } catch (err) {
    const rolled = prevTasks.map((t) => (t.id === taskId ? { ...t, status: prevStatus } : t));
    setTasks(rolled);
    showToast("Ошибка, попробуйте ещё раз");
  } finally {
    inFlight.delete(taskId);
  }
}

let pendingDelete = null; // { kind, tasks: any[], timerId }

async function finalizeDelete(taskId) {
  if (!taskId) return;
  if (inFlight.has(taskId)) return;
  inFlight.set(taskId, true);
  try {
    await api.deleteTask(taskId);
  } catch {
    showToast("Ошибка удаления");
    // Best-effort resync
    try {
      await loadTasks();
    } catch {
      // ignore
    }
  } finally {
    inFlight.delete(taskId);
  }
}

export function deleteTask(taskId, opts = { withUndo: true }) {
  const withUndo = opts?.withUndo !== false;
  const prevTasks = getTasks();
  const task = prevTasks.find((t) => t.id === taskId);
  if (!task) return;

  // If there is a pending delete, finalize it (best-effort).
  if (pendingDelete) {
    clearTimeout(pendingDelete.timerId);
    pendingDelete.tasks.forEach((t) => finalizeDelete(t.id));
    pendingDelete = null;
  }

  const nextTasks = prevTasks.filter((t) => t.id !== taskId);
  haptic("medium");
  setTasks(nextTasks);

  if (!withUndo) {
    finalizeDelete(taskId);
    showToast("Удалено");
    return;
  }

  const timerId = setTimeout(() => {
    if (!pendingDelete || pendingDelete.kind !== "single") return;
    if (pendingDelete.tasks[0]?.id !== taskId) return;
    pendingDelete = null;
    finalizeDelete(taskId);
  }, 5000);

  pendingDelete = { kind: "single", tasks: [task], timerId };

  showToast("Удалено", {
    actionLabel: "Undo",
    durationMs: 5000,
    onAction: () => {
      if (!pendingDelete || pendingDelete.kind !== "single") return;
      if (pendingDelete.tasks[0]?.id !== taskId) return;
      clearTimeout(pendingDelete.timerId);
      const restored = pendingDelete.tasks[0];
      pendingDelete = null;
      setTasks([restored, ...getTasks()]);
      showToast("Отменено");
    },
  });
}

export function bulkDelete(taskIds) {
  const ids = Array.isArray(taskIds) ? taskIds.filter(Boolean) : [];
  if (!ids.length) return;
  const idSet = new Set(ids);

  if (pendingDelete) {
    clearTimeout(pendingDelete.timerId);
    pendingDelete.tasks.forEach((t) => finalizeDelete(t.id));
    pendingDelete = null;
  }

  const prevTasks = getTasks();
  const removed = prevTasks.filter((t) => idSet.has(t.id));
  if (!removed.length) return;

  const nextTasks = prevTasks.filter((t) => !idSet.has(t.id));
  haptic("medium");
  setTasks(nextTasks);

  const timerId = setTimeout(() => {
    if (!pendingDelete || pendingDelete.kind !== "bulk") return;
    pendingDelete = null;
    removed.forEach((t) => finalizeDelete(t.id));
  }, 5000);

  pendingDelete = { kind: "bulk", tasks: removed, timerId };

  showToast("Удалено", {
    actionLabel: "Undo",
    durationMs: 5000,
    onAction: () => {
      if (!pendingDelete || pendingDelete.kind !== "bulk") return;
      clearTimeout(pendingDelete.timerId);
      pendingDelete = null;
      setTasks([...removed, ...getTasks()]);
      showToast("Отменено");
    },
  });
}

export async function quickAdd(title, { campaignId = null } = {}) {
  const t = String(title || "").trim();
  if (!t) return;

  const tempId = `tmp-${Date.now()}`;
  const tempTask = {
    id: tempId,
    title: t,
    description: t,
    campaignId: campaignId ?? null,
    status: "new",
    priority: "normal",
    createdAt: new Date().toISOString(),
  };

  const prevTasks = getTasks();
  haptic("light");
  setState({ tab: "active", tasks: [tempTask, ...prevTasks] });

  try {
    const data = await api.createTask({ title: t, campaignId: campaignId ?? null }).catch(() => null);
    const created = data?.task && data.task.id ? data.task : null;
    if (!created) {
      await loadTasks();
      showToast("Сохранено");
      return;
    }
    const after = getTasks();
    const replaced = after.map((x) => (x.id === tempId ? created : x));
    setTasks(replaced);
    showToast("Сохранено");
  } catch {
    const after = getTasks();
    setTasks(after.filter((x) => x.id !== tempId));
    showToast("Ошибка, попробуйте ещё раз");
  }
}

export async function bulkDone(taskIds) {
  const ids = Array.isArray(taskIds) ? taskIds.filter(Boolean) : [];
  if (!ids.length) return;
  const idSet = new Set(ids);

  const prevTasks = getTasks();
  const prevStatus = new Map();
  prevTasks.forEach((t) => {
    if (idSet.has(t.id)) prevStatus.set(t.id, t.status);
  });

  haptic("light");
  showToast("Сохранено");

  const nextTasks = prevTasks.map((t) => (idSet.has(t.id) ? { ...t, status: "done" } : t));
  setTasks(nextTasks);

  const failures = [];
  for (const id of ids) {
    if (inFlight.has(id)) continue;
    inFlight.set(id, true);
    try {
      await api.updateTaskStatus(id, "done");
    } catch {
      failures.push(id);
    } finally {
      inFlight.delete(id);
    }
  }

  if (failures.length) {
    const after = getTasks();
    const failSet = new Set(failures);
    const rolled = after.map((t) => (failSet.has(t.id) ? { ...t, status: prevStatus.get(t.id) ?? t.status } : t));
    setTasks(rolled);
    showToast("Ошибка, попробуйте ещё раз");
  }
}

export async function updateTask(taskId, patch, opts = {}) {
  if (!taskId) return;
  const sync = opts?.sync !== false;
  if (sync) {
    if (inFlight.has(taskId)) return;
    inFlight.set(taskId, true);
  }

  const prevTasks = getTasks();
  const prev = prevTasks.find((t) => t.id === taskId);
  if (!prev) {
    if (sync) inFlight.delete(taskId);
    return;
  }

  const merged = { ...prev, ...(patch || {}) };
  const nextTasks = prevTasks.map((t) => (t.id === taskId ? merged : t));
  setTasks(nextTasks);

  if (!sync) return;

  try {
    await api.updateTaskFields(taskId, patch || {});
    haptic("light");
  } catch {
    showToast("Ошибка, попробуйте ещё раз");
    try {
      await loadTasks();
    } catch {
      // ignore
    }
  } finally {
    inFlight.delete(taskId);
  }
}

export async function moveProject(taskIds, projectId) {
  const ids = Array.isArray(taskIds) ? taskIds.filter(Boolean) : [];
  if (!ids.length) return;
  const idSet = new Set(ids);

  const prevTasks = getTasks();
  const prevProject = new Map();
  prevTasks.forEach((t) => {
    if (idSet.has(t.id)) prevProject.set(t.id, t.projectId ?? null);
  });

  const nextTasks = prevTasks.map((t) => (idSet.has(t.id) ? { ...t, projectId: projectId ?? null } : t));
  setTasks(nextTasks);
  showToast("Сохранено");

  const failures = [];
  for (const id of ids) {
    try {
      await api.updateTaskProject(id, projectId ?? null);
    } catch {
      failures.push(id);
    }
  }

  if (failures.length) {
    const after = getTasks();
    const failSet = new Set(failures);
    const rolled = after.map((t) => (failSet.has(t.id) ? { ...t, projectId: prevProject.get(t.id) ?? null } : t));
    setTasks(rolled);
    showToast("Ошибка, попробуйте ещё раз");
  }
}
