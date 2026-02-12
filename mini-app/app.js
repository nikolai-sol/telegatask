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
  swipe: null, // active swipe session
  pendingDelete: null, // { task, timerId }
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

    const list = document.getElementById("taskList");
    list?.addEventListener("pointerdown", (event) => this.onSwipePointerDown(event));
    list?.addEventListener("pointermove", (event) => this.onSwipePointerMove(event));
    list?.addEventListener("pointerup", (event) => this.onSwipePointerUp(event));
    list?.addEventListener("pointercancel", (event) => this.onSwipePointerUp(event));
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
      <div class="task-swipe" data-task-id="${task.id}">
        <div class="task-swipe-bg" aria-hidden="true">
          <div class="bg-left">✅ Выполнено</div>
          <div class="bg-right">🗑 Удалить</div>
        </div>
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
      </div>
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
      this.finalizeDelete(state.pendingDelete.task.id);
      state.pendingDelete = null;
    }

    state.tasks = state.tasks.filter((t) => t.id !== taskId);
    this.render();

    const timerId = setTimeout(() => {
      if (!state.pendingDelete || state.pendingDelete.task.id !== taskId) return;
      state.pendingDelete = null;
      this.finalizeDelete(taskId);
    }, 5000);

    state.pendingDelete = { task, timerId };

    this.showToast("Удалено", {
      actionLabel: "Undo",
      durationMs: 5000,
      onAction: () => {
        if (!state.pendingDelete || state.pendingDelete.task.id !== taskId) return;
        clearTimeout(state.pendingDelete.timerId);
        const restored = state.pendingDelete.task;
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
