import { apiFetch } from "../../core/api.js";

export async function fetchTasks() {
  return apiFetch("/api/tasks");
}

export async function createTask(input) {
  const payload = typeof input === "string" ? { title: input } : (input || {});
  return apiFetch("/api/tasks", { method: "POST", body: payload });
}

export async function updateTaskStatus(taskId, status) {
  return apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/status`, {
    method: "POST",
    body: { status },
  });
}

export async function deleteTask(taskId) {
  return apiFetch(`/api/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
}

export async function updateTaskFields(taskId, fields) {
  return apiFetch(`/api/tasks/${encodeURIComponent(taskId)}`, { method: "PATCH", body: fields || {} });
}

export async function updateTaskProject(taskId, projectId) {
  return apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/project`, {
    method: "POST",
    body: { projectId: projectId ?? null },
  });
}

export async function fetchProjects() {
  return apiFetch("/api/projects");
}

export async function suggestUsers(query, opts = {}) {
  const q = String(query || "").trim();
  return apiFetch(`/api/users/suggest?q=${encodeURIComponent(q)}`, { signal: opts.signal });
}
