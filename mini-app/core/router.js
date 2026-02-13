// Hash-based router (no dependencies).
// Route handlers should return an optional unmount() function.

function normalizeHash(hash) {
  const h = String(hash || "").trim();
  if (!h) return "";
  return h.startsWith("#") ? h : `#${h}`;
}

export function startRouter({ routes, defaultRoute, root }) {
  if (!(root instanceof HTMLElement)) throw new Error("startRouter: root is required");
  if (!routes || typeof routes !== "object") throw new Error("startRouter: routes is required");

  let currentUnmount = null;
  let currentRoute = null;

  function resolveRoute() {
    const raw = normalizeHash(window.location.hash);
    if (raw && routes[raw]) return raw;
    const def = normalizeHash(defaultRoute) || Object.keys(routes)[0] || "";
    return routes[def] ? def : "";
  }

  function navigate(to) {
    const next = normalizeHash(to);
    if (next) window.location.hash = next;
  }

  async function render() {
    const nextRoute = resolveRoute();
    if (!nextRoute) return;
    if (nextRoute === currentRoute) return;

    try {
      if (typeof currentUnmount === "function") {
        try {
          currentUnmount();
        } catch {
          // ignore
        }
      }
    } finally {
      currentUnmount = null;
      currentRoute = nextRoute;
      root.innerHTML = "";
    }

    const mount = routes[nextRoute];
    try {
      const unmount = mount(root, { navigate, route: nextRoute });
      currentUnmount = typeof unmount === "function" ? unmount : null;
    } catch (err) {
      root.innerHTML = `<div class="state state--error"><p class="state__icon">⚠️</p><p class="state__text">Ошибка роутера</p></div>`;
      // eslint-disable-next-line no-console
      console.error("[MiniApp] router mount error", err);
    }
  }

  window.addEventListener("hashchange", render);

  if (!normalizeHash(window.location.hash)) {
    const def = normalizeHash(defaultRoute);
    if (def) window.location.hash = def;
  }

  render();

  return () => {
    window.removeEventListener("hashchange", render);
    if (typeof currentUnmount === "function") currentUnmount();
    root.innerHTML = "";
  };
}

