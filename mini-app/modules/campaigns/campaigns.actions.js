import { getState, setState } from "../../core/store.js";
import * as api from "./campaigns.api.js";

function getCampaigns() {
  const s = getState() || {};
  return Array.isArray(s.campaigns) ? s.campaigns : [];
}

function setCampaigns(list) {
  setState({ campaigns: list });
}

export async function loadCampaigns() {
  setState({ campaignsLoading: true });
  try {
    const res = await api.fetchCampaigns();
    setCampaigns(Array.isArray(res) ? res : []);
  } finally {
    setState({ campaignsLoading: false });
  }
}

export function createCampaign(name) {
  const n = String(name || "").trim();
  if (!n) return null;

  const campaign = {
    id: `cmp-${Date.now()}`,
    name: n,
    client: "",
    status: "draft",
    startDate: null,
    endDate: null,
    budgetPlanned: null,
    budgetSpentManual: null,
    createdAt: new Date().toISOString(),
  };

  const next = [campaign, ...getCampaigns()];
  setCampaigns(next);
  return campaign;
}

