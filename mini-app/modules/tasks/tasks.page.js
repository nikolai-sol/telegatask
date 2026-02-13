import { initStore, getState, subscribe } from "../../core/store.js";
import { tasksApp, state as initialState } from "./tasks.ui.js";
import * as selectors from "./tasks.selectors.js";

let unsub = null;

function renderFromState() {
  const s = getState() || initialState;
  const visibleTasks = selectors.sortTasks(selectors.applyFilters(selectors.selectTasksByTab(s), s));
  const items = selectors.flattenGroupedTasks(visibleTasks, s);
  const emptyText = selectors.selectEmptyStateText(s);
  tasksApp.render({ state: s, visibleTasks, items, emptyText });
}

export function mountTasks() {
  // Initialize store once. For now we keep initial state colocated with tasks module.
  if (!getState()) initStore(initialState);

  // Render on store updates (currently only some flows use setState; others call render directly).
  if (!unsub) {
    unsub = subscribe(() => {
      try {
        renderFromState();
      } catch {
        // ignore
      }
    });
  }

  tasksApp.init();
  renderFromState();
}

export function unmountTasks() {
  if (unsub) {
    unsub();
    unsub = null;
  }
  // TODO: remove event listeners when we introduce router/unmount lifecycle.
}
