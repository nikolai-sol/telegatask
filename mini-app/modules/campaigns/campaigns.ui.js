function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function fmtMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  try {
    return new Intl.NumberFormat("ru-RU").format(n);
  } catch {
    return String(n);
  }
}

function statusLabel(status) {
  const s = String(status || "draft");
  switch (s) {
    case "planned": return "Planned";
    case "running": return "Running";
    case "paused": return "Paused";
    case "finished": return "Finished";
    default: return "Draft";
  }
}

export function renderCampaignCard(c) {
  const id = escapeHtml(c.id);
  const name = escapeHtml(c.name || "Untitled");
  const client = escapeHtml(c.client || "—");
  const st = String(c.status || "draft");
  const budget = fmtMoney(c.budgetPlanned);
  const budgetLine = budget ? `Budget: ${budget}` : "Budget: —";

  return `
    <button class="campaign-card" type="button" data-campaign-id="${id}">
      <div class="campaign-card__top">
        <div class="campaign-card__name">${name}</div>
        <span class="chip chip--status-${escapeHtml(st)}">${statusLabel(st)}</span>
      </div>
      <div class="campaign-card__meta">
        <div>Client: ${client}</div>
        <div>${escapeHtml(budgetLine)}</div>
      </div>
    </button>
  `;
}

export function renderEmptyState() {
  return `
    <section class="state state--empty">
      <p class="state__icon">📣</p>
      <p class="state__text">Нет кампаний</p>
      <p class="state__text">Нажмите “+”, чтобы создать первую.</p>
    </section>
  `;
}

export function renderCampaignList(root, campaigns) {
  const listEl = root.querySelector("#campaignList");
  if (!(listEl instanceof HTMLElement)) return;

  if (!Array.isArray(campaigns) || campaigns.length === 0) {
    listEl.innerHTML = renderEmptyState();
    return;
  }

  listEl.innerHTML = `
    <div class="campaign-list">
      ${campaigns.map(renderCampaignCard).join("")}
    </div>
  `;
}

