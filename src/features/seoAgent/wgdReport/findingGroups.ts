import { findingCatalogEntry } from "./findingCatalog";
import type {
  CrawlEvidence,
  WgdFinding,
  WgdFindingSeverity,
  WgdManagerFindingGroup,
  WgdKnownFindingCode,
} from "./types";

export type WgdFindingGroupsInput = {
  findings: WgdFinding[];
  crawl?: Pick<CrawlEvidence, "brokenUrls" | "duplicateTitles" | "duplicateDescriptions">;
};

const SEVERITY_RANK: Record<WgdFindingSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function urlsForFinding(
  finding: WgdFinding,
  crawl?: Pick<CrawlEvidence, "brokenUrls" | "duplicateTitles" | "duplicateDescriptions">
): string[] {
  const urls = new Set<string>();
  if (finding.affectedUrl) urls.add(finding.affectedUrl);
  if (crawl && finding.code === "duplicate_titles") {
    Object.values(crawl.duplicateTitles).flat().forEach((url) => urls.add(url));
  }
  if (crawl && finding.code === "duplicate_descriptions") {
    Object.values(crawl.duplicateDescriptions).flat().forEach((url) => urls.add(url));
  }
  if (crawl && finding.code === "broken_internal_links") {
    crawl.brokenUrls.forEach((url) => urls.add(url));
  }
  return [...urls].sort();
}

/** Build every confirmed manager finding group in deterministic priority order. */
export function buildAllManagerFindingGroups(input: WgdFindingGroupsInput): WgdManagerFindingGroup[] {
  const grouped = new Map<WgdKnownFindingCode, { severity: WgdFindingSeverity; urls: Set<string>; count: number }>();

  for (const finding of input.findings) {
    const catalog = findingCatalogEntry(finding.code);
    if (!catalog?.managerEligible) continue;
    const code = finding.code as WgdKnownFindingCode;
    const current = grouped.get(code);
    const urls = urlsForFinding(finding, input.crawl);
    // A page finding without a typed URL has no safe manager-card target. In
    // particular, evidence prose is deliberately not a fallback URL source.
    if (catalog.managerScope === "page" && urls.length === 0) continue;
    if (!current) {
      grouped.set(code, {
        severity: finding.severity,
        urls: new Set(urls),
        count: 1,
      });
      continue;
    }
    if (SEVERITY_RANK[finding.severity] < SEVERITY_RANK[current.severity]) current.severity = finding.severity;
    urls.forEach((url) => current.urls.add(url));
    current.count += 1;
  }

  return [...grouped.entries()]
    .map(([code, group]) => {
      const catalog = findingCatalogEntry(code);
      if (!catalog) throw new Error(`Eligible finding code is missing catalog metadata: ${code}`);
      return {
        code,
        rank: catalog.rank,
        severity: group.severity,
        deliveryStage: catalog.deliveryStage,
        technicalAnchor: catalog.technicalAnchor,
        scope: catalog.managerScope,
        affectedUrls: [...group.urls].sort(),
        findingCount: group.count,
      } satisfies WgdManagerFindingGroup;
    })
    .sort((a, b) => {
      const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      return severity || a.rank - b.rank || a.code.localeCompare(b.code);
    });
}

/** Build the five-or-fewer confirmed problem cards used by the manager report. */
export function buildManagerFindingGroups(input: WgdFindingGroupsInput): WgdManagerFindingGroup[] {
  return buildAllManagerFindingGroups(input).slice(0, 5);
}
