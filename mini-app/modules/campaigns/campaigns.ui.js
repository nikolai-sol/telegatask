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

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
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
  const currency = escapeHtml((c && c.currency) ? String(c.currency).toUpperCase() : "EUR");
  const planned = typeof c?.plannedBudget === "number" ? c.plannedBudget : null;
  const spent = typeof c?.spent === "number" ? c.spent : 0;

  const plannedFmt = planned === null ? null : fmtMoney(planned);
  const spentFmt = fmtMoney(spent) ?? "0";
  const remaining = planned === null ? null : (planned - spent);
  const remainingFmt = remaining === null ? null : (fmtMoney(remaining) ?? String(remaining));

  const progress =
    planned && planned > 0
      ? clamp01(spent / planned)
      : 0;
  const over = planned !== null && spent > planned;

  return `
    <button class="campaign-card" type="button" data-campaign-id="${id}">
      <div class="campaign-card__top">
        <div class="campaign-card__name">${name}</div>
        <span class="chip chip--status-${escapeHtml(st)}">${statusLabel(st)}</span>
      </div>
      <div class="campaign-card__meta">
        <div>Client: ${client}</div>
        ${
          planned === null
            ? `<div class="campaign-budget campaign-budget--empty">No budget set</div>`
            : `
              <div class="campaign-budget">
                <div class="campaign-budget__rows">
                  <div>Planned: ${escapeHtml(plannedFmt ?? String(planned))} ${currency}</div>
                  <div>Spent: ${escapeHtml(spentFmt)} ${currency}</div>
                  <div>Remaining: ${escapeHtml(remainingFmt ?? String(remaining))} ${currency}</div>
                </div>
                <div class="campaign-mini-progress" role="progressbar" aria-valuenow="${Math.round(progress * 100)}" aria-valuemin="0" aria-valuemax="100">
                  <div class="campaign-mini-progress__fill ${over ? "campaign-mini-progress__fill--over" : ""}" style="width:${Math.round(progress * 100)}%"></div>
                </div>
              </div>
            `
        }
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

export function renderLoadingState() {
  return `
    <section class="state state--loading">
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
    </section>
  `;
}

export function renderCampaignList(root, campaigns, opts = null) {
  const listEl = root.querySelector("#campaignList");
  if (!(listEl instanceof HTMLElement)) return;

  const loading = Boolean(opts?.loading);
  const emptyText = typeof opts?.emptyText === "string" ? opts.emptyText : null;

  if (loading) {
    listEl.innerHTML = renderLoadingState();
    return;
  }

  if (!Array.isArray(campaigns) || campaigns.length === 0) {
    if (emptyText) {
      listEl.innerHTML = `
        <section class="state state--empty">
          <p class="state__icon">📣</p>
          <p class="state__text">Нет кампаний</p>
          <p class="state__text">${escapeHtml(emptyText)}</p>
        </section>
      `;
      return;
    }
    listEl.innerHTML = renderEmptyState();
    return;
  }

  listEl.innerHTML = `
    <div class="campaign-list">
      ${campaigns.map(renderCampaignCard).join("")}
    </div>
  `;
}
