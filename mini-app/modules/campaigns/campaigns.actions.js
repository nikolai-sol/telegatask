import { getState, setState } from "../../core/store.js";
import * as api from "./campaigns.api.js";
import { showToast } from "../shared/toast.js";

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
    const campaigns = Array.isArray(res?.campaigns) ? res.campaigns : [];
    // Keep global state in sync with backend context.
    if (res && typeof res === "object" && "activeTeamId" in res) {
      setState({ activeTeamId: res.activeTeamId ?? null });
    }
    setCampaigns(campaigns);
  } catch (e) {
    showToast(e?.message || "Failed to load campaigns");
    setCampaigns([]);
  } finally {
    setState({ campaignsLoading: false });
  }
}

export async function createDraftCampaign(name) {
  const n = String(name || "").trim();
  if (!n) return null;
  try {
    const created = await api.createCampaign({ name: n });
    if (!created || !created.id) throw new Error("Campaign create failed");
    setCampaigns([created, ...getCampaigns()]);
    showToast("Campaign created");
    return created;
  } catch (e) {
    const status = e?.status;
    if (status === 403) {
      showToast("Нет прав создавать кампании");
      return null;
    }
    showToast(e?.message || "Failed to create campaign");
    return null;
  }
}
