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

const directions = [
  {
    name: "Industrial automation / machine automation",
    de: ["industrieautomation österreich", "automatisierungslösungen österreich", "maschinenautomatisierung österreich"],
    en: ["industrial automation Austria", "automation solutions Austria", "machine automation Austria"],
  },
  {
    name: "Machine tools / CNC / HMI",
    de: ["cnc steuerung maschinenbau", "hmi maschinenbau", "maschinenbedienpanel"],
    en: ["CNC control machine tools", "HMI machine tools", "machine operator panel"],
  },
  {
    name: "Robotics",
    de: ["robotersteuerung", "integrierte robotik", "safe robotics"],
    en: ["robot controller", "integrated robotics", "safe robotics"],
  },
  {
    name: "Plastics / injection molding",
    de: ["spritzguss automation", "kunststoffmaschinen steuerung", "spritzgießmaschine software"],
    en: ["injection molding automation", "plastics machine control", "injection molding software"],
  },
  {
    name: "Intralogistics",
    de: ["intralogistik automation", "lagerautomation steuerung", "fördertechnik automation"],
    en: ["intralogistics automation", "warehouse automation control", "conveyor automation"],
  },
  {
    name: "Servo / drive technology",
    de: ["servoregler maschinenbau", "antriebstechnik maschinenbau", "servo drive automation"],
    en: ["servo controller machine automation", "drive technology machine automation", "servo drive automation"],
  },
];

function flattenKeywords(language: "de" | "en"): string[] {
  return directions.flatMap((direction) => direction[language]);
}

function keywordDirectionMap(language: "de" | "en"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const direction of directions) {
    for (const keyword of direction[language]) out[keyword.toLowerCase()] = direction.name;
  }
  return out;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderRankRows(run: any, language: "de" | "en"): string {
  const map = keywordDirectionMap(language);
  const checks = run.rankTracking?.google?.checks || [];
  return checks
    .map(
      (check: any) => `
        <tr>
          <td>${escapeHtml(map[String(check.query || "").toLowerCase()] || "")}</td>
          <td>${escapeHtml(check.query)}</td>
          <td>${check.found ? "yes" : "no"}</td>
          <td>${escapeHtml(check.position || "")}</td>
          <td>${escapeHtml(check.matchedUrl || "")}</td>
          <td>${escapeHtml((check.competitorsAbove || []).map((c: any) => c.domain).join(", "))}</td>
        </tr>`
    )
    .join("");
}

function summarizeByDirection(run: any, language: "de" | "en") {
  const map = keywordDirectionMap(language);
  const summary = new Map<string, { total: number; found: number; best: number | null }>();
  for (const direction of directions) summary.set(direction.name, { total: 0, found: 0, best: null });
  for (const check of run.rankTracking?.google?.checks || []) {
    const direction = map[String(check.query || "").toLowerCase()] || "Other";
    const item = summary.get(direction) || { total: 0, found: 0, best: null };
    item.total += 1;
    if (check.found) {
      item.found += 1;
      if (typeof check.position === "number") item.best = item.best === null ? check.position : Math.min(item.best, check.position);
    }
    summary.set(direction, item);
  }
  return Array.from(summary.entries()).map(([direction, item]) => ({ direction, ...item }));
}

function renderSummaryRows(run: any, language: "de" | "en"): string {
  return summarizeByDirection(run, language)
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.direction)}</td>
          <td>${escapeHtml(item.found)}/${escapeHtml(item.total)}</td>
          <td>${escapeHtml(item.best ?? "")}</td>
        </tr>`
    )
    .join("");
}

function renderHtml(input: { deRun: any; enRun: any; htmlPath: string; jsonPath: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>KEBA Austria Direction Rank Tracking</title>
  <style>
    :root{--bg:#f5f7fb;--paper:#fff;--ink:#162033;--muted:#667085;--line:#d9e0ea;--blue:#245a8d;--soft:#f9fbfe}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 Arial,"Helvetica Neue",sans-serif}main{max-width:1180px;margin:0 auto;padding:30px 22px 54px}
    .hero,section,details{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:22px;margin:14px 0;box-shadow:0 10px 34px rgba(23,34,51,.05)}.hero{padding:30px}
    h1,h2{line-height:1.18;margin:0 0 12px;letter-spacing:0}h1{font-size:clamp(30px,4vw,48px)}h2{font-size:22px}.sub{max-width:940px;color:var(--muted);font-size:18px}.note{color:var(--muted);font-size:13px}
    .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.card{border:1px solid var(--line);border-radius:8px;background:var(--soft);padding:16px;min-height:118px}.label{color:var(--muted);font-size:12px;text-transform:uppercase;font-weight:700}.metric{font-size:30px;font-weight:800;margin:6px 0;color:#1d334c}
    table{width:100%;border-collapse:collapse}th,td{border-top:1px solid var(--line);padding:10px 8px;text-align:left;vertical-align:top}th{color:var(--muted);font-size:12px;text-transform:uppercase}
    code{background:#eef2f6;border-radius:5px;padding:1px 5px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}a{color:var(--blue)}details summary{cursor:pointer;font-weight:800;font-size:17px}
    @media(max-width:860px){.grid{grid-template-columns:1fr}table{display:block;overflow-x:auto}main{padding:16px}}
  </style>
</head>
<body>
<main>
  <div class="hero">
    <div class="note">Website Growth Diagnostic supplement · Geo: Austria · DataForSEO Google Organic · Date: 2026-06-24</div>
    <h1>KEBA Austria direction rank tracking</h1>
    <p class="sub">Ranking supplement for <a href="${escapeHtml(targetUrl)}">${escapeHtml(targetUrl)}</a>. Keywords were selected from KEBA Industrial Automation navigation and product/industry directions, then checked in Austria for German and English SERPs.</p>
  </div>

  <section>
    <h2>Executive Snapshot</h2>
    <div class="grid">
      <div class="card"><div class="label">German checks</div><div class="metric">${escapeHtml(input.deRun.rankTracking?.google?.status?.metricsSummary?.foundCount ?? 0)}/${escapeHtml(input.deRun.rankTracking?.google?.status?.metricsSummary?.queryCount ?? 0)}</div><p>DataForSEO <code>language_name=German</code>, location Austria.</p></div>
      <div class="card"><div class="label">English checks</div><div class="metric">${escapeHtml(input.enRun.rankTracking?.google?.status?.metricsSummary?.foundCount ?? 0)}/${escapeHtml(input.enRun.rankTracking?.google?.status?.metricsSummary?.queryCount ?? 0)}</div><p>DataForSEO <code>language_name=English</code>, location Austria.</p></div>
      <div class="card"><div class="label">Directions</div><div class="metric">${escapeHtml(directions.length)}</div><p>Industry/product clusters from KEBA IA site navigation.</p></div>
      <div class="card"><div class="label">Keywords</div><div class="metric">${escapeHtml(flattenKeywords("de").length + flattenKeywords("en").length)}</div><p>Total checked across both languages.</p></div>
    </div>
  </section>

  <section>
    <h2>Direction Coverage: German / Austria</h2>
    <table><thead><tr><th>Direction</th><th>Found</th><th>Best Position</th></tr></thead><tbody>${renderSummaryRows(input.deRun, "de")}</tbody></table>
  </section>

  <section>
    <h2>Direction Coverage: English / Austria</h2>
    <table><thead><tr><th>Direction</th><th>Found</th><th>Best Position</th></tr></thead><tbody>${renderSummaryRows(input.enRun, "en")}</tbody></table>
  </section>

  <section>
    <h2>German Rank Checks</h2>
    <table><thead><tr><th>Direction</th><th>Query</th><th>Found</th><th>Position</th><th>Matched URL</th><th>Competitors Above</th></tr></thead><tbody>${renderRankRows(input.deRun, "de")}</tbody></table>
  </section>

  <section>
    <h2>English Rank Checks</h2>
    <table><thead><tr><th>Direction</th><th>Query</th><th>Found</th><th>Position</th><th>Matched URL</th><th>Competitors Above</th></tr></thead><tbody>${renderRankRows(input.enRun, "en")}</tbody></table>
  </section>

  <section>
    <h2>Readout</h2>
    <ol>
      <li>Austria should be treated as a separate rank-tracking geo, not inferred from Germany-only checks.</li>
      <li>German and English SERPs differ materially: German direction terms tend to surface German localized pages when KEBA is found, while English checks are more likely to return English KEBA IA URLs.</li>
      <li>Directions with no or weak found coverage should become landing-page/content priorities before expanding generic paid/organic campaigns.</li>
    </ol>
  </section>

  <details>
    <summary>Artifacts</summary>
    <ul>
      <li>JSON artifact: <code>${escapeHtml(input.jsonPath)}</code></li>
      <li>HTML artifact: <code>${escapeHtml(input.htmlPath)}</code></li>
      <li>German run ID: <code>${escapeHtml(input.deRun.id)}</code></li>
      <li>English run ID: <code>${escapeHtml(input.enRun.id)}</code></li>
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

  const config = await upsertSeoConfig({
    teamId,
    companyId,
    domain,
    targetDomainAliases: [domain, `www.${domain}`],
    markets: ["AT"],
    languages: ["de", "en"],
    competitors: [],
    importantSections: ["/en/industrial-automation/lp/keba-ia-germany"],
    brandKeywords: [],
    excludeKeywords: [],
    trackingKeywords: [],
    targetLocation: "Austria",
    targetRegion: null,
    targetDevice: "desktop",
    createdByUserId,
  });

  const deRun = await runSeoAnalysis({
    teamId,
    companyId,
    config,
    mode: "quick_audit",
    createdByUserId,
    sources: ["google_serp_rank"],
    keywords: flattenKeywords("de"),
    location: "Austria",
    language: "German",
    device: "desktop",
  });

  const enRun = await runSeoAnalysis({
    teamId,
    companyId,
    config,
    mode: "quick_audit",
    createdByUserId,
    sources: ["google_serp_rank"],
    keywords: flattenKeywords("en"),
    location: "Austria",
    language: "English",
    device: "desktop",
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve(process.cwd(), "reports");
  const jsonPath = path.join(outDir, `wgd-keba-austria-directions-${stamp}.json`);
  const htmlPath = path.join(outDir, `wgd-keba-austria-directions-${stamp}.html`);
  const payload = {
    targetUrl,
    domain,
    location: "Austria",
    directions,
    runs: [
      { label: "German", language: "German", run: deRun, summary: summarizeByDirection(deRun, "de") },
      { label: "English", language: "English", run: enRun, summary: summarizeByDirection(enRun, "en") },
    ],
  };
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(htmlPath, renderHtml({ deRun, enRun, htmlPath, jsonPath }));

  console.log(
    JSON.stringify(
      {
        jsonPath,
        htmlPath,
        deRunId: deRun.id,
        enRunId: enRun.id,
        de: deRun.rankTracking.google?.status.metricsSummary,
        en: enRun.rankTracking.google?.status.metricsSummary,
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
