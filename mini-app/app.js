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
};

const app = {
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

    document.getElementById("taskList")?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const toggleBtn = target.closest("[data-action='toggle']");
      if (toggleBtn instanceof HTMLElement) {
        const taskId = toggleBtn.dataset.taskId;
        if (taskId) this.toggleDone(taskId);
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
      return;
    }

    const tasks = this.sortTasks(this.getFilteredTasks());

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
  },

  renderTabs() {
    document.querySelectorAll(".tab").forEach((tabBtn) => {
      tabBtn.classList.toggle("active", tabBtn.dataset.tab === state.tab);
    });
  },

  renderEmptyState() {
    const textEl = document.getElementById("emptyStateText");
    if (!textEl) return;

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

  renderTaskCard(task) {
    const isDone = task.status === "done" || task.status === "cancelled";
    const isExpanded = state.expandedTaskIds.has(task.id);
    const title = this.escapeHtml(task.title || task.description || "Без названия");

    const due = this.formatDueBadge(task.dueDate);
    const dueChip = due
      ? `<span class="chip ${due.overdue ? "chip--due-overdue" : ""}">${due.label}</span>`
      : "";

    const projectChip = task.sourceChatTitle
      ? `<span class="chip">${this.escapeHtml(task.sourceChatTitle)}</span>`
      : "";

    const priorityChip = task.priority && task.priority !== "normal"
      ? `<span class="chip chip--priority-${task.priority}">${this.priorityLabel(task.priority)}</span>`
      : "";

    return `
      <article class="task-card ${isDone ? "task-card--done" : ""} ${isExpanded ? "is-expanded" : ""}" data-task-id="${task.id}">
        <button class="task-card__check ${isDone ? "is-done" : ""}" data-action="toggle" data-task-id="${task.id}" type="button" aria-label="${isDone ? "Вернуть" : "Выполнить"}">
          <span class="task-card__check-circle">✓</span>
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
    `;
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
        body: JSON.stringify({ title, description: title }),
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

  showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;

    toast.textContent = message;
    toast.hidden = false;

    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 2200);
  },

  escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value;
    return div.innerHTML;
  },
};

document.addEventListener("DOMContentLoaded", () => app.init());
window.app = app;
