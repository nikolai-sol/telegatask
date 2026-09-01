import fs from "fs";
import path from "path";

const reportPath = path.resolve(process.cwd(), "reports/wgd-hellocash-2026-07-27.html");
const html = fs.readFileSync(reportPath, "utf8");
const actionPlan = `<section><h2>Recommended Action Plan</h2><div class="grid"><div class="metric"><div class="label">Priority 1 · Protect</div><div class="value">Defend positions 1–2</div><p class="muted">Keep the homepage focused on online Registrierkasse, online Kassa and mobile Registrierkasse intent.</p><p><strong>KPI:</strong> retain positions 1–2</p></div><div class="metric"><div class="label">Priority 2 · Improve</div><div class="value">Push gastronomy from #8</div><p class="muted">Strengthen the gastronomy page with Austrian use cases, internal links and structured FAQ content.</p><p><strong>KPI:</strong> top 5, then top 3</p></div><div class="metric"><div class="label">Priority 3 · Expand</div><div class="value">Move RKSV from #4</div><p class="muted">Refresh the RKSV page with current guidance, trust signals and product-page links.</p><p><strong>KPI:</strong> position 1–3</p></div><div class="metric"><div class="label">Priority 4 · AI</div><div class="value">Build citation depth</div><p class="muted">Maintain the cited pages and connect them to product pages with clear entity and source signals.</p><p><strong>KPI:</strong> grow citations beyond 28</p></div></div></section>`;
const output = html.includes("Recommended Action Plan") ? html : html.replace("</main>", `${actionPlan}</main>`);
fs.writeFileSync(reportPath, output);
console.log(reportPath);
