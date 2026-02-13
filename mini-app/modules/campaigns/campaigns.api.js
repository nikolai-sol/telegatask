import { apiFetch } from "../../core/api.js";

export async function fetchCampaigns() {
  return apiFetch("/api/campaigns");
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
