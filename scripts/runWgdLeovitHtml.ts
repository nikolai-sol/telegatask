import "dotenv/config";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { firestore } from "../src/config/firebase";
import { upsertSeoConfig } from "../src/features/seoAgent/seoConfigRepository";
import { listSeoDraftTasksForRun, runSeoAnalysis } from "../src/features/seoAgent/seoAgentService";

const teamId = "qa-seo-team-1";
const companyId = "qa-seo-company-leovit";
const createdByUserId = "qa-seo-user";
const targetUrl =
  "https://www.leovit.ru/khudeem-za-nedelyu/programmy-pitaniya/gastronomicheskie-programmy/russkaya-dieta/";
const domain = "leovit.ru";

type PageSnapshot = {
  url: string;
  finalUrl: string;
  httpStatus: number | null;
  title: string | null;
  description: string | null;
  h1: string | null;
  canonical: string | null;
  wordCount: number;
  bodySample: string;
};

type LocalLighthouseSnapshot = {
  status: "success" | "failed";
  message: string;
  pageUrl: string;
  performanceScore: number | null;
  accessibilityScore: number | null;
  bestPracticesScore: number | null;
  seoScore: number | null;
  largestContentfulPaintMs: number | null;
  cumulativeLayoutShift: number | null;
  interactionToNextPaintMs: number | null;
  totalBlockingTimeMs: number | null;
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function statusClass(status: string): string {
  if (status === "success") return "ok";
  if (status === "partial" || status === "skipped") return "warn";
  return "bad";
}

function formatDate(value: number | string | null | undefined): string {
  if (!value) return "n/a";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? "n/a" : date.toISOString();
}

function readTagContent(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  return match ? String(match[1] || "").replace(/\s+/g, " ").trim() || null : null;
}

function textFromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readLighthouseScore(categories: Record<string, { score?: number } | undefined>, key: string): number | null {
  const score = categories[key]?.score;
  return typeof score === "number" && Number.isFinite(score) ? Math.round(score * 100) : null;
}

function runLocalLighthouse(url: string): LocalLighthouseSnapshot {
  try {
    const raw = execFileSync(
      "npx",
      [
        "lighthouse",
        url,
        "--quiet",
        "--output=json",
        "--output-path=stdout",
        "--preset=desktop",
        "--throttling-method=provided",
        "--only-categories=performance,accessibility,best-practices,seo",
        "--chrome-flags=--headless=new --no-sandbox --disable-gpu",
      ],
      {
        encoding: "utf8",
        maxBuffer: 30 * 1024 * 1024,
      }
    );
    const payload = JSON.parse(raw) as {
      finalDisplayedUrl?: string;
      categories?: Record<string, { score?: number } | undefined>;
      audits?: Record<string, Record<string, unknown> | undefined>;
    };
    const categories = payload.categories || {};
    const audits = payload.audits || {};
    return {
      status: "success",
      message: "Local Lighthouse desktop/provided completed successfully",
      pageUrl: payload.finalDisplayedUrl || url,
      performanceScore: readLighthouseScore(categories, "performance"),
      accessibilityScore: readLighthouseScore(categories, "accessibility"),
      bestPracticesScore: readLighthouseScore(categories, "best-practices"),
      seoScore: readLighthouseScore(categories, "seo"),
      largestContentfulPaintMs: cleanNumber(audits["largest-contentful-paint"]?.numericValue),
      cumulativeLayoutShift: cleanNumber(audits["cumulative-layout-shift"]?.numericValue),
      interactionToNextPaintMs: cleanNumber(audits["interaction-to-next-paint"]?.numericValue),
      totalBlockingTimeMs: cleanNumber(audits["total-blocking-time"]?.numericValue),
    };
  } catch (err) {
    return {
      status: "failed",
      message: err instanceof Error ? err.message : "Local Lighthouse failed",
      pageUrl: url,
      performanceScore: null,
      accessibilityScore: null,
      bestPracticesScore: null,
      seoScore: null,
      largestContentfulPaintMs: null,
      cumulativeLayoutShift: null,
      interactionToNextPaintMs: null,
      totalBlockingTimeMs: null,
    };
  }
}

async function fetchPageSnapshot(url: string): Promise<PageSnapshot> {
  const response = await fetch(url, { redirect: "follow" });
  const html = await response.text();
  const bodyText = textFromHtml(html);
  return {
    url,
    finalUrl: response.url || url,
    httpStatus: response.status,
    title: readTagContent(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    description: readTagContent(html, /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i),
    h1: readTagContent(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i),
    canonical: readTagContent(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([\s\S]*?)["'][^>]*>/i),
    wordCount: bodyText ? bodyText.split(/\s+/).length : 0,
    bodySample: bodyText.slice(0, 900),
  };
}

function renderRankRows(run: any): string {
  const googleChecks = run.rankTracking?.google?.checks || [];
  const yandexChecks = run.rankTracking?.yandex?.checks || [];
  return [...googleChecks, ...yandexChecks]
    .map(
      (item: any) => `
        <tr>
          <td>${escapeHtml(item.searchEngine)}</td>
          <td>${escapeHtml(item.query)}</td>
          <td>${item.found ? "да" : "нет"}</td>
          <td>${escapeHtml(item.position || "")}</td>
          <td>${escapeHtml(item.matchedUrl || "")}</td>
        </tr>`
    )
    .join("");
}

function renderReport(
  run: any,
  page: PageSnapshot,
  lighthouse: LocalLighthouseSnapshot,
  jsonPath: string,
  htmlPath: string
): string {
  const scores = run.scores || {};
  const crawler = run.crawler || {};
  const rankRows = renderRankRows(run);
  const sourceRows = (run.sourceStatuses || [])
    .map(
      (item: any) => `
        <tr>
          <td>${escapeHtml(item.source)}</td>
          <td><span class="pill ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td>
          <td>${escapeHtml(item.message)}</td>
          <td>${escapeHtml(item.errorCode || "")}</td>
        </tr>`
    )
    .join("");
  const recommendationRows = (run.recommendations || [])
    .map(
      (item: any) => `
        <tr>
          <td>${escapeHtml(item.priority)}</td>
          <td>${escapeHtml(item.type)}</td>
          <td>${escapeHtml(item.title)}</td>
          <td>${escapeHtml(item.reasoning)}</td>
        </tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WGD Report - leovit.ru / Русская диета</title>
  <style>
    :root{--bg:#f5f6f8;--paper:#fff;--ink:#151b24;--muted:#647084;--line:#dde3ea;--green:#227047;--amber:#946300;--red:#b13a31;--blue:#245a8d;--soft:#f9fbfd}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 Arial,"Helvetica Neue",sans-serif}main{max-width:1180px;margin:0 auto;padding:30px 22px 54px}
    .hero,section,details{background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:22px;margin:14px 0;box-shadow:0 10px 34px rgba(23,34,51,.05)}.hero{padding:30px}
    h1,h2,h3{line-height:1.18;margin:0 0 12px;letter-spacing:0}h1{font-size:clamp(30px,4vw,50px)}h2{font-size:22px}h3{font-size:17px;margin-top:18px}.sub{max-width:920px;color:var(--muted);font-size:18px}.note{color:var(--muted);font-size:13px}
    .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.card{border:1px solid var(--line);border-radius:8px;background:var(--soft);padding:16px;min-height:124px}.label{color:var(--muted);font-size:12px;text-transform:uppercase;font-weight:700}.metric{font-size:30px;font-weight:800;margin:6px 0;color:#1d334c}
    table{width:100%;border-collapse:collapse}th,td{border-top:1px solid var(--line);padding:10px 8px;text-align:left;vertical-align:top}th{color:var(--muted);font-size:12px;text-transform:uppercase}.pill{display:inline-block;border-radius:999px;padding:3px 9px;font-size:12px;font-weight:800}.ok{background:#e6f2eb;color:var(--green)}.warn{background:#fff2d7;color:var(--amber)}.bad{background:#fde7e4;color:var(--red)}
    code{background:#eef2f6;border-radius:5px;padding:1px 5px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}ol,ul{margin:0;padding-left:22px}li{margin:7px 0}a{color:var(--blue)}details summary{cursor:pointer;font-weight:800;font-size:17px}.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    @media(max-width:860px){.grid,.two{grid-template-columns:1fr}table{display:block;overflow-x:auto}main{padding:16px}}
  </style>
</head>
<body>
<main>
  <div class="hero">
    <div class="note">Website Growth Diagnostic · Гео: РФ / Россия · Язык: русский · Дата запуска: ${escapeHtml(formatDate(run.createdAt))}</div>
    <h1>leovit.ru: программа питания «Русская диета»</h1>
    <p class="sub">Диагностика выполнена для страницы <a href="${escapeHtml(targetUrl)}">${escapeHtml(targetUrl)}</a>. Цель отчёта: оценить техническую доступность, базовую видимость в Google/Yandex по РФ и дать практический план роста, включая рекомендации для статей.</p>
    <p class="note">Run ID: ${escapeHtml(run.id)}</p>
  </div>

  <section>
    <h2>Executive Snapshot</h2>
    <div class="grid">
      <div class="card"><div class="label">Overall SEO Score</div><div class="metric">${escapeHtml(scores.overallSeoScore ?? "n/a")}</div><p>Сводная оценка WGD по доступным источникам.</p></div>
      <div class="card"><div class="label">Visibility Score</div><div class="metric">${escapeHtml(scores.visibilityScore ?? "n/a")}</div><p>Оценка органической видимости по ранк-трекингу и данным источников.</p></div>
      <div class="card"><div class="label">HTTP страницы</div><div class="metric">${escapeHtml(page.httpStatus ?? "n/a")}</div><p>Целевая страница открылась по чистому URL без UTM-меток.</p></div>
      <div class="card"><div class="label">Рекомендации</div><div class="metric">${escapeHtml((run.recommendations || []).length)}</div><p>Автоматические рекомендации WGD плюс редакционный план ниже.</p></div>
    </div>
  </section>

  <section>
    <h2>Целевая страница</h2>
    <div class="two">
      <div>
        <p><strong>Final URL:</strong> <a href="${escapeHtml(page.finalUrl)}">${escapeHtml(page.finalUrl)}</a></p>
        <p><strong>Title:</strong> ${escapeHtml(page.title || "n/a")}</p>
        <p><strong>Description:</strong> ${escapeHtml(page.description || "n/a")}</p>
        <p><strong>H1:</strong> ${escapeHtml(page.h1 || "n/a")}</p>
        <p><strong>Canonical:</strong> ${escapeHtml(page.canonical || "n/a")}</p>
      </div>
      <div>
        <p><strong>Комментарий:</strong> В отчёте используется чистый canonical URL. UTM-метки не нужны для SEO-проверки, внутренних ссылок и рекомендаций по статьям.</p>
        <p><strong>Объём текста:</strong> примерно ${escapeHtml(page.wordCount)} слов на странице по HTML-снимку.</p>
      </div>
    </div>
  </section>

  <section>
    <h2>Техническая база WGD</h2>
    <div class="grid">
      <div class="card"><div class="label">Homepage HTTP</div><div class="metric">${escapeHtml(crawler.httpStatus ?? "n/a")}</div><p>Проверка домена <code>${escapeHtml(domain)}</code>.</p></div>
      <div class="card"><div class="label">Title</div><div class="metric">${crawler.hasTitle ? "да" : "нет"}</div><p>Наличие title на проверенной странице.</p></div>
      <div class="card"><div class="label">Meta description</div><div class="metric">${crawler.hasMetaDescription ? "да" : "нет"}</div><p>Наличие description.</p></div>
      <div class="card"><div class="label">Indexable</div><div class="metric">${escapeHtml(crawler.isIndexable ?? "n/a")}</div><p>Индексируемость по базовой проверке.</p></div>
    </div>
    <p class="note">Robots.txt: ${escapeHtml(crawler.robotsTxtReachable)} · Sitemap.xml: ${escapeHtml(crawler.sitemapXmlReachable)} · Final URL: ${escapeHtml(crawler.finalUrl || "n/a")}</p>
  </section>

  <section>
    <h2>Local Lighthouse</h2>
    <p class="note">Проверка выполнена локальным Lighthouse через Chrome, без обращения к PageSpeed Insights API. Использован desktop/provided режим: он обходит лимит PSI и не падает на mobile headless <code>NO_FCP</code> для этой страницы.</p>
    <div class="grid">
      <div class="card"><div class="label">Performance</div><div class="metric">${escapeHtml(lighthouse.performanceScore ?? "n/a")}</div></div>
      <div class="card"><div class="label">SEO</div><div class="metric">${escapeHtml(lighthouse.seoScore ?? "n/a")}</div></div>
      <div class="card"><div class="label">Accessibility</div><div class="metric">${escapeHtml(lighthouse.accessibilityScore ?? "n/a")}</div></div>
      <div class="card"><div class="label">Best Practices</div><div class="metric">${escapeHtml(lighthouse.bestPracticesScore ?? "n/a")}</div></div>
    </div>
    <p class="note">Status: ${escapeHtml(lighthouse.status)} · LCP: ${escapeHtml(lighthouse.largestContentfulPaintMs ?? "n/a")} ms · CLS: ${escapeHtml(lighthouse.cumulativeLayoutShift ?? "n/a")} · INP: ${escapeHtml(lighthouse.interactionToNextPaintMs ?? "n/a")} ms · TBT: ${escapeHtml(lighthouse.totalBlockingTimeMs ?? "n/a")} ms</p>
  </section>

  <section>
    <h2>Rank Tracking: Россия</h2>
    <p class="note">Для РФ основной ранк-трекинг выполнен через Yandex Search API, регион <code>225</code>. Google/DataForSEO не выбран в финальном запуске, потому что справочник локаций провайдера в текущей конфигурации не содержит RU/Russia.</p>
    ${rankRows ? `<table><thead><tr><th>Поисковик</th><th>Запрос</th><th>Найден</th><th>Позиция</th><th>URL</th></tr></thead><tbody>${rankRows}</tbody></table>` : "<p class=\"note\">Ранк-трекинг не вернул проверок.</p>"}
  </section>

  <section>
    <h2>Рекомендации для статей</h2>
    <ol>
      <li><strong>Сделать кластер «русская диета» не только товарным, но и экспертным.</strong> Опорная статья: «Русская диета для похудения: меню, принципы и кому подходит». Внутри дать мягкую ссылку на программу питания.</li>
      <li><strong>Развести интенты.</strong> Отдельные статьи под запросы: «меню русской диеты на неделю», «готовая программа питания для похудения», «как похудеть за неделю без голода», «низкокалорийные супы и каши для похудения».</li>
      <li><strong>Добавить медицински аккуратный блок.</strong> Для тем похудения нужны дисклеймеры, противопоказания, рекомендации проконсультироваться со специалистом и аккуратная формулировка обещаний без гарантии результата.</li>
      <li><strong>Усилить E-E-A-T.</strong> Указывать автора/редактора, дату обновления, источники, участие нутрициолога или врача, если возможно. Для каждой статьи добавить FAQ с 4-6 вопросами.</li>
      <li><strong>Использовать внутреннюю перелинковку.</strong> Каждая статья должна ссылаться на чистый URL программы без UTM, на категорию программ питания и на 2-3 соседних материала по меню, рациону, калорийности и привычкам.</li>
      <li><strong>Писать под российский SERP.</strong> Включать привычные продукты и сценарии: гречка, супы, каши, кисель, рабочий обед, перекус, ужин дома, покупка готового набора.</li>
      <li><strong>Сделать таблицы и схемы.</strong> Форматы, которые хорошо работают для статей: меню на 7 дней, список продуктов, калорийность по приёмам пищи, сравнение «готовая программа vs самостоятельное меню».</li>
    </ol>
    <h3>Приоритетный контент-план</h3>
    <table>
      <thead><tr><th>Приоритет</th><th>Материал</th><th>Основной интент</th><th>Связка со страницей</th></tr></thead>
      <tbody>
        <tr><td>1</td><td>Русская диета для похудения: меню на 7 дней</td><td>Информационный + коммерческий</td><td>CTA к готовой программе «Русская диета»</td></tr>
        <tr><td>2</td><td>Что входит в готовую программу питания для похудения</td><td>Коммерческое сравнение</td><td>Показать состав, удобство и сценарий применения</td></tr>
        <tr><td>3</td><td>Как питаться неделю, чтобы снизить калорийность рациона</td><td>Образовательный</td><td>Ссылка на программу как готовое решение</td></tr>
        <tr><td>4</td><td>Диетические супы, каши и напитки: как собрать рацион</td><td>Низкочастотный кластер</td><td>Перелинковка на категории и конкретную программу</td></tr>
        <tr><td>5</td><td>Ошибки при быстром похудении за неделю</td><td>Trust / risk reduction</td><td>Аккуратный переход к контролируемой программе</td></tr>
      </tbody>
    </table>
  </section>

  <section>
    <h2>Автоматические рекомендации WGD</h2>
    ${recommendationRows ? `<table><thead><tr><th>Priority</th><th>Type</th><th>Title</th><th>Reasoning</th></tr></thead><tbody>${recommendationRows}</tbody></table>` : "<p class=\"note\">Автоматические рекомендации не сформированы.</p>"}
  </section>

  <details>
    <summary>Статус источников</summary>
    <table><thead><tr><th>Источник</th><th>Статус</th><th>Сообщение</th><th>Ошибка</th></tr></thead><tbody>${sourceRows}</tbody></table>
  </details>

  <details>
    <summary>Raw Diagnostic Notes</summary>
    <ul>
      <li>Target URL: <code>${escapeHtml(targetUrl)}</code></li>
      <li>Canonical target: <code>${escapeHtml(page.canonical || targetUrl)}</code></li>
      <li>Local Lighthouse: <code>${escapeHtml(lighthouse.status)}</code>, <code>${escapeHtml(lighthouse.message)}</code>.</li>
      <li>Geo: <code>Россия</code>, Yandex region: <code>225</code>, language: <code>ru</code>. Google/DataForSEO исключён из финального запуска из-за отсутствия RU/Russia в справочнике локаций провайдера.</li>
      <li>JSON artifact: <code>${escapeHtml(jsonPath)}</code></li>
      <li>HTML artifact: <code>${escapeHtml(htmlPath)}</code></li>
      <li>Page body sample: ${escapeHtml(page.bodySample)}</li>
    </ul>
  </details>
</main>
</body>
</html>`;
}

async function main(): Promise<void> {
  await firestore.collection("teams").doc(teamId).set(
    {
      name: "SEO QA Team",
      memberIds: [createdByUserId],
      roles: { [createdByUserId]: "owner" },
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
  await firestore.collection("companies").doc(companyId).set(
    {
      teamId,
      name: "Leovit WGD",
      type: "campaign",
      restrictAccess: false,
      status: "active",
      createdAt: Date.now(),
      createdByUserId,
    },
    { merge: true }
  );

  const config = await upsertSeoConfig({
    teamId,
    companyId,
    domain,
    gscSiteUrl: null,
    targetDomainAliases: [domain, `www.${domain}`],
    markets: ["RU"],
    languages: ["ru"],
    competitors: ["dietelle.ru", "fitkit.ru", "growfood.pro", "levelkitchen.com", "myfood.ru"],
    importantSections: [
      "/khudeem-za-nedelyu/",
      "/khudeem-za-nedelyu/programmy-pitaniya/",
      "/khudeem-za-nedelyu/programmy-pitaniya/gastronomicheskie-programmy/russkaya-dieta/",
    ],
    brandKeywords: ["леовит", "leovit", "худеем за неделю"],
    excludeKeywords: [],
    trackingKeywords: [
      "русская диета",
      "русская диета леовит",
      "леовит русская диета",
      "худеем за неделю русская диета",
      "программа питания для похудения",
      "готовая программа питания для похудения",
      "меню для похудения на неделю",
      "диета на неделю для похудения",
      "гастрономическая программа питания",
      "леовит худеем за неделю",
    ],
    targetLocation: "Russia",
    targetRegion: "225",
    targetDevice: "desktop",
    createdByUserId,
  });

  const run = await runSeoAnalysis({
    teamId,
    companyId,
    config,
    mode: "quick_audit",
    createdByUserId,
    sources: ["crawler", "gsc", "yandex_serp_rank"],
    keywords: config.trackingKeywords,
    location: "Russia",
    region: "225",
    language: "ru",
    device: "desktop",
  });
  const draftTasks = await listSeoDraftTasksForRun(teamId, run.id);
  const page = await fetchPageSnapshot(targetUrl);
  const lighthouse = runLocalLighthouse(targetUrl);

  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve(process.cwd(), "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `wgd-leovit-russkaya-dieta-${stamp}.json`);
  const htmlPath = path.join(outDir, `wgd-leovit-russkaya-dieta-${stamp}.html`);
  fs.writeFileSync(jsonPath, JSON.stringify({ run, draftTasks, page, lighthouse }, null, 2));
  fs.writeFileSync(htmlPath, renderReport(run, page, lighthouse, jsonPath, htmlPath));

  console.log(
    JSON.stringify({ runId: run.id, draftTaskCount: draftTasks.length, jsonPath, htmlPath, pageStatus: page.httpStatus, lighthouse: lighthouse.status }, null, 2)
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => process.exit(process.exitCode || 0), 250);
  });
