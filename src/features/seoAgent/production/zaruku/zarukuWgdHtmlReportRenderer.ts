import { zarukuSeoProductionConfig } from "./zarukuSeoProductionConfig";
import {
  escapeHtml,
  statusClass,
  type LighthouseSummary,
  type PageSnapshot,
  type SitemapSummary,
  type YandexAiProbe,
  type YandexWebmasterQuery,
} from "./zarukuWgdRunnerHelpers";

const zarukuConfig = zarukuSeoProductionConfig;

export type ZarukuWgdHtmlReportInput = {
  run: any;
  draftTasks: any[];
  page: PageSnapshot;
  sitemap: SitemapSummary;
  lighthouse: LighthouseSummary;
  yandexQueries: YandexWebmasterQuery[];
  aiProbes: YandexAiProbe[];
  jsonPath: string;
  htmlPath: string;
};

function renderRows<T>(items: T[], render: (item: T) => string): string {
  return items.map(render).join("");
}

export function renderZarukuWgdHtmlReport(input: ZarukuWgdHtmlReportInput): string {
  const { run, draftTasks, page, sitemap, lighthouse, yandexQueries, aiProbes, jsonPath, htmlPath } = input;
  const scores = run.scores || {};
  const crawler = run.crawler || {};
  const webmaster = run.yandexWebmaster || {};
  const yandexChecks = run.rankTracking?.yandex?.checks || [];
  const sourceRows = renderRows(run.sourceStatuses || [], (item: any) => `
    <tr>
      <td>${escapeHtml(item.source)}</td>
      <td><span class="pill ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td>
      <td>${escapeHtml(item.message)}</td>
      <td>${escapeHtml(item.errorCode || "")}</td>
    </tr>`);
  const rankRows = renderRows(yandexChecks, (item: any) => `
    <tr>
      <td>${escapeHtml(item.query)}</td>
      <td>${item.found ? "да" : "нет"}</td>
      <td>${escapeHtml(item.position || "")}</td>
      <td>${escapeHtml(item.matchedUrl || "")}</td>
      <td>${escapeHtml((item.topResultDomains || []).slice(0, 5).join(", "))}</td>
    </tr>`);
  const queryRows = renderRows(yandexQueries.slice(0, 30), (item) => `
    <tr>
      <td>${escapeHtml(item.query)}</td>
      <td>${escapeHtml(item.impressions ?? "")}</td>
      <td>${escapeHtml(item.clicks ?? "")}</td>
      <td>${escapeHtml(item.ctr !== null ? item.ctr.toFixed(2) + "%" : "")}</td>
      <td>${escapeHtml(item.averagePosition !== null ? item.averagePosition.toFixed(2) : "")}</td>
    </tr>`);
  const sectionRows = renderRows(sitemap.sectionCounts, (item) => `<tr><td>${escapeHtml(item.section)}</td><td>${escapeHtml(item.count)}</td></tr>`);
  const taskRows = renderRows(draftTasks, (item: any) => `<tr><td>${escapeHtml(item.priority)}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml((item.labels || []).join(", "))}</td></tr>`);
  const aiRows = renderRows(aiProbes, (item) => `<tr><td>${escapeHtml(item.channel)}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(item.query)}</td><td>${escapeHtml(item.targetFound ? "yes" : "no")}</td><td>${escapeHtml(item.sourcePosition ?? "")}</td><td>${escapeHtml(item.targetUsed ? "yes" : "no")}</td><td>${escapeHtml(item.usedSourcePosition ?? "")}</td><td>${escapeHtml(item.result)}</td><td>${escapeHtml(item.usedSources.join(", ") || item.sources.join(", "))}</td></tr>`);
  const aiChecked = aiProbes.filter((item) => item.status === "checked").length;
  const aiTargetFound = aiProbes.filter((item) => item.targetFound).length;
  const aiTargetUsed = aiProbes.filter((item) => item.targetUsed).length;

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(zarukuConfig.reportTitle)}</title>
  <style>
    :root{--bg:#f5f7fb;--paper:#fff;--ink:#172033;--muted:#627084;--line:#d9e1ec;--ok:#1f7a4d;--warn:#9a6500;--bad:#b42318;--accent:#245a8d;--soft:#f9fbfe}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 Arial,"Helvetica Neue",sans-serif}main{max-width:1200px;margin:0 auto;padding:30px 22px 54px}
    .hero,section,details{background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:22px;margin:14px 0;box-shadow:0 10px 34px rgba(23,34,51,.05)}.hero{padding:30px}
    h1,h2,h3{line-height:1.18;margin:0 0 12px;letter-spacing:0}h1{font-size:clamp(30px,4vw,50px)}h2{font-size:22px}h3{font-size:17px;margin-top:18px}.sub{max-width:980px;color:var(--muted);font-size:18px}.note{color:var(--muted);font-size:13px}
    .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.card{border:1px solid var(--line);border-radius:8px;background:var(--soft);padding:16px;min-height:124px}.label{color:var(--muted);font-size:12px;text-transform:uppercase;font-weight:700}.metric{font-size:30px;font-weight:800;margin:6px 0;color:#1d334c}
    table{width:100%;border-collapse:collapse}th,td{border-top:1px solid var(--line);padding:10px 8px;text-align:left;vertical-align:top}th{color:var(--muted);font-size:12px;text-transform:uppercase}.pill{display:inline-block;border-radius:999px;padding:3px 9px;font-size:12px;font-weight:800}.ok{background:#e6f2eb;color:var(--ok)}.warn{background:#fff2d7;color:var(--warn)}.bad{background:#fde7e4;color:var(--bad)}
    code{background:#eef2f6;border-radius:5px;padding:1px 5px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}ol,ul{margin:0;padding-left:22px}li{margin:7px 0}a{color:var(--accent)}details summary{cursor:pointer;font-weight:800;font-size:17px}.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    @media(max-width:860px){.grid,.two{grid-template-columns:1fr}table{display:block;overflow-x:auto}main{padding:16px}}
  </style>
</head>
<body>
<main>
  <div class="hero">
    <div class="note">${escapeHtml(zarukuConfig.reportHeroLabel)} · ${escapeHtml(new Date().toISOString())}</div>
    <h1>${escapeHtml(zarukuConfig.reportHeading)}</h1>
    <p class="sub">Цель: показать сильные и слабые стороны портала о раке, понять, как усилить органический рост и какие Yandex AI/Search источники подключить дальше. Google Search Console недоступен; основа owner-data — Yandex Webmaster.</p>
    <p class="note">Run ID: ${escapeHtml(run.id)} · JSON: ${escapeHtml(jsonPath)} · HTML: ${escapeHtml(htmlPath)}</p>
  </div>

  <section>
    <h2>Executive Snapshot</h2>
    <div class="grid">
      <div class="card"><div class="label">Yandex Webmaster impressions</div><div class="metric">${escapeHtml(webmaster.impressions ?? "n/a")}</div><p>Показы за последние 7 дней с задержкой данных Webmaster.</p></div>
      <div class="card"><div class="label">Yandex clicks / CTR</div><div class="metric">${escapeHtml(webmaster.clicks ?? "n/a")} / ${escapeHtml(webmaster.ctr !== null && webmaster.ctr !== undefined ? webmaster.ctr.toFixed(2) + "%" : "n/a")}</div><p>CTR неплохой, но top queries требуют чистки интента.</p></div>
      <div class="card"><div class="label">Average position</div><div class="metric">${escapeHtml(webmaster.averagePosition !== null && webmaster.averagePosition !== undefined ? webmaster.averagePosition.toFixed(2) : "n/a")}</div><p>Есть база для quick wins в Yandex.</p></div>
      <div class="card"><div class="label">Yandex AI source presence</div><div class="metric">${escapeHtml(aiTargetUsed)}/${escapeHtml(aiChecked)}</div><p>Сколько Alisa/YandexGPT answers реально цитируют ${escapeHtml(zarukuConfig.domain)}.</p></div>
    </div>
  </section>

  <section>
    <h2>Главные выводы</h2>
    <ol>
      <li><strong>Сильная база в Yandex уже есть.</strong> Webmaster показывает ${escapeHtml(webmaster.impressions ?? "n/a")} impressions и ${escapeHtml(webmaster.clicks ?? "n/a")} clicks за период ${escapeHtml(webmaster.dateRange?.startDate)}-${escapeHtml(webmaster.dateRange?.endDate)}.</li>
      <li><strong>Сайт технически доступен.</strong> Homepage, robots.txt и sitemap.xml отдают 200; crawler видит title, meta description, H1, canonical и indexable-сигнал.</li>
      <li><strong>Слабое место — качество поискового спроса.</strong> В top queries есть нерелевантные/сомнительные запросы вроде лабораторий и адресов, которые не раскрывают ценность портала о раке. Нужно проверить, какие страницы их привлекают, и не размывают ли они тематику.</li>
      <li><strong>AI-answerability уже есть по брендовому/entity запросу, но слабее по общим patient-help темам.</strong> В YandexGPT/Alisa-style answers ${escapeHtml(zarukuConfig.domain)} найден в ${escapeHtml(aiTargetFound)}/${escapeHtml(aiChecked)} проверенных ответах и использован как источник в ${escapeHtml(aiTargetUsed)}/${escapeHtml(aiChecked)}.</li>
      <li><strong>Growth opportunity — patient journey clusters.</strong> Порталу стоит усиливать кластеры “симптомы → диагностика → лечение → восстановление → поддержка близких” по нозологиям и типам терапии.</li>
    </ol>
  </section>

  <section>
    <h2>Страница и структура</h2>
    <div class="two">
      <div>
        <p><strong>Final URL:</strong> <a href="${escapeHtml(page.finalUrl)}">${escapeHtml(page.finalUrl)}</a></p>
        <p><strong>HTTP:</strong> ${escapeHtml(page.httpStatus)}</p>
        <p><strong>Title:</strong> ${escapeHtml(page.title)}</p>
        <p><strong>Description:</strong> ${escapeHtml(page.description)}</p>
        <p><strong>H1:</strong> ${escapeHtml(page.h1)}</p>
        <p><strong>Canonical:</strong> ${escapeHtml(page.canonical)}</p>
      </div>
      <div>
        <p><strong>Homepage words:</strong> ${escapeHtml(page.wordCount)}</p>
        <p><strong>Internal links sampled:</strong> ${escapeHtml(page.internalLinks.length)}</p>
        <p><strong>Sitemap status:</strong> ${escapeHtml(sitemap.status)}</p>
        <p><strong>Top sections by sitemap:</strong></p>
        <table><thead><tr><th>Section</th><th>URLs</th></tr></thead><tbody>${sectionRows}</tbody></table>
      </div>
    </div>
  </section>

  <section>
    <h2>Yandex Webmaster: top queries</h2>
    <p class="note">Расширенная выгрузка popular queries через Webmaster API. Это owner-data, не внешняя SERP-проверка.</p>
    <table><thead><tr><th>Query</th><th>Impressions</th><th>Clicks</th><th>CTR</th><th>Avg position</th></tr></thead><tbody>${queryRows}</tbody></table>
  </section>

  <section>
    <h2>Yandex SERP rank checks</h2>
    ${rankRows ? `<table><thead><tr><th>Query</th><th>Found</th><th>Position</th><th>Matched URL</th><th>Top domains</th></tr></thead><tbody>${rankRows}</tbody></table>` : "<p class=\"note\">No Yandex rank checks returned.</p>"}
  </section>

  <section>
    <h2>Lighthouse</h2>
    <div class="grid">
      <div class="card"><div class="label">Performance</div><div class="metric">${escapeHtml(lighthouse.performanceScore ?? "n/a")}</div></div>
      <div class="card"><div class="label">SEO</div><div class="metric">${escapeHtml(lighthouse.seoScore ?? "n/a")}</div></div>
      <div class="card"><div class="label">Accessibility</div><div class="metric">${escapeHtml(lighthouse.accessibilityScore ?? "n/a")}</div></div>
      <div class="card"><div class="label">Best Practices</div><div class="metric">${escapeHtml(lighthouse.bestPracticesScore ?? "n/a")}</div></div>
    </div>
    <p class="note">FCP: ${escapeHtml(lighthouse.firstContentfulPaintMs)} ms · LCP: ${escapeHtml(lighthouse.largestContentfulPaintMs)} ms · CLS: ${escapeHtml(lighthouse.cumulativeLayoutShift)} · TBT: ${escapeHtml(lighthouse.totalBlockingTimeMs)} ms · Page weight: ${escapeHtml(lighthouse.totalByteWeight)}</p>
  </section>

  <section>
    <h2>Как усилить портал</h2>
    <ol>
      <li><strong>Сделать главный “entity layer”.</strong> На главной и about-странице явно описать: кто такие “За руку”, для кого портал, медицинская редакция, принципы проверки материалов, чем портал отличается от клиник/форумов/фондов.</li>
      <li><strong>Добавить structured data.</strong> Organization, WebSite, MedicalWebPage/MedicalCondition где применимо, FAQPage для patient questions, BreadcrumbList для нозологий.</li>
      <li><strong>Построить кластеры по маршруту пациента.</strong> Для каждой нозологии: симптомы, диагностика, стадии, лечение, побочные эффекты, реабилитация, поддержка близких, вопросы врачу.</li>
      <li><strong>Отдельно оптимизировать восстановление и качество жизни.</strong> Webmaster уже показывает спрос “восстановление после рмж”; это хороший пример не только медицинского, но и поддерживающего интента.</li>
      <li><strong>Почистить нерелевантный трафик.</strong> Проверить страницы, которые ранжируются по лабораториям/адресным запросам, и решить: усилить релевантность, закрыть мусорные страницы от индексации или перенаправить интент.</li>
      <li><strong>Подключить Yandex generative search monitoring.</strong> Еженедельно проверять: цитируется ли сайт в YandexGPT/Search generative responses по patient-help запросам и какие источники используются вместо него.</li>
    </ol>
  </section>

  <section>
    <h2>Yandex Alisa / AI source position</h2>
    <p class="note">Метрика: позиция ${escapeHtml(zarukuConfig.domain)} среди источников Yandex Search API generative response. Это ближайший доступный API-замер для YandexGPT/Alisa-style answer surface.</p>
    <table><thead><tr><th>Channel</th><th>Status</th><th>Top related query</th><th>${escapeHtml(zarukuConfig.aiProbeTargetLabel)} in sources</th><th>source pos</th><th>${escapeHtml(zarukuConfig.aiProbeTargetLabel)} used</th><th>used pos</th><th>AI answer</th><th>Used sources</th></tr></thead><tbody>${aiRows}</tbody></table>
    <h3>Что подключить следующим шагом</h3>
    <ul>
      <li><strong>Yandex Search API generative response:</strong> endpoint <code>/v2/gen/search</code>, возвращает YandexGPT answer, sources, searchQueries, rejected/bullet flags. В этом отчёте используется как proxy для позиции в Yandex Alisa / AI answers.</li>
      <li><strong>Yandex Search API Wordstat:</strong> частотность и география запросов по кластерам “рак”, “онкология”, “химиотерапия”, нозологии.</li>
      <li><strong>YandexGPT / AI Studio:</strong> можно использовать не как ranking source, а как content QA: medical clarity, FAQ coverage, entity extraction, сравнение страниц с patient journey.</li>
    </ul>
  </section>

  <details>
    <summary>Source statuses</summary>
    <table><thead><tr><th>Source</th><th>Status</th><th>Message</th><th>Error</th></tr></thead><tbody>${sourceRows}</tbody></table>
  </details>

  <details>
    <summary>Draft tasks</summary>
    <table><thead><tr><th>Priority</th><th>Title</th><th>Labels</th></tr></thead><tbody>${taskRows}</tbody></table>
  </details>
</main>
</body>
</html>`;
}
