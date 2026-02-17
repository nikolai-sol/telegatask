import { initStore, getState, setState, subscribe } from "../../core/store.js";
import { mountBottomNav } from "../shared/bottomNav.js";
import { showToast } from "../shared/toast.js";
import * as api from "./settings.api.js";
import { renderSettings } from "./settings.ui.js";

const initialState = {
  teams: [],
  activeTeamId: null,
  teamsLoading: false,
};

function ensureState() {
  const s = getState();
  if (!s) {
    initStore({ ...initialState });
    return;
  }
  const patch = {};
  for (const [k, v] of Object.entries(initialState)) {
    if (s[k] === undefined) patch[k] = v;
  }
  if (Object.keys(patch).length) setState(patch);
}

function markup() {
  return `
    <div class="app-shell settings-shell">
      <header class="app-header">
        <div>
          <p class="app-header__eyebrow">Telegatask</p>
          <h1 class="app-header__title">Settings</h1>
        </div>
        <button id="settingsBack" class="icon-btn" type="button" aria-label="Назад">←</button>
      </header>

      <main>
        <div class="settings-hint" id="activeTeamHint"></div>
        <div id="teamList"></div>
      </main>
    </div>

    <div id="toast" class="toast" hidden></div>
  `;
}

async function loadTeams() {
  setState({ teamsLoading: true });
  try {
    const data = await api.fetchTeams();
    const teams = Array.isArray(data?.teams) ? data.teams : [];
    const activeTeamId = data?.activeTeamId ?? null;
    setState({ teams, activeTeamId });
  } catch (err) {
    showToast(err?.message || "Не удалось загрузить команды");
    setState({ teams: [], activeTeamId: null });
  } finally {
    setState({ teamsLoading: false });
  }
}

export function mountSettings(root) {
  if (!(root instanceof HTMLElement)) return null;
  ensureState();

  root.innerHTML = markup();
  const unmountNav = mountBottomNav(root, "settings");
  const ctrl = new AbortController();

  function render() {
    const s = getState() || {};
    renderSettings(root, {
      teams: s.teams,
      activeTeamId: s.activeTeamId,
      loading: s.teamsLoading,
    });
  }

  const unsub = subscribe(() => render());

  root.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (target.closest("#settingsBack")) window.location.hash = "#/tasks";
  }, { signal: ctrl.signal });

  root.addEventListener("change", async (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.name !== "activeTeam") return;
    const teamId = String(target.value || "").trim();
    if (!teamId) return;

    const prev = (getState() || {}).activeTeamId ?? null;
    if (prev === teamId) return;

    // Optimistic UI
    setState({ activeTeamId: teamId });

    try {
      await api.setActiveTeam(teamId);
      showToast("Active team changed");
      // Return to tasks; Tasks mount will reload from backend with the new activeTeamId.
      window.location.hash = "#/tasks";
    } catch (err) {
      // Roll back
      setState({ activeTeamId: prev });
      showToast(err?.message || "Не удалось сменить команду");
    }
  }, { signal: ctrl.signal });

  loadTeams().catch(() => {});
  render();

  return () => {
    try { ctrl.abort(); } catch {}
    try { unsub && unsub(); } catch {}
    try { unmountNav && unmountNav(); } catch {}
    root.innerHTML = "";
  };
}
