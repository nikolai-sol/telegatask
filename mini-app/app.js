/**
 * Telegatask Mini App — lightweight mobile UI without frameworks.
 */

const tg = window.Telegram?.WebApp;
const INIT_DATA = tg?.initData || "";

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
};

const app = {
  sheetDrag: null,
  init() {
    if (tg) {
      tg.ready();
      tg.expand();
      tg.enableClosingConfirmation();
    }

    this.detectApiBase();
    this.bindUi();
    this.render();
    this.loadTasks();
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
    const tabs = document.querySelectorAll(".tab");
    tabs.forEach((tabBtn) => {
      tabBtn.addEventListener("click", () => {
        // Keep search/query/filters, but reset selection when switching tabs.
        if (state.selectedTaskIds.size > 0) {
          state.selectedTaskIds.clear();
        }
        state.tab = tabBtn.dataset.tab || "active";
        this.haptic("light");
        this.render();
      });
    });

    document.getElementById("retryButton")?.addEventListener("click", () => {
      this.loadTasks();
    });

    document.getElementById("fabAdd")?.addEventListener("click", () => {
      this.openQuickAdd();
    });

    document.getElementById("searchInput")?.addEventListener("input", () => {
      this.onSearchInput();
    });
    document.getElementById("searchClear")?.addEventListener("click", () => {
      this.clearSearch();
    });
    document.getElementById("filterChips")?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const btn = target.closest("[data-filter]");
      if (!(btn instanceof HTMLElement)) return;
      const key = btn.dataset.filter || "";
      this.toggleFilter(key);
    });

    document.getElementById("filterMenuButton")?.addEventListener("click", () => {
      this.openFilterMenu();
    });

    document.getElementById("quickAddSubmit")?.addEventListener("click", () => {
      this.submitQuickAdd();
    });

    document.getElementById("quickAddInput")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.submitQuickAdd();
      }
      if (event.key === "Escape") {
        this.closeQuickAdd();
      }
    });
    document.getElementById("quickAddInput")?.addEventListener("input", () => {
      this.onQuickAddInput();
    });
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("#mentionSuggest") || target.closest("#quickAdd")) return;
      this.hideSuggest();
    });

    document.getElementById("mentionSuggest")?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const item = target.closest("[data-username]");
      if (!(item instanceof HTMLElement)) return;
      const username = item.dataset.username;
      if (username) this.applyMention(username);
    });

    document.getElementById("sheetBackdrop")?.addEventListener("click", () => {
      this.closeActionSheet();
    });
    document.getElementById("sheetCancel")?.addEventListener("click", () => {
      this.closeActionSheet();
    });
    document.getElementById("sheetToggleDone")?.addEventListener("click", () => {
      const taskId = state.actionSheetTaskId;
      this.closeActionSheet();
      if (taskId) this.toggleDone(taskId);
    });
    document.getElementById("sheetDelete")?.addEventListener("click", () => {
      const taskId = state.actionSheetTaskId;
      this.closeActionSheet();
      if (taskId) this.deleteTask(taskId);
    });
    document.getElementById("sheetMove")?.addEventListener("click", () => {
      const taskId = state.actionSheetTaskId;
      this.closeActionSheet();
      if (taskId) this.openProjectPicker([taskId]);
    });

    document.getElementById("bulkCancel")?.addEventListener("click", () => {
      this.clearSelection();
    });
    document.getElementById("bulkDone")?.addEventListener("click", () => {
      this.bulkMarkDone();
    });
    document.getElementById("bulkMove")?.addEventListener("click", () => {
      const ids = Array.from(state.selectedTaskIds);
      if (!ids.length) return;
      this.openProjectPicker(ids);
    });
    document.getElementById("bulkDelete")?.addEventListener("click", () => {
      this.bulkDeleteWithUndo();
    });

    document.getElementById("projectBackdrop")?.addEventListener("click", () => {
      this.closeProjectPicker();
    });
    document.getElementById("projectCancel")?.addEventListener("click", () => {
      this.closeProjectPicker();
    });
    document.getElementById("projectList")?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const btn = target.closest("[data-project-id]");
      if (!(btn instanceof HTMLElement)) return;
      const projectId = btn.dataset.projectId || "";
      this.applyProjectToPickedTasks(projectId || null);
    });

    document.getElementById("sheetOverlay")?.addEventListener("click", () => {
      this.closeTaskSheet();
    });
    document.getElementById("taskSheetClose")?.addEventListener("click", () => {
      this.closeTaskSheet();
    });
    document.getElementById("taskSheetTitle")?.addEventListener("input", () => {
      this.onTaskSheetChangeDebounced();
    });
    document.getElementById("taskSheet")?.addEventListener("click", (event) => {
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
    document.getElementById("taskSheetDone")?.addEventListener("click", () => {
      const taskId = state.taskSheetTaskId;
      if (taskId) this.toggleDone(taskId);
    });
    document.getElementById("taskSheetDelete")?.addEventListener("click", () => {
      const taskId = state.taskSheetTaskId;
      if (!taskId) return;
      this.closeTaskSheet();
      this.deleteWithUndo(taskId);
    });

    document.getElementById("taskList")?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

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

    const list = document.getElementById("taskList");
    list?.addEventListener("pointerdown", (event) => this.onSwipePointerDown(event));
    list?.addEventListener("pointermove", (event) => this.onSwipePointerMove(event));
    list?.addEventListener("pointerup", (event) => this.onSwipePointerUp(event));
    list?.addEventListener("pointercancel", (event) => this.onSwipePointerUp(event));

    // Swipe down to close details sheet (optional)
    const sheet = document.getElementById("taskSheet");
    sheet?.addEventListener("pointerdown", (event) => this.onSheetPointerDown(event));
    sheet?.addEventListener("pointermove", (event) => this.onSheetPointerMove(event));
    sheet?.addEventListener("pointerup", (event) => this.onSheetPointerUp(event));
    sheet?.addEventListener("pointercancel", (event) => this.onSheetPointerUp(event));
  },

  async loadTasks() {
    state.loading = true;
    this.render();

    try {
      const base = this.getApiBase();
      const res = await fetch(`${base}/api/tasks`, {
        headers: {
          "X-Telegram-Init-Data": INIT_DATA,
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      state.tasks = Array.isArray(data.tasks) ? data.tasks : [];
      state.loading = false;
      this.render();
    } catch (error) {
      console.error("[MiniApp] loadTasks error", error);
      state.loading = false;
      this.showErrorState();
    }
  },

  getFilteredTasks() {
    const activeStatuses = ["incoming", "new", "in_progress", "waiting"];

    if (state.tab === "active") {
      return state.tasks.filter((task) => activeStatuses.includes(task.status));
    }

    if (state.tab === "done") {
      return state.tasks.filter((task) => task.status === "done" || task.status === "cancelled");
    }

    return [...state.tasks];
  },

  applyFilters(tasks) {
    let out = [...tasks];

    const query = (state.query || "").trim().toLowerCase();
    if (query) {
      out = out.filter((t) => {
        const hay = String(t.title || t.description || "").toLowerCase();
        return hay.includes(query);
      });
    }

    const f = state.filters || { today: false, overdue: false, p1: false, nodue: false };
    if (f.p1) {
      out = out.filter((t) => (t.priority || "normal") === "urgent");
    }
    if (f.nodue) {
      out = out.filter((t) => !t.dueDate);
    }
    if (f.today || f.overdue) {
      out = out.filter((t) => {
        const tag = this.computeDueTag(t.dueDate);
        if (f.today && tag !== "today") return false;
        if (f.overdue && tag !== "overdue") return false;
        return true;
      });
    }

    return out;
  },

  computeDueTag(dueDate) {
    if (!dueDate) return "none";
    const due = new Date(dueDate);
    if (Number.isNaN(due.getTime())) return "none";
    const now = new Date();
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (dueDay.getTime() < nowDay.getTime()) return "overdue";
    if (dueDay.getTime() === nowDay.getTime()) return "today";
    return "future";
  },

  sortTasks(tasks) {
    const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };

    return [...tasks].sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 2;
      const pb = priorityOrder[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  },

  render() {
    const loadingEl = document.getElementById("loadingState");
    const emptyEl = document.getElementById("emptyState");
    const errorEl = document.getElementById("errorState");
    const listEl = document.getElementById("taskList");

    if (!loadingEl || !emptyEl || !errorEl || !listEl) return;

    this.renderTabs();

    if (state.loading) {
      loadingEl.hidden = false;
      emptyEl.hidden = true;
      errorEl.hidden = true;
      listEl.hidden = true;
      this.renderSearchUi();
      return;
    }

    const tasks = this.sortTasks(this.applyFilters(this.getFilteredTasks()));
    this.renderSearchUi();

    loadingEl.hidden = true;
    errorEl.hidden = true;

    if (!tasks.length) {
      this.renderEmptyState();
      emptyEl.hidden = false;
      listEl.hidden = true;
      return;
    }

    emptyEl.hidden = true;
    listEl.hidden = false;
    listEl.innerHTML = tasks.map((task) => this.renderTaskCard(task)).join("");
    this.hydrateExpandableText();
    this.renderBulkBar();
  },

  renderTabs() {
    document.querySelectorAll(".tab").forEach((tabBtn) => {
      tabBtn.classList.toggle("active", tabBtn.dataset.tab === state.tab);
    });
  },

  renderEmptyState() {
    const textEl = document.getElementById("emptyStateText");
    if (!textEl) return;

    const anyFilter =
      (state.query || "").trim().length > 0 ||
      Object.values(state.filters || {}).some(Boolean);
    if (anyFilter) {
      textEl.textContent = "Ничего не найдено";
      return;
    }

    if (state.tab === "active") {
      textEl.textContent = "Нет активных задач 🎉";
      return;
    }

    if (state.tab === "done") {
      textEl.textContent = "Нет выполненных задач";
      return;
    }

    textEl.textContent = "Пока задач нет";
  },

  showErrorState() {
    const loadingEl = document.getElementById("loadingState");
    const emptyEl = document.getElementById("emptyState");
    const errorEl = document.getElementById("errorState");
    const listEl = document.getElementById("taskList");

    if (!loadingEl || !emptyEl || !errorEl || !listEl) return;

    loadingEl.hidden = true;
    emptyEl.hidden = true;
    listEl.hidden = true;
    errorEl.hidden = false;
  },

  renderSearchUi() {
    const input = document.getElementById("searchInput");
    const clear = document.getElementById("searchClear");
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

    document.querySelectorAll("#filterChips [data-filter]").forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const k = el.dataset.filter;
      if (!k) return;
      el.classList.toggle("is-active", Boolean(state.filters && state.filters[k]));
    });
  },

  onSearchInput() {
    const input = document.getElementById("searchInput");
    if (!(input instanceof HTMLInputElement)) return;
    const next = input.value;

    const clear = document.getElementById("searchClear");
    if (clear instanceof HTMLElement) clear.hidden = next.trim().length === 0;

    clearTimeout(state.queryTimer);
    state.queryTimer = setTimeout(() => {
      state.query = next;
      this.render();
    }, 200);
  },

  clearSearch() {
    const input = document.getElementById("searchInput");
    if (input instanceof HTMLInputElement) {
      input.value = "";
      input.focus();
    }
    state.query = "";
    clearTimeout(state.queryTimer);
    this.render();
  },

  toggleFilter(key) {
    if (!state.filters || !(key in state.filters)) return;
    state.filters[key] = !state.filters[key];
    this.haptic("light");
    this.render();
  },

  renderTaskCard(task) {
    const isDone = task.status === "done" || task.status === "cancelled";
    const isExpanded = state.expandedTaskIds.has(task.id);
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
        <article class="task-card ${isDone ? "task-card--done" : ""} ${isExpanded ? "is-expanded" : ""}" data-task-id="${task.id}">
          <button class="task-card__check ${isSelected ? "is-done" : ""}" data-action="toggle" data-task-id="${task.id}" type="button" aria-label="${isSelected ? "Снять выбор" : "Выбрать"}">
            <span class="task-card__check-circle">${isSelected ? "✓" : ""}</span>
          </button>

          <div class="task-card__content">
            <p class="task-card__title ${isDone ? "is-done" : ""}" data-role="title">${title}</p>
            <button class="task-card__expand" data-action="expand" data-task-id="${task.id}" type="button">Показать</button>
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

  openTaskSheet(taskId) {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;

    state.taskSheetTaskId = taskId;

    const overlay = document.getElementById("sheetOverlay");
    const sheet = document.getElementById("taskSheet");
    const titleInput = document.getElementById("taskSheetTitle");
    const projectEl = document.getElementById("taskSheetProject");

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
    const overlay = document.getElementById("sheetOverlay");
    const sheet = document.getElementById("taskSheet");
    if (!(overlay instanceof HTMLElement) || !(sheet instanceof HTMLElement)) return;
    sheet.classList.remove("is-open");
    setTimeout(() => {
      overlay.hidden = true;
      sheet.hidden = true;
    }, 190);
    state.taskSheetTaskId = null;
  },

  syncTaskSheetChips(task) {
    const sheet = document.getElementById("taskSheet");
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
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;

    let dueDate = null;
    if (kind === "today" || kind === "tomorrow") {
      const now = new Date();
      const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
      if (kind === "tomorrow") base.setDate(base.getDate() + 1);
      dueDate = base.toISOString();
    }

    task.dueDate = dueDate;
    this.syncTaskSheetChips(task);
    this.render();
    this.onTaskSheetChangeDebounced();
  },

  setTaskSheetPriority(priority) {
    const taskId = state.taskSheetTaskId;
    if (!taskId) return;
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;
    task.priority = priority;
    this.syncTaskSheetChips(task);
    this.render();
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
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;

    const titleEl = document.getElementById("taskSheetTitle");
    const title = titleEl instanceof HTMLInputElement ? titleEl.value.trim() : (task.title || task.description || "");

    // optimistic already in UI; keep state consistent
    task.title = title;
    task.description = title;
    this.render();

    try {
      const base = this.getApiBase();
      const res = await fetch(`${base}/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: {
          "X-Telegram-Init-Data": INIT_DATA,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          dueDate: task.dueDate ?? null,
          priority: task.priority ?? "normal",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.haptic("light");
    } catch (err) {
      console.error("[MiniApp] task patch failed", err);
      this.showToast("Ошибка, попробуйте ещё раз");
      // Resync is safest
      this.loadTasks();
    }
  },

  onSheetPointerDown(event) {
    if (!(event instanceof PointerEvent)) return;
    const sheet = document.getElementById("taskSheet");
    if (!(sheet instanceof HTMLElement) || sheet.hidden) return;
    // Only if started on header/handle area
    if (!event.target || !(event.target instanceof Element)) return;
    if (!event.target.closest(".task-sheet__header") && !event.target.closest(".task-sheet__handle")) return;
    this.sheetDrag = { id: event.pointerId, y0: event.clientY, dy: 0, locked: false };
    sheet.setPointerCapture(event.pointerId);
  },

  onSheetPointerMove(event) {
    if (!(event instanceof PointerEvent)) return;
    const sheet = document.getElementById("taskSheet");
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
    const sheet = document.getElementById("taskSheet");
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
      const base = this.getApiBase();
      const res = await fetch(`${base}/api/projects`, {
        headers: {
          "X-Telegram-Init-Data": INIT_DATA,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data.projects) ? data.projects : [];
      state.projects = { activeTeamId: data.activeTeamId ?? null, list };
    } catch (err) {
      // non-fatal
    }
  },

  async openProjectPicker(taskIds) {
    state.projectPicker = { taskIds: [...taskIds] };
    await this.loadProjects();

    const sheet = document.getElementById("projectSheet");
    const listEl = document.getElementById("projectList");
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
    const sheet = document.getElementById("projectSheet");
    if (sheet) sheet.hidden = true;
    state.projectPicker = null;
  },

  async applyProjectToPickedTasks(projectId) {
    const picked = state.projectPicker?.taskIds || [];
    if (!picked.length) {
      this.closeProjectPicker();
      return;
    }

    // Optimistic update
    const prev = new Map();
    for (const id of picked) {
      const t = state.tasks.find((x) => x.id === id);
      if (!t) continue;
      prev.set(id, t.projectId ?? null);
      t.projectId = projectId;
    }
    state.selectedTaskIds.clear();
    this.closeProjectPicker();
    this.render();
    this.showToast("Сохранено");

    const base = this.getApiBase();
    const failures = [];
    for (const id of picked) {
      try {
        const res = await fetch(`${base}/api/tasks/${id}/project`, {
          method: "POST",
          headers: {
            "X-Telegram-Init-Data": INIT_DATA,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ projectId }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        failures.push(id);
      }
    }

    if (failures.length) {
      for (const id of failures) {
        const t = state.tasks.find((x) => x.id === id);
        if (t && prev.has(id)) t.projectId = prev.get(id);
      }
      this.render();
      this.showToast("Ошибка, попробуйте ещё раз");
    }
  },

  hydrateExpandableText() {
    const cards = document.querySelectorAll(".task-card");

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
    this.render();
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
      setTimeout(() => this.toggleDone(s.taskId), 140);
      return;
    }

    if (dx < -80) {
      // Animate slightly left, then remove optimistically with undo.
      s.card.classList.add("is-releasing");
      s.card.style.transform = "translateX(-140px)";
      setTimeout(() => {
        cleanup();
        this.deleteWithUndo(s.taskId);
      }, 170);
      return;
    }

    releaseToZero();
  },

  deleteWithUndo(taskId) {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;

    // Finalize previous pending delete immediately to keep UX simple.
    if (state.pendingDelete) {
      clearTimeout(state.pendingDelete.timerId);
      state.pendingDelete.tasks.forEach((t) => this.finalizeDelete(t.id));
      state.pendingDelete = null;
    }

    state.tasks = state.tasks.filter((t) => t.id !== taskId);
    this.render();

    const timerId = setTimeout(() => {
      if (!state.pendingDelete || state.pendingDelete.kind !== "single") return;
      if (state.pendingDelete.tasks[0]?.id !== taskId) return;
      state.pendingDelete = null;
      this.finalizeDelete(taskId);
    }, 5000);

    state.pendingDelete = { kind: "single", tasks: [task], timerId };

    this.showToast("Удалено", {
      actionLabel: "Undo",
      durationMs: 5000,
      onAction: () => {
        if (!state.pendingDelete || state.pendingDelete.kind !== "single") return;
        if (state.pendingDelete.tasks[0]?.id !== taskId) return;
        clearTimeout(state.pendingDelete.timerId);
        const restored = state.pendingDelete.tasks[0];
        state.pendingDelete = null;
        state.tasks.unshift(restored);
        this.render();
        this.showToast("Отменено");
      },
    });
  },

  async finalizeDelete(taskId) {
    try {
      const base = this.getApiBase();
      const res = await fetch(`${base}/api/tasks/${taskId}`, {
        method: "DELETE",
        headers: {
          "X-Telegram-Init-Data": INIT_DATA,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (error) {
      console.error("[MiniApp] finalizeDelete error", error);
      this.showToast("Ошибка удаления");
      // Best-effort resync
      this.loadTasks();
    }
  },

  toggleSelect(taskId) {
    if (state.selectedTaskIds.has(taskId)) {
      state.selectedTaskIds.delete(taskId);
    } else {
      state.selectedTaskIds.add(taskId);
    }
    this.haptic("light");
    this.renderBulkBar();
    // Update only checkmarks quickly by rerendering list (simple and consistent)
    this.render();
  },

  clearSelection() {
    if (state.selectedTaskIds.size === 0) return;
    state.selectedTaskIds.clear();
    this.haptic("light");
    this.render();
  },

  renderBulkBar() {
    const bar = document.getElementById("bulkBar");
    const countEl = document.getElementById("bulkCount");
    if (!(bar instanceof HTMLElement) || !(countEl instanceof HTMLElement)) return;
    const n = state.selectedTaskIds.size;
    bar.hidden = n === 0;
    countEl.textContent = String(n);
  },

  async bulkMarkDone() {
    const ids = Array.from(state.selectedTaskIds);
    if (!ids.length) return;

    // optimistic
    const prev = new Map();
    for (const id of ids) {
      const t = state.tasks.find((x) => x.id === id);
      if (!t) continue;
      prev.set(id, t.status);
      t.status = "done";
    }

    this.clearSelection();
    this.showToast("Сохранено");
    this.render();

    // fire API calls (best-effort)
    const base = this.getApiBase();
    const failures = [];
    for (const id of ids) {
      try {
        const res = await fetch(`${base}/api/tasks/${id}/status`, {
          method: "POST",
          headers: {
            "X-Telegram-Init-Data": INIT_DATA,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: "done" }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        failures.push(id);
      }
    }

    if (failures.length) {
      for (const id of failures) {
        const t = state.tasks.find((x) => x.id === id);
        if (t && prev.has(id)) t.status = prev.get(id);
      }
      this.render();
      this.showToast("Ошибка, попробуйте ещё раз");
    }
  },

  bulkDeleteWithUndo() {
    const ids = Array.from(state.selectedTaskIds);
    if (!ids.length) return;

    // Cancel selection immediately
    state.selectedTaskIds.clear();

    // For now: if there is a pending delete, finalize it
    if (state.pendingDelete) {
      clearTimeout(state.pendingDelete.timerId);
      state.pendingDelete.tasks.forEach((t) => this.finalizeDelete(t.id));
      state.pendingDelete = null;
    }

    const removed = state.tasks.filter((t) => ids.includes(t.id));
    if (!removed.length) return;

    state.tasks = state.tasks.filter((t) => !ids.includes(t.id));
    this.haptic("medium");
    this.render();

    const timerId = setTimeout(() => {
      if (!state.pendingDelete || state.pendingDelete.kind !== "bulk") return;
      state.pendingDelete = null;
      // finalize all
      removed.forEach((t) => this.finalizeDelete(t.id));
    }, 5000);

    state.pendingDelete = { kind: "bulk", tasks: removed, timerId };

    this.showToast("Удалено", {
      actionLabel: "Undo",
      durationMs: 5000,
      onAction: () => {
        if (!state.pendingDelete || state.pendingDelete.kind !== "bulk") return;
        clearTimeout(state.pendingDelete.timerId);
        state.pendingDelete = null;
        // restore at top preserving order
        state.tasks = [...removed, ...state.tasks];
        this.render();
        this.showToast("Отменено");
      },
    });
  },

  async toggleDone(taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;

    const prevStatus = task.status;
    const nextStatus = prevStatus === "done" ? "incoming" : "done";

    task.status = nextStatus;
    this.haptic("light");
    this.render();

    try {
      const base = this.getApiBase();
      const res = await fetch(`${base}/api/tasks/${taskId}/status`, {
        method: "POST",
        headers: {
          "X-Telegram-Init-Data": INIT_DATA,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: nextStatus }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      this.showToast("Сохранено");
    } catch (error) {
      console.error("[MiniApp] toggleDone error", error);
      task.status = prevStatus;
      this.render();
      this.showToast("Ошибка, попробуйте ещё раз");
    }
  },

  openActionSheet(taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;

    state.actionSheetTaskId = taskId;

    const toggleBtn = document.getElementById("sheetToggleDone");
    const sheet = document.getElementById("actionSheet");
    if (toggleBtn) {
      const done = task.status === "done" || task.status === "cancelled";
      toggleBtn.textContent = done ? "Вернуть в активные" : "Отметить выполненной";
    }
    if (sheet) sheet.hidden = false;
  },

  closeActionSheet() {
    const sheet = document.getElementById("actionSheet");
    if (sheet) sheet.hidden = true;
    state.actionSheetTaskId = null;
  },

  async deleteTask(taskId) {
    const prevTasks = [...state.tasks];
    state.tasks = state.tasks.filter((item) => item.id !== taskId);
    this.haptic("medium");
    this.render();

    try {
      const base = this.getApiBase();
      const res = await fetch(`${base}/api/tasks/${taskId}`, {
        method: "DELETE",
        headers: {
          "X-Telegram-Init-Data": INIT_DATA,
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      this.showToast("Удалено");
    } catch (error) {
      console.error("[MiniApp] deleteTask error", error);
      state.tasks = prevTasks;
      this.render();
      this.showToast("Ошибка, попробуйте ещё раз");
    }
  },

  openQuickAdd() {
    const wrap = document.getElementById("quickAdd");
    const input = document.getElementById("quickAddInput");
    if (!(wrap instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;

    state.quickAddOpen = true;
    wrap.hidden = false;
    input.focus();
  },

  closeQuickAdd() {
    const wrap = document.getElementById("quickAdd");
    const input = document.getElementById("quickAddInput");
    if (!(wrap instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;

    input.value = "";
    wrap.hidden = true;
    state.quickAddOpen = false;
  },

  async submitQuickAdd() {
    const input = document.getElementById("quickAddInput");
    if (!(input instanceof HTMLInputElement)) return;

    const title = input.value.trim();
    if (!title) {
      input.focus();
      return;
    }

    this.hideSuggest();

    const tempId = `tmp-${Date.now()}`;
    const tempTask = {
      id: tempId,
      title,
      description: title,
      status: "new",
      priority: "normal",
      createdAt: new Date().toISOString(),
    };

    input.value = "";
    state.tab = "active";
    state.tasks.unshift(tempTask);
    this.haptic("light");
    this.render();

    try {
      const base = this.getApiBase();
      const res = await fetch(`${base}/api/tasks`, {
        method: "POST",
        headers: {
          "X-Telegram-Init-Data": INIT_DATA,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json().catch(() => null);
      const created = data?.task && data.task.id ? data.task : null;

      if (created) {
        const idx = state.tasks.findIndex((t) => t.id === tempId);
        if (idx !== -1) state.tasks[idx] = created;
        this.render();
      } else {
        await this.loadTasks();
      }

      this.showToast("Сохранено");
    } catch (error) {
      console.error("[MiniApp] quick add failed", error);
      state.tasks = state.tasks.filter((item) => item.id !== tempId);
      this.render();
      this.showToast("Ошибка, попробуйте ещё раз");
    }
  },

  onQuickAddInput() {
    const input = document.getElementById("quickAddInput");
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
      const base = this.getApiBase();
      if (state.suggestAbort) state.suggestAbort.abort();
      state.suggestAbort = new AbortController();

      const res = await fetch(`${base}/api/users/suggest?q=${encodeURIComponent(query)}`, {
        headers: {
          "X-Telegram-Init-Data": INIT_DATA,
          "Content-Type": "application/json",
        },
        signal: state.suggestAbort.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const users = Array.isArray(data.users) ? data.users : [];
      this.renderSuggest(users);
    } catch (err) {
      // ignore aborts
      if (String(err?.name) === "AbortError") return;
      this.hideSuggest();
    }
  },

  renderSuggest(users) {
    const box = document.getElementById("mentionSuggest");
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
    const box = document.getElementById("mentionSuggest");
    if (!(box instanceof HTMLElement)) return;
    box.hidden = true;
    box.innerHTML = "";
  },

  applyMention(username) {
    const input = document.getElementById("quickAddInput");
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
          state.tab = buttonId;
          this.render();
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

  showToast(message, opts = null) {
    const toast = document.getElementById("toast");
    if (!toast) return;

    const actionLabel = opts && opts.actionLabel ? String(opts.actionLabel) : null;
    const onAction = opts && typeof opts.onAction === "function" ? opts.onAction : null;
    const durationMs = opts && typeof opts.durationMs === "number" ? opts.durationMs : 2200;

    if (actionLabel && onAction) {
      toast.innerHTML = `<span class=\"toast__text\"></span><button class=\"toast__btn\" type=\"button\"></button>`;
      const textEl = toast.querySelector(".toast__text");
      const btn = toast.querySelector(".toast__btn");
      if (textEl) textEl.textContent = message;
      if (btn) {
        btn.textContent = actionLabel;
        btn.onclick = () => onAction();
      }
    } else {
      toast.textContent = message;
    }

    toast.hidden = false;

    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, durationMs);
  },

  escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value;
    return div.innerHTML;
  },
};

document.addEventListener("DOMContentLoaded", () => app.init());
window.app = app;
