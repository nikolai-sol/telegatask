function safeLower(s) {
  return String(s || "").toLowerCase();
}

export function selectTasksByTab(state) {
  const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
  const tab = state?.tab || "active";
  const activeStatuses = ["incoming", "new", "in_progress", "waiting"];

  if (tab === "active") return tasks.filter((t) => activeStatuses.includes(t.status));
  if (tab === "done") return tasks.filter((t) => t.status === "done" || t.status === "cancelled");
  return [...tasks];
}

export function computeDueTag(dueDate) {
  if (!dueDate) return "none";
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return "none";
  const now = new Date();
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (dueDay.getTime() < nowDay.getTime()) return "overdue";
  if (dueDay.getTime() === nowDay.getTime()) return "today";
  return "future";
}

export function applyFilters(tasks, state) {
  let out = [...(tasks || [])];

  const query = safeLower((state?.query || "").trim());
  if (query) {
    out = out.filter((t) => {
      const hay = safeLower(t.title || t.description || "");
      return hay.includes(query);
    });
  }

  const f = state?.filters || { today: false, overdue: false, p1: false, nodue: false };
  if (f.p1) out = out.filter((t) => (t.priority || "normal") === "urgent");
  if (f.nodue) out = out.filter((t) => !t.dueDate);

  if (f.today || f.overdue) {
    out = out.filter((t) => {
      const tag = computeDueTag(t.dueDate);
      if (f.today && tag !== "today") return false;
      if (f.overdue && tag !== "overdue") return false;
      return true;
    });
  }

  return out;
}

export function sortTasks(tasks) {
  const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
  return [...(tasks || [])].sort((a, b) => {
    const pa = priorityOrder[a.priority] ?? 2;
    const pb = priorityOrder[b.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export function groupTasks(tasks) {
  const groups = { overdue: [], today: [], tomorrow: [], upcoming: [], nodue: [] };
  const now = new Date();
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  (tasks || []).forEach((task) => {
    const dueAt = task.dueDate;
    if (!dueAt) {
      groups.nodue.push(task);
      return;
    }

    const due = new Date(dueAt);
    if (Number.isNaN(due.getTime())) {
      groups.nodue.push(task);
      return;
    }

    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
    const diff = dueDay - nowDay;

    if (diff < 0) groups.overdue.push(task);
    else if (diff === 0) groups.today.push(task);
    else if (diff === 86400000) groups.tomorrow.push(task);
    else groups.upcoming.push(task);
  });

  return groups;
}

export function flattenGroupedTasks(tasks, state) {
  const groups = groupTasks(tasks);
  const result = [];
  const collapsed = state?.collapsedGroups || new Set();

  function pushGroup(key, title) {
    const arr = groups[key] || [];
    if (!arr.length) return;
    result.push({ type: "header", key, title, count: arr.length });
    if (collapsed && collapsed.has && collapsed.has(key)) return;
    arr.forEach((task) => result.push({ type: "task", task }));
  }

  pushGroup("overdue", "Просрочено");
  pushGroup("today", "Сегодня");
  pushGroup("tomorrow", "Завтра");
  pushGroup("upcoming", "Позже");
  pushGroup("nodue", "Без даты");

  return result;
}

export function selectVisibleItems(state) {
  const base = selectTasksByTab(state);
  const filtered = applyFilters(base, state);
  const sorted = sortTasks(filtered);
  return flattenGroupedTasks(sorted, state);
}

export function selectEmptyStateText(state) {
  const anyFilter =
    String(state?.query || "").trim().length > 0 ||
    Object.values(state?.filters || {}).some(Boolean);
  if (anyFilter) return "Ничего не найдено";
  if ((state?.tab || "active") === "active") return "Нет активных задач 🎉";
  if (state?.tab === "done") return "Нет выполненных задач";
  return "Пока задач нет";
}

