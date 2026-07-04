import "dotenv/config";
import fs from "fs";
import path from "path";
import { firestore } from "../src/config/firebase";
import { upsertSeoConfig } from "../src/features/seoAgent/seoConfigRepository";
import { runSeoAnalysis } from "../src/features/seoAgent/seoAgentService";

const teamId = "qa-seo-team-1";
const companyId = "qa-seo-company-keba-ia-germany";
const createdByUserId = "qa-seo-user";
const domain = "keba.com";
const targetUrl = "https://www.keba.com/en/industrial-automation/lp/keba-ia-germany";
const targetPath = "/en/industrial-automation/lp/keba-ia-germany";

const keywordSet = [
  "keba industrial automation germany",
  "keba automation germany",
  "industrial automation germany",
  "automation solutions germany",
  "machine automation germany",
  "keba ia germany",
];

type LabeledRun = {
  label: string;
  dataForSeoLanguage: string;
  run: any;
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

function renderRankRows(run: any): string {
  const googleChecks = run.rankTracking?.google?.checks || [];
  return googleChecks
    .map(
      (item: any) => `
        <tr>
          <td>${escapeHtml(item.query)}</td>
          <td>${item.found ? "yes" : "no"}</td>
          <td>${escapeHtml(item.position || "")}</td>
          <td>${escapeHtml(item.matchedUrl || "")}</td>
          <td>${escapeHtml((item.competitorsAbove || []).map((c: any) => c.domain).join(", "))}</td>
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

function renderRunSection(item: LabeledRun): string {
  const run = item.run;
  const crawler = run.crawler || {};
  const pagespeed = run.pagespeed || {};
  const rankRows = renderRankRows(run);
  const recRows = renderRecommendationRows(run);

  return `
    <section>
      <h2>${escapeHtml(item.label)} DataForSEO Run</h2>
      <div class="meta">Run ID: ${escapeHtml(run.id)} · Created: ${escapeHtml(formatDate(run.createdAt))} · DataForSEO language_name: ${escapeHtml(item.dataForSeoLanguage)}</div>
      <div class="grid">
        <div class="metric"><div class="label">Overall SEO Score</div><div class="value">${escapeHtml(run.scores?.overallSeoScore ?? "n/a")}</div></div>
        <div class="metric"><div class="label">Google Checks</div><div class="value">${escapeHtml(run.rankTracking?.google?.checks?.length || 0)}</div></div>
        <div class="metric"><div class="label">Found</div><div class="value">${escapeHtml(run.rankTracking?.google?.status?.metricsSummary?.foundCount ?? "n/a")}</div></div>
        <div class="metric"><div class="label">Recommendations</div><div class="value">${escapeHtml((run.recommendations || []).length)}</div></div>
      </div>
    </section>

    <section>
      <h2>${escapeHtml(item.label)} Sources</h2>
      <table>
        <thead><tr><th>Source</th><th>Status</th><th>Message</th><th>Error</th></tr></thead>
        <tbody>${renderSourceRows(run)}</tbody>
      </table>
    </section>

    <section>
      <h2>${escapeHtml(item.label)} Technical Snapshot</h2>
      <div class="grid">
        <div class="metric"><div class="label">Crawler HTTP</div><div class="value">${escapeHtml(crawler.httpStatus ?? "n/a")}</div></div>
        <div class="metric"><div class="label">Title</div><div class="value">${crawler.hasTitle ? "yes" : "no"}</div></div>
        <div class="metric"><div class="label">Meta Description</div><div class="value">${crawler.hasMetaDescription ? "yes" : "no"}</div></div>
        <div class="metric"><div class="label">PageSpeed SEO</div><div class="value">${escapeHtml(pagespeed.seoScore ?? "n/a")}</div></div>
      </div>
      <p class="muted">Crawler final URL: <a href="${escapeHtml(crawler.finalUrl || "")}">${escapeHtml(crawler.finalUrl || "n/a")}</a></p>
      <p class="muted">PageSpeed URL: ${escapeHtml(pagespeed.pageUrl || "n/a")}</p>
    </section>

    <section>
      <h2>${escapeHtml(item.label)} Google Rank Tracking</h2>
      ${
        rankRows
          ? `<table><thead><tr><th>Query</th><th>Found</th><th>Position</th><th>Matched URL</th><th>Competitors Above</th></tr></thead><tbody>${rankRows}</tbody></table>`
          : "<p class=\"muted\">No Google rank checks returned.</p>"
      }
    </section>

    <section>
      <h2>${escapeHtml(item.label)} Recommendations</h2>
      ${
        recRows
          ? `<table><thead><tr><th>Priority</th><th>Type</th><th>Title</th><th>Reasoning</th></tr></thead><tbody>${recRows}</tbody></table>`
          : "<p class=\"muted\">No recommendations.</p>"
      }
    </section>`;
}

function renderReport(runs: LabeledRun[]): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WGD Report - KEBA IA Germany</title>
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
    body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 1120px; margin: 0 auto; padding: 28px; }
    header { margin-bottom: 18px; }
    h1 { margin: 0 0 6px; font-size: 30px; letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 18px; letter-spacing: 0; }
    section { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px; margin: 14px 0; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .metric { border: 1px solid var(--line); border-radius: 6px; padding: 12px; min-height: 78px; }
    .label { color: var(--muted); font-size: 12px; margin-bottom: 6px; }
    .value { font-size: 22px; font-weight: 700; overflow-wrap: anywhere; }
    .muted, .meta { color: var(--muted); }
    .meta { margin-bottom: 12px; }
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
    <h1>WGD Report: KEBA IA Germany</h1>
    <div class="muted">Requested URL: <a href="${escapeHtml(targetUrl)}">${escapeHtml(targetUrl)}</a></div>
    <div class="muted">WGD domain scope: ${escapeHtml(domain)} · Landing path tracked as important section: ${escapeHtml(targetPath)}</div>
  </header>
  ${runs.map(renderRunSection).join("\n")}
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
      name: "KEBA IA Germany QA",
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
    targetDomainAliases: [domain, `www.${domain}`],
    markets: ["DE"],
    languages: ["de", "en"],
    competitors: [],
    importantSections: [targetPath],
    brandKeywords: ["keba"],
    excludeKeywords: [],
    trackingKeywords: keywordSet,
    targetLocation: "Germany",
    targetRegion: "276",
    targetDevice: "desktop",
    createdByUserId,
  });

  const runInputs = [
    { label: "Deutsch", dataForSeoLanguage: "German" },
    { label: "English", dataForSeoLanguage: "English" },
  ];

  const runs: LabeledRun[] = [];
  for (const item of runInputs) {
    const run = await runSeoAnalysis({
      teamId,
      companyId,
      config,
      mode: "quick_audit",
      createdByUserId,
      sources: ["crawler", "pagespeed", "google_serp_rank"],
      keywords: keywordSet,
      location: "Germany",
      region: "276",
      language: item.dataForSeoLanguage,
      device: "desktop",
    });
    runs.push({ ...item, run });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve(process.cwd(), "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `wgd-keba-ia-germany-${stamp}.json`);
  const htmlPath = path.join(outDir, `wgd-keba-ia-germany-${stamp}.html`);
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        targetUrl,
        domain,
        targetPath,
        runs,
      },
      null,
      2
    )
  );
  fs.writeFileSync(htmlPath, renderReport(runs));

  console.log(
    JSON.stringify(
      {
        runIds: runs.map((item) => ({ label: item.label, runId: item.run.id })),
        jsonPath,
        htmlPath,
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
