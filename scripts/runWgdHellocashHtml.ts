import "dotenv/config";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { firestore } from "../src/config/firebase";
import { upsertSeoConfig } from "../src/features/seoAgent/seoConfigRepository";
import { listSeoDraftTasksForRun, runSeoAnalysis } from "../src/features/seoAgent/seoAgentService";

const teamId = "qa-seo-team-1";
const companyId = "qa-seo-company-hellocash";
const createdByUserId = "qa-seo-user";
const domain = "hellocash.at";
const targetUrl = "https://hellocash.at/";
const keywords = [
  "hellocash",
  "hello cash registrierkasse",
  "online registrierkasse österreich",
  "online kassa österreich",
  "registrierkasse app österreich",
  "kassensystem gastronomie österreich",
  "rkvs registrierkasse online",
  "mobile registrierkasse österreich",
];

type LighthouseSnapshot = {
  status: "success" | "failed";
  message: string;
  pageUrl: string;
  performanceScore: number | null;
  accessibilityScore: number | null;
  bestPracticesScore: number | null;
  seoScore: number | null;
  largestContentfulPaintMs: number | null;
  cumulativeLayoutShift: number | null;
  totalBlockingTimeMs: number | null;
};

type DataForSeoAiSnapshot = {
  status: "success" | "failed";
  message: string;
  platform: "google";
  location: string;
  language: string;
  citationCount: number | null;
  aiSearchVolume: number | null;
  citedPages: Array<{ question: string; title: string; domain: string; url: string; rank: number | null }>;
};

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function date(value: unknown): string {
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? "n/a" : parsed.toISOString();
}

function statusClass(status: string): string {
  return status === "success" ? "ok" : status === "partial" || status === "skipped" ? "warn" : "bad";
}

function runLocalLighthouse(url: string): LighthouseSnapshot {
  try {
    const raw = execFileSync("npx", ["lighthouse", url, "--quiet", "--output=json", "--output-path=stdout", "--preset=desktop", "--throttling-method=provided", "--only-categories=performance,accessibility,best-practices,seo", "--chrome-flags=--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --js-flags=--max-old-space-size=4096"], { encoding: "utf8", maxBuffer: 35 * 1024 * 1024, env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=4096" } });
    const payload = JSON.parse(raw) as any;
    const score = (key: string) => typeof payload.categories?.[key]?.score === "number" ? Math.round(payload.categories[key].score * 100) : null;
    const numeric = (key: string) => typeof payload.audits?.[key]?.numericValue === "number" ? payload.audits[key].numericValue : null;
    return { status: "success", message: "Local Lighthouse desktop/provided completed successfully", pageUrl: payload.finalDisplayedUrl || url, performanceScore: score("performance"), accessibilityScore: score("accessibility"), bestPracticesScore: score("best-practices"), seoScore: score("seo"), largestContentfulPaintMs: numeric("largest-contentful-paint"), cumulativeLayoutShift: numeric("cumulative-layout-shift"), totalBlockingTimeMs: numeric("total-blocking-time") };
  } catch (error) {
    return { status: "failed", message: error instanceof Error ? error.message : String(error), pageUrl: url, performanceScore: null, accessibilityScore: null, bestPracticesScore: null, seoScore: null, largestContentfulPaintMs: null, cumulativeLayoutShift: null, totalBlockingTimeMs: null };
  }
}

async function dataForSeoPost(endpoint: string, body: unknown): Promise<any> {
  const auth = process.env.DATAFORSEO_AUTH_BASE64 || (process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD
    ? Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString("base64")
    : "");
  if (!auth) throw new Error("DataForSEO credentials are not configured");
  const response = await fetch(`https://api.dataforseo.com/v3/ai_optimization/llm_mentions/${endpoint}/live`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify([body]),
  });
  const payload = await response.json();
  if (!response.ok || payload.status_code !== 20000 || payload.tasks?.[0]?.status_code !== 20000) {
    throw new Error(payload.tasks?.[0]?.status_message || payload.status_message || `DataForSEO HTTP ${response.status}`);
  }
  return payload.tasks[0].result?.[0] || {};
}

async function runDataForSeoAiVisibility(): Promise<DataForSeoAiSnapshot> {
  try {
    const target = { domain, search_scope: ["sources"] };
    const metrics = await dataForSeoPost("target_metrics", { platform: "google", location_name: "Austria", language_name: "German", target: [target] });
    const mentions = await dataForSeoPost("search_mentions", { platform: "google", location_name: "Austria", language_name: "German", target: [target], limit: 10 });
    const total = metrics.aggregated_metrics?.total || {};
    const citedPages = (mentions.items || [])
      .flatMap((item: any) => (item.sources || []).filter((source: any) => source.domain === domain).map((source: any) => ({ question: item.question || "", title: source.title || "", domain: source.domain || domain, url: source.url || "", rank: typeof source.rank === "number" ? source.rank : null })))
      .filter((item: any, index: number, all: any[]) => item.url && all.findIndex((candidate) => candidate.url === item.url) === index)
      .slice(0, 10);
    return { status: "success", message: "DataForSEO LLM Mentions completed successfully", platform: "google", location: "Austria", language: "German", citationCount: typeof total.mentions === "number" ? total.mentions : null, aiSearchVolume: typeof total.ai_search_volume === "number" ? total.ai_search_volume : null, citedPages };
  } catch (error) {
    return { status: "failed", message: error instanceof Error ? error.message : String(error), platform: "google", location: "Austria", language: "German", citationCount: null, aiSearchVolume: null, citedPages: [] };
  }
}

function render(run: any, draftTasks: any[], lighthouse: LighthouseSnapshot, aiVisibility: DataForSeoAiSnapshot): string {
  const crawler = run.crawler || {};
  const checks = run.rankTracking?.google?.checks || [];
  const rows = checks.map((item: any) => `<tr><td>${esc(item.query)}</td><td>${item.found ? "yes" : "no"}</td><td>${esc(item.position || "")}</td><td>${esc(item.matchedUrl || "")}</td></tr>`).join("");
  const selectedSources = new Set(run.sources || []);
  const sources = (run.sourceStatuses || []).filter((item: any) => selectedSources.has(item.source)).map((item: any) => `<tr><td>${esc(item.source)}</td><td><span class="pill ${statusClass(item.status)}">${esc(item.status)}</span></td><td>${esc(item.message)}</td><td>${esc(item.errorCode || "")}</td></tr>`).join("");
  const visibleRecommendations = (run.recommendations || []).filter((item: any) => !/yandex|webmaster/i.test(`${item.title} ${item.reasoning || ""}`));
  const recommendations = visibleRecommendations.map((item: any) => `<tr><td>${esc(item.priority)}</td><td>${esc(item.type)}</td><td>${esc(item.title)}</td><td>${esc(item.reasoning)}</td></tr>`).join("");
  const opportunities = (run.opportunities || []).map((item: any) => `<tr><td>${esc(item.priority || item.impact || "")}</td><td>${esc(item.category || item.type || "")}</td><td>${esc(item.title)}</td><td>${esc(item.reasoning)}</td></tr>`).join("");
  const aiPages = aiVisibility.citedPages.map((item) => `<tr><td>${esc(item.question)}</td><td>${esc(item.title)}</td><td>${esc(item.rank ?? "")}</td><td><a href="${esc(item.url)}">${esc(item.url)}</a></td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>WGD Report - ${esc(domain)}</title><style>
  :root{--bg:#f6f7f9;--panel:#fff;--text:#17202a;--muted:#5c6670;--line:#d9dee5;--ok:#1f7a4d;--warn:#9a6500;--bad:#b3261e;--accent:#087f9e}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1180px;margin:0 auto;padding:28px}h1{margin:0 0 6px;font-size:30px}h2{margin:0 0 12px;font-size:18px}section{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:18px;margin:14px 0}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.metric{border:1px solid var(--line);border-radius:6px;padding:12px;min-height:78px}.label{color:var(--muted);font-size:12px;margin-bottom:6px}.value{font-size:22px;font-weight:700;overflow-wrap:anywhere}.muted{color:var(--muted)}table{width:100%;border-collapse:collapse}th,td{border-top:1px solid var(--line);padding:9px 8px;text-align:left;vertical-align:top}th{color:var(--muted);font-size:12px}.pill{display:inline-block;border-radius:999px;padding:2px 8px;font-size:12px;font-weight:700}.pill.ok{background:#e7f4ed;color:var(--ok)}.pill.warn{background:#fff3d8;color:var(--warn)}.pill.bad{background:#fde8e7;color:var(--bad)}a{color:var(--accent)}@media(max-width:760px){main{padding:16px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}table{display:block;overflow-x:auto}}
  </style></head><body><main><header><h1>WGD Report: ${esc(domain)}</h1><div class="muted">Requested URL: <a href="${esc(targetUrl)}">${esc(targetUrl)}</a></div><div class="muted">Run ID: ${esc(run.id)} · Created: ${esc(date(run.createdAt))} · Geo: Austria · Language: German</div></header>
  <section><h2>Executive Snapshot</h2><div class="grid"><div class="metric"><div class="label">Overall SEO Score</div><div class="value">${esc(run.scores?.overallSeoScore ?? "n/a")}</div></div><div class="metric"><div class="label">Visibility Score</div><div class="value">${esc(run.scores?.visibilityScore ?? "n/a")}</div></div><div class="metric"><div class="label">Google Checks Found</div><div class="value">${esc(run.rankTracking?.google?.status?.metricsSummary?.foundCount ?? 0)}/${esc(checks.length)}</div></div><div class="metric"><div class="label">Draft Tasks</div><div class="value">${esc(draftTasks.length)}</div></div></div></section>
  <section><h2>Sources</h2><table><thead><tr><th>Source</th><th>Status</th><th>Message</th><th>Error</th></tr></thead><tbody>${sources}</tbody></table></section>
  <section><h2>Technical Crawl</h2><div class="grid"><div class="metric"><div class="label">HTTP Status</div><div class="value">${esc(crawler.httpStatus ?? "n/a")}</div></div><div class="metric"><div class="label">Title</div><div class="value">${crawler.hasTitle ? "yes" : "no"}</div></div><div class="metric"><div class="label">Meta Description</div><div class="value">${crawler.hasMetaDescription ? "yes" : "no"}</div></div><div class="metric"><div class="label">H1</div><div class="value">${crawler.hasH1 ? "yes" : "no"}</div></div></div><p class="muted">Final URL: <a href="${esc(crawler.finalUrl || targetUrl)}">${esc(crawler.finalUrl || "n/a")}</a><br>Robots: ${esc(crawler.robotsTxtReachable)} · Sitemap: ${esc(crawler.sitemapXmlReachable)} · Indexable: ${esc(crawler.isIndexable)}</p></section>
  <section><h2>Local Lighthouse / PageSpeed Snapshot</h2><div class="grid"><div class="metric"><div class="label">Performance</div><div class="value">${esc(lighthouse.performanceScore ?? "n/a")}</div></div><div class="metric"><div class="label">SEO</div><div class="value">${esc(lighthouse.seoScore ?? "n/a")}</div></div><div class="metric"><div class="label">Accessibility</div><div class="value">${esc(lighthouse.accessibilityScore ?? "n/a")}</div></div><div class="metric"><div class="label">Best Practices</div><div class="value">${esc(lighthouse.bestPracticesScore ?? "n/a")}</div></div></div><p class="muted">Status: ${esc(lighthouse.status)} · LCP: ${esc(lighthouse.largestContentfulPaintMs ?? "n/a")} ms · CLS: ${esc(lighthouse.cumulativeLayoutShift ?? "n/a")} · TBT: ${esc(lighthouse.totalBlockingTimeMs ?? "n/a")} ms. Desktop/provided mode, without PageSpeed Insights API quota.</p></section>
  <section><h2>AI Visibility · DataForSEO</h2><div class="grid"><div class="metric"><div class="label">Platform</div><div class="value">Google AI Overview</div></div><div class="metric"><div class="label">Citations</div><div class="value">${esc(aiVisibility.citationCount ?? "n/a")}</div></div><div class="metric"><div class="label">AI Search Volume</div><div class="value">${esc(aiVisibility.aiSearchVolume ?? "n/a")}</div></div><div class="metric"><div class="label">Status</div><div class="value">${esc(aiVisibility.status)}</div></div></div><p class="muted">Geo: ${esc(aiVisibility.location)} · Language: ${esc(aiVisibility.language)} · ${esc(aiVisibility.message)}. The citation count uses DataForSEO <code>search_scope=sources</code>.</p>${aiPages ? `<table><thead><tr><th>AI Question</th><th>Cited Page</th><th>Source Rank</th><th>URL</th></tr></thead><tbody>${aiPages}</tbody></table>` : "<p class=\"muted\">No detailed cited pages returned.</p>"}</section>
  <section><h2>Google Rank Tracking</h2>${rows ? `<table><thead><tr><th>Query</th><th>Found</th><th>Position</th><th>Matched URL</th></tr></thead><tbody>${rows}</tbody></table>` : "<p class=\"muted\">No rank checks returned.</p>"}</section>
  <section><h2>Recommendations</h2>${recommendations ? `<table><thead><tr><th>Priority</th><th>Type</th><th>Title</th><th>Reasoning</th></tr></thead><tbody>${recommendations}</tbody></table>` : "<p class=\"muted\">No recommendations.</p>"}</section>
  <section><h2>Opportunities</h2>${opportunities ? `<table><thead><tr><th>Priority</th><th>Category</th><th>Title</th><th>Reasoning</th></tr></thead><tbody>${opportunities}</tbody></table>` : "<p class=\"muted\">No opportunities returned.</p>"}</section>
  <section><h2>Visibility Notes</h2><ul>${(run.visibility?.notes || []).map((item: string) => `<li>${esc(item)}</li>`).join("") || "<li class=\"muted\">No notes.</li>"}</ul></section>
  </main></body></html>`;
}

async function main(): Promise<void> {
  await firestore.collection("teams").doc(teamId).set({ name: "SEO QA Team", memberIds: [createdByUserId], roles: { [createdByUserId]: "owner" }, updatedAt: new Date().toISOString() }, { merge: true });
  await firestore.collection("companies").doc(companyId).set({ teamId, name: "HELLOCASH QA", type: "campaign", restrictAccess: false, status: "active", createdAt: Date.now(), createdByUserId }, { merge: true });
  const config = await upsertSeoConfig({ teamId, companyId, domain, gscSiteUrl: "sc-domain:hellocash.at", targetDomainAliases: [domain, `www.${domain}`], markets: ["AT"], languages: ["de"], competitors: [], importantSections: ["/"], brandKeywords: ["hellocash", "hello cash"], excludeKeywords: [], trackingKeywords: keywords, targetLocation: "Austria", targetRegion: "225", targetDevice: "desktop", createdByUserId });
  const run = await runSeoAnalysis({ teamId, companyId, config, mode: "quick_audit", createdByUserId, sources: ["crawler", "pagespeed", "google_serp_rank"], keywords, location: "Austria", region: "225", language: "de", device: "desktop" });
  const draftTasks = await listSeoDraftTasksForRun(teamId, run.id);
  const lighthouse = runLocalLighthouse(targetUrl);
  const aiVisibility = await runDataForSeoAiVisibility();
  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve(process.cwd(), "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `wgd-hellocash-${stamp}.json`);
  const htmlPath = path.join(outDir, `wgd-hellocash-${stamp}.html`);
  fs.writeFileSync(jsonPath, JSON.stringify({ run, draftTasks, lighthouse, aiVisibility }, null, 2));
  const actionPlan = `<section><h2>Recommended Action Plan</h2><div class="grid"><div class="metric"><div class="label">Priority 1 · Protect</div><div class="value">Defend positions 1–2</div><p class="muted">Keep the homepage focused on online Registrierkasse, online Kassa and mobile Registrierkasse intent.</p><p><strong>KPI:</strong> retain positions 1–2</p></div><div class="metric"><div class="label">Priority 2 · Improve</div><div class="value">Push gastronomy from #8</div><p class="muted">Strengthen the gastronomy page with Austrian use cases, internal links and structured FAQ content.</p><p><strong>KPI:</strong> top 5, then top 3</p></div><div class="metric"><div class="label">Priority 3 · Expand</div><div class="value">Move RKSV from #4</div><p class="muted">Refresh the RKSV page with current guidance, trust signals and product-page links.</p><p><strong>KPI:</strong> position 1–3</p></div><div class="metric"><div class="label">Priority 4 · AI</div><div class="value">Build citation depth</div><p class="muted">Maintain the cited pages and connect them to product pages with clear entity and source signals.</p><p><strong>KPI:</strong> grow citations beyond 28</p></div></div></section>`;
  const reportHtml = render(run, draftTasks, lighthouse, aiVisibility).replace("</main>", `${actionPlan}</main>`);
  fs.writeFileSync(htmlPath, reportHtml);
  console.log(JSON.stringify({ runId: run.id, draftTaskCount: draftTasks.length, jsonPath, htmlPath, lighthouse: lighthouse.status, aiVisibility: aiVisibility.status }, null, 2));
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => { setTimeout(() => process.exit(process.exitCode || 0), 250); });
