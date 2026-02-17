// Hash-based router (no dependencies).
// Route handlers should return an optional unmount() function.

function normalizeHash(hash) {
  const h = String(hash || "").trim();
  if (!h) return "";
  return h.startsWith("#") ? h : `#${h}`;
}

function splitPath(hash) {
  const raw = normalizeHash(hash);
  if (!raw) return [];
  // "#/a/b" -> [ "a", "b" ]
  const path = raw.startsWith("#") ? raw.slice(1) : raw;
  return path.split("?")[0].split("/").filter(Boolean);
}

function matchRouteKey(routeKey, rawHash) {
  const key = normalizeHash(routeKey);
  const raw = normalizeHash(rawHash);
  if (!key || !raw) return null;
  if (key === raw) return { params: {} };

  // Support simple segment params: "#/campaigns/:id"
  if (!key.includes("/:")) return null;
  const keySegs = splitPath(key);
  const rawSegs = splitPath(raw);
  if (keySegs.length !== rawSegs.length) return null;

  const params = {};
  for (let i = 0; i < keySegs.length; i += 1) {
    const ks = keySegs[i];
    const rs = rawSegs[i];
    if (ks.startsWith(":")) {
      params[ks.slice(1)] = decodeURIComponent(rs);
      continue;
    }
    if (ks !== rs) return null;
  }
  return { params };
}

export function startRouter({ routes, defaultRoute, root }) {
  if (!(root instanceof HTMLElement)) throw new Error("startRouter: root is required");
  if (!routes || typeof routes !== "object") throw new Error("startRouter: routes is required");

  let currentUnmount = null;
  let currentRoute = null; // raw hash

  function resolveRoute() {
    const raw = normalizeHash(window.location.hash);
    if (raw && routes[raw]) return { key: raw, route: raw, params: {} };

    if (raw) {
      // Try dynamic matches
      for (const key of Object.keys(routes)) {
        const m = matchRouteKey(key, raw);
        if (m) return { key, route: raw, params: m.params || {} };
      }
    }

    const def = normalizeHash(defaultRoute) || Object.keys(routes)[0] || "";
    if (!routes[def]) return { key: "", route: "", params: {} };
    return { key: def, route: def, params: {} };
  }

  function navigate(to) {
    const next = normalizeHash(to);
    if (next) window.location.hash = next;
  }

  async function render() {
    const resolved = resolveRoute();
    if (!resolved?.key) return;
    if (resolved.route === currentRoute) return;

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
      currentRoute = resolved.route;
      root.innerHTML = "";
    }

    const mount = routes[resolved.key];
    try {
      const unmount = mount(root, { navigate, route: resolved.route, routeKey: resolved.key, params: resolved.params });
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
