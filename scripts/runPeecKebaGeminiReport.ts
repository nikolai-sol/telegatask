import fs from "fs";
import path from "path";

const token = process.env.PEEC_API_TOKEN || "";
const endpoint = "https://api.peec.ai/mcp";
const projectId = "or_57c0d9f3-d38e-404a-8dca-6e24730eb2db";
const startDate = "2026-05-25";
const endDate = "2026-06-24";
const kebaBrandId = "kw_bbc15ac3-c9d8-4b04-a064-538275a0b430";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseSse(text: string): any {
  const data = text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6))
    .join("\n");
  return data ? JSON.parse(data) : null;
}

async function postMcp(body: any, sessionId?: string): Promise<{ response: any; sessionId?: string }> {
  if (!token.trim()) throw new Error("PEEC_API_TOKEN is required");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = parseSse(text);
  if (parsed?.error) throw new Error(JSON.stringify(parsed.error));
  return { response: parsed, sessionId: response.headers.get("mcp-session-id") || sessionId };
}

async function createSession(): Promise<string> {
  const { sessionId } = await postMcp({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "wgd-peec-keba", version: "1.0.0" },
    },
  });
  if (!sessionId) throw new Error("Peec MCP did not return a session id");
  return sessionId;
}

async function callTool(sessionId: string, id: number, name: string, args: Record<string, unknown>): Promise<any> {
  const { response } = await postMcp(
    {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    },
    sessionId
  );
  return response?.result?.structuredContent || JSON.parse(response?.result?.content?.[0]?.text || "{}");
}

function rowsToObjects(table: any): any[] {
  const columns = table.columns || [];
  return (table.rows || []).map((row: any[]) => Object.fromEntries(columns.map((column: string, index: number) => [column, row[index]])));
}

function pct(value: unknown): string {
  return typeof value === "number" ? `${Math.round(value * 1000) / 10}%` : "n/a";
}

function num(value: unknown): string {
  return typeof value === "number" ? String(Math.round(value * 10) / 10) : "n/a";
}

function renderBrandTable(rows: any[]): string {
  return rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.brand_name)}</td>
          <td>${escapeHtml(pct(row.visibility))}</td>
          <td>${escapeHtml(row.mention_count)}</td>
          <td>${escapeHtml(pct(row.share_of_voice))}</td>
          <td>${escapeHtml(num(row.sentiment))}</td>
          <td>${escapeHtml(num(row.position))}</td>
        </tr>`
    )
    .join("");
}

function renderTopicTable(rows: any[]): string {
  return rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.topic_name)}</td>
          <td>${escapeHtml(pct(row.visibility))}</td>
          <td>${escapeHtml(row.mention_count)}</td>
          <td>${escapeHtml(pct(row.share_of_voice))}</td>
          <td>${escapeHtml(num(row.position))}</td>
        </tr>`
    )
    .join("");
}

function renderDomainTable(rows: any[]): string {
  return rows
    .slice(0, 20)
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.domain)}</td>
          <td>${escapeHtml(row.classification)}</td>
          <td>${escapeHtml(row.retrieval_count)}</td>
          <td>${escapeHtml(row.citation_count)}</td>
          <td>${escapeHtml(num(row.citation_rate))}</td>
        </tr>`
    )
    .join("");
}

function renderActionRows(rows: any[]): string {
  return rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.group_type || row.action_group_type)}</td>
          <td>${escapeHtml(row.url_classification || row.domain || "")}</td>
          <td>${escapeHtml(row.text || "")}</td>
          <td>${escapeHtml(row.relative_opportunity_score)}</td>
        </tr>`
    )
    .join("");
}

function renderHtml(payload: any, htmlPath: string, jsonPath: string): string {
  const geminiBrands = rowsToObjects(payload.geminiAT);
  const keba = geminiBrands.find((row) => row.brand_name === "KEBA") || {};
  const topics = rowsToObjects(payload.kebaGeminiTopics);
  const domains = rowsToObjects(payload.domainGeminiAT);
  const kebaDomain = rowsToObjects(payload.domainKeba)[0] || {};
  const actions = payload.actionDetails.flatMap((item: any) => rowsToObjects(item.detail));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>KEBA Peec Gemini GEO Report</title>
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
    <div class="note">Website Growth Diagnostic supplement · Peec AI MCP · Gemini UI · Austria · ${escapeHtml(startDate)} to ${escapeHtml(endDate)}</div>
    <h1>KEBA Gemini GEO / AI visibility</h1>
    <p class="sub">Peec data for the existing KEBA project. This is real AI search tracking data, not a SERP proxy: brand visibility, share of voice, source retrievals, citations, and Peec action recommendations.</p>
  </div>

  <section>
    <h2>Executive Snapshot</h2>
    <div class="grid">
      <div class="card"><div class="label">KEBA Gemini visibility</div><div class="metric">${escapeHtml(pct(keba.visibility))}</div><p>${escapeHtml(keba.visibility_count || 0)} of ${escapeHtml(keba.visibility_total || 0)} Gemini Austria answers mentioned KEBA.</p></div>
      <div class="card"><div class="label">Share of voice</div><div class="metric">${escapeHtml(pct(keba.share_of_voice))}</div><p>KEBA's mention share among tracked competitors in Gemini Austria.</p></div>
      <div class="card"><div class="label">Average position</div><div class="metric">${escapeHtml(num(keba.position))}</div><p>Lower is better. KEBA appears marginally when it appears.</p></div>
      <div class="card"><div class="label">keba.com citations</div><div class="metric">${escapeHtml(kebaDomain.citation_count || 0)}</div><p>Own-domain citation count in Gemini Austria.</p></div>
    </div>
  </section>

  <section>
    <h2>Brand Visibility: Gemini / Austria</h2>
    <table><thead><tr><th>Brand</th><th>Visibility</th><th>Mentions</th><th>Share of Voice</th><th>Sentiment</th><th>Position</th></tr></thead><tbody>${renderBrandTable(geminiBrands)}</tbody></table>
  </section>

  <section>
    <h2>KEBA by Topic: Gemini / Austria</h2>
    <table><thead><tr><th>Topic</th><th>Visibility</th><th>Mentions</th><th>Share of Voice</th><th>Position</th></tr></thead><tbody>${renderTopicTable(topics)}</tbody></table>
  </section>

  <section>
    <h2>Top Cited Domains: Gemini / Austria</h2>
    <table><thead><tr><th>Domain</th><th>Class</th><th>Retrievals</th><th>Citations</th><th>Citation Rate</th></tr></thead><tbody>${renderDomainTable(domains)}</tbody></table>
  </section>

  <section>
    <h2>Peec Actions</h2>
    <p class="note">Peec's overview identified Owned product pages and Owned category pages as the biggest high-opportunity gaps for Gemini Austria.</p>
    <table><thead><tr><th>Group</th><th>Slice</th><th>Recommendation</th><th>Strength</th></tr></thead><tbody>${renderActionRows(actions)}</tbody></table>
  </section>

  <section>
    <h2>Readout</h2>
    <ol>
      <li>KEBA is present in Gemini Austria, but weak: ${escapeHtml(pct(keba.visibility))} visibility and ${escapeHtml(pct(keba.share_of_voice))} share of voice.</li>
      <li>Competitors dominate: Siemens and ABB lead both visibility and citations.</li>
      <li>KEBA only breaks through meaningfully in the Industrial robot controllers topic; drive technology, injection molding automation, machine automation software, and intralogistics are currently 0% for KEBA in Gemini Austria.</li>
      <li>Own-domain citation is very thin: <code>keba.com</code> was retrieved ${escapeHtml(kebaDomain.retrieval_count || 0)} times and cited ${escapeHtml(kebaDomain.citation_count || 0)} times.</li>
      <li>The biggest lever is owned product/category content, not Reddit. Full Peec action list: <a href="https://app.peec.ai/actions">https://app.peec.ai/actions</a>.</li>
    </ol>
  </section>

  <details>
    <summary>Artifacts</summary>
    <ul>
      <li>JSON artifact: <code>${escapeHtml(jsonPath)}</code></li>
      <li>HTML artifact: <code>${escapeHtml(htmlPath)}</code></li>
      <li>Peec project: <code>KEBA</code></li>
      <li>Channel: <code>Gemini UI</code></li>
      <li>Country: <code>Austria</code></li>
    </ul>
  </details>
</main>
</body>
</html>`;
}

async function main(): Promise<void> {
  const sessionId = await createSession();
  const baseFilters = [
    { field: "model_channel_id", operator: "in", values: ["google-2"] },
    { field: "country_code", operator: "in", values: ["AT"] },
  ];
  const base = { project_id: projectId, start_date: startDate, end_date: endDate };

  const geminiAT = await callTool(sessionId, 2, "get_brand_report", { ...base, limit: 1000, filters: baseFilters });
  const kebaGeminiTopics = await callTool(sessionId, 3, "get_brand_report", {
    ...base,
    limit: 1000,
    dimensions: ["topic_id"],
    filters: baseFilters,
    having: [{ field: "brand_id", operator: "in", values: [kebaBrandId] }],
  });
  const domainGeminiAT = await callTool(sessionId, 4, "get_domain_report", {
    ...base,
    limit: 50,
    filters: baseFilters,
    order_by: [{ field: "citation_count", direction: "desc" }],
  });
  const domainKeba = await callTool(sessionId, 5, "get_domain_report", {
    ...base,
    limit: 20,
    filters: baseFilters,
    having: [{ field: "domain", operator: "in", values: ["keba.com"] }],
  });
  const actionsOverview = await callTool(sessionId, 6, "get_actions", {
    ...base,
    scope: "overview",
    model_channel_ids: ["google-2"],
    country_codes: ["AT"],
  });

  const overviewRows = rowsToObjects(actionsOverview)
    .sort((a, b) => Number(b.opportunity_score || 0) - Number(a.opportunity_score || 0))
    .slice(0, 3);
  const actionDetails = [];
  let id = 7;
  for (const row of overviewRows) {
    const scope = String(row.action_group_type || "").toLowerCase();
    const args: Record<string, unknown> = {
      ...base,
      scope,
      model_channel_ids: ["google-2"],
      country_codes: ["AT"],
    };
    if (row.url_classification) args.url_classification = row.url_classification;
    if (row.domain) args.domain = row.domain;
    actionDetails.push({ overview: row, detail: await callTool(sessionId, id++, "get_actions", args) });
  }

  const outDir = path.resolve(process.cwd(), "reports");
  const stamp = new Date().toISOString().slice(0, 10);
  const jsonPath = path.join(outDir, `wgd-keba-peec-gemini-${stamp}.json`);
  const htmlPath = path.join(outDir, `wgd-keba-peec-gemini-${stamp}.html`);
  const payload = { projectId, startDate, endDate, geminiAT, kebaGeminiTopics, domainGeminiAT, domainKeba, actionsOverview, actionDetails };
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(htmlPath, renderHtml(payload, htmlPath, jsonPath));
  console.log(JSON.stringify({ jsonPath, htmlPath }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
