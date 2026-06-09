import { setApiContext } from "./core/api.js";
import { mountTasks } from "./modules/tasks/tasks.page.js";
import { mountCampaigns } from "./modules/campaigns/campaigns.page.js";
import { mountCampaignDetails } from "./modules/campaigns/campaign.details.page.js";
import { mountSeoDashboard } from "./modules/seo-dashboard/seo.page.js";
import { mountSettings } from "./modules/settings/settings.page.js";
import { startRouter } from "./core/router.js";

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
  const root = document.getElementById("app");
  if (!(root instanceof HTMLElement)) return;

  startRouter({
    root,
    defaultRoute: "#/tasks",
    routes: {
      "#/tasks": (el) => mountTasks(el),
      "#/campaigns": (el) => mountCampaigns(el),
      "#/campaigns/:id": (el, ctx) => mountCampaignDetails(el, ctx),
      "#/seo": (el) => mountSeoDashboard(el),
      "#/settings": (el) => mountSettings(el),
    },
  });
});
