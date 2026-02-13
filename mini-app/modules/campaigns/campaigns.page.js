import { mountBottomNav } from "../shared/bottomNav.js";

export function mountCampaigns(root) {
  if (!(root instanceof HTMLElement)) return null;

  root.innerHTML = `
    <div class="app-shell">
      <header class="app-header">
        <div>
          <p class="app-header__eyebrow">Telegatask</p>
          <h1 class="app-header__title">Campaigns</h1>
        </div>
        <button id="campaignsNew" class="icon-btn" type="button" aria-label="Создать">＋</button>
      </header>

      <main>
        <section class="state state--empty">
          <p class="state__icon">📣</p>
          <p class="state__text">Нет кампаний</p>
          <button id="campaignsBack" class="btn" type="button">Назад к задачам</button>
        </section>
      </main>
    </div>
  `;

  const unmountNav = mountBottomNav(root, "campaigns");

  const onBack = () => {
    window.location.hash = "#/tasks";
  };
  const backBtn = root.querySelector("#campaignsBack");
  if (backBtn instanceof HTMLElement) backBtn.addEventListener("click", onBack);

  const onNew = () => {
    // Skeleton: later we will open a sheet/form.
    // For now keep it as a noop to avoid implying backend exists.
  };
  const newBtn = root.querySelector("#campaignsNew");
  if (newBtn instanceof HTMLElement) newBtn.addEventListener("click", onNew);

  return () => {
    if (backBtn instanceof HTMLElement) backBtn.removeEventListener("click", onBack);
    if (newBtn instanceof HTMLElement) newBtn.removeEventListener("click", onNew);
    try {
      unmountNav && unmountNav();
    } catch {
      // ignore
    }
    root.innerHTML = "";
  };
}
