import {
  buildManagerPresentation,
  type WgdManagerNormalizedPayload,
} from "./managerPresentation";
import { renderManagerHeader, renderManagerSections } from "./managerReportRenderer";
import { htmlText } from "./reportHtml";
import { renderTechnicalSections } from "./technicalReportRenderer";
import { buildPublishedWgdReport, isScorableCrawlEvidence } from "./reportModel";
import type { YandexEvidence } from "./yandexEvidence";
import type {
  CrawlEvidence,
  LighthouseEvidence,
  PageEvidence,
  SourceCoverage,
  WgdPublishedReport,
  WgdReportPayload,
} from "./types";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function assemblePresentation(published: WgdPublishedReport): {
  normalized: WgdManagerNormalizedPayload;
  presentation: ReturnType<typeof buildManagerPresentation>;
} {
  const crawl = isScorableCrawlEvidence(published.crawl) ? published.crawl : undefined;
  const pages: PageEvidence[] = published.pages;
  const lighthouse: LighthouseEvidence[] = published.lighthouse;
  const yandex = isObject(published.yandex) ? published.yandex as unknown as YandexEvidence : undefined;
  const sources: SourceCoverage[] = published.sources;
  const normalized: WgdManagerNormalizedPayload = {
    generatedAt: published.generatedAt,
    options: published.options,
    sources,
    crawl,
    pages,
    lighthouse,
    yandex,
    findings: published.findings,
    limitations: published.limitations,
    evidenceFiles: stringArray(published.evidenceFiles),
    manualQueryPackPath: typeof published.manualQueryPackPath === "string"
      ? published.manualQueryPackPath
      : undefined,
  };
  return {
    normalized,
    presentation: buildManagerPresentation({
      normalized,
      assessment: published.assessment,
      findingGroups: published.groupedFindings,
    }),
  };
}

const REPORT_CSS = `
:root{color-scheme:light;--ink:#142033;--muted:#5e6b7d;--line:#dbe3ee;--paper:#fff;--wash:#f2f6fb;--blue:#1859c9;--critical:#b42318;--risk:#b54708;--improve:#8a6700;--good:#067647;--unknown:#667085}
*{box-sizing:border-box}
html{background:var(--wash)}
body{margin:0;color:var(--ink);font:15px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow-wrap:anywhere}
main{width:min(1120px,calc(100% - 28px));margin:28px auto 60px}
.report-header,section,details{background:var(--paper);border:1px solid var(--line);border-radius:16px;margin:0 0 18px;box-shadow:0 8px 28px #263b5910}
.report-header,section{padding:24px}
details{padding:0}
summary{cursor:pointer;font-size:1.18rem;font-weight:750;padding:20px 24px;list-style-position:inside}
.detail-body{border-top:1px solid var(--line);padding:20px 24px}
h1{font-size:clamp(2rem,6vw,3.5rem);line-height:1.05;margin:.15rem 0 .65rem}
h2{font-size:clamp(1.3rem,3vw,1.65rem);margin:0 0 16px}
h3{font-size:1rem;margin:0 0 8px}
p{margin:.45rem 0 1rem}
.eyebrow{color:var(--blue);font-weight:750;margin:0;text-transform:uppercase;letter-spacing:.06em}
.header-meta{display:flex;flex-wrap:wrap;gap:8px 18px;color:var(--muted)}
.overall-grid{display:grid;grid-template-columns:minmax(220px,.7fr) minmax(0,2fr);gap:18px}
.overall-card,.component-card,.metric-card,.problem-card,.priority-card{border:1px solid var(--line);border-radius:13px;background:#fff;padding:16px}
.overall-card{border-top:6px solid var(--unknown)}
.overall-card.score-critical,.metric-card.score-critical,.component-card.score-critical{border-top-color:var(--critical)}
.overall-card.score-risk,.metric-card.score-risk,.component-card.score-risk{border-top-color:var(--risk)}
.overall-card.score-improve,.metric-card.score-improve,.component-card.score-improve{border-top-color:var(--improve)}
.overall-card.score-good,.metric-card.score-good,.component-card.score-good{border-top-color:var(--good)}
.overall-score-value{font-size:clamp(2.2rem,7vw,4.4rem);font-weight:800;line-height:1}
.overall-state,.component-score{font-size:1.08rem;font-weight:750}
.conclusion,.section-summary{font-size:1.05rem}
.component-grid,.problem-grid,.summary-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:12px}
.component-card{border-top:4px solid var(--unknown)}
.compact-facts,.problem-facts,.technical-facts{margin:12px 0;display:grid;gap:8px}
.compact-facts div,.problem-facts div,.technical-facts div{display:grid;grid-template-columns:minmax(120px,.7fr) minmax(0,1.3fr);gap:10px}
dt{color:var(--muted)}dd{margin:0;font-weight:650}
.problem-card{border-left:5px solid var(--blue)}
.problem-card p{margin:.6rem 0}
.detail-link,.file-links a{color:var(--blue);font-weight:700;text-decoration-thickness:1px;text-underline-offset:2px}
.summary-cards{margin-bottom:14px}
.metric-card{border-top:4px solid var(--unknown);display:grid;gap:5px}.metric-card span{color:var(--muted)}.metric-card strong{font-size:1.35rem}
.priority-list{display:grid;gap:12px}.priority-card{display:flex;gap:14px}.priority-number{display:grid;place-items:center;flex:0 0 34px;height:34px;border-radius:50%;background:#e9f1ff;color:var(--blue);font-weight:800}
.priority-card ul,.file-links{margin:.5rem 0;padding-left:20px}
.note,.empty{color:var(--muted)}
.anchor-target{display:block;position:relative;top:-12px;visibility:hidden}
.table-scroll{width:100%;max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:11px;margin:12px 0}
table{border-collapse:collapse;width:100%;min-width:620px}
th,td{padding:10px 12px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line);overflow-wrap:anywhere}
th{background:#f7f9fc;white-space:nowrap}tbody tr:last-child td{border-bottom:0}
@media(max-width:420px){main{width:calc(100% - 16px);margin:8px auto 30px}.report-header,section{padding:16px;border-radius:12px}summary{padding:16px}.detail-body{padding:16px}.overall-grid{grid-template-columns:1fr}.compact-facts div,.problem-facts div,.technical-facts div{grid-template-columns:1fr;gap:2px}table{min-width:560px}}
@media print{html,body{background:#fff}.report-header,section,details{box-shadow:none;break-inside:avoid}main{width:100%;margin:0}.detail-body{display:block}.table-scroll{overflow:visible}table{min-width:0;font-size:10pt}}
`;

/** Render the exact trusted schema-2 object already assembled at the artifact boundary. */
export function renderPublishedWgdHtml(payload: WgdPublishedReport): string {
  const { normalized, presentation } = assemblePresentation(payload);
  const manager = renderManagerSections(presentation);
  const technical = renderTechnicalSections(normalized, presentation);
  return `<!doctype html>
<html lang="${presentation.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${htmlText(presentation.header.title)} · ${htmlText(presentation.header.domain)}</title>
<style>${REPORT_CSS}</style></head><body><main>
${renderManagerHeader(presentation)}
${manager.leadingHtml}
${manager.pageDetails.startHtml}${technical.pageDetailsHtml || manager.pageDetails.emptyHtml}${manager.pageDetails.endHtml}
${technical.closedDetailsHtml}
</main></body></html>`;
}

/** Safely render an arbitrary report payload after rebuilding all derived fields. */
export function renderWgdHtml(payload: WgdReportPayload): string {
  return renderPublishedWgdHtml(buildPublishedWgdReport(payload));
}
