function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function roleLabel(role) {
  switch (String(role || "")) {
    case "owner": return "owner";
    case "admin": return "admin";
    case "member": return "member";
    case "read_only": return "viewer";
    default: return "—";
  }
}

export function renderSettings(root, view) {
  const listEl = root.querySelector("#teamList");
  const activeEl = root.querySelector("#activeTeamHint");
  if (!(listEl instanceof HTMLElement) || !(activeEl instanceof HTMLElement)) return;

  const teams = Array.isArray(view?.teams) ? view.teams : [];
  const activeTeamId = view?.activeTeamId ?? null;
  const loading = Boolean(view?.loading);

  activeEl.textContent = activeTeamId ? `activeTeamId: ${activeTeamId}` : "activeTeamId: —";

  if (loading) {
    listEl.innerHTML = `
      <section class="state state--loading">
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
      </section>
    `;
    return;
  }

  if (!teams.length) {
    listEl.innerHTML = `
      <section class="state state--empty">
        <p class="state__icon">👥</p>
        <p class="state__text">Нет доступных команд</p>
        <p class="state__text">Создай команду в групповом чате через /link_team или попроси доступ.</p>
      </section>
    `;
    return;
  }

  listEl.innerHTML = `
    <section class="settings-card">
      <div class="settings-card__title">Active team</div>
      <div class="radio-list" role="radiogroup" aria-label="Teams">
        ${teams.map((t) => {
          const id = escapeHtml(t.id);
          const name = escapeHtml(t.name || "Untitled");
          const role = roleLabel(t.role);
          const checked = t.id === activeTeamId ? "checked" : "";
          return `
            <label class="radio-item">
              <input class="radio-item__input" type="radio" name="activeTeam" value="${id}" ${checked}>
              <span class="radio-item__dot" aria-hidden="true"></span>
              <span class="radio-item__text">
                <span class="radio-item__name">${name}</span>
                <span class="radio-item__meta">role: ${escapeHtml(role)}</span>
              </span>
            </label>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

