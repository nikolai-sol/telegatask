/**
 * Telegatask Mini App — lightweight mobile UI without frameworks.
 */

const tg = window.Telegram?.WebApp;
const INIT_DATA = tg?.initData || "";

const state = {
  tasks: [],
  tab: "active", // active | done | all
  loading: false,
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
      this.openCreateTask();
    });

    document.getElementById("filterMenuButton")?.addEventListener("click", () => {
      this.openFilterMenu();
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

      const deleteBtn = target.closest("[data-action='delete']");
      if (deleteBtn instanceof HTMLElement) {
        const taskId = deleteBtn.dataset.taskId;
        if (taskId) this.deleteTask(taskId);
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
    const title = this.escapeHtml(task.title || task.description || "Без названия");

    const dueChip = task.dueDate
      ? `<span class="chip ${this.isOverdue(task.dueDate) ? "chip--due-overdue" : ""}">${this.formatDue(task.dueDate)}</span>`
      : "";

    const projectChip = task.sourceChatTitle
      ? `<span class="chip">${this.escapeHtml(task.sourceChatTitle)}</span>`
      : "";

    const priorityChip = task.priority
      ? `<span class="chip chip--priority-${task.priority}">${this.priorityLabel(task.priority)}</span>`
      : "";

    return `
      <article class="task-card ${isDone ? "task-card--done" : ""}" data-task-id="${task.id}">
        <button class="task-card__check ${isDone ? "is-done" : ""}" data-action="toggle" data-task-id="${task.id}" type="button" aria-label="${isDone ? "Вернуть" : "Выполнить"}">${isDone ? "✓" : ""}</button>

        <div class="task-card__content">
          <p class="task-card__title ${isDone ? "is-done" : ""}">${title}</p>
          <div class="task-card__meta">
            ${dueChip}
            ${projectChip}
            ${priorityChip}
          </div>
        </div>

        <button class="task-card__delete" data-action="delete" data-task-id="${task.id}" type="button" aria-label="Удалить">🗑</button>
      </article>
    `;
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

  async deleteTask(taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;

    const taskTitle = task.title || task.description || "Эту задачу";
    const confirmed = await this.confirm(`Удалить задачу?\n${taskTitle}`);
    if (!confirmed) return;

    this.haptic("medium");

    const prevTasks = [...state.tasks];
    state.tasks = state.tasks.filter((item) => item.id !== taskId);
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

  async openCreateTask() {
    const title = await this.ask("Новая задача", "Введите текст задачи");
    if (!title) return;

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
        if (res.status === 404 || res.status === 405) {
          this.showToast("Создание задачи пока недоступно в API");
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      this.showToast("Сохранено");
      await this.loadTasks();
    } catch (error) {
      console.error("[MiniApp] createTask error", error);
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

  confirm(message) {
    return new Promise((resolve) => {
      if (tg?.showPopup) {
        tg.showPopup(
          {
            title: "Подтверждение",
            message,
            buttons: [
              { id: "yes", type: "destructive", text: "Удалить" },
              { id: "no", type: "cancel", text: "Отмена" },
            ],
          },
          (buttonId) => resolve(buttonId === "yes")
        );
        return;
      }

      resolve(window.confirm(message));
    });
  },

  ask(title, placeholder) {
    const value = window.prompt(`${title}\n${placeholder}`);
    return Promise.resolve((value || "").trim());
  },

  isOverdue(dueDate) {
    const due = new Date(dueDate).getTime();
    return Number.isFinite(due) && due < Date.now();
  },

  formatDue(dueDate) {
    const date = new Date(dueDate);
    if (Number.isNaN(date.getTime())) return "Без срока";

    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const dayDiff = Math.ceil(diff / (1000 * 60 * 60 * 24));

    if (dayDiff < 0) return `Просрочено ${Math.abs(dayDiff)}д`;
    if (dayDiff === 0) return "Сегодня";
    if (dayDiff === 1) return "Завтра";

    return date.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
    });
  },

  priorityLabel(priority) {
    const labels = {
      urgent: "Срочно",
      high: "Высокий",
      normal: "Обычный",
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
