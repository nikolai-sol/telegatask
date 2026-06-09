import "dotenv/config";
import fs from "fs";
import path from "path";
import { firestore } from "../src/config/firebase";
import { upsertSeoConfig } from "../src/features/seoAgent/seoConfigRepository";
import { listSeoDraftTasksForRun, runSeoAnalysis } from "../src/features/seoAgent/seoAgentService";

const teamId = "qa-seo-team-1";
const companyId = "qa-seo-company-amalphis";
const createdByUserId = "qa-seo-user";
const domain = "amalphis.at";

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

function renderList(items: string[]): string {
  if (!items.length) return "<p class=\"muted\">No items.</p>";
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderReport(run: any): string {
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

  const recRows = (run.recommendations || [])
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

  const opportunityRows = (run.opportunities || [])
    .map(
      (item: any) => `
        <tr>
          <td>${escapeHtml(item.priority || item.impact || "")}</td>
          <td>${escapeHtml(item.category || item.type || "")}</td>
          <td>${escapeHtml(item.title)}</td>
          <td>${escapeHtml(item.reasoning)}</td>
        </tr>`
    )
    .join("");

  const googleChecks = run.rankTracking?.google?.checks || [];
  const yandexChecks = run.rankTracking?.yandex?.checks || [];
  const rankRows = [...googleChecks, ...yandexChecks]
    .map(
      (item: any) => `
        <tr>
          <td>${escapeHtml(item.searchEngine)}</td>
          <td>${escapeHtml(item.query)}</td>
          <td>${item.found ? "yes" : "no"}</td>
          <td>${escapeHtml(item.position || "")}</td>
          <td>${escapeHtml(item.matchedUrl || "")}</td>
        </tr>`
    )
    .join("");

  const crawler = run.crawler || {};
  const pagespeed = run.pagespeed || {};
  const scores = run.scores || {};

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WGD Report - ${escapeHtml(run.domain)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --text: #17202a;
      --muted: #5c6670;
      --line: #d9dee5;
      --ok: #1f7a4d;
      --warn: #9a6500;
      --bad: #b3261e;
      --accent: #235789;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main { max-width: 1120px; margin: 0 auto; padding: 28px; }
    header { margin-bottom: 18px; }
    h1 { margin: 0 0 6px; font-size: 30px; letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 18px; letter-spacing: 0; }
    section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
      margin: 14px 0;
    }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .metric { border: 1px solid var(--line); border-radius: 6px; padding: 12px; min-height: 78px; }
    .label { color: var(--muted); font-size: 12px; margin-bottom: 6px; }
    .value { font-size: 22px; font-weight: 700; overflow-wrap: anywhere; }
    .muted { color: var(--muted); }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-top: 1px solid var(--line); padding: 9px 8px; text-align: left; vertical-align: top; }
    th { color: var(--muted); font-size: 12px; font-weight: 600; }
    .pill { display: inline-block; border-radius: 999px; padding: 2px 8px; font-size: 12px; font-weight: 700; }
    .pill.ok { background: #e7f4ed; color: var(--ok); }
    .pill.warn { background: #fff3d8; color: var(--warn); }
    .pill.bad { background: #fde8e7; color: var(--bad); }
    a { color: var(--accent); }
    @media (max-width: 760px) {
      main { padding: 16px; }
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      table { display: block; overflow-x: auto; }
    }
  </style>
</head>
<body>
<main>
  <header>
    <h1>WGD Report: ${escapeHtml(run.domain)}</h1>
    <div class="muted">Run ID: ${escapeHtml(run.id)} · Created: ${escapeHtml(formatDate(run.createdAt))}</div>
  </header>

  <section>
    <h2>Executive Snapshot</h2>
    <div class="grid">
      <div class="metric"><div class="label">Overall SEO Score</div><div class="value">${escapeHtml(scores.overallSeoScore ?? "n/a")}</div></div>
      <div class="metric"><div class="label">Visibility Score</div><div class="value">${escapeHtml(scores.visibilityScore ?? "n/a")}</div></div>
      <div class="metric"><div class="label">Opportunities</div><div class="value">${escapeHtml((run.opportunities || []).length)}</div></div>
      <div class="metric"><div class="label">Recommendations</div><div class="value">${escapeHtml((run.recommendations || []).length)}</div></div>
    </div>
  </section>

  <section>
    <h2>Sources</h2>
    <table>
      <thead><tr><th>Source</th><th>Status</th><th>Message</th><th>Error</th></tr></thead>
      <tbody>${sourceRows}</tbody>
    </table>
  </section>

  <section>
    <h2>Technical Crawl</h2>
    <div class="grid">
      <div class="metric"><div class="label">HTTP Status</div><div class="value">${escapeHtml(crawler.httpStatus ?? "n/a")}</div></div>
      <div class="metric"><div class="label">Title</div><div class="value">${crawler.hasTitle ? "yes" : "no"}</div></div>
      <div class="metric"><div class="label">Meta Description</div><div class="value">${crawler.hasMetaDescription ? "yes" : "no"}</div></div>
      <div class="metric"><div class="label">H1</div><div class="value">${crawler.hasH1 ? "yes" : "no"}</div></div>
    </div>
    <p class="muted">Final URL: <a href="${escapeHtml(crawler.finalUrl || "")}">${escapeHtml(crawler.finalUrl || "n/a")}</a></p>
    <p class="muted">Robots.txt reachable: ${escapeHtml(crawler.robotsTxtReachable)} · Sitemap.xml reachable: ${escapeHtml(crawler.sitemapXmlReachable)} · Indexable: ${escapeHtml(crawler.isIndexable)}</p>
  </section>

  <section>
    <h2>PageSpeed</h2>
    <div class="grid">
      <div class="metric"><div class="label">Performance</div><div class="value">${escapeHtml(pagespeed.performanceScore ?? "n/a")}</div></div>
      <div class="metric"><div class="label">SEO</div><div class="value">${escapeHtml(pagespeed.seoScore ?? "n/a")}</div></div>
      <div class="metric"><div class="label">Accessibility</div><div class="value">${escapeHtml(pagespeed.accessibilityScore ?? "n/a")}</div></div>
      <div class="metric"><div class="label">Best Practices</div><div class="value">${escapeHtml(pagespeed.bestPracticesScore ?? "n/a")}</div></div>
    </div>
  </section>

  <section>
    <h2>Rank Tracking</h2>
    ${rankRows ? `<table><thead><tr><th>Engine</th><th>Query</th><th>Found</th><th>Position</th><th>Matched URL</th></tr></thead><tbody>${rankRows}</tbody></table>` : "<p class=\"muted\">No rank checks returned.</p>"}
  </section>

  <section>
    <h2>Recommendations</h2>
    ${recRows ? `<table><thead><tr><th>Priority</th><th>Type</th><th>Title</th><th>Reasoning</th></tr></thead><tbody>${recRows}</tbody></table>` : "<p class=\"muted\">No recommendations.</p>"}
  </section>

  <section>
    <h2>Opportunities</h2>
    ${opportunityRows ? `<table><thead><tr><th>Priority</th><th>Category</th><th>Title</th><th>Reasoning</th></tr></thead><tbody>${opportunityRows}</tbody></table>` : "<p class=\"muted\">No opportunities returned.</p>"}
  </section>

  <section>
    <h2>Visibility Notes</h2>
    ${renderList(run.visibility?.notes || [])}
  </section>
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
      name: "Amalphis QA",
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
    gscSiteUrl: "sc-domain:amalphis.at",
    targetDomainAliases: [domain, `www.${domain}`],
    markets: ["AT"],
    languages: ["de"],
    competitors: [],
    importantSections: ["/", "/collections/frontpage"],
    brandKeywords: ["amalphis", "divo"],
    excludeKeywords: [],
    trackingKeywords: [
      "amalphis",
      "divo olive oil",
      "divo extra virgin olive oil",
      "olivenöl 5 liter",
      "griechisches olivenöl",
    ],
    targetLocation: "Austria",
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
    sources: ["crawler", "pagespeed", "gsc", "google_serp_rank", "yandex_serp_rank"],
    keywords: config.trackingKeywords,
    location: "Austria",
    region: "225",
    language: "de",
    device: "desktop",
  });
  const draftTasks = await listSeoDraftTasksForRun(teamId, run.id);

  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve(process.cwd(), "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `wgd-amalphis-${stamp}.json`);
  const htmlPath = path.join(outDir, `wgd-amalphis-${stamp}.html`);
  fs.writeFileSync(jsonPath, JSON.stringify({ run, draftTasks }, null, 2));
  fs.writeFileSync(htmlPath, renderReport(run));

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
