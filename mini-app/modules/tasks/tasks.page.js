import { initStore, getState, setState, subscribe } from "../../core/store.js";
import { tasksApp, state as initialState } from "./tasks.ui.js";
import * as selectors from "./tasks.selectors.js";
import { cleanupTasksActions } from "./tasks.actions.js";
import { mountBottomNav } from "../shared/bottomNav.js";

function tasksMarkup() {
  // Keep markup identical to the previously working index.html body (moved here for DOM ownership).
  return `
    <div class="app-shell">
      <header class="app-header">
        <div>
          <p class="app-header__eyebrow">Telegatask</p>
          <h1 class="app-header__title">Задачи</h1>
        </div>
        <button id="filterMenuButton" class="icon-btn" type="button" aria-label="Фильтры">☰</button>
      </header>

      <section id="quickAdd" class="quick-add" hidden>
        <input id="quickAddInput" class="quick-add__input" type="text" placeholder="Быстро добавить задачу" maxlength="280" autocomplete="off">
        <button id="quickAddSubmit" class="quick-add__submit" type="button">Добавить</button>
        <div id="mentionSuggest" class="suggest" hidden></div>
      </section>

      <section id="searchPanel" class="search-panel" aria-label="Поиск" hidden>
        <div class="search-bar__field">
          <input id="searchInput" class="search-bar__input" type="search" placeholder="Поиск задач…" autocomplete="off">
          <button id="searchClear" class="search-bar__clear" type="button" aria-label="Очистить" hidden>✕</button>
        </div>
        <section id="filterChips" class="filter-chips" aria-label="Фильтры">
          <button class="chip-toggle" type="button" data-filter="today">Today</button>
          <button class="chip-toggle" type="button" data-filter="overdue">Overdue</button>
          <button class="chip-toggle" type="button" data-filter="p1">P1</button>
          <button class="chip-toggle" type="button" data-filter="nodue">No due</button>
        </section>
      </section>

      <div class="sticky-top">
        <nav class="scope-switch" aria-label="Область задач">
          <button class="scope-btn active" data-scope="my" type="button">Мои</button>
          <button class="scope-btn" data-scope="team" type="button">Команда</button>
        </nav>
        <nav class="tabs" aria-label="Вкладки задач">
          <button class="tab active" data-tab="active" type="button">Активные</button>
          <button class="tab" data-tab="done" type="button">Выполненные</button>
          <button class="tab" data-tab="all" type="button">Все</button>
        </nav>
      </div>

      <main>
        <section id="loadingState" class="state state--loading" aria-live="polite" hidden>
          <div class="skeleton-card"></div>
          <div class="skeleton-card"></div>
          <div class="skeleton-card"></div>
        </section>

        <section id="emptyState" class="state state--empty" hidden>
          <p class="state__icon">🗂️</p>
          <p id="emptyStateText" class="state__text">Нет задач</p>
        </section>

        <section id="errorState" class="state state--error" hidden>
          <p class="state__icon">⚠️</p>
          <p class="state__text">Не удалось загрузить задачи</p>
          <button id="retryButton" class="btn" type="button">Повторить</button>
        </section>

        <div id="stickyGroupHeader" class="sticky-group-header" hidden></div>

        <div id="taskListViewport" aria-label="Список задач">
          <div id="topSpacer"></div>
          <div id="taskList" class="task-list" aria-live="polite"></div>
          <div id="bottomSpacer"></div>
        </div>
      </main>
    </div>

    <button id="fabSearch" class="fab fab--secondary" type="button" aria-label="Поиск">🔍</button>
    <button id="fabAdd" class="fab" type="button" aria-label="Добавить задачу">+</button>

    <div id="actionSheet" class="sheet" hidden>
      <button id="sheetBackdrop" class="sheet__backdrop" type="button" aria-label="Закрыть"></button>
      <div class="sheet__panel">
        <button id="sheetToggleDone" class="sheet__action" type="button">Отметить выполненной</button>
        <button id="sheetMove" class="sheet__action" type="button">Перенести в проект</button>
        <button id="sheetDelete" class="sheet__action sheet__action--danger" type="button">Удалить</button>
        <button id="sheetCancel" class="sheet__action" type="button">Отмена</button>
      </div>
    </div>

    <div id="projectSheet" class="sheet" hidden>
      <button id="projectBackdrop" class="sheet__backdrop" type="button" aria-label="Закрыть"></button>
      <div class="sheet__panel">
        <div class="sheet__title">Перенести в проект</div>
        <div id="projectList" class="sheet__list"></div>
        <button id="projectCancel" class="sheet__action" type="button">Отмена</button>
      </div>
    </div>

    <div id="toast" class="toast" hidden></div>

    <div id="sheetOverlay" class="overlay" hidden></div>
    <div id="taskSheet" class="task-sheet" hidden>
      <div class="task-sheet__handle" aria-hidden="true"></div>
      <header class="task-sheet__header">
        <div class="task-sheet__title">Задача</div>
        <button id="taskSheetClose" class="icon-btn icon-btn--ghost" type="button" aria-label="Закрыть">✕</button>
      </header>

      <div class="task-sheet__body">
        <label class="field">
          <div class="field__label">Заголовок</div>
          <input id="taskSheetTitle" class="field__input" type="text" autocomplete="off" maxlength="280">
        </label>

        <div class="field">
          <div class="field__label">Срок</div>
          <div class="chips">
            <button id="dueToday" class="chip-btn" type="button" data-due="today">Сегодня</button>
            <button id="dueTomorrow" class="chip-btn" type="button" data-due="tomorrow">Завтра</button>
            <button id="dueClear" class="chip-btn" type="button" data-due="clear">Снять</button>
          </div>
        </div>

        <div class="field">
          <div class="field__label">Приоритет</div>
          <div class="chips">
            <button class="chip-btn" type="button" data-priority="urgent">P1</button>
            <button class="chip-btn" type="button" data-priority="high">P2</button>
            <button class="chip-btn" type="button" data-priority="normal">Обычный</button>
          </div>
        </div>

        <div class="field">
          <div class="field__label">Проект</div>
          <div id="taskSheetProject" class="field__value">—</div>
        </div>

        <div class="task-sheet__actions">
          <button id="taskSheetDone" class="btn btn--ghost" type="button">✅ Done</button>
          <button id="taskSheetDelete" class="btn btn--danger" type="button">🗑 Delete</button>
        </div>
      </div>
    </div>

    <div id="bulkBar" class="bulk-bar" hidden>
      <button id="bulkCancel" class="bulk-bar__btn" type="button" aria-label="Снять выбор">✕</button>
      <div id="bulkCount" class="bulk-bar__count">0</div>
      <div class="bulk-bar__spacer"></div>
      <button id="bulkDone" class="bulk-bar__btn bulk-bar__btn--accent" type="button" aria-label="Выполнено">✅</button>
      <button id="bulkMove" class="bulk-bar__btn bulk-bar__btn--accent" type="button" aria-label="В проект">📁</button>
      <button id="bulkDelete" class="bulk-bar__btn bulk-bar__btn--danger" type="button" aria-label="Удалить">🗑</button>
    </div>
  `;
}

let unsub = null;

function renderFromState() {
  const s = getState() || initialState;
  const visibleTasks = selectors.sortTasks(selectors.applyFilters(selectors.selectTasksByTab(s), s));
  const scope = String(s?.tasksScope || "my").trim().toLowerCase() || "my";
  const items =
    scope === "team"
      ? selectors.flattenCampaignGroups(visibleTasks, s)
      : selectors.flattenGroupedTasks(visibleTasks, s);
  const emptyText = selectors.selectEmptyStateText(s);
  tasksApp.render({ state: s, visibleTasks, items, emptyText });
}

export function mountTasks(rootEl) {
  if (!(rootEl instanceof HTMLElement)) throw new Error("mountTasks: rootEl is required");

  rootEl.innerHTML = tasksMarkup();
  const unmountNav = mountBottomNav(rootEl, "tasks");

  // Initialize store once. For now we keep initial state colocated with tasks module.
  const existing = getState();
  if (!existing) {
    initStore(initialState);
  } else {
    const patch = {};
    for (const [k, v] of Object.entries(initialState)) {
      if (existing[k] === undefined) patch[k] = v;
    }
    if (Object.keys(patch).length) setState(patch);
  }

  unsub = subscribe(() => {
    try {
      renderFromState();
    } catch {
      // ignore
    }
  });

  tasksApp.init(rootEl);
  renderFromState();

  return () => {
    try {
      if (unsub) unsub();
    } finally {
      unsub = null;
    }
    try {
      unmountNav && unmountNav();
    } catch {
      // ignore
    }
    try {
      cleanupTasksActions();
    } catch {
      // ignore
    }
    try {
      tasksApp.destroy();
    } catch {
      // ignore
    }
    rootEl.innerHTML = "";
  };
}

export function unmountTasks() {
  // Backward-compatible no-op: lifecycle is now returned by mountTasks(rootEl).
}
