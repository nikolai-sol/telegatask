import { getState } from "../../core/store.js";
import { selectCampaignById } from "./campaigns.selectors.js";
import { mountBottomNav } from "../shared/bottomNav.js";

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function mountCampaignDetails(root, ctx = {}) {
  if (!(root instanceof HTMLElement)) return null;
  const id = ctx?.params?.id || "";

  const s = getState() || {};
  const campaign = selectCampaignById(s, id);

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
          campaign
            ? `
              <section class="campaign-details">
                <div class="campaign-details__name">${escapeHtml(campaign.name || "Untitled")}</div>
                <div class="campaign-details__row"><span class="campaign-details__k">Client</span><span class="campaign-details__v">${escapeHtml(campaign.client || "—")}</span></div>
                <div class="campaign-details__row"><span class="campaign-details__k">Status</span><span class="campaign-details__v">${escapeHtml(campaign.status || "draft")}</span></div>
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

  const unmountNav = mountBottomNav(root, "campaigns");

  const onBack = () => {
    window.location.hash = "#/campaigns";
  };
  const backBtn = root.querySelector("#campaignBack");
  if (backBtn instanceof HTMLElement) backBtn.addEventListener("click", onBack);

  return () => {
    if (backBtn instanceof HTMLElement) backBtn.removeEventListener("click", onBack);
    try { unmountNav && unmountNav(); } catch {}
    root.innerHTML = "";
  };
}

