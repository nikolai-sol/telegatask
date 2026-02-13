import { initStore, getState, setState, subscribe } from "../../core/store.js";
import { selectCampaignById } from "./campaigns.selectors.js";
import { mountBottomNav } from "../shared/bottomNav.js";
import { loadCampaigns } from "./campaigns.actions.js";

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function fmtCreatedAt(v) {
  const n = Number(v);
  const d = Number.isFinite(n) ? new Date(n) : new Date(String(v || ""));
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(d);
  } catch {
    return d.toISOString();
  }
}

export function mountCampaignDetails(root, ctx = {}) {
  if (!(root instanceof HTMLElement)) return null;
  const id = ctx?.params?.id || "";

  const s0 = getState();
  if (!s0) {
    initStore({ campaigns: [], campaignsLoading: false, activeTeamId: null });
  }

  const ctrl = new AbortController();

  function render() {
    const s = getState() || {};
    const campaign = selectCampaignById(s, id);
    const loading = Boolean(s.campaignsLoading) && !campaign;

    root.innerHTML = `
      <div class="app-shell">
        <header class="app-header">
          <div>
            <p class="app-header__eyebrow">Telegatask</p>
            <h1 class="app-header__title">Campaign</h1>
          </div>
          <button id="campaignBack" class="icon-btn" type="button" aria-label="Back">←</button>
        </header>

        <main>
          ${
            loading
              ? `
                <section class="state state--loading">
                  <div class="skeleton-card"></div>
                  <div class="skeleton-card"></div>
                </section>
              `
              : campaign
                ? `
                  <section class="campaign-details">
                    <div class="campaign-details__name">${escapeHtml(campaign.name || "Untitled")}</div>
                    <div class="campaign-details__row"><span class="campaign-details__k">Status</span><span class="campaign-details__v">${escapeHtml(campaign.status || "draft")}</span></div>
                    <div class="campaign-details__row"><span class="campaign-details__k">Created</span><span class="campaign-details__v">${escapeHtml(fmtCreatedAt(campaign.createdAt))}</span></div>
                    <div class="campaign-details__row"><span class="campaign-details__k">Created by</span><span class="campaign-details__v">${escapeHtml(campaign.createdByUserId || "—")}</span></div>
                  </section>
                `
                : `
                  <section class="state state--empty">
                    <p class="state__icon">🕵️</p>
                    <p class="state__text">Кампания не найдена</p>
                  </section>
                `
          }
        </main>
      </div>
    `;

    const backBtn = root.querySelector("#campaignBack");
    if (backBtn instanceof HTMLElement) {
      backBtn.onclick = () => {
        window.location.hash = "#/campaigns";
      };
    }
  }

  const unmountNav = mountBottomNav(root, "campaigns");
  const unsub = subscribe(() => render());

  // If deep-linked, state might not have campaigns yet.
  const s1 = getState() || {};
  const existing = selectCampaignById(s1, id);
  if (!existing) {
    setState({ campaignsLoading: true });
    loadCampaigns().catch(() => {}).finally(() => {
      setState({ campaignsLoading: false });
    });
  }

  render();

  return () => {
    try { ctrl.abort(); } catch {}
    try { unsub && unsub(); } catch {}
    try { unmountNav && unmountNav(); } catch {}
    root.innerHTML = "";
  };
}
