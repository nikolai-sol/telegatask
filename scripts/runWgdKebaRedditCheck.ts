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

const keywordGroups = {
  de: [
    { type: "brand", keyword: "keba österreich" },
    { type: "brand", keyword: "keba automatisierung" },
    { type: "brand", keyword: "keba industrieautomation" },
    { type: "brand", keyword: "keba hmi" },
    { type: "brand", keyword: "keba robotersteuerung" },
    { type: "brand", keyword: "keba servoregler" },
    { type: "brand", keyword: "keba cnc steuerung" },
    { type: "brand", keyword: "keba spritzguss software" },
    { type: "non-brand", keyword: "industrieautomation österreich" },
    { type: "non-brand", keyword: "automatisierungslösungen österreich" },
    { type: "non-brand", keyword: "maschinenautomatisierung österreich" },
    { type: "non-brand", keyword: "hmi maschinenbau" },
    { type: "non-brand", keyword: "cnc steuerung maschinenbau" },
    { type: "non-brand", keyword: "robotersteuerung" },
    { type: "non-brand", keyword: "spritzguss automation" },
    { type: "non-brand", keyword: "intralogistik automation" },
    { type: "non-brand", keyword: "servoregler maschinenbau" },
    { type: "non-brand", keyword: "antriebstechnik maschinenbau" },
  ],
  en: [
    { type: "brand", keyword: "keba austria" },
    { type: "brand", keyword: "keba automation" },
    { type: "brand", keyword: "keba industrial automation" },
    { type: "brand", keyword: "keba hmi" },
    { type: "brand", keyword: "keba robot controller" },
    { type: "brand", keyword: "keba servo controller" },
    { type: "brand", keyword: "keba cnc control" },
    { type: "brand", keyword: "keba injection molding software" },
    { type: "non-brand", keyword: "industrial automation Austria" },
    { type: "non-brand", keyword: "automation solutions Austria" },
    { type: "non-brand", keyword: "machine automation Austria" },
    { type: "non-brand", keyword: "HMI machine tools" },
    { type: "non-brand", keyword: "CNC control machine tools" },
    { type: "non-brand", keyword: "robot controller" },
    { type: "non-brand", keyword: "injection molding automation" },
    { type: "non-brand", keyword: "intralogistics automation" },
    { type: "non-brand", keyword: "servo controller machine automation" },
    { type: "non-brand", keyword: "drive technology machine automation" },
  ],
} as const;

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function groupMap(language: "de" | "en"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of keywordGroups[language]) out[item.keyword.toLowerCase()] = item.type;
  return out;
}

function checks(run: any): any[] {
  return run.rankTracking?.google?.checks || [];
}

function hasReddit(check: any): boolean {
  const domains = [
    ...(check.topResultDomains || []),
    ...(check.competitorsAbove || []).map((item: any) => item.domain),
  ].map((item) => String(item || "").toLowerCase());
  return domains.some((domain) => domain === "reddit.com" || domain.endsWith(".reddit.com"));
}

function redditUrls(check: any): string[] {
  return (check.competitorsAbove || [])
    .filter((item: any) => String(item.domain || "").toLowerCase().includes("reddit.com"))
    .map((item: any) => item.url)
    .filter(Boolean);
}

function summarize(run: any, language: "de" | "en") {
  const map = groupMap(language);
  const out: Record<string, { total: number; reddit: number; kebaFound: number }> = {
    brand: { total: 0, reddit: 0, kebaFound: 0 },
    "non-brand": { total: 0, reddit: 0, kebaFound: 0 },
  };
  for (const check of checks(run)) {
    const type = map[String(check.query || "").toLowerCase()] || "non-brand";
    out[type].total += 1;
    if (hasReddit(check)) out[type].reddit += 1;
    if (check.found) out[type].kebaFound += 1;
  }
  return out;
}

function renderRows(run: any, language: "de" | "en"): string {
  const map = groupMap(language);
  return checks(run)
    .map((check) => {
      const reddit = hasReddit(check);
      return `
        <tr>
          <td>${escapeHtml(map[String(check.query || "").toLowerCase()] || "non-brand")}</td>
          <td>${escapeHtml(check.query)}</td>
          <td>${check.found ? "yes" : "no"}</td>
          <td>${escapeHtml(check.position || "")}</td>
          <td>${reddit ? "yes" : "no"}</td>
          <td>${escapeHtml((check.topResultDomains || []).join(", "))}</td>
          <td>${escapeHtml(redditUrls(check).join(", "))}</td>
        </tr>`;
    })
    .join("");
}

function renderHtml(input: { deRun: any; enRun: any; jsonPath: string; htmlPath: string }): string {
  const deSummary = summarize(input.deRun, "de");
  const enSummary = summarize(input.enRun, "en");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>KEBA Reddit SERP Check</title>
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
    <div class="note">Website Growth Diagnostic supplement · Reddit SERP presence · Geo: Austria · DataForSEO Google Organic · Date: 2026-06-24</div>
    <h1>KEBA Reddit check: brand vs non-brand</h1>
    <p class="sub">This checks whether Reddit appears in Google SERPs for KEBA brand and non-brand industrial automation keywords. It is not AI citation tracking; it is a practical proxy while DataForSEO AI Optimization access is locked.</p>
  </div>

  <section>
    <h2>Executive Snapshot</h2>
    <div class="grid">
      <div class="card"><div class="label">DE Brand Reddit</div><div class="metric">${escapeHtml(deSummary.brand.reddit)}/${escapeHtml(deSummary.brand.total)}</div><p>German SERP, Austria, brand keywords.</p></div>
      <div class="card"><div class="label">DE Non-brand Reddit</div><div class="metric">${escapeHtml(deSummary["non-brand"].reddit)}/${escapeHtml(deSummary["non-brand"].total)}</div><p>German SERP, Austria, category keywords.</p></div>
      <div class="card"><div class="label">EN Brand Reddit</div><div class="metric">${escapeHtml(enSummary.brand.reddit)}/${escapeHtml(enSummary.brand.total)}</div><p>English SERP, Austria, brand keywords.</p></div>
      <div class="card"><div class="label">EN Non-brand Reddit</div><div class="metric">${escapeHtml(enSummary["non-brand"].reddit)}/${escapeHtml(enSummary["non-brand"].total)}</div><p>English SERP, Austria, category keywords.</p></div>
    </div>
  </section>

  <section>
    <h2>German Results</h2>
    <table><thead><tr><th>Type</th><th>Query</th><th>KEBA Found</th><th>KEBA Position</th><th>Reddit Present</th><th>Top Result Domains</th><th>Reddit URLs Above KEBA</th></tr></thead><tbody>${renderRows(input.deRun, "de")}</tbody></table>
  </section>

  <section>
    <h2>English Results</h2>
    <table><thead><tr><th>Type</th><th>Query</th><th>KEBA Found</th><th>KEBA Position</th><th>Reddit Present</th><th>Top Result Domains</th><th>Reddit URLs Above KEBA</th></tr></thead><tbody>${renderRows(input.enRun, "en")}</tbody></table>
  </section>

  <section>
    <h2>Readout</h2>
    <ol>
      <li>If Reddit appears on non-brand queries, treat it as a content/reputation surface: those discussions may also feed AI answer systems.</li>
      <li>If Reddit appears only on broad category terms and not brand terms, KEBA likely has no direct Reddit reputation issue, but generic buyer discussions may shape AI context.</li>
      <li>If Reddit is absent, the next check should move to forums, vendor review sites, YouTube, GitHub/StackOverflow-style technical communities, and AI Optimization API once the subscription is enabled.</li>
    </ol>
  </section>

  <details>
    <summary>Artifacts</summary>
    <ul>
      <li>JSON artifact: <code>${escapeHtml(input.jsonPath)}</code></li>
      <li>HTML artifact: <code>${escapeHtml(input.htmlPath)}</code></li>
      <li>German run ID: <code>${escapeHtml(input.deRun.id)}</code></li>
      <li>English run ID: <code>${escapeHtml(input.enRun.id)}</code></li>
      <li>Target URL: <code>${escapeHtml(targetUrl)}</code></li>
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
    competitors: ["reddit.com"],
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
    keywords: keywordGroups.de.map((item) => item.keyword),
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
    keywords: keywordGroups.en.map((item) => item.keyword),
    location: "Austria",
    language: "English",
    device: "desktop",
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve(process.cwd(), "reports");
  const jsonPath = path.join(outDir, `wgd-keba-reddit-check-${stamp}.json`);
  const htmlPath = path.join(outDir, `wgd-keba-reddit-check-${stamp}.html`);
  const payload = {
    targetUrl,
    domain,
    location: "Austria",
    runs: [
      { label: "German", language: "German", run: deRun, summary: summarize(deRun, "de") },
      { label: "English", language: "English", run: enRun, summary: summarize(enRun, "en") },
    ],
  };
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(htmlPath, renderHtml({ deRun, enRun, jsonPath, htmlPath }));

  console.log(
    JSON.stringify(
      {
        jsonPath,
        htmlPath,
        deRunId: deRun.id,
        enRunId: enRun.id,
        deSummary: summarize(deRun, "de"),
        enSummary: summarize(enRun, "en"),
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
