import { initStore, getState, setState, subscribe } from "../../core/store.js";
import { selectCampaignById } from "./campaigns.selectors.js";
import { mountBottomNav } from "../shared/bottomNav.js";
import { loadCampaigns } from "./campaigns.actions.js";
import { loadTasks, quickAdd } from "../tasks/tasks.actions.js";
import { showToast } from "../shared/toast.js";
import { updateCampaign } from "./campaigns.api.js";

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

  let financeEditing = false;
  let financeDraft = null; // { plannedBudget, spent, currency }

  const s0 = getState();
  if (!s0) {
    initStore({ campaigns: [], campaignsLoading: false, activeTeamId: null });
  }
  // Ensure minimal task slice exists (Tasks page will patch full state later).
  const sBoot = getState() || {};
  const patch = {};
  if (sBoot.tasks === undefined) patch.tasks = [];
  if (sBoot.loading === undefined) patch.loading = false;
  if (sBoot.campaignTab === undefined) patch.campaignTab = "overview";
  if (Object.keys(patch).length) setState(patch);

  const ctrl = new AbortController(); // reserved for future delegated handlers

  function fmtMoney(amount, currency) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return "—";
    const cur = String(currency || "EUR").toUpperCase();
    try {
      return new Intl.NumberFormat("ru-RU", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n);
    } catch {
      return `${n} ${cur}`;
    }
  }

  function render() {
    const s = getState() || {};
    const campaign = selectCampaignById(s, id);
    const loading = Boolean(s.campaignsLoading) && !campaign;
    const tasksLoading = Boolean(s.loading);
    const tasks = selectTasksByCampaign(s, id);
    const role = String(s.activeTeamRole || "").trim().toLowerCase();
    const isViewer = role === "viewer";
    const canEditFinance = role === "owner" || role === "account";
    const canSeeFinance = !isViewer;
    const tabRaw = String(s.campaignTab || "overview").trim().toLowerCase();
    const campaignTab =
      tabRaw === "overview" || tabRaw === "tasks" || tabRaw === "finance" || tabRaw === "team"
        ? tabRaw
        : "overview";
    const effectiveTab = (!canSeeFinance && campaignTab === "finance") ? "overview" : campaignTab;

    if (financeEditing && !canEditFinance) {
      financeEditing = false;
      financeDraft = null;
    }

    const plannedBudget =
      campaign && typeof campaign.plannedBudget === "number" ? campaign.plannedBudget : null;
    const spent =
      campaign && typeof campaign.spent === "number" ? campaign.spent : 0;
    const currency =
      campaign && typeof campaign.currency === "string" && campaign.currency.trim()
        ? campaign.currency.trim().toUpperCase()
        : "EUR";
    const remaining =
      plannedBudget === null ? null : Math.max(0, plannedBudget - (Number.isFinite(spent) ? spent : 0));
    const progress =
      plannedBudget && plannedBudget > 0 ? Math.max(0, Math.min(1, spent / plannedBudget)) : 0;
    const isOverBudget =
      plannedBudget !== null && Number.isFinite(spent) && spent >= plannedBudget;

    const draft = financeDraft || { plannedBudget, spent, currency };
    const draftPlanned = draft.plannedBudget === null ? null : Number(draft.plannedBudget);
    const draftSpent = Number.isFinite(Number(draft.spent)) ? Number(draft.spent) : 0;
    const draftCurrency = String(draft.currency || currency || "EUR").toUpperCase();
    const draftRemaining = draftPlanned === null ? null : Math.max(0, draftPlanned - draftSpent);
    const draftProgress = draftPlanned && draftPlanned > 0 ? Math.max(0, Math.min(1, draftSpent / draftPlanned)) : 0;

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
                  ${isOverBudget ? `<div class="campaign-warning">Budget exceeded</div>` : ""}
                  <section class="campaign-details">
                    <div class="campaign-details__name">${escapeHtml(campaign.name || "Untitled")}</div>
                    <div class="campaign-details__row"><span class="campaign-details__k">Status</span><span class="campaign-details__v">${escapeHtml(campaign.status || "draft")}</span></div>
                    <div class="campaign-details__row"><span class="campaign-details__k">Created</span><span class="campaign-details__v">${escapeHtml(fmtCreatedAt(campaign.createdAt))}</span></div>
                    <div class="campaign-details__row"><span class="campaign-details__k">Created by</span><span class="campaign-details__v">${escapeHtml(campaign.createdByUserId || "—")}</span></div>
                  </section>

                  <nav class="campaign-tabs" aria-label="Campaign lifecycle">
                    <button class="campaign-tab ${effectiveTab === "overview" ? "active" : ""}" type="button" data-campaign-tab="overview">Overview</button>
                    <button class="campaign-tab ${effectiveTab === "tasks" ? "active" : ""}" type="button" data-campaign-tab="tasks">Tasks</button>
                    ${canSeeFinance ? `<button class="campaign-tab ${effectiveTab === "finance" ? "active" : ""}" type="button" data-campaign-tab="finance">Finance</button>` : ""}
                    <button class="campaign-tab ${effectiveTab === "team" ? "active" : ""}" type="button" data-campaign-tab="team">Team</button>
                  </nav>

                  ${
                    effectiveTab === "overview"
                      ? `
                        <section class="settings-card">
                          <div class="settings-card__title">Overview</div>
                          <div class="campaign-actions">
                            <button id="campaignEditBtn" class="btn btn--ghost" type="button">Edit name/status</button>
                            ${
                              isViewer || String(campaign.status || "") === "archived"
                                ? ""
                                : `<button id="campaignArchiveBtn" class="btn btn--danger" type="button">Archive campaign</button>`
                            }
                          </div>
                        </section>
                      `
                      : ""
                  }

                  ${
                    effectiveTab === "tasks"
                      ? `
                        <section class="settings-card campaign-tasks">
                          <div class="settings-card__title">Tasks</div>
                          ${isOverBudget ? `<div class="campaign-warning">Budget exceeded</div>` : ""}
                          <div class="quick-add campaign-tasks__add">
                            <input id="campaignTaskInput" class="quick-add__input" type="text" placeholder="Добавить задачу в кампанию" maxlength="280" autocomplete="off">
                            <button id="campaignTaskAdd" class="quick-add__submit" type="button">+ Add task</button>
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
                      : ""
                  }

                  ${
                    effectiveTab === "finance"
                      ? `
                        <section class="settings-card">
                          <div class="settings-card__title">Finance</div>
                          ${isOverBudget ? `<div class="campaign-warning">Budget exceeded</div>` : ""}
                          ${
                            financeEditing
                              ? `
                                <div class="campaign-finance-edit">
                                  <label class="field">
                                    <div class="field__label">Planned budget</div>
                                    <input id="financePlanned" class="field__input" inputmode="decimal" type="number" min="0" step="1" placeholder="—" value="${draftPlanned === null ? "" : escapeHtml(String(draftPlanned))}">
                                  </label>
                                  <label class="field">
                                    <div class="field__label">Spent</div>
                                    <input id="financeSpent" class="field__input" inputmode="decimal" type="number" min="0" step="1" value="${escapeHtml(String(draftSpent))}">
                                  </label>
                                  <label class="field">
                                    <div class="field__label">Currency</div>
                                    <select id="financeCurrency" class="field__input">
                                      ${["EUR","USD","RUB"].map((c) => `<option value="${c}" ${c === draftCurrency ? "selected" : ""}>${c}</option>`).join("")}
                                    </select>
                                  </label>

                                  <div class="campaign-finance-preview">
                                    <div class="campaign-finance__row"><span class="campaign-finance__k">Remaining</span><span id="financeRemaining" class="campaign-finance__v">${draftRemaining === null ? "—" : escapeHtml(fmtMoney(draftRemaining, draftCurrency))}</span></div>
                                    <div class="campaign-progress">
                                      <div class="campaign-progress__bar"><div id="financeProgressBar" class="campaign-progress__fill" style="width:${Math.round(draftProgress * 100)}%"></div></div>
                                      <div id="financeProgressText" class="campaign-progress__text">${Math.round(draftProgress * 100)}%</div>
                                    </div>
                                  </div>

                                  <div class="campaign-actions">
                                    <button id="financeCancel" class="btn btn--ghost" type="button">Cancel</button>
                                    <button id="financeSave" class="btn" type="button">Save</button>
                                  </div>
                                </div>
                              `
                              : plannedBudget === null
                                ? `
                                  <section class="state state--empty">
                                    <p class="state__icon">💶</p>
                                    <p class="state__text">No budget set</p>
                                    ${canEditFinance ? `<button id="financeSetBudget" class="btn" type="button">Set budget</button>` : ""}
                                  </section>
                                `
                                : `
                                  <div class="campaign-finance">
                                    <div class="campaign-finance__row"><span class="campaign-finance__k">Planned</span><span class="campaign-finance__v">${escapeHtml(fmtMoney(plannedBudget, currency))}</span></div>
                                    <div class="campaign-finance__row"><span class="campaign-finance__k">Spent</span><span class="campaign-finance__v">${escapeHtml(fmtMoney(spent, currency))}</span></div>
                                    <div class="campaign-finance__row"><span class="campaign-finance__k">Remaining</span><span class="campaign-finance__v">${remaining === null ? "—" : escapeHtml(fmtMoney(remaining, currency))}</span></div>
                                    <div class="campaign-progress">
                                      <div class="campaign-progress__bar"><div class="campaign-progress__fill" style="width:${Math.round(progress * 100)}%"></div></div>
                                      <div class="campaign-progress__text">${Math.round(progress * 100)}%</div>
                                    </div>
                                    ${canEditFinance ? `<div class="campaign-actions"><button id="financeEdit" class="btn btn--ghost" type="button">Edit</button></div>` : ""}
                                  </div>
                                `
                          }
                        </section>
                      `
                      : ""
                  }

                  ${
                    effectiveTab === "team"
                      ? `
                        <section class="settings-card">
                          <div class="settings-card__title">Team</div>
                          <section class="state state--empty">
                            <p class="state__icon">👥</p>
                            <p class="state__text">Team members coming soon</p>
                          </section>
                        </section>
                      `
                      : ""
                  }
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

    root.querySelectorAll("[data-campaign-tab]").forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      el.onclick = () => {
        const next = String(el.dataset.campaignTab || "overview").trim().toLowerCase();
        if (next === "finance" && !canSeeFinance) return;
        setState({ campaignTab: next });
      };
    });

    const editBtn = root.querySelector("#campaignEditBtn");
    if (editBtn instanceof HTMLElement) {
      editBtn.onclick = () => showToast("Soon");
    }

    const archiveBtn = root.querySelector("#campaignArchiveBtn");
    if (archiveBtn instanceof HTMLElement) {
      archiveBtn.onclick = async () => {
        if (isViewer) return;
        const ok = confirm("Archive this campaign?");
        if (!ok) return;
        try {
          await updateCampaign(id, { status: "archived" });
          showToast("Archived");
          window.location.hash = "#/campaigns";
        } catch (e) {
          showToast(e?.message || "Failed to archive");
        }
      };
    }

    const setBudgetBtn = root.querySelector("#financeSetBudget");
    if (setBudgetBtn instanceof HTMLElement) {
      setBudgetBtn.onclick = () => {
        if (!canEditFinance) return;
        financeEditing = true;
        financeDraft = { plannedBudget: plannedBudget ?? 0, spent: spent ?? 0, currency };
        setState({}); // rerender
      };
    }

    const financeEditBtn = root.querySelector("#financeEdit");
    if (financeEditBtn instanceof HTMLElement) {
      financeEditBtn.onclick = () => {
        if (!canEditFinance) return;
        financeEditing = true;
        financeDraft = { plannedBudget, spent, currency };
        setState({}); // rerender
      };
    }

    const financeCancelBtn = root.querySelector("#financeCancel");
    if (financeCancelBtn instanceof HTMLElement) {
      financeCancelBtn.onclick = () => {
        financeEditing = false;
        financeDraft = null;
        setState({});
      };
    }

    function syncFinancePreview() {
      const pb = root.querySelector("#financePlanned");
      const sp = root.querySelector("#financeSpent");
      const curEl = root.querySelector("#financeCurrency");
      if (!(pb instanceof HTMLInputElement) || !(sp instanceof HTMLInputElement) || !(curEl instanceof HTMLSelectElement)) return;
      const planned = pb.value.trim() === "" ? null : Number(pb.value);
      const spentNow = sp.value.trim() === "" ? 0 : Number(sp.value);
      const cur = String(curEl.value || "EUR").toUpperCase();

      financeDraft = {
        plannedBudget: planned === null ? null : (Number.isFinite(planned) ? planned : null),
        spent: Number.isFinite(spentNow) && spentNow >= 0 ? spentNow : 0,
        currency: cur,
      };

      const rem = planned === null || !Number.isFinite(planned) ? null : Math.max(0, planned - (Number.isFinite(spentNow) ? spentNow : 0));
      const prog = planned && Number.isFinite(planned) && planned > 0 ? Math.max(0, Math.min(1, spentNow / planned)) : 0;

      const remEl = root.querySelector("#financeRemaining");
      const bar = root.querySelector("#financeProgressBar");
      const txt = root.querySelector("#financeProgressText");
      if (remEl instanceof HTMLElement) remEl.textContent = rem === null ? "—" : fmtMoney(rem, cur);
      if (bar instanceof HTMLElement) bar.style.width = `${Math.round(prog * 100)}%`;
      if (txt instanceof HTMLElement) txt.textContent = `${Math.round(prog * 100)}%`;
    }

    const financePlanned = root.querySelector("#financePlanned");
    const financeSpent = root.querySelector("#financeSpent");
    const financeCur = root.querySelector("#financeCurrency");
    [financePlanned, financeSpent, financeCur].forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      el.oninput = () => syncFinancePreview();
      el.onchange = () => syncFinancePreview();
    });

    const financeSaveBtn = root.querySelector("#financeSave");
    if (financeSaveBtn instanceof HTMLElement) {
      financeSaveBtn.onclick = async () => {
        if (!canEditFinance) return;
        syncFinancePreview();
        const draftNow = financeDraft || { plannedBudget, spent, currency };
        const pb = draftNow.plannedBudget === null ? null : Number(draftNow.plannedBudget);
        const sp = Number(draftNow.spent);
        const cur = String(draftNow.currency || "EUR").toUpperCase();
        if (pb !== null && (!Number.isFinite(pb) || pb < 0)) {
          showToast("Invalid planned budget");
          return;
        }
        if (!Number.isFinite(sp) || sp < 0) {
          showToast("Invalid spent");
          return;
        }
        if (!/^[A-Z]{3}$/.test(cur)) {
          showToast("Invalid currency");
          return;
        }

        try {
          await updateCampaign(id, { plannedBudget: pb, spent: sp, currency: cur });
          const st = getState() || {};
          const list = Array.isArray(st.campaigns) ? st.campaigns : [];
          const updated = list.map((c) => (c && c.id === id ? { ...c, plannedBudget: pb, spent: sp, currency: cur } : c));
          setState({ campaigns: updated });
          financeEditing = false;
          financeDraft = null;
          showToast("Budget updated");
        } catch (e) {
          showToast(e?.message || "Failed to update budget");
        }
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
