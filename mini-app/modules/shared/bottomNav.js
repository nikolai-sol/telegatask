// Global bottom navigation across top-level pages.
// Mounts into the page root and returns an unmount() cleanup.

export function mountBottomNav(root, currentTab) {
  if (!(root instanceof HTMLElement)) return () => {};

  const nav = document.createElement("nav");
  nav.className = "bottom-nav";
  nav.setAttribute("aria-label", "Navigation");

  const tab = String(currentTab || "");
  nav.innerHTML = `
    <button type="button" data-route="#/tasks" class="${tab === "tasks" ? "active" : ""}">Tasks</button>
    <button type="button" data-route="#/campaigns" class="${tab === "campaigns" ? "active" : ""}">Campaigns</button>
    <button type="button" data-route="#/settings" class="${tab === "settings" ? "active" : ""}">Settings</button>
  `;

  const onClick = (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest("[data-route]");
    if (!(btn instanceof HTMLElement)) return;
    const route = btn.dataset.route;
    if (!route) return;
    window.location.hash = route;
  };

  nav.addEventListener("click", onClick);
  root.appendChild(nav);

  return () => {
    nav.removeEventListener("click", onClick);
    nav.remove();
  };
}

