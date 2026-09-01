import type { WgdFindingDeliveryStage, WgdKnownFindingCode, WgdManagerFindingScope } from "./types";

export type KnownWgdFindingCode = WgdKnownFindingCode;

export type WgdFindingCatalogEntry = {
  rank: number;
  managerEligible: boolean;
  deliveryStage: WgdFindingDeliveryStage;
  technicalAnchor: string;
  managerScope: WgdManagerFindingScope;
};

function entry(
  rank: number,
  managerEligible: boolean,
  deliveryStage: WgdFindingDeliveryStage,
  technicalAnchor: string,
  managerScope: WgdManagerFindingScope,
): WgdFindingCatalogEntry {
  return { rank, managerEligible, deliveryStage, technicalAnchor, managerScope };
}

/**
 * Complete metadata for all codes emitted by buildWgdFindings.
 * New codes are intentionally unknown until they are added here explicitly.
 */
export const FINDING_CATALOG: Record<KnownWgdFindingCode, WgdFindingCatalogEntry> = {
  homepage_noindex: entry(0, true, "blocking", "#page-details", "page"),
  indexability_signal_conflict: entry(1, true, "blocking", "#page-details", "page"),
  page_evidence_collection_failed: entry(2, false, "blocking", "#methodology", "page"),
  missing_sitemap: entry(3, true, "visibility", "#site-technical", "site"),
  broken_internal_links: entry(4, true, "blocking", "#page-details", "page"),
  orphan_candidate: entry(5, false, "visibility", "#page-details", "page"),
  missing_h1: entry(6, true, "visibility", "#page-details", "page"),
  missing_canonical: entry(7, true, "visibility", "#page-details", "page"),
  duplicate_titles: entry(8, true, "visibility", "#page-details", "page"),
  mobile_desktop_regression: entry(9, true, "improvement", "#speed-ux", "page"),
  accessibility_audits_failed: entry(10, true, "improvement", "#page-details", "page"),
  duplicate_descriptions: entry(11, true, "visibility", "#page-details", "page"),
  generic_description: entry(12, false, "visibility", "#page-details", "page"),
  keyword_topic_alignment_gap: entry(13, false, "visibility", "#page-details", "page"),
  thin_content_heuristic: entry(14, false, "improvement", "#page-details", "page"),
  missing_image_alt: entry(15, true, "improvement", "#page-details", "page"),
  alice_ai_not_used: entry(16, false, "visibility", "#alice-visibility", "site"),
  crawl_truncated: entry(17, false, "visibility", "#methodology", "site"),
  owner_access_gap: entry(18, false, "visibility", "#methodology", "site"),
};

export function findingCatalogEntry(code: string): WgdFindingCatalogEntry | undefined {
  return Object.prototype.hasOwnProperty.call(FINDING_CATALOG, code)
    ? FINDING_CATALOG[code as KnownWgdFindingCode]
    : undefined;
}

export function findingCatalogRank(code: string): number {
  return findingCatalogEntry(code)?.rank ?? Number.MAX_SAFE_INTEGER;
}
