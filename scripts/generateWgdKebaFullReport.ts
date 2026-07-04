import "dotenv/config";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { generateSeoDraftTasksForRun } from "../src/features/seoAgent/seoAgentService";

const teamId = "qa-seo-team-1";
const targetUrl = "https://www.keba.com/en/industrial-automation/lp/keba-ia-germany";
const domain = "keba.com";
const baseJsonPath = path.resolve("reports/wgd-keba-ia-germany-2026-06-24.json");

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
  totalByteWeight: string | null;
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
        maxBuffer: 35 * 1024 * 1024,
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
      totalByteWeight:
        typeof audits["total-byte-weight"]?.displayValue === "string"
          ? String(audits["total-byte-weight"]?.displayValue)
          : null,
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
      totalByteWeight: null,
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
    bodySample: bodyText.slice(0, 1000),
  };
}

function googleChecks(run: any): any[] {
  return run.rankTracking?.google?.checks || [];
}

function landingMatches(checks: any[]): number {
  return checks.filter((check) => String(check.matchedUrl || "").includes("/industrial-automation/lp/keba-ia-germany")).length;
}

function renderRankRows(run: any): string {
  return googleChecks(run)
    .map(
      (item: any) => `
        <tr>
          <td>${escapeHtml(item.searchEngine)}</td>
          <td>${escapeHtml(item.query)}</td>
          <td>${item.found ? "yes" : "no"}</td>
          <td>${escapeHtml(item.position || "")}</td>
          <td>${escapeHtml(item.matchedUrl || "")}</td>
          <td>${escapeHtml((item.competitorsAbove || []).map((c: any) => c.domain).join(", "))}</td>
        </tr>`
    )
    .join("");
}

function renderSourceRows(run: any): string {
  return (run.sourceStatuses || [])
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
}

function renderDraftRows(tasks: any[]): string {
  return tasks
    .map(
      (task) => `
        <tr>
          <td>${escapeHtml(task.priority)}</td>
          <td>${escapeHtml(task.status)}</td>
          <td>${escapeHtml(task.title)}</td>
          <td>${escapeHtml((task.labels || []).join(", "))}</td>
        </tr>`
    )
    .join("");
}

function renderFindingRows(run: any): string {
  return (run.findings || [])
    .map(
      (item: any) => `
        <tr>
          <td>${escapeHtml(item.severity)}</td>
          <td>${escapeHtml(item.confidence)}</td>
          <td>${escapeHtml(item.source)}</td>
          <td>${escapeHtml(item.title)}</td>
          <td>${escapeHtml(item.recommendation)}</td>
        </tr>`
    )
    .join("");
}

function renderRecommendationRows(run: any): string {
  return (run.recommendations || [])
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
}

function renderLanguageSection(input: { label: string; dataForSeoLanguage: string; run: any; draftTasks: any[] }): string {
  const checks = googleChecks(input.run);
  const foundCount = checks.filter((item) => item.found).length;
  const rankRows = renderRankRows(input.run);
  const draftRows = renderDraftRows(input.draftTasks);
  const recommendationRows = renderRecommendationRows(input.run);

  return `
  <section>
    <h2>DataForSEO: ${escapeHtml(input.label)}</h2>
    <p class="note">Run ID: ${escapeHtml(input.run.id)} · DataForSEO <code>language_name=${escapeHtml(input.dataForSeoLanguage)}</code> · Location: <code>Germany</code> · Device: <code>desktop</code></p>
    <div class="grid">
      <div class="card"><div class="label">Google checks</div><div class="metric">${escapeHtml(checks.length)}</div><p>Live organic SERP checks through DataForSEO.</p></div>
      <div class="card"><div class="label">Found</div><div class="metric">${escapeHtml(foundCount)}/${escapeHtml(checks.length)}</div><p>Domain <code>keba.com</code> found in checked SERPs.</p></div>
      <div class="card"><div class="label">Landing matches</div><div class="metric">${escapeHtml(landingMatches(checks))}</div><p>Matched URL contains the requested IA Germany landing path.</p></div>
      <div class="card"><div class="label">Draft tasks</div><div class="metric">${escapeHtml(input.draftTasks.length)}</div><p>Created only as WGD drafts, not converted to real tasks.</p></div>
    </div>
  </section>

  <section>
    <h2>${escapeHtml(input.label)} Google Rank Tracking</h2>
    ${rankRows ? `<table><thead><tr><th>Engine</th><th>Query</th><th>Found</th><th>Position</th><th>Matched URL</th><th>Competitors Above</th></tr></thead><tbody>${rankRows}</tbody></table>` : "<p class=\"note\">No rank checks returned.</p>"}
  </section>

  <section>
    <h2>${escapeHtml(input.label)} Draft Tasks</h2>
    ${draftRows ? `<table><thead><tr><th>Priority</th><th>Status</th><th>Title</th><th>Labels</th></tr></thead><tbody>${draftRows}</tbody></table>` : "<p class=\"note\">No draft tasks generated.</p>"}
  </section>

  <section>
    <h2>${escapeHtml(input.label)} WGD Recommendations</h2>
    ${recommendationRows ? `<table><thead><tr><th>Priority</th><th>Type</th><th>Title</th><th>Reasoning</th></tr></thead><tbody>${recommendationRows}</tbody></table>` : "<p class=\"note\">No recommendations generated.</p>"}
  </section>`;
}

function renderReport(input: {
  runs: Array<{ label: string; dataForSeoLanguage: string; run: any; draftTasks: any[] }>;
  page: PageSnapshot;
  lighthouse: LocalLighthouseSnapshot;
  jsonPath: string;
  htmlPath: string;
  lighthousePath: string;
}): string {
  const primaryRun = input.runs[0].run;
  const crawler = primaryRun.crawler || {};
  const allChecks = input.runs.flatMap((item) => googleChecks(item.run));
  const landingMatchCount = landingMatches(allChecks);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WGD Report - KEBA IA Germany</title>
  <style>
    :root{--bg:#f5f7fb;--paper:#fff;--ink:#162033;--muted:#667085;--line:#d9e0ea;--ok:#1f7a4d;--warn:#9a6500;--bad:#b42318;--blue:#245a8d;--soft:#f9fbfe}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 Arial,"Helvetica Neue",sans-serif}main{max-width:1180px;margin:0 auto;padding:30px 22px 54px}
    .hero,section,details{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:22px;margin:14px 0;box-shadow:0 10px 34px rgba(23,34,51,.05)}.hero{padding:30px}
    h1,h2,h3{line-height:1.18;margin:0 0 12px;letter-spacing:0}h1{font-size:clamp(30px,4vw,48px)}h2{font-size:22px}.sub{max-width:940px;color:var(--muted);font-size:18px}.note{color:var(--muted);font-size:13px}
    .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.card{border:1px solid var(--line);border-radius:8px;background:var(--soft);padding:16px;min-height:118px}.label{color:var(--muted);font-size:12px;text-transform:uppercase;font-weight:700}.metric{font-size:30px;font-weight:800;margin:6px 0;color:#1d334c}
    table{width:100%;border-collapse:collapse}th,td{border-top:1px solid var(--line);padding:10px 8px;text-align:left;vertical-align:top}th{color:var(--muted);font-size:12px;text-transform:uppercase}.pill{display:inline-block;border-radius:999px;padding:3px 9px;font-size:12px;font-weight:800}.ok{background:#e6f2eb;color:var(--ok)}.warn{background:#fff2d7;color:var(--warn)}.bad{background:#fde7e4;color:var(--bad)}
    code{background:#eef2f6;border-radius:5px;padding:1px 5px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}ol,ul{margin:0;padding-left:22px}li{margin:7px 0}a{color:var(--blue)}details summary{cursor:pointer;font-weight:800;font-size:17px}.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    @media(max-width:860px){.grid,.two{grid-template-columns:1fr}table{display:block;overflow-x:auto}main{padding:16px}}
  </style>
</head>
<body>
<main>
  <div class="hero">
    <div class="note">Website Growth Diagnostic · Geo: Germany · DataForSEO languages: Deutsch/German and English · Date: 2026-06-24</div>
    <h1>KEBA IA Germany landing page</h1>
    <p class="sub">Diagnostic for <a href="${escapeHtml(targetUrl)}">${escapeHtml(targetUrl)}</a>. The report combines live Google rank tracking through DataForSEO, target-page inspection, local Lighthouse, WGD recommendations, draft tasks, and source status audit.</p>
    <p class="note">Domain scope: <code>${escapeHtml(domain)}</code>. The WGD core crawler checks homepage-level domain health; target-page facts and Lighthouse are collected separately for the requested landing page.</p>
  </div>

  <section>
    <h2>Executive Snapshot</h2>
    <div class="grid">
      <div class="card"><div class="label">Google checks</div><div class="metric">${escapeHtml(allChecks.length)}</div><p>Two DataForSEO runs: German and English.</p></div>
      <div class="card"><div class="label">Landing matches</div><div class="metric">${escapeHtml(landingMatchCount)}</div><p>Checks where the matched URL is the IA Germany landing path.</p></div>
      <div class="card"><div class="label">Target page SEO</div><div class="metric">${escapeHtml(input.lighthouse.seoScore ?? "n/a")}</div><p>Local Lighthouse SEO score for the exact landing URL.</p></div>
      <div class="card"><div class="label">Draft tasks</div><div class="metric">${escapeHtml(input.runs.reduce((sum, item) => sum + item.draftTasks.length, 0))}</div><p>Drafts generated from both WGD runs.</p></div>
    </div>
  </section>

  <section>
    <h2>Target Page Facts</h2>
    <div class="two">
      <div>
        <p><strong>HTTP:</strong> ${escapeHtml(input.page.httpStatus ?? "n/a")}</p>
        <p><strong>Final URL:</strong> <a href="${escapeHtml(input.page.finalUrl)}">${escapeHtml(input.page.finalUrl)}</a></p>
        <p><strong>Title:</strong> ${escapeHtml(input.page.title || "n/a")}</p>
        <p><strong>Description:</strong> ${escapeHtml(input.page.description || "n/a")}</p>
        <p><strong>Canonical:</strong> <code>${escapeHtml(input.page.canonical || "n/a")}</code></p>
      </div>
      <div>
        <p><strong>H1:</strong> ${escapeHtml(input.page.h1 || "n/a")}</p>
        <p><strong>Approx. visible words:</strong> ${escapeHtml(input.page.wordCount)}</p>
        <p><strong>Homepage crawl:</strong> ${escapeHtml(crawler.httpStatus ?? "n/a")} · ${escapeHtml(crawler.finalUrl || "n/a")}</p>
        <p><strong>Robots/Sitemap:</strong> robots ${escapeHtml(crawler.robotsTxtReachable)} · sitemap ${escapeHtml(crawler.sitemapXmlReachable)}</p>
      </div>
    </div>
  </section>

  <section>
    <h2>Main Findings</h2>
    <ol>
      <li><strong>English SERP match is stronger for the requested URL.</strong> English DataForSEO found <code>keba.com</code> for all checked queries, with the IA Germany landing page matching most commercial queries.</li>
      <li><strong>German SERP often resolves to the German localized landing page.</strong> That is expected for <code>language_name=German</code>; it means DE localization is visible, while the requested English URL is not always the canonical SERP target for German users.</li>
      <li><strong>Brand and branded-commercial queries are very strong.</strong> Queries such as <code>keba industrial automation germany</code>, <code>keba automation germany</code>, and <code>keba ia germany</code> are position 1 in both language runs.</li>
      <li><strong>Generic category capture is mixed.</strong> English performs well for <code>automation solutions germany</code> and <code>machine automation germany</code>; German did not find the domain for <code>machine automation germany</code> in this check set.</li>
      <li><strong>PageSpeed API is rate-limited, so local Lighthouse is the reliable technical snapshot in this report.</strong> The PSI source remains recorded as partial in WGD source statuses.</li>
    </ol>
  </section>

  <section>
    <h2>Recommended Growth Work</h2>
    <ol>
      <li><strong>Keep EN and DE landing pages intentionally separated.</strong> Add/verify hreflang between English and German variants and ensure each localized page has a self-referencing canonical.</li>
      <li><strong>Build a German keyword layer, not only English queries with German SERP settings.</strong> Add terms like <code>Industrieautomation Deutschland</code>, <code>Maschinenautomatisierung</code>, <code>Automatisierungslösungen Deutschland</code>, and <code>Steuerungstechnik Maschinenbau</code>.</li>
      <li><strong>Create supporting pages for non-brand commercial intent.</strong> Use solution pages/case studies for machine automation, robotics/HMI/control systems, and Germany-specific implementation proof.</li>
      <li><strong>Strengthen snippet control.</strong> Align title/meta/H1 around “Industrial automation in Germany” on EN and equivalent German phrasing on DE, while avoiding duplicate localized metadata.</li>
      <li><strong>Add conversion proof for industrial buyers.</strong> Above the fold and mid-page should show concrete industries, integration capabilities, certifications/standards, service coverage in Germany, and clear contact/demo CTA.</li>
    </ol>
  </section>

  <section>
    <h2>Local Lighthouse: Target Page</h2>
    <p class="note">Run locally through Chrome, desktop/provided mode, no PageSpeed API dependency.</p>
    <div class="grid">
      <div class="card"><div class="label">Performance</div><div class="metric">${escapeHtml(input.lighthouse.performanceScore ?? "n/a")}</div></div>
      <div class="card"><div class="label">SEO</div><div class="metric">${escapeHtml(input.lighthouse.seoScore ?? "n/a")}</div></div>
      <div class="card"><div class="label">Accessibility</div><div class="metric">${escapeHtml(input.lighthouse.accessibilityScore ?? "n/a")}</div></div>
      <div class="card"><div class="label">Best Practices</div><div class="metric">${escapeHtml(input.lighthouse.bestPracticesScore ?? "n/a")}</div></div>
    </div>
    <p class="note">Status: ${escapeHtml(input.lighthouse.status)} · LCP: ${escapeHtml(input.lighthouse.largestContentfulPaintMs ?? "n/a")} ms · CLS: ${escapeHtml(input.lighthouse.cumulativeLayoutShift ?? "n/a")} · INP: ${escapeHtml(input.lighthouse.interactionToNextPaintMs ?? "n/a")} ms · TBT: ${escapeHtml(input.lighthouse.totalBlockingTimeMs ?? "n/a")} ms · Total weight: ${escapeHtml(input.lighthouse.totalByteWeight || "n/a")}</p>
  </section>

  ${input.runs.map(renderLanguageSection).join("\n")}

  <details>
    <summary>SeoFinding records</summary>
    <table><thead><tr><th>Severity</th><th>Confidence</th><th>Source</th><th>Title</th><th>Recommendation</th></tr></thead><tbody>${input.runs.map((item) => renderFindingRows(item.run)).join("")}</tbody></table>
  </details>

  <details>
    <summary>Source statuses</summary>
    ${input.runs
      .map(
        (item) => `
          <h3>${escapeHtml(item.label)}</h3>
          <table><thead><tr><th>Source</th><th>Status</th><th>Message</th><th>Error</th></tr></thead><tbody>${renderSourceRows(item.run)}</tbody></table>`
      )
      .join("")}
  </details>

  <details>
    <summary>Artifacts</summary>
    <ul>
      <li>JSON artifact: <code>${escapeHtml(input.jsonPath)}</code></li>
      <li>HTML artifact: <code>${escapeHtml(input.htmlPath)}</code></li>
      <li>Lighthouse summary JSON: <code>${escapeHtml(input.lighthousePath)}</code></li>
      <li>Target URL: <code>${escapeHtml(targetUrl)}</code></li>
      <li>Page body sample: ${escapeHtml(input.page.bodySample)}</li>
    </ul>
  </details>
</main>
</body>
</html>`;
}

async function main(): Promise<void> {
  const base = JSON.parse(fs.readFileSync(baseJsonPath, "utf8"));
  const page = await fetchPageSnapshot(targetUrl);
  const lighthouse = runLocalLighthouse(targetUrl);

  const runs = [];
  for (const item of base.runs || []) {
    const draftTasks = await generateSeoDraftTasksForRun(teamId, item.run.id);
    runs.push({
      label: item.label,
      dataForSeoLanguage: item.dataForSeoLanguage,
      run: item.run,
      draftTasks,
    });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve(process.cwd(), "reports");
  const jsonPath = path.join(outDir, `wgd-keba-ia-germany-full-${stamp}.json`);
  const htmlPath = path.join(outDir, `wgd-keba-ia-germany-full-${stamp}.html`);
  const lighthousePath = path.join(outDir, `lighthouse-keba-ia-germany-${stamp}.json`);

  fs.writeFileSync(lighthousePath, JSON.stringify(lighthouse, null, 2));
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        targetUrl,
        domain,
        page,
        lighthouse,
        runs,
      },
      null,
      2
    )
  );
  fs.writeFileSync(htmlPath, renderReport({ runs, page, lighthouse, jsonPath, htmlPath, lighthousePath }));

  console.log(
    JSON.stringify(
      {
        jsonPath,
        htmlPath,
        lighthousePath,
        runs: runs.map((item) => ({ label: item.label, runId: item.run.id, draftTaskCount: item.draftTasks.length })),
        lighthouse: lighthouse.status,
      },
      null,
      2
    )
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
