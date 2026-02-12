/**
 * Telegatask Mini App — Task Manager
 * Communicates with bot backend via REST API
 */

const tg = window.Telegram?.WebApp;

// ─── Config ───
const API_BASE = window.__TELEGATASK_API__ || ""; // Will be set from env / config
const INIT_DATA = tg?.initData || "";

// ─── State ───
const state = {
  tasks: [],
  filter: "active", // active | done | all
  pendingAction: null, // { type: 'done'|'delete', taskId }
};

// ─── App ───
const app = {
  /** Initialize the app */
  init() {
    if (tg) {
      tg.ready();
      tg.expand();
      tg.enableClosingConfirmation();
    }

    this.bindFilters();
    this.detectApiBase();
    this.loadTasks();
  },

  /** Detect API base URL from meta tag or Telegram start_param */
  detectApiBase() {
    // Priority: 1) explicit global, 2) meta tag, 3) start_param, 4) same origin
    if (API_BASE) return;

    const meta = document.querySelector('meta[name="api-base"]');
    if (meta) {
      window.__TELEGATASK_API__ = meta.content;
      return;
    }

    // Try to get from Telegram start_param (format: api_<encoded_url>)
    const startParam = tg?.initDataUnsafe?.start_param || "";
    if (startParam.startsWith("api_")) {
      try {
        window.__TELEGATASK_API__ = atob(startParam.slice(4));
        return;
      } catch (e) { /* ignore */ }
    }

    // Fallback: use window config or relative path
    window.__TELEGATASK_API__ = "";
  },

  /** Get the API base URL */
  getApiBase() {
    return window.__TELEGATASK_API__ || "";
  },

  /** Bind filter button events */
  bindFilters() {
    document.querySelectorAll(".filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelector(".filter-btn.active")?.classList.remove("active");
        btn.classList.add("active");
        state.filter = btn.dataset.filter;
        this.renderTasks();
      });
    });
  },

  /** Fetch tasks from API */
  async loadTasks() {
    this.showLoading();

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
      state.tasks = data.tasks || [];
      this.renderTasks();
    } catch (err) {
      console.error("[MiniApp] loadTasks error:", err);
      this.showError();
    }
  },

  /** Filter tasks based on current filter */
  getFilteredTasks() {
    const active = ["incoming", "new", "in_progress", "waiting"];
    switch (state.filter) {
      case "active":
        return state.tasks.filter((t) => active.includes(t.status));
      case "done":
        return state.tasks.filter((t) => t.status === "done" || t.status === "cancelled");
      case "all":
        return state.tasks;
      default:
        return state.tasks;
    }
  },

  /** Render the task list */
  renderTasks() {
    const tasks = this.getFilteredTasks();
    const listEl = document.getElementById("task-list");
    const emptyEl = document.getElementById("empty");
    const loadingEl = document.getElementById("loading");
    const errorEl = document.getElementById("error");

    loadingEl.style.display = "none";
    errorEl.style.display = "none";

    if (tasks.length === 0) {
      listEl.style.display = "none";
      emptyEl.style.display = "block";
      return;
    }

    emptyEl.style.display = "none";
    listEl.style.display = "block";

    listEl.innerHTML = tasks
      .sort((a, b) => {
        // Priority order: urgent > high > normal > low
        const prio = { urgent: 0, high: 1, normal: 2, low: 3 };
        const pa = prio[a.priority] ?? 2;
        const pb = prio[b.priority] ?? 2;
        if (pa !== pb) return pa - pb;
        // Then by date desc
        return new Date(b.createdAt) - new Date(a.createdAt);
      })
      .map((task) => this.renderTaskCard(task))
      .join("");
  },

  /** Render a single task card */
  renderTaskCard(task) {
    const isDone = task.status === "done" || task.status === "cancelled";
    const doneClass = isDone ? "task-card--done" : "";

    const priorityTag =
      task.priority && task.priority !== "normal"
        ? `<span class="task-card__tag tag--priority-${task.priority}">${this.priorityLabel(task.priority)}</span>`
        : "";

    const dueTag = task.dueDate ? this.renderDueTag(task.dueDate) : "";

    const statusTag =
      task.status === "in_progress"
        ? `<span class="task-card__tag tag--status">В работе</span>`
        : task.status === "waiting"
          ? `<span class="task-card__tag tag--status">Ожидание</span>`
          : "";

    return `
      <div class="task-card ${doneClass}" data-id="${task.id}">
        <div class="task-card__inner">
          <div class="task-card__check" onclick="app.toggleDone('${task.id}')"></div>
          <div class="task-card__body">
            <div class="task-card__title">${this.escapeHtml(task.title)}</div>
            <div class="task-card__meta">
              ${priorityTag}${statusTag}${dueTag}
            </div>
          </div>
        </div>
        <div class="task-card__actions">
          <button class="task-card__action" onclick="app.toggleDone('${task.id}')">
            ${isDone ? "↩️ Вернуть" : "✓ Выполнено"}
          </button>
          <button class="task-card__action task-card__action--delete" onclick="app.confirmDelete('${task.id}')">
            🗑 Удалить
          </button>
        </div>
      </div>
    `;
  },

  /** Toggle task done status */
  async toggleDone(taskId) {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;

    const isDone = task.status === "done";
    const newStatus = isDone ? "incoming" : "done";

    // Optimistic update
    task.status = newStatus;
    this.renderTasks();

    if (tg) tg.HapticFeedback?.impactOccurred("light");

    try {
      const base = this.getApiBase();
      const res = await fetch(`${base}/api/tasks/${taskId}/status`, {
        method: "POST",
        headers: {
          "X-Telegram-Init-Data": INIT_DATA,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      this.showToast(isDone ? "Задача возвращена" : "✓ Выполнено");
    } catch (err) {
      console.error("[MiniApp] toggleDone error:", err);
      // Revert
      task.status = isDone ? "done" : "incoming";
      this.renderTasks();
      this.showToast("Ошибка, попробуйте снова");
    }
  },

  /** Show delete confirmation */
  confirmDelete(taskId) {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;

    if (tg) tg.HapticFeedback?.impactOccurred("medium");

    state.pendingAction = { type: "delete", taskId };

    const modal = document.getElementById("modal");
    document.getElementById("modal-title").textContent = "Удалить задачу?";
    document.getElementById("modal-subtitle").textContent = task.title;

    const confirmBtn = document.getElementById("modal-confirm");
    confirmBtn.textContent = "Удалить";
    confirmBtn.className = "modal__btn modal__btn--confirm destructive";
    confirmBtn.onclick = () => this.executeDelete(taskId);

    modal.style.display = "block";
  },

  /** Execute delete */
  async executeDelete(taskId) {
    this.closeModal();

    const card = document.querySelector(`.task-card[data-id="${taskId}"]`);
    if (card) card.classList.add("removing");

    if (tg) tg.HapticFeedback?.notificationOccurred("warning");

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

      // Remove from state after animation
      setTimeout(() => {
        state.tasks = state.tasks.filter((t) => t.id !== taskId);
        this.renderTasks();
        this.showToast("Задача удалена");
      }, 300);
    } catch (err) {
      console.error("[MiniApp] delete error:", err);
      if (card) card.classList.remove("removing");
      this.showToast("Ошибка при удалении");
    }
  },

  /** Close modal */
  closeModal() {
    document.getElementById("modal").style.display = "none";
    state.pendingAction = null;
  },

  /** Show toast notification */
  showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.style.display = "block";

    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.style.display = "none";
    }, 2500);
  },

  /** Show loading state */
  showLoading() {
    document.getElementById("loading").style.display = "flex";
    document.getElementById("error").style.display = "none";
    document.getElementById("empty").style.display = "none";
    document.getElementById("task-list").style.display = "none";
  },

  /** Show error state */
  showError() {
    document.getElementById("loading").style.display = "none";
    document.getElementById("error").style.display = "block";
    document.getElementById("empty").style.display = "none";
    document.getElementById("task-list").style.display = "none";
  },

  /** Priority label */
  priorityLabel(p) {
    const map = { urgent: "Срочно", high: "Высокий", normal: "Обычный", low: "Низкий" };
    return map[p] || p;
  },

  /** Render due date tag */
  renderDueTag(dueDate) {
    const now = new Date();
    const due = new Date(dueDate);
    const diffMs = due - now;
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    let label, className;
    if (diffDays < 0) {
      label = `Просрочено ${Math.abs(diffDays)}д`;
      className = "tag--overdue";
    } else if (diffDays === 0) {
      label = "Сегодня";
      className = "tag--overdue";
    } else if (diffDays === 1) {
      label = "Завтра";
      className = "tag--due";
    } else {
      const d = due.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
      label = d;
      className = "tag--due";
    }

    return `<span class="task-card__tag ${className}">${label}</span>`;
  },

  /** Escape HTML */
  escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  },
};

// Start the app
document.addEventListener("DOMContentLoaded", () => app.init());
