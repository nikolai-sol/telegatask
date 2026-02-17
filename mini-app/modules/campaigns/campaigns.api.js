import { apiFetch } from "../../core/api.js";

export async function fetchCampaigns(opts = null) {
  const includeArchived = Boolean(opts && opts.includeArchived);
  const path = includeArchived ? "/api/campaigns?includeArchived=1" : "/api/campaigns";
  return apiFetch(path);
}

export async function createCampaign(data) {
  return apiFetch("/api/campaigns", {
    method: "POST",
    body: data || {},
  });
}

export async function updateCampaign(id, patch) {
  const cid = String(id || "");
  if (!cid) throw new Error("Missing campaign id");
  return apiFetch(`/api/campaigns/${encodeURIComponent(cid)}`, {
    method: "PATCH",
    body: patch || {},
  });
}

export async function deleteCampaign(id) {
  const cid = String(id || "");
  if (!cid) throw new Error("Missing campaign id");
  return apiFetch(`/api/campaigns/${encodeURIComponent(cid)}`, {
    method: "DELETE",
  });
}
