/**
 * Telegatask Mini App — lightweight mobile UI without frameworks.
 */

import { getState, setState } from "../../core/store.js";
import * as tasksApi from "./tasks.api.js";
import * as actions from "./tasks.actions.js";

const tg = window.Telegram?.WebApp;
const INIT_DATA = tg?.initData || "";

function $id(id) {
  const root = tasksApp.root;
  if (root instanceof HTMLElement) return root.querySelector(`#${id}`);
  return document.getElementById(id);
}

function $one(sel) {
  const root = tasksApp.root;
  if (root instanceof HTMLElement) return root.querySelector(sel);
  return document.querySelector(sel);
}

function $all(sel) {
  const root = tasksApp.root;
  if (root instanceof HTMLElement) return root.querySelectorAll(sel);
  return document.querySelectorAll(sel);
}

const VLIST = {
  taskHeight: 110,
  headerHeight: 40,
  overscan: 6,
  maxItems: 120,
  measured: false,
};

const COLLAPSE_LS_KEY = "telegatask:collapsedGroups";

function loadCollapsedGroups() {
  try {
    const raw = localStorage.getItem(COLLAPSE_LS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.filter((x) => typeof x === "string"));
    if (parsed && typeof parsed === "object") {
      const keys = Object.keys(parsed).filter((k) => parsed[k]);
      return new Set(keys);
    }
    return new Set();
  } catch {
    return new Set();
  }
}

function saveCollapsedGroups(set) {
  try {
    localStorage.setItem(COLLAPSE_LS_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // ignore
  }
}

const state = {
  tasks: [],
  tab: "active", // active | done | all
  loading: false,
  actionSheetTaskId: null,
  expandedTaskIds: new Set(),
  quickAddOpen: false,
  selectedTaskIds: new Set(),
  swipe: null, // active swipe session
  pendingDelete: null, // { kind: "single"|"bulk", tasks: any[], timerId }
  suggestTimer: null,
  suggestAbort: null,
  projects: null, // { activeTeamId, list: [{id,name}] }
  projectPicker: null, // { taskIds: string[] }
  taskSheetTaskId: null,
  taskSheetTimer: null,
  swipeSuppressClickUntil: 0,
  query: "",
  queryTimer: null,
  filters: { today: false, overdue: false, p1: false, nodue: false },
  vlistItems: [],
  vlistPrefix: null,
  vlistTotal: 0,
  collapsedGroups: loadCollapsedGroups(), // Set<string>
};

const tasksApp = {
  sheetDrag: null,
  vlistScrollHandler: null,
  root: null,
  abort: null,
  init(rootEl) {
    if (rootEl instanceof HTMLElement) this.root = rootEl;
    if (this.abort) {
      try {
        this.abort.abort();
      } catch {
        // ignore
      }
    }
    this.abort = new AbortController();

    if (tg) {
      tg.ready();
      tg.expand();
      tg.enableClosingConfirmation();
    }

    this.bindUi();
    // Initial UI comes from store.subscribe() when loadTasks sets loading=true.
    this.loadTasks();
  },
  destroy() {
    try {
      if (this.abort) this.abort.abort();
    } catch {
      // ignore
    } finally {
      this.abort = null;
    }

    // best-effort timers cleanup (avoid leaks across router pages)
    try {
      if (state.queryTimer) clearTimeout(state.queryTimer);
      if (state.suggestTimer) clearTimeout(state.suggestTimer);
      if (state.taskSheetTimer) clearTimeout(state.taskSheetTimer);
      state.queryTimer = null;
      state.suggestTimer = null;
      state.taskSheetTimer = null;
    } catch {
      // ignore
    }

    try {
      if (state.suggestAbort) state.suggestAbort.abort();
      state.suggestAbort = null;
    } catch {
      // ignore
    }

    this.root = null;
  },

  detectApiBase() {
    if (window.__TELEGATASK_API__) return;

    const meta = document.querySelector('meta[name="api-base"]');
    if (meta?.content) {
      window.__TELEGATASK_API__ = meta.content;
      return;
    }

    const startParam = tg?.initDataUnsafe?.start_param || "";
    if (startParam.startsWith("api_")) {
      try {
        window.__TELEGATASK_API__ = atob(startParam.slice(4));
        return;
      } catch (e) {
        console.warn("[MiniApp] failed to decode API url from start_param");
      }
    }

    window.__TELEGATASK_API__ = "";
  },

  getApiBase() {
    return window.__TELEGATASK_API__ || "";
  },

  bindUi() {
    const signal = this.abort?.signal;
    const tabs = $all(".tab");
    tabs.forEach((tabBtn) => {
      tabBtn.addEventListener("click", () => {
        // Keep search/query/filters, but reset selection when switching tabs.
        if (state.selectedTaskIds.size > 0) {
          state.selectedTaskIds.clear();
        }
        setState({ tab: tabBtn.dataset.tab || "active" });
        this.haptic("light");
      }, signal ? { signal } : undefined);
    });

    $id("retryButton")?.addEventListener("click", () => {
      this.loadTasks();
    }, signal ? { signal } : undefined);

    $id("fabAdd")?.addEventListener("click", () => {
      this.openQuickAdd();
    }, signal ? { signal } : undefined);

    $id("fabSearch")?.addEventListener("click", () => {
      this.toggleSearchPanel();
    }, signal ? { signal } : undefined);

    $id("searchInput")?.addEventListener("input", () => {
      this.onSearchInput();
    }, signal ? { signal } : undefined);
    $id("searchInput")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.applySearchAndClose();
      }
      if (event.key === "Escape") {
        this.closeSearchPanel();
      }
    }, signal ? { signal } : undefined);
    $id("searchClear")?.addEventListener("click", () => {
      this.clearSearch();
    }, signal ? { signal } : undefined);
    $id("filterChips")?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const btn = target.closest("[data-filter]");
      if (!(btn instanceof HTMLElement)) return;
      const key = btn.dataset.filter || "";
      this.toggleFilter(key);
    }, signal ? { signal } : undefined);

    $id("filterMenuButton")?.addEventListener("click", () => {
      this.openFilterMenu();
    }, signal ? { signal } : undefined);

    $id("quickAddSubmit")?.addEventListener("click", () => {
      this.submitQuickAdd();
    }, signal ? { signal } : undefined);

    $id("quickAddInput")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.submitQuickAdd();
      }
      if (event.key === "Escape") {
        this.closeQuickAdd();
      }
    }, signal ? { signal } : undefined);
    $id("quickAddInput")?.addEventListener("input", () => {
      this.onQuickAddInput();
    }, signal ? { signal } : undefined);
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("#mentionSuggest") || target.closest("#quickAdd")) return;
      this.hideSuggest();
    }, signal ? { signal } : undefined);

    $id("mentionSuggest")?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const item = target.closest("[data-username]");
      if (!(item instanceof HTMLElement)) return;
      const username = item.dataset.username;
      if (username) this.applyMention(username);
    }, signal ? { signal } : undefined);

    $id("sheetBackdrop")?.addEventListener("click", () => {
      this.closeActionSheet();
    }, signal ? { signal } : undefined);
    $id("sheetCancel")?.addEventListener("click", () => {
      this.closeActionSheet();
    }, signal ? { signal } : undefined);
    $id("sheetToggleDone")?.addEventListener("click", () => {
      const taskId = state.actionSheetTaskId;
      this.closeActionSheet();
      if (taskId) actions.toggleDone(taskId);
    }, signal ? { signal } : undefined);
    $id("sheetDelete")?.addEventListener("click", () => {
      const taskId = state.actionSheetTaskId;
      this.closeActionSheet();
      if (taskId) actions.deleteTask(taskId, { withUndo: true });
    }, signal ? { signal } : undefined);
    $id("sheetMove")?.addEventListener("click", () => {
      const taskId = state.actionSheetTaskId;
      this.closeActionSheet();
      if (taskId) this.openProjectPicker([taskId]);
    }, signal ? { signal } : undefined);

    $id("bulkCancel")?.addEventListener("click", () => {
      this.clearSelection();
    }, signal ? { signal } : undefined);
    $id("bulkDone")?.addEventListener("click", () => {
      const ids = Array.from(state.selectedTaskIds);
      if (!ids.length) return;
      state.selectedTaskIds.clear();
      actions.bulkDone(ids);
    }, signal ? { signal } : undefined);
    $id("bulkMove")?.addEventListener("click", () => {
      const ids = Array.from(state.selectedTaskIds);
      if (!ids.length) return;
      this.openProjectPicker(ids);
    }, signal ? { signal } : undefined);
    $id("bulkDelete")?.addEventListener("click", () => {
      const ids = Array.from(state.selectedTaskIds);
      if (!ids.length) return;
      state.selectedTaskIds.clear();
      actions.bulkDelete(ids);
    }, signal ? { signal } : undefined);

    $id("projectBackdrop")?.addEventListener("click", () => {
      this.closeProjectPicker();
    }, signal ? { signal } : undefined);
    $id("projectCancel")?.addEventListener("click", () => {
      this.closeProjectPicker();
    }, signal ? { signal } : undefined);
    $id("projectList")?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const btn = target.closest("[data-project-id]");
      if (!(btn instanceof HTMLElement)) return;
      const projectId = btn.dataset.projectId || "";
      this.applyProjectToPickedTasks(projectId || null);
    }, signal ? { signal } : undefined);

    $id("sheetOverlay")?.addEventListener("click", () => {
      this.closeTaskSheet();
    }, signal ? { signal } : undefined);
    $id("taskSheetClose")?.addEventListener("click", () => {
      this.closeTaskSheet();
    }, signal ? { signal } : undefined);
    $id("taskSheetTitle")?.addEventListener("input", () => {
      this.onTaskSheetChangeDebounced();
    }, signal ? { signal } : undefined);
    $id("taskSheet")?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const dueBtn = target.closest("[data-due]");
      if (dueBtn instanceof HTMLElement) {
        const v = dueBtn.dataset.due || "";
        this.setTaskSheetDue(v);
        return;
      }

      const prBtn = target.closest("[data-priority]");
      if (prBtn instanceof HTMLElement) {
        const v = prBtn.dataset.priority || "";
        this.setTaskSheetPriority(v);
        return;
      }
    });
    $id("taskSheetDone")?.addEventListener("click", () => {
      const taskId = state.taskSheetTaskId;
      if (taskId) actions.toggleDone(taskId);
    }, signal ? { signal } : undefined);
    $id("taskSheetDelete")?.addEventListener("click", () => {
      const taskId = state.taskSheetTaskId;
      if (!taskId) return;
      this.closeTaskSheet();
      actions.deleteTask(taskId, { withUndo: true });
    }, signal ? { signal } : undefined);

    const viewport = $id("taskListViewport");
    if (viewport instanceof HTMLElement) {
      this.vlistScrollHandler = this.throttle(() => {
        this.renderVirtualList(state.vlistItems || []);
        this.updateStickyGroupHeader();
      }, 16);
      viewport.addEventListener("scroll", this.vlistScrollHandler, signal ? { passive: true, signal } : { passive: true });
    }

    $id("taskList")?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const groupHeader = target.closest(".group-header");
      if (groupHeader instanceof HTMLElement) {
        const key = groupHeader.dataset.groupKey;
        if (key) this.toggleGroupCollapsed(key);
        return;
      }

      const cardEl = target.closest(".task-card");
      if (cardEl instanceof HTMLElement) {
        const taskId = cardEl.dataset.taskId;
        // Don't open details while selecting or when interacting with controls.
        if (!taskId) return;
        if (state.selectedTaskIds.size > 0) return;
        if (Date.now() < state.swipeSuppressClickUntil) return;
        if (target.closest("[data-action]")) return;
        this.openTaskSheet(taskId);
        return;
      }

      const toggleBtn = target.closest("[data-action='toggle']");
      if (toggleBtn instanceof HTMLElement) {
        const taskId = toggleBtn.dataset.taskId;
        if (taskId) this.toggleSelect(taskId);
        return;
      }

      const menuBtn = target.closest("[data-action='menu']");
      if (menuBtn instanceof HTMLElement) {
        const taskId = menuBtn.dataset.taskId;
        if (taskId) this.openActionSheet(taskId);
        return;
      }

      const expandBtn = target.closest("[data-action='expand']");
      if (expandBtn instanceof HTMLElement) {
        const taskId = expandBtn.dataset.taskId;
        if (taskId) this.toggleExpand(taskId);
      }
    });

    const list = $id("taskList");
    list?.addEventListener("pointerdown", (event) => this.onSwipePointerDown(event), signal ? { signal } : undefined);
    list?.addEventListener("pointermove", (event) => this.onSwipePointerMove(event), signal ? { signal } : undefined);
    list?.addEventListener("pointerup", (event) => this.onSwipePointerUp(event), signal ? { signal } : undefined);
    list?.addEventListener("pointercancel", (event) => this.onSwipePointerUp(event), signal ? { signal } : undefined);

    // Swipe down to close details sheet (optional)
    const sheet = $id("taskSheet");
    sheet?.addEventListener("pointerdown", (event) => this.onSheetPointerDown(event), signal ? { signal } : undefined);
    sheet?.addEventListener("pointermove", (event) => this.onSheetPointerMove(event), signal ? { signal } : undefined);
    sheet?.addEventListener("pointerup", (event) => this.onSheetPointerUp(event), signal ? { signal } : undefined);
    sheet?.addEventListener("pointercancel", (event) => this.onSheetPointerUp(event), signal ? { signal } : undefined);
  },

  async loadTasks() {
    try {
      await actions.loadTasks();
    } catch (error) {
      console.error("[MiniApp] loadTasks error", error);
      this.showErrorState();
    }
  },

  render(view = null) {
    const s = view?.state || getState() || state;
    const visibleTasks = view?.visibleTasks || [];
    const items = view?.items || [];
    const emptyText = view?.emptyText;
    const loadingEl = $id("loadingState");
    const emptyEl = $id("emptyState");
    const errorEl = $id("errorState");
    const listEl = $id("taskList");
    const viewport = $id("taskListViewport");
    const sticky = $id("stickyGroupHeader");

    if (!loadingEl || !emptyEl || !errorEl || !listEl || !viewport || !sticky) return;

    this.renderTabs();

    if (s.loading) {
      loadingEl.hidden = false;
      emptyEl.hidden = true;
      errorEl.hidden = true;
      viewport.hidden = true;
      sticky.hidden = true;
      this.renderSearchUi();
      return;
    }

    this.renderSearchUi();

    loadingEl.hidden = true;
    errorEl.hidden = true;

    if (!visibleTasks.length) {
      this.renderEmptyState(emptyText);
      emptyEl.hidden = false;
      viewport.hidden = true;
      sticky.hidden = true;
      return;
    }

    emptyEl.hidden = true;
    viewport.hidden = false;
    state.vlistItems = items;
    state.vlistPrefix = this.buildPrefixHeights(items);
    state.vlistTotal = state.vlistPrefix[state.vlistPrefix.length - 1] || 0;
    this.updateStickyGroupHeader();
    this.renderVirtualList(items);
    this.renderBulkBar();
  },

  renderVirtualList(flatList) {
    const viewport = $id("taskListViewport");
    const topSpacer = $id("topSpacer");
    const bottomSpacer = $id("bottomSpacer");
    const list = $id("taskList");

    if (!(viewport instanceof HTMLElement)) return;
    if (!(topSpacer instanceof HTMLElement)) return;
    if (!(bottomSpacer instanceof HTMLElement)) return;
    if (!(list instanceof HTMLElement)) return;

    const total = Array.isArray(flatList) ? flatList.length : 0;
    if (total === 0) {
      topSpacer.style.height = "0px";
      bottomSpacer.style.height = "0px";
      list.innerHTML = "";
      return;
    }

    // Measure approximate heights once (median of 1..3 items of each type).
    if (!VLIST.measured) {
      const sampleHeaders = flatList.filter((x) => x.type === "header").slice(0, 2);
      const sampleTasks = flatList.filter((x) => x.type === "task").slice(0, 2);
      const sample = [...sampleHeaders, ...sampleTasks].slice(0, 3);
      list.innerHTML = sample
        .map((it) => (it.type === "header" ? this.renderGroupHeader(it) : this.renderTaskCard(it.task)))
        .join("");

      const headerHeights = Array.from(list.querySelectorAll(".group-header"))
        .map((el) => (el instanceof HTMLElement ? el.offsetHeight : 0))
        .filter((h) => h > 18 && h < 90)
        .sort((a, b) => a - b);
      if (headerHeights.length) VLIST.headerHeight = headerHeights[Math.floor(headerHeights.length / 2)];

      const taskHeights = Array.from(list.querySelectorAll(".task-swipe"))
        .map((el) => (el instanceof HTMLElement ? el.offsetHeight : 0))
        .filter((h) => h > 50 && h < 260)
        .sort((a, b) => a - b);
      if (taskHeights.length) VLIST.taskHeight = taskHeights[Math.floor(taskHeights.length / 2)];

      VLIST.measured = true;
    }

    const scrollTop = viewport.scrollTop;
    const viewportHeight = viewport.clientHeight || window.innerHeight;

    const prefix = state.vlistPrefix && Array.isArray(state.vlistPrefix) && state.vlistPrefix.length === total + 1
      ? state.vlistPrefix
      : this.buildPrefixHeights(flatList);
    state.vlistPrefix = prefix;
    const totalHeight = prefix[prefix.length - 1] || 0;
    state.vlistTotal = totalHeight;

    const minH = Math.max(24, Math.min(VLIST.headerHeight, VLIST.taskHeight));
    const itemsPerScreen = Math.ceil(viewportHeight / minH);
    const windowSize = Math.min(VLIST.maxItems, itemsPerScreen + VLIST.overscan * 2);

    let start = this.lowerBound(prefix, scrollTop) - VLIST.overscan;
    start = Math.max(0, start);
    let end = Math.min(total, start + windowSize);
    start = Math.max(0, end - windowSize);

    topSpacer.style.height = prefix[start] + "px";
    bottomSpacer.style.height = (totalHeight - prefix[end]) + "px";

    const windowItems = flatList.slice(start, end);
    list.innerHTML = windowItems
      .map((it) => (it.type === "header" ? this.renderGroupHeader(it) : this.renderTaskCard(it.task)))
      .join("");
  },

  updateStickyGroupHeader() {
    const sticky = $id("stickyGroupHeader");
    const viewport = $id("taskListViewport");
    if (!(sticky instanceof HTMLElement) || !(viewport instanceof HTMLElement)) return;

    const items = state.vlistItems || [];
    if (!items.length) {
      sticky.hidden = true;
      sticky.textContent = "";
      return;
    }

    const prefix = state.vlistPrefix;
    if (!prefix || prefix.length !== items.length + 1) {
      sticky.hidden = true;
      return;
    }

    const firstIndex = Math.min(items.length - 1, Math.max(0, this.lowerBound(prefix, viewport.scrollTop)));
    let i = firstIndex;
    if (items[i] && items[i].type === "header") {
      const c = Number.isFinite(items[i].count) ? items[i].count : 0;
      sticky.textContent = `${items[i].title} (${c})`;
      sticky.hidden = false;
      return;
    }
    while (i >= 0) {
      if (items[i].type === "header") {
        const c = Number.isFinite(items[i].count) ? items[i].count : 0;
        sticky.textContent = `${items[i].title} (${c})`;
        sticky.hidden = false;
        return;
      }
      i -= 1;
    }
    sticky.hidden = true;
  },

  renderTabs() {
    $all(".tab").forEach((tabBtn) => {
      tabBtn.classList.toggle("active", tabBtn.dataset.tab === state.tab);
    });
  },

  renderEmptyState(emptyText) {
    const textEl = $id("emptyStateText");
    if (!textEl) return;
    textEl.textContent = String(emptyText || "Нет задач");
  },

  showErrorState() {
    const loadingEl = $id("loadingState");
    const emptyEl = $id("emptyState");
    const errorEl = $id("errorState");
    const listEl = $id("taskList");
    const viewport = $id("taskListViewport");

    if (!loadingEl || !emptyEl || !errorEl || !listEl || !viewport) return;

    loadingEl.hidden = true;
    emptyEl.hidden = true;
    viewport.hidden = true;
    errorEl.hidden = false;
  },

  renderSearchUi() {
    const input = $id("searchInput");
    const clear = $id("searchClear");
    if (input instanceof HTMLInputElement) {
      if (input.value !== state.query && document.activeElement !== input) {
        // keep input in sync when changed elsewhere
        input.value = state.query || "";
      }
    }
    if (clear instanceof HTMLElement) {
      const has = (input instanceof HTMLInputElement ? input.value : state.query || "").trim().length > 0;
      clear.hidden = !has;
    }

    $all("#filterChips [data-filter]").forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const k = el.dataset.filter;
      if (!k) return;
      el.classList.toggle("is-active", Boolean(state.filters && state.filters[k]));
    });
  },

  openSearchPanel() {
    const panel = $id("searchPanel");
    const input = $id("searchInput");
    if (!(panel instanceof HTMLElement)) return;

    // Avoid stacking top panels.
    this.closeQuickAdd();
    this.hideSuggest();

    panel.hidden = false;
    if (input instanceof HTMLInputElement) {
      input.value = state.query || "";
      setTimeout(() => input.focus(), 30);
    }
    this.renderSearchUi();
  },

  closeSearchPanel() {
    const panel = $id("searchPanel");
    const input = $id("searchInput");
    if (!(panel instanceof HTMLElement)) return;
    panel.hidden = true;
    if (input instanceof HTMLInputElement) input.blur();
  },

  toggleSearchPanel() {
    const panel = $id("searchPanel");
    if (!(panel instanceof HTMLElement)) return;
    if (panel.hidden) this.openSearchPanel();
    else this.closeSearchPanel();
  },

  applySearchAndClose() {
    const input = $id("searchInput");
    if (!(input instanceof HTMLInputElement)) {
      this.closeSearchPanel();
      return;
    }

    const next = input.value;
    clearTimeout(state.queryTimer);
    setState({ query: next });
    this.closeSearchPanel();
  },

  onSearchInput() {
    const input = $id("searchInput");
    if (!(input instanceof HTMLInputElement)) return;
    const next = input.value;

    const clear = $id("searchClear");
    if (clear instanceof HTMLElement) clear.hidden = next.trim().length === 0;

    clearTimeout(state.queryTimer);
    state.queryTimer = setTimeout(() => {
      setState({ query: next });
    }, 200);
  },

  clearSearch() {
    const input = $id("searchInput");
    if (input instanceof HTMLInputElement) {
      input.value = "";
      input.focus();
    }
    clearTimeout(state.queryTimer);
    setState({ query: "" });
  },

  toggleFilter(key) {
    if (!state.filters || !(key in state.filters)) return;
    const next = { ...state.filters, [key]: !state.filters[key] };
    state.filters = next;
    this.haptic("light");
    setState({ filters: next });
  },

  renderTaskCard(task) {
    const isDone = task.status === "done" || task.status === "cancelled";
    const isSelected = state.selectedTaskIds.has(task.id);
    const title = this.escapeHtml(task.title || task.description || "Без названия");

    const due = this.formatDueBadge(task.dueDate);
    const dueChip = due
      ? `<span class="chip ${due.overdue ? "chip--due-overdue" : ""}">${due.label}</span>`
      : "";

    const projectName = this.getProjectName(task.projectId ?? null);
    const projectChip = projectName
      ? `<span class="chip">📁 ${this.escapeHtml(projectName)}</span>`
      : task.sourceChatTitle
        ? `<span class="chip">${this.escapeHtml(task.sourceChatTitle)}</span>`
        : "";

    const priorityChip = task.priority && task.priority !== "normal"
      ? `<span class="chip chip--priority-${task.priority}">${this.priorityLabel(task.priority)}</span>`
      : "";

    return `
      <div class="task-swipe" data-task-id="${task.id}">
        <div class="task-swipe-bg" aria-hidden="true">
          <div class="bg-left">✅ Выполнено</div>
          <div class="bg-right">🗑 Удалить</div>
        </div>
        <article class="task-card ${isDone ? "task-card--done" : ""}" data-task-id="${task.id}">
          <button class="task-card__check ${isSelected ? "is-done" : ""}" data-action="toggle" data-task-id="${task.id}" type="button" aria-label="${isSelected ? "Снять выбор" : "Выбрать"}">
            <span class="task-card__check-circle">${isSelected ? "✓" : ""}</span>
          </button>

          <div class="task-card__content">
            <p class="task-card__title ${isDone ? "is-done" : ""}" data-role="title">${title}</p>
            <div class="task-card__meta">
              ${dueChip}
              ${projectChip}
              ${priorityChip}
            </div>
          </div>

          <button class="task-card__menu" data-action="menu" data-task-id="${task.id}" type="button" aria-label="Действия">…</button>
        </article>
      </div>
    `;
  },

  renderGroupHeader(item) {
    const key = String(item.key || "");
    const title = this.escapeHtml(item.title || "");
    const count = Number.isFinite(item.count) ? item.count : 0;
    const isCollapsed = state.collapsedGroups && state.collapsedGroups.has(key);
    const caret = isCollapsed ? "▸" : "▾";
    const label = `${title} (${count})`;
    return `
      <button class="group-header" type="button" data-group-key="${this.escapeHtml(key)}" aria-expanded="${isCollapsed ? "false" : "true"}">
        <span class="group-header__label">${label}</span>
        <span class="group-header__caret" aria-hidden="true">${caret}</span>
      </button>
    `;
  },

  toggleGroupCollapsed(key) {
    const prev = state.collapsedGroups || new Set();
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    state.collapsedGroups = next;
    saveCollapsedGroups(next);
    this.haptic("light");
    setState({ collapsedGroups: next });
  },

  buildPrefixHeights(items) {
    const prefix = new Array(items.length + 1);
    prefix[0] = 0;
    for (let i = 0; i < items.length; i += 1) {
      const h = items[i].type === "header" ? VLIST.headerHeight : VLIST.taskHeight;
      prefix[i + 1] = prefix[i] + h;
    }
    return prefix;
  },

  // first index i such that prefix[i] >= value (prefix is non-decreasing, length n+1)
  lowerBound(prefix, value) {
    let lo = 0;
    let hi = prefix.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (prefix[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  },

  openTaskSheet(taskId) {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;

    state.taskSheetTaskId = taskId;

    const overlay = $id("sheetOverlay");
    const sheet = $id("taskSheet");
    const titleInput = $id("taskSheetTitle");
    const projectEl = $id("taskSheetProject");

    if (!(overlay instanceof HTMLElement) || !(sheet instanceof HTMLElement)) return;
    if (titleInput instanceof HTMLInputElement) {
      titleInput.value = task.title || task.description || "";
      setTimeout(() => titleInput.focus(), 30);
    }

    if (projectEl instanceof HTMLElement) {
      const projectName = this.getProjectName(task.projectId ?? null);
      projectEl.textContent = projectName || task.sourceChatTitle || "Текучка";
    }

    this.syncTaskSheetChips(task);

    overlay.hidden = false;
    sheet.hidden = false;
    // allow display before animating
    requestAnimationFrame(() => sheet.classList.add("is-open"));
  },

  closeTaskSheet() {
    const overlay = $id("sheetOverlay");
    const sheet = $id("taskSheet");
    if (!(overlay instanceof HTMLElement) || !(sheet instanceof HTMLElement)) return;
    sheet.classList.remove("is-open");
    setTimeout(() => {
      overlay.hidden = true;
      sheet.hidden = true;
    }, 190);
    state.taskSheetTaskId = null;
  },

  syncTaskSheetChips(task) {
    const sheet = $id("taskSheet");
    if (!(sheet instanceof HTMLElement)) return;

    const due = this.getDueKind(task.dueDate);
    sheet.querySelectorAll("[data-due]").forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const v = el.dataset.due || "";
      el.classList.toggle("is-active", v === due);
    });

    const pr = task.priority || "normal";
    sheet.querySelectorAll("[data-priority]").forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const v = el.dataset.priority || "";
      el.classList.toggle("is-active", v === pr);
    });
  },

  getDueKind(dueDate) {
    if (!dueDate) return "clear";
    const d = new Date(dueDate);
    if (Number.isNaN(d.getTime())) return "clear";
    const now = new Date();
    const dueDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.round((dueDay - nowDay) / (24 * 60 * 60 * 1000));
    if (diffDays === 0) return "today";
    if (diffDays === 1) return "tomorrow";
    return "custom";
  },

  setTaskSheetDue(kind) {
    const taskId = state.taskSheetTaskId;
    if (!taskId) return;
    const s = getState() || state;
    const task = (s.tasks || []).find((t) => t.id === taskId);
    if (!task) return;

    let dueDate = null;
    if (kind === "today" || kind === "tomorrow") {
      const now = new Date();
      const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
      if (kind === "tomorrow") base.setDate(base.getDate() + 1);
      dueDate = base.toISOString();
    }

    actions.updateTask(taskId, { dueDate }, { sync: false });
    this.syncTaskSheetChips({ ...task, dueDate });
    this.onTaskSheetChangeDebounced();
  },

  setTaskSheetPriority(priority) {
    const taskId = state.taskSheetTaskId;
    if (!taskId) return;
    const s = getState() || state;
    const task = (s.tasks || []).find((t) => t.id === taskId);
    if (!task) return;
    actions.updateTask(taskId, { priority }, { sync: false });
    this.syncTaskSheetChips({ ...task, priority });
    this.onTaskSheetChangeDebounced();
  },

  onTaskSheetChangeDebounced() {
    clearTimeout(state.taskSheetTimer);
    state.taskSheetTimer = setTimeout(() => {
      this.flushTaskSheetPatch();
    }, 300);
  },

  async flushTaskSheetPatch() {
    const taskId = state.taskSheetTaskId;
    if (!taskId) return;
    const s = getState() || state;
    const task = (Array.isArray(s.tasks) ? s.tasks : []).find((t) => t.id === taskId);
    if (!task) return;

    const titleEl = $id("taskSheetTitle");
    const title = titleEl instanceof HTMLInputElement ? titleEl.value.trim() : (task.title || task.description || "");

    await actions.updateTask(taskId, {
      title,
      description: title,
      dueDate: task.dueDate ?? null,
      priority: task.priority ?? "normal",
    });
  },

  onSheetPointerDown(event) {
    if (!(event instanceof PointerEvent)) return;
    const sheet = $id("taskSheet");
    if (!(sheet instanceof HTMLElement) || sheet.hidden) return;
    // Only if started on header/handle area
    if (!event.target || !(event.target instanceof Element)) return;
    if (!event.target.closest(".task-sheet__header") && !event.target.closest(".task-sheet__handle")) return;
    this.sheetDrag = { id: event.pointerId, y0: event.clientY, dy: 0, locked: false };
    sheet.setPointerCapture(event.pointerId);
  },

  onSheetPointerMove(event) {
    if (!(event instanceof PointerEvent)) return;
    const sheet = $id("taskSheet");
    if (!(sheet instanceof HTMLElement)) return;
    const s = this.sheetDrag;
    if (!s || s.id !== event.pointerId) return;
    s.dy = event.clientY - s.y0;
    if (s.dy < 0) return;
    if (s.dy > 6) s.locked = true;
    if (!s.locked) return;
    event.preventDefault();
    sheet.style.transition = "none";
    sheet.style.transform = `translateY(${Math.min(320, s.dy)}px)`;
  },

  onSheetPointerUp(event) {
    if (!(event instanceof PointerEvent)) return;
    const sheet = $id("taskSheet");
    if (!(sheet instanceof HTMLElement)) return;
    const s = this.sheetDrag;
    if (!s || s.id !== event.pointerId) return;
    this.sheetDrag = null;

    const dy = s.dy;
    sheet.style.transition = "";
    sheet.style.transform = "";

    if (dy > 120) {
      this.closeTaskSheet();
    }
  },

  getProjectName(projectId) {
    if (!projectId) return null;
    const list = state.projects?.list || [];
    const p = list.find((x) => x.id === projectId);
    return p ? p.name : null;
  },

  async loadProjects() {
    try {
      const data = await tasksApi.fetchProjects();
      const list = Array.isArray(data?.projects) ? data.projects : [];
      state.projects = { activeTeamId: data?.activeTeamId ?? null, list };
    } catch (err) {
      // non-fatal
    }
  },

  async openProjectPicker(taskIds) {
    state.projectPicker = { taskIds: [...taskIds] };
    await this.loadProjects();

    const sheet = $id("projectSheet");
    const listEl = $id("projectList");
    if (!(sheet instanceof HTMLElement) || !(listEl instanceof HTMLElement)) return;

    const projects = state.projects?.list || [];
    if (!projects.length) {
      listEl.innerHTML = `<div class=\"sheet__title\">Нет проектов</div>`;
    } else {
      listEl.innerHTML = projects
        .map((p) => `<button class=\"sheet__item\" type=\"button\" data-project-id=\"${p.id}\"><span>${this.escapeHtml(p.name)}</span><span class=\"sheet__item-hint\">→</span></button>`)
        .join("");
    }

    sheet.hidden = false;
  },

  closeProjectPicker() {
    const sheet = $id("projectSheet");
    if (sheet) sheet.hidden = true;
    state.projectPicker = null;
  },

  async applyProjectToPickedTasks(projectId) {
    const picked = state.projectPicker?.taskIds || [];
    if (!picked.length) {
      this.closeProjectPicker();
      return;
    }

    state.selectedTaskIds.clear();
    this.closeProjectPicker();
    actions.moveProject(picked, projectId);
  },

  hydrateExpandableText() {
    const cards = $all(".task-card");

    cards.forEach((card) => {
      const titleEl = card.querySelector("[data-role='title']");
      const expandBtn = card.querySelector(".task-card__expand");
      const taskId = card.getAttribute("data-task-id") || "";
      if (!(titleEl instanceof HTMLElement) || !(expandBtn instanceof HTMLElement) || !taskId) return;

      const wasExpanded = card.classList.contains("is-expanded");
      if (wasExpanded) card.classList.remove("is-expanded");
      const hasOverflow = titleEl.scrollHeight > titleEl.clientHeight + 1;
      if (wasExpanded) card.classList.add("is-expanded");

      expandBtn.classList.toggle("is-visible", hasOverflow);

      if (!hasOverflow) {
        state.expandedTaskIds.delete(taskId);
        card.classList.remove("is-expanded");
      }

      expandBtn.textContent = state.expandedTaskIds.has(taskId) ? "Скрыть" : "Показать";
    });
  },

  toggleExpand(taskId) {
    if (state.expandedTaskIds.has(taskId)) {
      state.expandedTaskIds.delete(taskId);
    } else {
      state.expandedTaskIds.add(taskId);
    }
    setState({});
  },

  onSwipePointerDown(event) {
    if (!(event instanceof PointerEvent)) return;
    if (event.button !== 0) return;

    const target = event.target;
    if (!(target instanceof Element)) return;

    // Don't start swipe from buttons/inputs to avoid blocking taps.
    if (target.closest("button, input, textarea, select")) return;

    const card = target.closest(".task-card");
    if (!(card instanceof HTMLElement)) return;

    const wrap = card.closest(".task-swipe");
    if (!(wrap instanceof HTMLElement)) return;

    const taskId = card.getAttribute("data-task-id") || "";
    if (!taskId) return;

    // Close sheet if open
    this.closeActionSheet();

    card.setPointerCapture(event.pointerId);
    state.swipe = {
      pointerId: event.pointerId,
      taskId,
      card,
      wrap,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      dx: 0,
      dy: 0,
      locked: null, // "swipe" | "scroll"
      armed: false,
      hapticFired: false,
    };
  },

  onSwipePointerMove(event) {
    if (!(event instanceof PointerEvent)) return;
    const s = state.swipe;
    if (!s || s.pointerId !== event.pointerId) return;

    s.lastX = event.clientX;
    s.lastY = event.clientY;
    s.dx = s.lastX - s.startX;
    s.dy = s.lastY - s.startY;

    // Decide intent
    if (!s.locked) {
      const adx = Math.abs(s.dx);
      const ady = Math.abs(s.dy);
      if (adx > 8 && adx > ady) {
        s.locked = "swipe";
      } else if (ady > 8 && ady > adx) {
        s.locked = "scroll";
      } else {
        return;
      }
    }

    if (s.locked !== "swipe") return;

    // When selecting tasks, don't intercept scroll with swipes.
    if (state.selectedTaskIds.size > 0) return;

    event.preventDefault();

    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const dx = clamp(s.dx, -140, 140);

    s.card.classList.remove("is-releasing");
    s.card.style.transform = `translateX(${dx}px)`;

    s.wrap.classList.toggle("is-swiping-right", dx > 0);
    s.wrap.classList.toggle("is-swiping-left", dx < 0);

    const armed = Math.abs(dx) > 80;
    s.armed = armed;
    s.wrap.classList.toggle("swipe-armed", armed);

    if (armed && !s.hapticFired) {
      s.hapticFired = true;
      this.haptic("light");
    }
  },

  onSwipePointerUp(event) {
    if (!(event instanceof PointerEvent)) return;
    const s = state.swipe;
    if (!s || s.pointerId !== event.pointerId) return;
    state.swipe = null;

    const dx = s.dx;
    const abs = Math.abs(dx);

    const cleanup = () => {
      s.card.classList.remove("is-releasing");
      s.card.style.transform = "";
      s.wrap.classList.remove("is-swiping-right", "is-swiping-left", "swipe-armed");
    };

    const releaseToZero = () => {
      s.card.classList.add("is-releasing");
      s.card.style.transform = "translateX(0px)";
      const onEnd = () => {
        s.card.removeEventListener("transitionend", onEnd);
        cleanup();
      };
      s.card.addEventListener("transitionend", onEnd);
      // Safety cleanup
      setTimeout(() => {
        try { cleanup(); } catch {}
      }, 220);
    };

    if (s.locked !== "swipe" || abs < 8) {
      cleanup();
      return;
    }

    if (state.selectedTaskIds.size > 0) {
      cleanup();
      return;
    }

    // Prevent the follow-up click from opening details sheet after a swipe.
    state.swipeSuppressClickUntil = Date.now() + 260;

    if (dx > 80) {
      releaseToZero();
      setTimeout(() => actions.toggleDone(s.taskId), 140);
      return;
    }

    if (dx < -80) {
      // Animate slightly left, then remove optimistically with undo.
      s.card.classList.add("is-releasing");
      s.card.style.transform = "translateX(-140px)";
      setTimeout(() => {
        cleanup();
        actions.deleteTask(s.taskId, { withUndo: true });
      }, 170);
      return;
    }

    releaseToZero();
  },

  deleteWithUndo(taskId) {
    actions.deleteTask(taskId, { withUndo: true });
  },

  toggleSelect(taskId) {
    if (state.selectedTaskIds.has(taskId)) {
      state.selectedTaskIds.delete(taskId);
    } else {
      state.selectedTaskIds.add(taskId);
    }
    this.haptic("light");
    setState({});
  },

  clearSelection() {
    if (state.selectedTaskIds.size === 0) return;
    state.selectedTaskIds.clear();
    this.haptic("light");
    setState({});
  },

  renderBulkBar() {
    const bar = $id("bulkBar");
    const countEl = $id("bulkCount");
    if (!(bar instanceof HTMLElement) || !(countEl instanceof HTMLElement)) return;
    const n = state.selectedTaskIds.size;
    bar.hidden = n === 0;
    countEl.textContent = String(n);
  },

  bulkMarkDone() {
    const ids = Array.from(state.selectedTaskIds);
    if (!ids.length) return;
    state.selectedTaskIds.clear();
    actions.bulkDone(ids);
  },

  bulkDeleteWithUndo() {
    const ids = Array.from(state.selectedTaskIds);
    if (!ids.length) return;
    state.selectedTaskIds.clear();
    actions.bulkDelete(ids);
  },
  toggleDone(taskId) {
    actions.toggleDone(taskId);
  },

  openActionSheet(taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;

    state.actionSheetTaskId = taskId;

    const toggleBtn = $id("sheetToggleDone");
    const sheet = $id("actionSheet");
    if (toggleBtn) {
      const done = task.status === "done" || task.status === "cancelled";
      toggleBtn.textContent = done ? "Вернуть в активные" : "Отметить выполненной";
    }
    if (sheet) sheet.hidden = false;
  },

  closeActionSheet() {
    const sheet = $id("actionSheet");
    if (sheet) sheet.hidden = true;
    state.actionSheetTaskId = null;
  },

  openQuickAdd() {
    const wrap = $id("quickAdd");
    const input = $id("quickAddInput");
    if (!(wrap instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;

    state.quickAddOpen = true;
    wrap.hidden = false;
    input.focus();
  },

  closeQuickAdd() {
    const wrap = $id("quickAdd");
    const input = $id("quickAddInput");
    if (!(wrap instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;

    input.value = "";
    wrap.hidden = true;
    state.quickAddOpen = false;
  },

  async submitQuickAdd() {
    const input = $id("quickAddInput");
    if (!(input instanceof HTMLInputElement)) return;

    const title = input.value.trim();
    if (!title) {
      input.focus();
      return;
    }

    this.hideSuggest();
    this.closeQuickAdd();
    actions.quickAdd(title);
  },

  onQuickAddInput() {
    const input = $id("quickAddInput");
    if (!(input instanceof HTMLInputElement)) return;

    const ctx = this.getMentionContext(input.value, input.selectionStart ?? input.value.length);
    if (!ctx) {
      this.hideSuggest();
      return;
    }

    clearTimeout(state.suggestTimer);
    state.suggestTimer = setTimeout(() => {
      this.fetchSuggest(ctx.query);
    }, 150);
  },

  getMentionContext(value, cursorPos) {
    const left = value.slice(0, cursorPos);
    const at = left.lastIndexOf("@");
    if (at === -1) return null;
    // require boundary at start or whitespace
    if (at > 0 && !/\\s/.test(left[at - 1])) return null;
    const query = left.slice(at + 1);
    if (!/^[a-zA-Z0-9_]{0,32}$/.test(query)) return null;
    if (query.length < 1) return null;
    return { atIndex: at, query };
  },

  async fetchSuggest(query) {
    try {
      if (state.suggestAbort) state.suggestAbort.abort();
      state.suggestAbort = new AbortController();

      const data = await tasksApi.suggestUsers(query, { signal: state.suggestAbort.signal });
      const users = Array.isArray(data?.users) ? data.users : [];
      this.renderSuggest(users);
    } catch (err) {
      // ignore aborts
      if (String(err?.name) === "AbortError") return;
      this.hideSuggest();
    }
  },

  renderSuggest(users) {
    const box = $id("mentionSuggest");
    if (!(box instanceof HTMLElement)) return;
    if (!users.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.innerHTML = users
      .filter((u) => u.username)
      .slice(0, 10)
      .map((u) => {
        const handle = `@${u.username}`;
        const name = u.displayName ? this.escapeHtml(u.displayName) : "";
        return `<button class=\"suggest__item\" type=\"button\" data-username=\"${this.escapeHtml(u.username)}\"><span class=\"suggest__handle\">${handle}</span><span class=\"suggest__name\">${name}</span></button>`;
      })
      .join("");
    box.hidden = false;
  },

  hideSuggest() {
    const box = $id("mentionSuggest");
    if (!(box instanceof HTMLElement)) return;
    box.hidden = true;
    box.innerHTML = "";
  },

  applyMention(username) {
    const input = $id("quickAddInput");
    if (!(input instanceof HTMLInputElement)) return;

    const pos = input.selectionStart ?? input.value.length;
    const ctx = this.getMentionContext(input.value, pos);
    if (!ctx) return;

    const before = input.value.slice(0, ctx.atIndex);
    const after = input.value.slice(pos);
    input.value = `${before}@${username} ${after}`.replace(/\\s{2,}/g, " ");
    const newPos = (before + `@${username} `).length;
    input.setSelectionRange(newPos, newPos);
    input.focus();
    this.hideSuggest();
  },

  openFilterMenu() {
    if (!tg?.showPopup) {
      return;
    }

    tg.showPopup(
      {
        title: "Фильтр",
        message: "Выберите вкладку",
        buttons: [
          { id: "active", type: "default", text: "Активные" },
          { id: "done", type: "default", text: "Выполненные" },
          { id: "all", type: "default", text: "Все" },
          { id: "cancel", type: "close", text: "Закрыть" },
        ],
      },
      (buttonId) => {
        if (buttonId === "active" || buttonId === "done" || buttonId === "all") {
          setState({ tab: buttonId });
        }
      }
    );
  },

  formatDueBadge(dueDate) {
    if (!dueDate) return null;

    const due = new Date(dueDate);
    if (Number.isNaN(due.getTime())) return null;

    const now = new Date();
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (dueDay.getTime() < nowDay.getTime()) {
      return { label: "Просрочено", overdue: true };
    }

    if (dueDay.getTime() === nowDay.getTime()) {
      return { label: "Сегодня", overdue: false };
    }

    return {
      label: due.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }),
      overdue: false,
    };
  },

  priorityLabel(priority) {
    const labels = {
      urgent: "Срочно",
      high: "Высокий",
      low: "Низкий",
    };
    return labels[priority] || priority;
  },

  haptic(intensity) {
    tg?.HapticFeedback?.impactOccurred(intensity);
  },

  throttle(fn, waitMs) {
    let last = 0;
    let timer = null;
    return (...args) => {
      const now = Date.now();
      const remaining = waitMs - (now - last);
      if (remaining <= 0) {
        last = now;
        fn(...args);
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        last = Date.now();
        fn(...args);
      }, remaining);
    };
  },

  escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value;
    return div.innerHTML;
  },
};

// Keep backward compatibility for debugging.
window.app = tasksApp;

export { tasksApp, state };
