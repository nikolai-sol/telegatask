import { apiFetch } from "../../core/api.js";

export async function fetchSeoDashboard() {
  return apiFetch("/api/ai/seo/dashboard");
}

export async function saveSeoConfig(companyId, domain) {
  return apiFetch(`/api/companies/${encodeURIComponent(companyId)}/seo-config`, {
    method: "POST",
    body: { domain },
  });
}

export async function startSeoAnalysis(companyId) {
  return apiFetch("/api/ai/seo/analyze", {
    method: "POST",
    body: { companyId, mode: "quick_audit", sources: ["crawler", "pagespeed", "gsc"] },
  });
}

export async function approveSeoDraftTasks(runId, draftTaskIds) {
  return apiFetch(`/api/ai/seo/runs/${encodeURIComponent(runId)}/recommended-tasks/approve`, {
    method: "POST",
    body: { draftTaskIds },
  });
}

export async function rejectSeoDraftTasks(runId, draftTaskIds) {
  return apiFetch(`/api/ai/seo/runs/${encodeURIComponent(runId)}/recommended-tasks/reject`, {
    method: "POST",
    body: { draftTaskIds },
  });
}
