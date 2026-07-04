import fs from "fs";
import path from "path";

const token = process.env.PEEC_API_TOKEN || "";
const endpoint = "https://api.peec.ai/mcp";
const projectId = "or_57c0d9f3-d38e-404a-8dca-6e24730eb2db";
const startDate = "2026-05-25";
const endDate = "2026-06-24";
const countries = [
  { code: "AT", name: "Austria" },
  { code: "DE", name: "Germany" },
  { code: "US", name: "United States" },
];

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
      clientInfo: { name: "wgd-peec-keba-country-compare", version: "1.0.0" },
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

function renderCountryCards(data: any[]): string {
  return data
    .map((item) => {
      const keba = item.keba || {};
      const domain = item.kebaDomain || {};
      return `
        <div class="card">
          <div class="label">${escapeHtml(item.country.name)}</div>
          <div class="metric">${escapeHtml(pct(keba.visibility))}</div>
          <p>SoV ${escapeHtml(pct(keba.share_of_voice))}; own-domain citations ${escapeHtml(domain.citation_count || 0)}.</p>
        </div>`;
    })
    .join("");
}

function renderSummaryRows(data: any[]): string {
  return data
    .map((item) => {
      const keba = item.keba || {};
      const domain = item.kebaDomain || {};
      return `
        <tr>
          <td>${escapeHtml(item.country.name)}</td>
          <td>${escapeHtml(pct(keba.visibility))}</td>
          <td>${escapeHtml(keba.mention_count ?? 0)}</td>
          <td>${escapeHtml(pct(keba.share_of_voice))}</td>
          <td>${escapeHtml(num(keba.position))}</td>
          <td>${escapeHtml(domain.retrieval_count || 0)}</td>
          <td>${escapeHtml(domain.citation_count || 0)}</td>
        </tr>`;
    })
    .join("");
}

function renderTopDomains(item: any): string {
  return (item.topDomains || [])
    .slice(0, 12)
    .map(
      (row: any) => `
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

function renderHtml(payload: any, htmlPath: string, jsonPath: string): string {
  const countriesWithData = payload.countries.filter((item: any) => item.brandReport?.rowCount > 0);
  const countriesWithoutData = payload.countries.filter((item: any) => !item.brandReport?.rowCount);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>KEBA Peec Country Citation Compare</title>
  <style>
    :root{--bg:#f5f7fb;--paper:#fff;--ink:#162033;--muted:#667085;--line:#d9e0ea;--blue:#245a8d;--soft:#f9fbfe}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 Arial,"Helvetica Neue",sans-serif}main{max-width:1180px;margin:0 auto;padding:30px 22px 54px}
    .hero,section,details{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:22px;margin:14px 0;box-shadow:0 10px 34px rgba(23,34,51,.05)}.hero{padding:30px}
    h1,h2,h3{line-height:1.18;margin:0 0 12px;letter-spacing:0}h1{font-size:clamp(30px,4vw,48px)}h2{font-size:22px}h3{font-size:17px;margin-top:20px}.sub{max-width:940px;color:var(--muted);font-size:18px}.note{color:var(--muted);font-size:13px}
    .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.card{border:1px solid var(--line);border-radius:8px;background:var(--soft);padding:16px;min-height:118px}.label{color:var(--muted);font-size:12px;text-transform:uppercase;font-weight:700}.metric{font-size:30px;font-weight:800;margin:6px 0;color:#1d334c}
    table{width:100%;border-collapse:collapse}th,td{border-top:1px solid var(--line);padding:10px 8px;text-align:left;vertical-align:top}th{color:var(--muted);font-size:12px;text-transform:uppercase}
    code{background:#eef2f6;border-radius:5px;padding:1px 5px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}a{color:var(--blue)}details summary{cursor:pointer;font-weight:800;font-size:17px}
    @media(max-width:860px){.grid{grid-template-columns:1fr}table{display:block;overflow-x:auto}main{padding:16px}}
  </style>
</head>
<body>
<main>
  <div class="hero">
    <div class="note">Website Growth Diagnostic supplement · Peec AI MCP · Gemini UI · ${escapeHtml(startDate)} to ${escapeHtml(endDate)}</div>
    <h1>KEBA citations by country</h1>
    <p class="sub">Comparison of KEBA Gemini visibility and own-domain citation strength in Austria, Germany, and the United States.</p>
  </div>

  <section>
    <h2>Executive Snapshot</h2>
    <div class="grid">${renderCountryCards(payload.countries)}</div>
  </section>

  <section>
    <h2>KEBA Country Comparison</h2>
    <table><thead><tr><th>Country</th><th>Visibility</th><th>Mentions</th><th>Share of Voice</th><th>Position</th><th>keba.com Retrievals</th><th>keba.com Citations</th></tr></thead><tbody>${renderSummaryRows(payload.countries)}</tbody></table>
  </section>

  ${payload.countries
    .map(
      (item: any) => `
      <section>
        <h2>Top Cited Domains: ${escapeHtml(item.country.name)}</h2>
        <table><thead><tr><th>Domain</th><th>Class</th><th>Retrievals</th><th>Citations</th><th>Citation Rate</th></tr></thead><tbody>${renderTopDomains(item)}</tbody></table>
      </section>`
    )
    .join("")}

  <section>
    <h2>Readout</h2>
    <ol>
      <li>Peec currently has Gemini data for ${escapeHtml(countriesWithData.map((item: any) => item.country.name).join(", ") || "no selected country")} in this project and date range.</li>
      <li>${escapeHtml(countriesWithoutData.map((item: any) => item.country.name).join(" and ") || "No selected country")} returned no Gemini rows at all. This means there is no country-level Peec data to compare yet, not that KEBA has confirmed 0% visibility there.</li>
      <li>Austria remains the only usable country in the current Peec data: KEBA has low visibility and very thin own-domain citation volume.</li>
      <li>To compare Germany and the United States, the Peec project needs tracked chats/prompts enabled for <code>DE</code> and <code>US</code> first, then at least one collection cycle.</li>
    </ol>
  </section>

  <details>
    <summary>Artifacts</summary>
    <ul>
      <li>JSON artifact: <code>${escapeHtml(jsonPath)}</code></li>
      <li>HTML artifact: <code>${escapeHtml(htmlPath)}</code></li>
      <li>Peec project: <code>KEBA</code></li>
      <li>Channel: <code>Gemini UI</code></li>
    </ul>
  </details>
</main>
</body>
</html>`;
}

async function main(): Promise<void> {
  const sessionId = await createSession();
  const base = { project_id: projectId, start_date: startDate, end_date: endDate };
  const results = [];
  let id = 2;

  for (const country of countries) {
    const filters = [
      { field: "model_channel_id", operator: "in", values: ["google-2"] },
      { field: "country_code", operator: "in", values: [country.code] },
    ];
    const brandReport = await callTool(sessionId, id++, "get_brand_report", { ...base, limit: 1000, filters });
    const domainReport = await callTool(sessionId, id++, "get_domain_report", {
      ...base,
      limit: 30,
      filters,
      order_by: [{ field: "citation_count", direction: "desc" }],
    });
    const kebaDomainReport = await callTool(sessionId, id++, "get_domain_report", {
      ...base,
      limit: 10,
      filters,
      having: [{ field: "domain", operator: "in", values: ["keba.com"] }],
    });
    const brands = rowsToObjects(brandReport);
    results.push({
      country,
      brandReport,
      domainReport,
      kebaDomainReport,
      keba: brands.find((row) => row.brand_name === "KEBA") || null,
      kebaDomain: rowsToObjects(kebaDomainReport)[0] || null,
      topDomains: rowsToObjects(domainReport),
    });
  }

  const outDir = path.resolve(process.cwd(), "reports");
  const stamp = new Date().toISOString().slice(0, 10);
  const jsonPath = path.join(outDir, `wgd-keba-peec-country-compare-${stamp}.json`);
  const htmlPath = path.join(outDir, `wgd-keba-peec-country-compare-${stamp}.html`);
  const payload = { projectId, startDate, endDate, countries: results };
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(htmlPath, renderHtml(payload, htmlPath, jsonPath));
  console.log(
    JSON.stringify(
      {
        jsonPath,
        htmlPath,
        countries: results.map((item) => ({
          country: item.country.name,
          visibility: item.keba?.visibility ?? null,
          shareOfVoice: item.keba?.share_of_voice ?? null,
          kebaDomainCitations: item.kebaDomain?.citation_count ?? 0,
        })),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
