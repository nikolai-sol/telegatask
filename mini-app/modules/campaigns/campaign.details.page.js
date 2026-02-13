import { initStore, getState, setState, subscribe } from "../../core/store.js";
import { selectCampaignById } from "./campaigns.selectors.js";
import { mountBottomNav } from "../shared/bottomNav.js";
import { loadCampaigns } from "./campaigns.actions.js";
import { loadTasks, quickAdd } from "../tasks/tasks.actions.js";
import { showToast } from "../shared/toast.js";

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

function selectTasksByCampaign(state, campaignId) {
  const s = state || {};
  const list = Array.isArray(s.tasks) ? s.tasks : [];
  const cid = String(campaignId || "");
  if (!cid) return [];
  return list.filter((t) => (t?.campaignId || null) === cid);
}

export function mountCampaignDetails(root, ctx = {}) {
  if (!(root instanceof HTMLElement)) return null;
  const id = ctx?.params?.id || "";

  const s0 = getState();
  if (!s0) {
    initStore({ campaigns: [], campaignsLoading: false, activeTeamId: null });
  }
  // Ensure minimal task slice exists (Tasks page will patch full state later).
  const sBoot = getState() || {};
  const patch = {};
  if (sBoot.tasks === undefined) patch.tasks = [];
  if (sBoot.loading === undefined) patch.loading = false;
  if (Object.keys(patch).length) setState(patch);

  const ctrl = new AbortController();

  function render() {
    const s = getState() || {};
    const campaign = selectCampaignById(s, id);
    const loading = Boolean(s.campaignsLoading) && !campaign;
    const tasksLoading = Boolean(s.loading);
    const tasks = selectTasksByCampaign(s, id);

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

                  <section class="settings-card campaign-tasks">
                    <div class="settings-card__title">Tasks in this campaign</div>
                    <div class="quick-add campaign-tasks__add">
                      <input id="campaignTaskInput" class="quick-add__input" type="text" placeholder="Добавить задачу в кампанию" maxlength="280" autocomplete="off">
                      <button id="campaignTaskAdd" class="quick-add__submit" type="button">Добавить</button>
                    </div>

                    ${
                      tasksLoading
                        ? `
                          <div class="campaign-tasks__skeleton">
                            <div class="skeleton-card"></div>
                            <div class="skeleton-card"></div>
                          </div>
                        `
                        : tasks.length
                          ? `
                            <div class="campaign-list campaign-tasks__list">
                              ${tasks.map((t) => `
                                <button class="campaign-card" type="button" data-task-id="${escapeHtml(t.id)}">
                                  <div class="campaign-card__top">
                                    <div class="campaign-card__name ${t.status === "done" ? "campaign-task--done" : ""}">${escapeHtml(t.title || t.description || "Untitled")}</div>
                                    <span class="chip">${escapeHtml(t.status || "")}</span>
                                  </div>
                                </button>
                              `).join("")}
                            </div>
                          `
                          : `
                            <section class="state state--empty campaign-tasks__empty">
                              <p class="state__icon">✅</p>
                              <p class="state__text">Пока нет задач</p>
                            </section>
                          `
                    }
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

      <div id="toast" class="toast" hidden></div>
    `;

    const backBtn = root.querySelector("#campaignBack");
    if (backBtn instanceof HTMLElement) {
      backBtn.onclick = () => {
        window.location.hash = "#/campaigns";
      };
    }

    const addBtn = root.querySelector("#campaignTaskAdd");
    const input = root.querySelector("#campaignTaskInput");
    if (addBtn instanceof HTMLElement && input instanceof HTMLInputElement) {
      addBtn.onclick = async () => {
        const title = String(input.value || "").trim();
        if (!title) return;
        input.value = "";
        try {
          await quickAdd(title, { campaignId: id });
        } catch (e) {
          showToast(e?.message || "Не удалось создать задачу");
        }
      };
      input.onkeydown = async (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          addBtn.click();
        }
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

  // Load tasks for current active team; Campaign tasks are filtered client-side by campaignId.
  loadTasks().catch(() => {});

  render();

  return () => {
    try { ctrl.abort(); } catch {}
    try { unsub && unsub(); } catch {}
    try { unmountNav && unmountNav(); } catch {}
    root.innerHTML = "";
  };
}
