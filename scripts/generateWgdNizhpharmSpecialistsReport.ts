import "dotenv/config";
import fs from "fs";
import path from "path";
import { findSeoAnalysisRunById } from "../src/features/seoAgent/seoAnalysisRunRepository";
import { listSeoDraftTasksForRun } from "../src/features/seoAgent/seoAgentService";

const runId = "RO4rr1PgOeUaO1QHHHZr";
const targetUrl = "https://nizhpharm.ru/doctor/boarding-page/";
const domain = "nizhpharm.ru";
const stamp = "2026-06-22";

type LighthousePayload = {
  finalDisplayedUrl?: string;
  fetchTime?: string;
  categories?: Record<string, { score?: number } | undefined>;
  audits?: Record<string, { numericValue?: number; displayValue?: string } | undefined>;
  scores?: LighthouseSummary["scores"];
  metrics?: LighthouseSummary["metrics"];
};

type LighthouseSummary = {
  finalDisplayedUrl: string | null;
  fetchTime: string | null;
  scores: {
    performance: number | null;
    accessibility: number | null;
    bestPractices: number | null;
    seo: number | null;
  };
  metrics: {
    firstContentfulPaintMs: number | null;
    largestContentfulPaintMs: number | null;
    cumulativeLayoutShift: number | null;
    totalBlockingTimeMs: number | null;
    speedIndexMs: number | null;
    totalByteWeight: string | null;
  };
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function score(payload: LighthousePayload, key: string): number | null {
  const summaryKey =
    key === "best-practices"
      ? "bestPractices"
      : key === "performance" || key === "accessibility" || key === "seo"
        ? key
        : null;
  if (summaryKey && typeof payload.scores?.[summaryKey] === "number") return payload.scores[summaryKey];
  const value = payload.categories?.[key]?.score;
  return typeof value === "number" ? Math.round(value * 100) : null;
}

function statusClass(status: string): string {
  if (status === "success") return "ok";
  if (status === "partial" || status === "skipped") return "warn";
  return "bad";
}

function numericAudit(payload: LighthousePayload, key: string): number | null {
  const summaryKey =
    key === "first-contentful-paint"
      ? "firstContentfulPaintMs"
      : key === "largest-contentful-paint"
        ? "largestContentfulPaintMs"
        : key === "cumulative-layout-shift"
          ? "cumulativeLayoutShift"
          : key === "total-blocking-time"
            ? "totalBlockingTimeMs"
            : key === "speed-index"
              ? "speedIndexMs"
              : null;
  if (summaryKey && typeof payload.metrics?.[summaryKey] === "number") return payload.metrics[summaryKey];
  const value = payload.audits?.[key]?.numericValue;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function summarizeLighthouse(payload: LighthousePayload): LighthouseSummary {
  return {
    finalDisplayedUrl: payload.finalDisplayedUrl || null,
    fetchTime: payload.fetchTime || null,
    scores: {
      performance: score(payload, "performance"),
      accessibility: score(payload, "accessibility"),
      bestPractices: score(payload, "best-practices"),
      seo: score(payload, "seo"),
    },
    metrics: {
      firstContentfulPaintMs: numericAudit(payload, "first-contentful-paint"),
      largestContentfulPaintMs: numericAudit(payload, "largest-contentful-paint"),
      cumulativeLayoutShift: numericAudit(payload, "cumulative-layout-shift"),
      totalBlockingTimeMs: numericAudit(payload, "total-blocking-time"),
      speedIndexMs: numericAudit(payload, "speed-index"),
      totalByteWeight: payload.metrics?.totalByteWeight || payload.audits?.["total-byte-weight"]?.displayValue || null,
    },
  };
}

function renderReport(input: {
  run: any;
  draftTasks: any[];
  lighthouse: LighthousePayload;
  jsonPath: string;
  htmlPath: string;
}): string {
  const { run, draftTasks, lighthouse, jsonPath, htmlPath } = input;
  const checks = [...(run.rankTracking?.google?.checks || []), ...(run.rankTracking?.yandex?.checks || [])];
  const sourceRows = (run.sourceStatuses || [])
    .map(
      (item: any) => `<tr><td>${escapeHtml(item.source)}</td><td><span class="pill ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td><td>${escapeHtml(item.message)}</td><td>${escapeHtml(item.errorCode || "")}</td></tr>`
    )
    .join("");
  const rankRows = checks
    .map(
      (item: any) => `<tr><td>${escapeHtml(item.searchEngine)}</td><td>${escapeHtml(item.query)}</td><td>${item.found ? "да" : "нет"}</td><td>${escapeHtml(item.position || "")}</td><td>${escapeHtml(item.matchedUrl || "")}</td><td>${escapeHtml((item.topResultDomains || []).slice(0, 5).join(", "))}</td></tr>`
    )
    .join("");
  const taskRows = draftTasks
    .map(
      (item: any) => `<tr><td>${escapeHtml(item.priority)}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml((item.labels || []).join(", "))}</td></tr>`
    )
    .join("");
  const findingRows = (run.findings || [])
    .map(
      (item: any) => `<tr><td>${escapeHtml(item.severity)}</td><td>${escapeHtml(item.confidence)}</td><td>${escapeHtml(item.source)}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.recommendation)}</td></tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WGD Report - Nizhpharm specialists</title>
  <style>
    :root{--bg:#f5f7fb;--paper:#fff;--ink:#162033;--muted:#667085;--line:#d9e0ea;--ok:#1f7a4d;--warn:#9a6500;--bad:#b42318;--blue:#245a8d;--soft:#f9fbfe}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 Arial,"Helvetica Neue",sans-serif}main{max-width:1180px;margin:0 auto;padding:30px 22px 54px}
    .hero,section,details{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:22px;margin:14px 0;box-shadow:0 10px 34px rgba(23,34,51,.05)}.hero{padding:30px}
    h1,h2,h3{line-height:1.18;margin:0 0 12px}h1{font-size:clamp(30px,4vw,48px)}h2{font-size:22px}.sub{max-width:940px;color:var(--muted);font-size:18px}.note{color:var(--muted);font-size:13px}
    .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.card{border:1px solid var(--line);border-radius:9px;background:var(--soft);padding:16px;min-height:118px}.label{color:var(--muted);font-size:12px;text-transform:uppercase;font-weight:700}.metric{font-size:30px;font-weight:800;margin:6px 0;color:#1d334c}
    table{width:100%;border-collapse:collapse}th,td{border-top:1px solid var(--line);padding:10px 8px;text-align:left;vertical-align:top}th{color:var(--muted);font-size:12px;text-transform:uppercase}.pill{display:inline-block;border-radius:999px;padding:3px 9px;font-size:12px;font-weight:800}.ok{background:#e6f2eb;color:var(--ok)}.warn{background:#fff2d7;color:var(--warn)}.bad{background:#fde7e4;color:var(--bad)}
    code{background:#eef2f6;border-radius:5px;padding:1px 5px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}ol,ul{margin:0;padding-left:22px}li{margin:7px 0}a{color:var(--blue)}details summary{cursor:pointer;font-weight:800;font-size:17px}.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    @media(max-width:860px){.grid,.two{grid-template-columns:1fr}table{display:block;overflow-x:auto}main{padding:16px}}
  </style>
</head>
<body>
<main>
  <div class="hero">
    <div class="note">Website Growth Diagnostic · Гео: РФ / Россия · Цель: привлечение специалистов здравоохранения · Дата запуска: ${stamp}</div>
    <h1>nizhpharm.ru: раздел для специалистов</h1>
    <p class="sub">Диагностика страницы <a href="${targetUrl}">${targetUrl}</a>. Фокус отчета: органическое привлечение врачей и других специалистов здравоохранения к professional portal/content hub, а не товарные продажи.</p>
    <p class="note">Run ID: ${escapeHtml(run.id)} · Company: ${escapeHtml(run.companyId)} · Все AI/heuristic выводы помечены как эвристика, не как прогноз ранжирования Google.</p>
  </div>

  <section>
    <h2>Executive Snapshot</h2>
    <div class="grid">
      <div class="card"><div class="label">Yandex checks</div><div class="metric">${checks.filter((item: any) => item.found).length}/${checks.length}</div><p>Найдены в основном брендовые/навигационные запросы.</p></div>
      <div class="card"><div class="label">Target page SEO</div><div class="metric">${escapeHtml(score(lighthouse, "seo") ?? "n/a")}</div><p>Lighthouse видит title, description и canonical целевой страницы.</p></div>
      <div class="card"><div class="label">Performance</div><div class="metric">${escapeHtml(score(lighthouse, "performance") ?? "n/a")}</div><p>TBT повышен; общий вес страницы около ${escapeHtml(lighthouse.audits?.["total-byte-weight"]?.displayValue || "n/a")}.</p></div>
      <div class="card"><div class="label">Draft tasks</div><div class="metric">${draftTasks.length}</div><p>Все задачи созданы только как drafts.</p></div>
    </div>
  </section>

  <section>
    <h2>Target Page Facts</h2>
    <div class="two">
      <div>
        <p><strong>Title:</strong> Специалистам – О компании Нижфарм и нашей миссии</p>
        <p><strong>Description:</strong> Специалистам на официальном сайте Нижфарм. Узнайте больше о наших ценностях, ответственности, карьерных возможностях и вкладе в развитие здравоохранения.</p>
        <p><strong>Canonical:</strong> <code>${targetUrl}</code></p>
        <p><strong>H1:</strong> Раздел для специалистов</p>
      </div>
      <div>
        <p><strong>Видимые CTA:</strong> Войти, Зарегистрироваться, Я — специалист здравоохранения.</p>
        <p><strong>Сегменты:</strong> гинекология, кардиология, неврология, терапия, педиатрия, урология, хирургия, эндокринология, ревматология, травматология, онкология.</p>
        <p><strong>Контентные форматы:</strong> статьи, брошюры для пациентов, брошюры для врачей, опросники/тесты, клинические рекомендации, научные видео.</p>
      </div>
    </div>
  </section>

  <section>
    <h2>Главные выводы</h2>
    <ol>
      <li><strong>Брендовый спрос закрыт хорошо.</strong> В Yandex сайт найден на позиции 1 по <code>нижфарм специалистам</code>, <code>нижфарм для врачей</code>, <code>нижфарм</code> и <code>nizhpharm</code>.</li>
      <li><strong>Небрендовый спрос почти не захвачен.</strong> По запросам <code>материалы для врачей</code>, <code>клинические рекомендации для врачей</code>, <code>образовательные материалы для врачей</code>, <code>портал для специалистов здравоохранения</code> сайт не найден в проверенной выдаче.</li>
      <li><strong>ServicePipe/WAF — отдельный риск.</strong> Обычный fetch/crawler получает 403 или JS challenge, robots.txt тоже отдал 403. Реальный браузер и Lighthouse страницу видят, но нужно явно проверить allowlist поисковых ботов и доступность robots/sitemap.</li>
      <li><strong>Страница выглядит как gated content hub.</strong> Это нормально для HCP-контента, но SEO-страница должна иметь достаточно открытого описательного текста: кому раздел полезен, какие материалы доступны, специализации, обновления, правила доступа.</li>
      <li><strong>Есть технический frontend-риск.</strong> В браузерной консоли зафиксированы Mindbox errors: duplicate tracker initialization и undefined <code>firebaseMessagingSenderId</code>. Это не сломало контент, но влияет на качество и мониторинг.</li>
    </ol>
  </section>

  <section>
    <h2>Рекомендации под привлечение специалистов</h2>
    <ol>
      <li><strong>Сделать открытый SEO-текст на посадочной.</strong> Добавить блоки: “материалы для врачей”, “клинические рекомендации”, “научные видео”, “брошюры для пациентов”, “по специальностям”. Без медицинских обещаний и без продажной подачи.</li>
      <li><strong>Создать индексируемые landing pages по специальностям.</strong> Например <code>/doctor/ginekologiya/</code>, <code>/doctor/kardiologiya/</code>, <code>/doctor/terapiya/</code> с открытым intro, списком типов материалов и ссылкой на регистрацию.</li>
      <li><strong>Развести брендовые и небрендовые интенты.</strong> Брендовые запросы уже сильные; рост нужен через запросы “для врачей”, “для специалистов здравоохранения”, “клинические материалы”, “вебинары/видео для врачей”.</li>
      <li><strong>Проверить WAF для SEO-ботов.</strong> Googlebot/YandexBot/Bingbot должны получать нормальные HTML/robots/sitemap без challenge. Иначе источник crawler будет показывать 403, а органика может терять доступ к структуре.</li>
      <li><strong>Подключить GSC property.</strong> Без GSC нельзя понять реальные query/page пары, CTR и страницы входа для раздела специалистов.</li>
    </ol>
  </section>

  <section>
    <h2>Lighthouse: целевая страница</h2>
    <div class="grid">
      <div class="card"><div class="label">Performance</div><div class="metric">${escapeHtml(score(lighthouse, "performance") ?? "n/a")}</div></div>
      <div class="card"><div class="label">SEO</div><div class="metric">${escapeHtml(score(lighthouse, "seo") ?? "n/a")}</div></div>
      <div class="card"><div class="label">Accessibility</div><div class="metric">${escapeHtml(score(lighthouse, "accessibility") ?? "n/a")}</div></div>
      <div class="card"><div class="label">Best Practices</div><div class="metric">${escapeHtml(score(lighthouse, "best-practices") ?? "n/a")}</div></div>
    </div>
    <p class="note">FCP: ${escapeHtml(lighthouse.audits?.["first-contentful-paint"]?.numericValue ?? "n/a")} ms · LCP: ${escapeHtml(lighthouse.audits?.["largest-contentful-paint"]?.numericValue ?? "n/a")} ms · CLS: ${escapeHtml(lighthouse.audits?.["cumulative-layout-shift"]?.numericValue ?? "n/a")} · TBT: ${escapeHtml(lighthouse.audits?.["total-blocking-time"]?.numericValue ?? "n/a")} ms</p>
  </section>

  <section>
    <h2>Yandex Rank Tracking: Россия</h2>
    <table><thead><tr><th>Поисковик</th><th>Запрос</th><th>Найден</th><th>Позиция</th><th>Matched URL</th><th>Top domains</th></tr></thead><tbody>${rankRows}</tbody></table>
  </section>

  <section>
    <h2>Draft Tasks</h2>
    <table><thead><tr><th>Priority</th><th>Status</th><th>Title</th><th>Labels</th></tr></thead><tbody>${taskRows}</tbody></table>
  </section>

  <details>
    <summary>SeoFinding records</summary>
    <table><thead><tr><th>Severity</th><th>Confidence</th><th>Source</th><th>Title</th><th>Recommendation</th></tr></thead><tbody>${findingRows}</tbody></table>
  </details>

  <details>
    <summary>Source statuses</summary>
    <table><thead><tr><th>Источник</th><th>Статус</th><th>Сообщение</th><th>Ошибка</th></tr></thead><tbody>${sourceRows}</tbody></table>
  </details>

  <details>
    <summary>Artifacts</summary>
    <ul>
      <li>JSON artifact: <code>${escapeHtml(jsonPath)}</code></li>
      <li>HTML artifact: <code>${escapeHtml(htmlPath)}</code></li>
      <li>Lighthouse summary JSON: <code>${escapeHtml(path.resolve("reports/lighthouse-nizhpharm-specialists-2026-06-22.json"))}</code></li>
      <li>Playwright snapshot: <code>${escapeHtml(path.resolve(".playwright-cli/page-2026-06-22T15-43-58-174Z.yml"))}</code></li>
      <li>Console log: <code>${escapeHtml(path.resolve(".playwright-cli/console-2026-06-22T15-43-55-936Z.log"))}</code></li>
    </ul>
  </details>
</main>
</body>
</html>`;
}

async function main(): Promise<void> {
  const run = await findSeoAnalysisRunById(runId);
  if (!run) throw new Error(`SeoAnalysisRun not found: ${runId}`);

  const draftTasks = await listSeoDraftTasksForRun(run.teamId, run.id);
  const lighthousePath = path.resolve("reports/lighthouse-nizhpharm-specialists-2026-06-22.json");
  const lighthouse = JSON.parse(fs.readFileSync(lighthousePath, "utf8")) as LighthousePayload;
  const lighthouseSummary = summarizeLighthouse(lighthouse);

  const outDir = path.resolve(process.cwd(), "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `wgd-nizhpharm-specialists-${stamp}.json`);
  const htmlPath = path.join(outDir, `wgd-nizhpharm-specialists-${stamp}.html`);

  const reportPayload = {
    run,
    draftTasks,
    targetPage: {
      url: targetUrl,
      browserValidated: true,
      title: "Специалистам – О компании Нижфарм и нашей миссии",
      description:
        "Специалистам на официальном сайте Нижфарм. Узнайте больше о наших ценностях, ответственности, карьерных возможностях и вкладе в развитие здравоохранения.",
      canonical: targetUrl,
      h1: "Раздел для специалистов",
      focus: "attract healthcare specialists, not direct sales",
    },
    lighthouse: lighthouseSummary,
    artifacts: {
      lighthousePath,
      playwrightSnapshotPath: path.resolve(".playwright-cli/page-2026-06-22T15-43-58-174Z.yml"),
      playwrightConsolePath: path.resolve(".playwright-cli/console-2026-06-22T15-43-55-936Z.log"),
    },
  };

  fs.writeFileSync(jsonPath, JSON.stringify(reportPayload, null, 2));
  fs.writeFileSync(lighthousePath, JSON.stringify(lighthouseSummary, null, 2));
  fs.writeFileSync(htmlPath, renderReport({ run, draftTasks, lighthouse, jsonPath, htmlPath }));
  console.log(JSON.stringify({ runId: run.id, draftTaskCount: draftTasks.length, jsonPath, htmlPath }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => process.exit(process.exitCode || 0), 250);
  });
