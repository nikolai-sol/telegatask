import { initStore, getState, setState, subscribe } from "../../core/store.js";
import { mountBottomNav } from "../shared/bottomNav.js";
import * as actions from "./campaigns.actions.js";
import * as selectors from "./campaigns.selectors.js";
import { renderCampaignList } from "./campaigns.ui.js";

const initialState = {
  campaigns: [],
  campaignsLoading: false,
  activeTeamId: null,
};

function ensureCampaignsState() {
  const s = getState();
  if (!s) {
    initStore({ ...initialState });
    return;
  }
  const patch = {};
  for (const [k, v] of Object.entries(initialState)) {
    if (s[k] === undefined) patch[k] = v;
  }
  if (Object.keys(patch).length) setState(patch);
}

function markup() {
  return `
    <div class="app-shell">
      <header class="app-header">
        <div>
          <p class="app-header__eyebrow">Telegatask</p>
          <h1 class="app-header__title">Campaigns</h1>
        </div>
        <button id="addCampaignBtn" class="icon-btn" type="button" aria-label="Создать">＋</button>
      </header>

      <main>
        <div id="campaignList"></div>
      </main>
    </div>

    <div id="toast" class="toast" hidden></div>
  `;
}

export function mountCampaigns(root) {
  if (!(root instanceof HTMLElement)) return null;

  ensureCampaignsState();
  root.innerHTML = markup();

  const unmountNav = mountBottomNav(root, "campaigns");

  const ctrl = new AbortController();
  let lastActiveTeamId = (getState() || {}).activeTeamId ?? null;

  function render() {
    const s = getState() || {};
    const campaigns = selectors.selectCampaigns(s);
    const loading = Boolean(s.campaignsLoading);
    renderCampaignList(root, campaigns, { loading });
  }

  const unsub = subscribe(() => {
    const s = getState() || {};
    const activeTeamId = s.activeTeamId ?? null;
    // If active team changed while staying on the page: clear + reload.
    if (activeTeamId !== lastActiveTeamId) {
      lastActiveTeamId = activeTeamId;
      setState({ campaigns: [] });
      actions.loadCampaigns().catch(() => {});
      return;
    }
    render();
  });

  root.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;

    const addBtn = target.closest("#addCampaignBtn");
    if (addBtn) {
      const name = prompt("Название кампании:");
      Promise.resolve()
        .then(() => actions.createDraftCampaign(name))
        .then((created) => {
          if (created?.id) window.location.hash = `#/campaigns/${created.id}`;
        })
        .catch(() => {});
      return;
    }

    const card = target.closest("[data-campaign-id]");
    if (card instanceof HTMLElement) {
      const id = card.dataset.campaignId;
      if (id) window.location.hash = `#/campaigns/${id}`;
    }
  }, { signal: ctrl.signal });

  actions.loadCampaigns().catch(() => {});
  render();

  return () => {
    try { ctrl.abort(); } catch {}
    try { unsub && unsub(); } catch {}
    try { unmountNav && unmountNav(); } catch {}
    root.innerHTML = "";
  };
}
