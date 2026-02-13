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

function campaignNameById(state) {
  const list = Array.isArray(state?.campaigns) ? state.campaigns : [];
  const map = new Map();
  list.forEach((c) => {
    if (!c || !c.id) return;
    map.set(String(c.id), String(c.name || "Untitled"));
  });
  return map;
}

export function flattenCampaignGroups(tasks, state) {
  const result = [];
  const collapsed = state?.collapsedGroups || new Set();
  const nameMap = campaignNameById(state);
  const groups = new Map(); // key -> { title, tasks: [] }

  (tasks || []).forEach((t) => {
    const cid = t?.campaignId ? String(t.campaignId) : "";
    const key = cid ? `camp:${cid}` : "camp:none";
    const title = cid ? (nameMap.get(cid) || `Campaign ${cid}`) : "Без кампании";
    if (!groups.has(key)) groups.set(key, { key, title, tasks: [] });
    groups.get(key).tasks.push(t);
  });

  const entries = Array.from(groups.values());
  entries.sort((a, b) => {
    if (a.key === "camp:none") return 1;
    if (b.key === "camp:none") return -1;
    return safeLower(a.title).localeCompare(safeLower(b.title));
  });

  for (const g of entries) {
    const arr = g.tasks || [];
    if (!arr.length) continue;
    result.push({ type: "header", key: g.key, title: g.title, count: arr.length });
    if (collapsed && collapsed.has && collapsed.has(g.key)) continue;
    arr.forEach((task) => result.push({ type: "task", task }));
  }

  return result;
}

function projectNameById(state) {
  const map = new Map();
  const dict = state?.projectsById && typeof state.projectsById === "object" ? state.projectsById : {};
  Object.keys(dict || {}).forEach((id) => {
    const v = dict[id];
    if (!id) return;
    map.set(String(id), String(v?.name || `Project ${id}`));
  });
  return map;
}

export function flattenProjectGroups(tasks, state) {
  const result = [];
  const collapsed = state?.collapsedGroups || new Set();
  const nameMap = projectNameById(state);
  const groups = new Map(); // key -> { title, tasks: [] }

  (tasks || []).forEach((t) => {
    const pid = t?.projectId ? String(t.projectId) : "";
    const key = pid ? `proj:${pid}` : "proj:none";
    const title = pid ? (nameMap.get(pid) || `Project ${pid}`) : "Без проекта";
    if (!groups.has(key)) groups.set(key, { key, title, tasks: [] });
    groups.get(key).tasks.push(t);
  });

  const entries = Array.from(groups.values());
  entries.sort((a, b) => {
    if (a.key === "proj:none") return 1;
    if (b.key === "proj:none") return -1;
    return safeLower(a.title).localeCompare(safeLower(b.title));
  });

  for (const g of entries) {
    const arr = g.tasks || [];
    if (!arr.length) continue;
    result.push({ type: "header", key: g.key, title: g.title, count: arr.length });
    if (collapsed && collapsed.has && collapsed.has(g.key)) continue;
    arr.forEach((task) => result.push({ type: "task", task }));
  }

  return result;
}

export function selectVisibleItems(state) {
  const base = selectTasksByTab(state);
  const filtered = applyFilters(base, state);
  const sorted = sortTasks(filtered);
  const scope = String(state?.tasksScope || "my").trim().toLowerCase() || "my";
  if (scope === "team") {
    const groupBy = String(state?.teamGroupBy || "campaign").trim().toLowerCase() || "campaign";
    return groupBy === "project" ? flattenProjectGroups(sorted, state) : flattenCampaignGroups(sorted, state);
  }
  return flattenGroupedTasks(sorted, state);
}

export function selectEmptyStateText(state) {
  const anyFilter =
    String(state?.query || "").trim().length > 0 ||
    Object.values(state?.filters || {}).some(Boolean);
  if (anyFilter) return "Ничего не найдено";
  if (String(state?.tasksScope || "my") === "team") return "Нет задач в команде";
  if ((state?.tab || "active") === "active") return "Нет активных задач 🎉";
  if (state?.tab === "done") return "Нет выполненных задач";
  return "Пока задач нет";
}
