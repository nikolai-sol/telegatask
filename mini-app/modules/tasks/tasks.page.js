import { initStore, getState, subscribe } from "../../core/store.js";
import { tasksApp, state as initialState } from "./tasks.ui.js";

let unsub = null;

export function mountTasks() {
  // Initialize store once. For now we keep initial state colocated with tasks module.
  if (!getState()) initStore(initialState);

  // Render on store updates (currently only some flows use setState; others call render directly).
  if (!unsub) {
    unsub = subscribe(() => {
      try {
        tasksApp.render();
      } catch {
        // ignore
      }
    });
  }

  tasksApp.init();
}

export function unmountTasks() {
  if (unsub) {
    unsub();
    unsub = null;
  }
  // TODO: remove event listeners when we introduce router/unmount lifecycle.
}

