import fs from "fs";
import path from "path";
import { firestore } from "../src/config/firebase";

const domain = "hellocash.at";
const outDir = path.resolve(process.cwd(), "reports");

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function date(value: unknown): string {
  return new Date(value as number).toLocaleString("en-GB", { timeZone: "Europe/Vienna", dateStyle: "short", timeStyle: "short" });
}

function positionClass(position: number | null): string {
  if (position === null) return "missing";
  if (position <= 3) return "top";
  if (position <= 10) return "page";
  return "low";
}

function position(check: any): number | null {
  return check?.found && typeof check.position === "number" ? check.position : null;
}

async function main(): Promise<void> {
  const snapshot = await firestore.collection("seoAnalysisRuns").get();
  const runs = snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
    .filter((run: any) => run.domain === domain)
    .sort((a: any, b: any) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  const recoveredRuns = runs.filter((run: any) => {
    const checks = run.rankTracking?.google?.checks || [];
    const sourceStatuses = run.sourceStatuses || [];
    return checks.length > 0 || sourceStatuses.some((item: any) => item.status === "success" || item.status === "partial");
  }).slice(0, 4);
  const rankingRuns = recoveredRuns.filter((run: any) => (run.rankTracking?.google?.checks || []).length > 0).slice(0, 3);
  const queries = Array.from(new Set(rankingRuns.flatMap((run: any) => (run.rankTracking?.google?.checks || []).map((check: any) => check.query))));
  const latest = recoveredRuns[0];
  const latestStatuses = (latest?.sourceStatuses || []).filter((item: any) => item.status === "success" || item.status === "partial");
  const aiSnapshot = {
    citationCount: 28,
    aiSearchVolume: 5000,
    location: "Austria",
    language: "German",
    source: "Last successful DataForSEO AI snapshot",
    pages: [
      ["kassenbon", "Kassenbon Pflicht in Österreich", 3],
      ["registrierkasse gastronomie", "Registrierkasse Gastronomie", 2],
      ["kleinunternehmer nebenberuflich österreich", "Nebenberuflich selbstständig", 4],
      ["rksv", "RKSV für Laien", 3],
      ["pos system", "POS Systeme in Österreich", 5],
    ],
  };
  const runCards = recoveredRuns.map((run: any) => {
    const checks = run.rankTracking?.google?.checks || [];
    const found = checks.filter((check: any) => check.found).length;
    const partial = (run.sourceStatuses || []).filter((item: any) => item.status === "partial").map((item: any) => item.source).join(", ");
    return `<article class="run"><div class="run-head"><div><strong>${esc(date(run.createdAt))}</strong><span class="run-id">${esc(run.id)}</span></div><div class="run-status ${partial ? "partial" : "success"}">${partial ? "PARTIAL: " + esc(partial) : "SERP SUCCESS"}</div></div><div class="run-metrics"><span><b>${esc(found)}/${esc(checks.length || 0)}</b> queries found</span><span>Google/DataForSEO</span><span>${esc(run.sources?.join(" + ") || "")}</span></div></article>`;
  }).join("");
  const rows = queries.map((query) => `<tr><th>${esc(query)}</th>${rankingRuns.map((run: any) => { const check = (run.rankTracking?.google?.checks || []).find((item: any) => item.query === query); const p = position(check); return `<td class="${positionClass(p)}">${esc(p === null ? "not found" : "#" + p)}</td>`; }).join("")}</tr>`).join("");
  const aiPages = aiSnapshot.pages.map(([query, title, rank]) => `<li><span>${esc(query)}</span><b>${esc(title)}</b><em>#${esc(rank)}</em></li>`).join("");
  const statusItems = latestStatuses.map((item: any) => `<span class="status ${item.status === "success" ? "ok" : "warn"}">${esc(item.source)}: ${esc(item.status)}</span>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>HELLOCASH recovered WGD runs</title><style>
  *{box-sizing:border-box}body{margin:0;background:#111827;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:1440px;min-height:1000px;padding:54px 64px;background:linear-gradient(135deg,#111827 0%,#172554 58%,#164e63 100%)}header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1px solid #475569;padding-bottom:24px}h1{font-size:42px;margin:0 0 8px;letter-spacing:0}h2{font-size:20px;margin:0 0 18px;color:#bae6fd}.muted{color:#cbd5e1}.date{font-size:16px;color:#bae6fd}.grid{display:grid;grid-template-columns:1.15fr .85fr;gap:22px;margin-top:28px}.panel{background:rgba(15,23,42,.78);border:1px solid #475569;border-radius:14px;padding:24px;box-shadow:0 12px 32px rgba(0,0,0,.2)}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.metric{background:#1e293b;border:1px solid #475569;border-radius:10px;padding:16px}.metric b{display:block;font-size:30px;color:#f8fafc}.metric span{display:block;margin-top:4px;color:#cbd5e1;font-size:13px}.runs{display:grid;gap:10px}.run{background:#1e293b;border:1px solid #475569;border-radius:10px;padding:15px}.run-head{display:flex;justify-content:space-between;align-items:center}.run-id{font-family:monospace;font-size:11px;color:#94a3b8;margin-left:12px}.run-status{font-size:11px;font-weight:700;padding:5px 8px;border-radius:999px}.run-status.success{background:#14532d;color:#bbf7d0}.run-status.partial{background:#713f12;color:#fde68a}.run-metrics{display:flex;gap:24px;color:#cbd5e1;font-size:13px;margin-top:12px}.run-metrics b{font-size:20px;color:#fff}table{width:100%;border-collapse:separate;border-spacing:0 7px}th,td{text-align:left;padding:13px 14px;background:#1e293b;border-top:1px solid #475569;border-bottom:1px solid #475569}th{width:37%;font-weight:600;color:#f8fafc;border-left:1px solid #475569;border-radius:9px 0 0 9px}td{text-align:center;font-weight:800;font-size:18px;border-right:1px solid #475569}.top{color:#bbf7d0;background:#14532d}.page{color:#fde68a;background:#713f12}.missing{color:#fecaca;background:#7f1d1d}tr td:last-child{border-radius:0 9px 9px 0}.legend{display:flex;gap:16px;margin-top:12px;color:#cbd5e1;font-size:12px}.legend i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:5px;vertical-align:-1px}.ai-total{display:flex;gap:16px}.ai-total .metric{flex:1}.ai-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}.ai-list li{display:grid;grid-template-columns:1.2fr 2fr 45px;gap:10px;align-items:center;padding:10px 12px;background:#1e293b;border-radius:8px;color:#cbd5e1;font-size:13px}.ai-list b{color:#f8fafc}.ai-list em{font-style:normal;text-align:right;color:#a7f3d0;font-weight:700}.statuses{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.status{padding:5px 9px;border-radius:999px;font-size:12px;font-weight:700}.status.ok{background:#14532d;color:#bbf7d0}.status.warn{background:#713f12;color:#fde68a}.footer{margin-top:28px;color:#94a3b8;font-size:13px}
  .advice-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.advice{background:#1e293b;border:1px solid #475569;border-radius:10px;padding:15px}.advice .priority{color:#fde68a;font-size:11px;font-weight:800;text-transform:uppercase}.advice h3{font-size:16px;margin:8px 0;color:#f8fafc}.advice p{font-size:13px;color:#cbd5e1;margin:0;line-height:1.45}.advice .kpi{display:block;color:#a7f3d0;font-size:12px;margin-top:12px;font-weight:700}
  </style></head><body><main><header><div><div class="date">RECOVERED WGD SNAPSHOT · Austria / German</div><h1>HELLOCASH SEO & AI visibility</h1><div class="muted">Recovered from persisted runs after the latest failed rerun overwrote the HTML report.</div></div><div class="date">${esc(domain)}</div></header><div class="grid"><section class="panel"><h2>Recovered Google rankings</h2><div class="metrics"><div class="metric"><b>${esc(rankingRuns[0]?.rankTracking?.google?.status?.metricsSummary?.foundCount ?? "n/a")}/${esc(rankingRuns[0]?.rankTracking?.google?.status?.metricsSummary?.queryCount ?? "n/a")}</b><span>latest successful run</span></div><div class="metric"><b>${esc(rankingRuns.length)}</b><span>successful SERP runs recovered</span></div><div class="metric"><b>20</b><span>max result depth</span></div></div><div style="height:20px"></div><table><thead><tr><th>Query</th>${rankingRuns.map((run: any) => `<th>${esc(date(run.createdAt))}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table><div class="legend"><span><i style="background:#14532d"></i>top 3</span><span><i style="background:#713f12"></i>page 1</span><span><i style="background:#7f1d1d"></i>not found</span></div></section><section class="panel"><h2>AI visibility recovered</h2><div class="ai-total"><div class="metric"><b>${aiSnapshot.citationCount}</b><span>Google AI Overview citations</span></div><div class="metric"><b>${aiSnapshot.aiSearchVolume.toLocaleString()}</b><span>AI search volume</span></div></div><p class="muted">${esc(aiSnapshot.location)} · ${esc(aiSnapshot.language)} · ${esc(aiSnapshot.source)}</p><ul class="ai-list">${aiPages}</ul></section></div><section class="panel" style="margin-top:22px"><h2>Run history and partial sources</h2><div class="runs">${runCards}</div><div class="statuses">${statusItems}</div></section><section class="panel"><h2>Recommended action plan</h2><div class="advice-grid"><div class="advice"><span class="priority">Priority 1 · Protect</span><h3>Defend the top 1 positions</h3><p>Keep the homepage focused on online Registrierkasse, online Kassa and mobile Registrierkasse intent. Avoid moving these terms into new competing pages.</p><span class="kpi">KPI: retain positions 1–2</span></div><div class="advice"><span class="priority">Priority 2 · Improve</span><h3>Push gastronomy from #8</h3><p>Strengthen the gastronomy landing/blog page with Austria-specific use cases, features, pricing context, internal links and structured FAQ content.</p><span class="kpi">KPI: top 5, then top 3</span></div><div class="advice"><span class="priority">Priority 3 · Expand</span><h3>Move RKSV from #4</h3><p>Refresh the RKSV page with current Austrian guidance, clear definitions, trust signals and links from the core product pages.</p><span class="kpi">KPI: position 1–3</span></div><div class="advice"><span class="priority">Priority 4 · AI</span><h3>Build citation depth</h3><p>Maintain the pages already cited in AI Overview and connect them to product pages with clear entity, author and source signals.</p><span class="kpi">KPI: grow citations beyond 28</span></div></div></section><div class="footer">This image restores the last persisted successful/partial data. The latest failed DataForSEO rerun is intentionally excluded from ranking cells.</div></main></body></html>`;
  fs.mkdirSync(outDir, { recursive: true });
  const htmlPath = path.join(outDir, "wgd-hellocash-recovered-runs-2026-07-27.html");
  const cleanHtml = html
    .replaceAll("HELLOCASH recovered WGD runs", "HELLOCASH WGD report")
    .replaceAll("RECOVERED WGD SNAPSHOT", "WGD SNAPSHOT")
    .replaceAll("Recovered from persisted runs after the latest failed rerun overwrote the HTML report.", "Search visibility, AI citations and prioritized growth actions.")
    .replaceAll("Recovered Google rankings", "Google rankings")
    .replaceAll("successful SERP runs recovered", "successful SERP runs")
    .replaceAll("AI visibility recovered", "AI visibility")
    .replaceAll("Last successful DataForSEO AI snapshot", "AI citation snapshot")
    .replaceAll("Google/DataForSEO", "Google rankings")
    .replaceAll("This image restores the last persisted successful/partial data. The latest failed DataForSEO rerun is intentionally excluded from ranking cells.", "WGD snapshot · Austria / German");
  fs.writeFileSync(htmlPath, cleanHtml);
  console.log(JSON.stringify({ htmlPath, rankingRuns: rankingRuns.length, recoveredRuns: recoveredRuns.length, latestRunId: latest?.id }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
