import type { WgdManagerPresentation } from "./types";
import { escapeHtml, htmlText, safeAnchorHref, safeDisplayUrl, scoreBand, table } from "./reportHtml";

export function renderManagerHeader(presentation: WgdManagerPresentation): string {
  const header = presentation.header;
  return `<header class="report-header">
    <p class="eyebrow">${htmlText(header.title)}</p>
    <h1>${htmlText(header.domain)}</h1>
    <div class="header-meta"><span>${htmlText(header.date)}</span><span>${htmlText(header.market)}</span><span>${htmlText(header.searchEngine)}</span><span>${htmlText(header.completeness)}</span></div>
  </header>`;
}

function overallSection(presentation: WgdManagerPresentation): string {
  const overall = presentation.overall;
  const componentCards = presentation.components.map((component) => `
    <article class="component-card score-${scoreBand(component.score)}">
      <h3>${htmlText(component.name)}</h3>
      <div class="component-score">${htmlText(component.scoreText)}</div>
      <p>${htmlText(component.explanation)}</p>
      <dl class="compact-facts"><div><dt>${htmlText(presentation.labels.collection)}</dt><dd>${htmlText(component.collection)}</dd></div><div><dt>${htmlText(presentation.labels.coverage)}</dt><dd>${htmlText(component.coverage)}</dd></div></dl>
    </article>`).join("");
  return `<section id="overall-score">
    <h2>${htmlText(presentation.headings.overall)}</h2>
    <div class="overall-grid">
      <article class="overall-card score-${scoreBand(overall.score)}">
        <div class="overall-score-value">${htmlText(overall.scoreText)}</div>
        <p class="overall-state">${htmlText(overall.status || overall.state)}</p>
        <p>${htmlText(presentation.labels.completeness)}: ${htmlText(overall.completenessText)}</p>
        <p class="conclusion">${htmlText(overall.conclusion)}</p>
      </article>
      <div><h3>${htmlText(presentation.headings.components)}</h3><div class="component-grid">${componentCards}</div></div>
    </div>
  </section>`;
}

function problemsSection(presentation: WgdManagerPresentation): string {
  const cards = presentation.problems.map((problem) => {
    const href = safeAnchorHref(problem.href);
    return `<article class="problem-card">
      <h3>${htmlText(problem.title)}</h3>
      <dl class="problem-facts">
        <div><dt>${htmlText(presentation.labels.priority)}</dt><dd>${htmlText(problem.priority)}</dd></div>
        <div><dt>${htmlText(presentation.labels.affected)}</dt><dd>${htmlText(problem.affected)}</dd></div>
      </dl>
      <p><strong>${htmlText(presentation.labels.impact)}:</strong> ${htmlText(problem.impact)}</p>
      <p><strong>${htmlText(presentation.labels.action)}:</strong> ${htmlText(problem.action)}</p>
      <a class="detail-link" href="${escapeHtml(href)}">${htmlText(problem.linkLabel)}</a>
    </article>`;
  }).join("");
  return `<section id="main-problems"><h2>${htmlText(presentation.headings.problems)}</h2><div class="problem-grid">${cards || `<p class="empty">${htmlText(presentation.problemsEmpty)}</p>`}</div></section>`;
}

function wordstatSection(presentation: WgdManagerPresentation): string {
  const demand = presentation.wordstat;
  const labels = presentation.locale === "ru"
    ? ["Запрос", "Спрос за 30 дней", "Контент", "Лучшая страница", "Связанные формулировки", "Динамика", "Регион"]
    : ["Query", "30-day demand", "Content", "Best page", "Related phrases", "Trend", "Region"];
  const primary = demand.primary
    ? `<article class="demand-primary"><p class="eyebrow">${htmlText(demand.primary.title)}</p><h3>${htmlText(demand.primary.seed)}</h3><div class="demand-primary-facts"><span>${htmlText(demand.primary.demand)}</span><span>${htmlText(demand.primary.coverage)}</span></div><p>${htmlText(demand.primary.action)}</p></article>`
    : "";
  const rows = demand.rows.map((row) => {
    const values = [row.seed, row.demand, row.coverage, row.bestPage, row.related, row.trend, row.region];
    return `<article class="demand-row"><dl>${values.map((value, index) => `<div><dt>${htmlText(labels[index])}</dt><dd>${htmlText(value)}</dd></div>`).join("")}</dl></article>`;
  }).join("");
  return `<section id="wordstat-demand"><h2>${htmlText(presentation.headings.demand)}</h2>
    <div class="demand-meta"><strong>${htmlText(demand.state)}</strong><span>${htmlText(demand.scoreNote)}</span></div>
    <p class="section-summary">${htmlText(demand.summary)}</p>${primary}
    <div class="demand-grid">${rows || `<p class="empty">${htmlText(demand.empty)}</p>`}</div>
  </section>`;
}

function yandexSection(presentation: WgdManagerPresentation): string {
  const yandex = presentation.yandex;
  const rows = yandex.rows.map((row) => [row.query, row.position, row.page, row.result]);
  return `<section id="yandex-positions"><h2>${htmlText(presentation.headings.yandex)}</h2><p class="section-summary">${htmlText(yandex.summary.text)}</p>${table(
    [presentation.labels.query, presentation.labels.position, presentation.labels.page, presentation.labels.result],
    rows,
    yandex.empty || ""
  )}</section>`;
}

function aliceSection(presentation: WgdManagerPresentation): string {
  const alice = presentation.alice;
  const rows = alice.rows.map((row) => [row.query, row.result]);
  return `<section id="alice-visibility"><h2>${htmlText(presentation.headings.alice)}</h2>
    <div class="summary-cards">
      <article class="metric-card score-${scoreBand(alice.score)}"><span>${htmlText(presentation.labels.componentScore)}</span><strong>${htmlText(alice.scoreText)}</strong></article>
      <article class="metric-card"><span>${htmlText(presentation.labels.usedAnswers)}</span><strong>${htmlText(alice.usedCount)}</strong></article>
      <article class="metric-card"><span>${htmlText(presentation.labels.checkedQueries)}</span><strong>${htmlText(alice.checkedCount)} / ${htmlText(alice.requestedCount)}</strong></article>
    </div>
    <p class="section-summary">${htmlText(alice.conclusion)}</p><p class="note">${htmlText(alice.note)}</p>
    ${table([presentation.labels.query, presentation.labels.result], rows, alice.empty || "")}
  </section>`;
}

function speedSection(presentation: WgdManagerPresentation): string {
  const lighthouse = presentation.lighthouse;
  const inputRows = lighthouse.scoreInputs.map((item) => [item.name, item.scoreText, item.weightText]);
  const supplementaryRows = lighthouse.supplementaryResults.map((item) => [item.name, item.scoreText, item.note]);
  const diagnostics = lighthouse.diagnostics.length
    ? `<ul>${lighthouse.diagnostics.map((item) => `<li>${htmlText(item)}</li>`).join("")}</ul>`
    : `<p class="empty">${htmlText(lighthouse.diagnosticsEmpty)}</p>`;
  const worstUrl = safeDisplayUrl(lighthouse.worstMobilePage?.url);
  const worst = lighthouse.worstMobilePage && worstUrl
    ? `<p><strong>${htmlText(presentation.labels.worstMobilePage)}:</strong> ${htmlText(worstUrl)} · ${htmlText(lighthouse.worstMobilePage.scoreText)}</p>`
    : "";
  return `<section id="speed-ux"><h2>${htmlText(presentation.headings.speed)}</h2>
    <div class="summary-cards">
      <article class="metric-card score-${scoreBand(lighthouse.score)}"><span>${htmlText(presentation.labels.componentScore)}</span><strong>${htmlText(lighthouse.scoreText)}</strong></article>
      <article class="metric-card"><span>${htmlText(presentation.labels.mobileAverage)}</span><strong>${htmlText(lighthouse.mobileAverageText)}</strong></article>
      <article class="metric-card"><span>${htmlText(presentation.labels.desktopAverage)}</span><strong>${htmlText(lighthouse.desktopAverageText)}</strong></article>
    </div>
    ${worst}<h3>${htmlText(presentation.labels.diagnostics)}</h3>${diagnostics}
    <h3>${htmlText(presentation.labels.scoreInputs)}</h3>${table(
      [presentation.labels.result, presentation.labels.componentScore, presentation.labels.weight],
      inputRows,
      lighthouse.empty || ""
    )}
    ${supplementaryRows.length ? `<h3>${htmlText(presentation.labels.supplementaryResults)}</h3>${table(
      [presentation.labels.result, presentation.labels.componentScore, presentation.labels.state],
      supplementaryRows,
      lighthouse.empty || ""
    )}` : ""}
    <p class="note">${htmlText(lighthouse.note)}</p><p class="note">${htmlText(lighthouse.roundingNote)}</p>
  </section>`;
}

function prioritiesSection(presentation: WgdManagerPresentation): string {
  const stages = presentation.priorityStages.map((stage, index) => `<article class="priority-card"><div class="priority-number">${index + 1}</div><div><h3>${htmlText(stage.title)}</h3><p>${htmlText(stage.result)}</p><ul>${stage.items.map((item) => `<li>${htmlText(item)}</li>`).join("")}</ul></div></article>`).join("");
  return `<section id="priority-actions"><h2>${htmlText(presentation.headings.priorities)}</h2><div class="priority-list">${stages || `<p class="empty">${htmlText(presentation.prioritiesEmpty)}</p>`}</div></section>`;
}

export type RenderedManagerSections = {
  leadingHtml: string;
  pageDetails: { startHtml: string; emptyHtml: string; endHtml: string };
};

/** Render all seven open manager section frames from the sanitized presentation model. */
export function renderManagerSections(presentation: WgdManagerPresentation): RenderedManagerSections {
  return {
    leadingHtml: [
      overallSection(presentation),
      problemsSection(presentation),
      wordstatSection(presentation),
      yandexSection(presentation),
      aliceSection(presentation),
      speedSection(presentation),
      prioritiesSection(presentation),
    ].join("\n"),
    pageDetails: {
      startHtml: `<section id="page-details"><h2>${htmlText(presentation.headings.pages)}</h2>`,
      emptyHtml: `<p class="empty">${htmlText(presentation.pagesEmpty)}</p>`,
      endHtml: "</section>",
    },
  };
}
