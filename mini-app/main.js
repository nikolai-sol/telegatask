import { setApiContext } from "./core/api.js";
import { mountTasks } from "./modules/tasks/tasks.page.js";

const tg = window.Telegram?.WebApp;

function detectApiBase() {
  const meta = document.querySelector('meta[name="api-base"]');
  if (meta?.content) return meta.content;

  const startParam = tg?.initDataUnsafe?.start_param || "";
  if (startParam.startsWith("api_")) {
    try {
      return atob(startParam.slice(4));
    } catch {
      console.warn("[MiniApp] failed to decode API url from start_param");
    }
  }

  return "";
}

const apiBase = detectApiBase();
const initData = tg?.initData || "";

setApiContext({ apiBase, initData });

document.addEventListener("DOMContentLoaded", () => {
  mountTasks();
});
