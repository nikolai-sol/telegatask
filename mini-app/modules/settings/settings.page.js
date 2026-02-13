import { mountBottomNav } from "../shared/bottomNav.js";

export function mountSettings(root) {
  if (!(root instanceof HTMLElement)) return null;

  root.innerHTML = `
    <div class="app-shell">
      <header class="app-header">
        <div>
          <p class="app-header__eyebrow">Telegatask</p>
          <h1 class="app-header__title">Settings</h1>
        </div>
        <button id="settingsBack" class="icon-btn" type="button" aria-label="Назад">←</button>
      </header>

      <main>
        <section class="state state--empty">
          <p class="state__icon">⚙️</p>
          <p class="state__text">Экран настроек в разработке</p>
        </section>
      </main>
    </div>
  `;

  const unmountNav = mountBottomNav(root, "settings");

  const onBack = () => {
    window.location.hash = "#/tasks";
  };
  const backBtn = root.querySelector("#settingsBack");
  if (backBtn instanceof HTMLElement) backBtn.addEventListener("click", onBack);

  return () => {
    if (backBtn instanceof HTMLElement) backBtn.removeEventListener("click", onBack);
    try {
      unmountNav && unmountNav();
    } catch {
      // ignore
    }
    root.innerHTML = "";
  };
}
