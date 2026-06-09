import { mountBottomNav } from "../shared/bottomNav.js";
import {
  approveSeoDraftTasks,
  fetchSeoDashboard,
  rejectSeoDraftTasks,
  saveSeoConfig,
  startSeoAnalysis,
} from "./seo.api.js";

const state = {
  loading: false,
  error: "",
  data: null,
  expanded: new Set(),
  selected: new Set(),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDate(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "No runs";
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return "No runs";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function stepClass(status) {
  const s = String(status || "skipped");
  if (s === "success") return "seo-step--ok";
  if (s === "partial") return "seo-step--warn";
  if (s === "failed") return "seo-step--bad";
  return "seo-step--muted";
}

function taskStatusClass(status) {
  const s = String(status || "draft");
  if (s === "approved") return "seo-task--approved";
  if (s === "rejected") return "seo-task--rejected";
  return "seo-task--draft";
}

function renderSteps(steps) {
  const list = Array.isArray(steps) ? steps : [];
  return `
    <div class="seo-steps">
      ${list
        .map(
          (step) => `
            <div class="seo-step ${stepClass(step.status)}">
              <div class="seo-step__dot"></div>
              <div class="seo-step__title">${escapeHtml(step.title)}</div>
              <div class="seo-step__detail">${escapeHtml(step.detail || step.status || "")}</div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderPositionChange(item) {
  const current = item.currentPosition === null || item.currentPosition === undefined ? "not found" : `#${item.currentPosition}`;
  const previous = item.previousPosition === null || item.previousPosition === undefined ? "no baseline" : `#${item.previousPosition}`;
  const delta = item.delta;
  const deltaClass = delta === null ? "seo-delta--neutral" : delta > 0 ? "seo-delta--up" : delta < 0 ? "seo-delta--down" : "seo-delta--neutral";
  const deltaText = delta === null ? "new" : delta > 0 ? `+${delta}` : String(delta);
  return `
    <div class="seo-position">
      <div class="seo-position__query">${escapeHtml(item.query)}</div>
      <div class="seo-position__meta">${escapeHtml(item.engine)} · ${escapeHtml(previous)} to ${escapeHtml(current)}</div>
      <div class="seo-position__delta ${deltaClass}">${escapeHtml(deltaText)}</div>
    </div>
  `;
}

function renderTaskLog(task) {
  const selectable = task.status === "draft" && !task.realTaskId;
  return `
    <div class="seo-task ${taskStatusClass(task.status)}">
      ${selectable ? `<input type="checkbox" data-seo-task-select="${escapeHtml(task.id)}" ${state.selected.has(task.id) ? "checked" : ""}>` : ""}
      <div>
        <div class="seo-task__title">${escapeHtml(task.title)}</div>
        <div class="seo-task__meta">${escapeHtml(task.priority)} · evidence ${escapeHtml(task.evidenceCount)} · ${escapeHtml(fmtDate(task.runCreatedAt))}</div>
        <div class="seo-task__meta">${(task.labels || []).map(escapeHtml).join(" · ")}</div>
      </div>
      <div class="seo-task__status">${escapeHtml(task.status)}</div>
    </div>
  `;
}

function renderFinding(finding) {
  return `
    <div class="seo-task">
      <div>
        <div class="seo-task__title">${escapeHtml(finding.title)}</div>
        <div class="seo-task__meta">${escapeHtml(finding.type)} · ${escapeHtml(finding.severity)} · confidence ${escapeHtml(finding.confidence)}</div>
        <div class="seo-task__meta">${(finding.labels || []).map(escapeHtml).join(" · ")}</div>
        <div class="seo-task__meta">${escapeHtml(finding.recommendation || "")}</div>
      </div>
    </div>
  `;
}

function renderProject(project) {
  const key = String(project.key || "");
  const expanded = state.expanded.has(key);
  const positions = Array.isArray(project.positionChanges) ? project.positionChanges : [];
  const tasks = Array.isArray(project.taskLog) ? project.taskLog : [];
  const findings = Array.isArray(project.findings) ? project.findings : [];
  const latestDrafts = tasks.filter((task) => task.runId === project.latestRunId && task.status === "draft" && !task.realTaskId);
  const selectedLatest = latestDrafts.filter((task) => state.selected.has(task.id));
  const steps = Array.isArray(project.steps) ? project.steps : [];
  const done = steps.filter((step) => step.status === "success").length;
  const progress = steps.length ? Math.round((done / steps.length) * 100) : 0;
  const warnings = Array.isArray(project.warnings) ? project.warnings.length : 0;
  const blocked = Array.isArray(project.blockedActions) ? project.blockedActions.length : 0;

  return `
    <article class="seo-project" data-seo-project="${escapeHtml(key)}">
      <button class="seo-project__head" type="button" data-seo-toggle="${escapeHtml(key)}">
        <div>
          <div class="seo-project__name">${escapeHtml(project.projectName || project.domain || "SEO project")}</div>
          <div class="seo-project__domain">${escapeHtml(project.domain || "")}</div>
        </div>
        <div class="seo-project__summary">
          <span>${escapeHtml(project.runCount || 0)} runs</span>
          <span>${escapeHtml(fmtDate(project.latestRunCreatedAt))}</span>
        </div>
      </button>

      <div class="seo-progress">
        <div class="seo-progress__bar"><div class="seo-progress__fill" style="width:${progress}%"></div></div>
        <div class="seo-progress__text">${progress}% pipeline</div>
      </div>

      ${renderSteps(steps)}

      ${
        expanded
          ? `
            <div class="seo-project__details">
              <section class="seo-panel">
                <div class="seo-panel__title">Position changes</div>
                ${
                  positions.length
                    ? `<div class="seo-position-list">${positions.map(renderPositionChange).join("")}</div>`
                    : `<div class="seo-empty-line">No rank history yet. The next run for this site will create a baseline.</div>`
                }
              </section>

              <section class="seo-panel">
                <div class="seo-panel__title">Task log</div>
                ${
                  latestDrafts.length
                    ? `<div class="seo-actions">
                        <button type="button" data-seo-approve="${escapeHtml(project.latestRunId)}" ${selectedLatest.length ? "" : "disabled"}>Approve selected</button>
                        <button type="button" data-seo-reject="${escapeHtml(project.latestRunId)}" ${selectedLatest.length ? "" : "disabled"}>Reject selected</button>
                      </div>`
                    : ""
                }
                ${
                  tasks.length
                    ? `<div class="seo-task-list">${tasks.map(renderTaskLog).join("")}</div>`
                    : `<div class="seo-empty-line">No draft tasks generated yet.</div>`
                }
              </section>

              <section class="seo-panel">
                <div class="seo-panel__title">Findings</div>
                ${findings.length ? `<div class="seo-task-list">${findings.map(renderFinding).join("")}</div>` : `<div class="seo-empty-line">No normalized findings.</div>`}
                <div class="seo-empty-line">AI heuristic output is advisory and is not a Google ranking prediction.</div>
              </section>

              <section class="seo-panel seo-panel--compact">
                <div class="seo-panel__title">Harness</div>
                <div class="seo-harness-grid">
                  <div><span>High</span><strong>${escapeHtml(project.confidenceSummary?.high || 0)}</strong></div>
                  <div><span>Medium</span><strong>${escapeHtml(project.confidenceSummary?.medium || 0)}</strong></div>
                  <div><span>Low</span><strong>${escapeHtml(project.confidenceSummary?.low || 0)}</strong></div>
                  <div><span>Warnings</span><strong>${escapeHtml(warnings)}</strong></div>
                  <div><span>Blocked</span><strong>${escapeHtml(blocked)}</strong></div>
                </div>
              </section>
            </div>
          `
          : ""
      }
    </article>
  `;
}

function markup() {
  const projects = Array.isArray(state.data?.projects) ? state.data.projects : [];
  return `
    <div class="app-shell seo-shell">
      <header class="app-header">
        <div>
          <p class="app-header__eyebrow">SEO Agent</p>
          <h1 class="app-header__title">Dashboard</h1>
        </div>
        <button id="seoRefresh" class="icon-btn" type="button" aria-label="Refresh">↻</button>
        <button id="seoStart" class="icon-btn" type="button" aria-label="Start SEO analysis">＋</button>
      </header>

      <main class="seo-main">
        ${
          state.loading
            ? `<div class="seo-skeleton"><div></div><div></div><div></div></div>`
            : state.error
              ? `<section class="state state--error"><p class="state__text">${escapeHtml(state.error)}</p></section>`
              : projects.length
                ? `<div class="seo-project-list">${projects.map(renderProject).join("")}</div>`
                : `<section class="state state--empty"><p class="state__text">SEO runs ещё не запускались. После первого запуска здесь появятся шаги, позиции и журнал задач.</p></section>`
        }
      </main>
    </div>
  `;
}

async function load(root) {
  state.loading = true;
  state.error = "";
  renderRoot(root);
  try {
    state.data = await fetchSeoDashboard();
  } catch (err) {
    state.error = err?.message || "Не удалось загрузить SEO dashboard";
  } finally {
    state.loading = false;
    renderRoot(root);
  }
}

let unmountNav = null;

function renderRoot(root) {
  try {
    unmountNav && unmountNav();
  } catch {}
  root.innerHTML = markup();
  unmountNav = mountBottomNav(root, "seo");
}

export function mountSeoDashboard(root) {
  if (!(root instanceof HTMLElement)) return null;
  const ctrl = new AbortController();

  renderRoot(root);

  root.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("#seoRefresh")) {
        load(root).catch(() => {});
        return;
      }
      if (target.closest("#seoStart")) {
        const companyId = prompt("Company ID:");
        if (!companyId) return;
        const domain = prompt("Domain:");
        if (!domain) return;
        Promise.resolve()
          .then(() => saveSeoConfig(companyId.trim(), domain.trim()))
          .then(() => startSeoAnalysis(companyId.trim()))
          .then(() => load(root))
          .catch((err) => {
            state.error = err?.message || "Не удалось запустить SEO analysis";
            renderRoot(root);
          });
        return;
      }
      const selection = target.closest("[data-seo-task-select]");
      if (selection instanceof HTMLInputElement) {
        const id = selection.dataset.seoTaskSelect || "";
        if (selection.checked) state.selected.add(id);
        else state.selected.delete(id);
        renderRoot(root);
        return;
      }
      const approve = target.closest("[data-seo-approve]");
      const reject = target.closest("[data-seo-reject]");
      if (approve instanceof HTMLElement || reject instanceof HTMLElement) {
        const runId = (approve || reject).dataset.seoApprove || (approve || reject).dataset.seoReject || "";
        const project = (state.data?.projects || []).find((item) => item.latestRunId === runId);
        const ids = (project?.taskLog || [])
          .filter((task) => task.runId === runId && state.selected.has(task.id))
          .map((task) => task.id);
        const action = approve ? approveSeoDraftTasks : rejectSeoDraftTasks;
        action(runId, ids)
          .then(() => {
            ids.forEach((id) => state.selected.delete(id));
            return load(root);
          })
          .catch((err) => {
            state.error = err?.message || "Не удалось обновить SEO recommendations";
            renderRoot(root);
          });
        return;
      }
      const toggle = target.closest("[data-seo-toggle]");
      if (toggle instanceof HTMLElement) {
        const key = toggle.dataset.seoToggle || "";
        if (state.expanded.has(key)) state.expanded.delete(key);
        else state.expanded.add(key);
        renderRoot(root);
      }
    },
    { signal: ctrl.signal }
  );

  load(root).catch(() => {});

  return () => {
    try {
      ctrl.abort();
    } catch {}
    try {
      unmountNav && unmountNav();
    } catch {}
    root.innerHTML = "";
  };
}
