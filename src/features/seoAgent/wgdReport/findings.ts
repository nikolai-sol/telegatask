import type {
  CrawlEvidence,
  LighthouseEvidence,
  PageEvidence,
  SourceCoverage,
  WgdFinding,
  WgdFindingConfidence,
  WgdFindingSeverity,
} from "./types";
import type { YandexEvidence } from "./yandexEvidence";
import { findingCatalogRank } from "./findingCatalog";

export type WgdFindingsInput = {
  crawl?: CrawlEvidence;
  pages?: PageEvidence[];
  lighthouse?: LighthouseEvidence[];
  yandex?: YandexEvidence;
  sources?: SourceCoverage[];
};

type FindingFields = Omit<WgdFinding, "severity" | "confidence"> & {
  severity?: WgdFindingSeverity;
  confidence?: WgdFindingConfidence;
};

const SEVERITY_RANK: Record<WgdFindingSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const GENERIC_DESCRIPTIONS = [
  "welcome to our website",
  "home page",
  "official website",
  "learn more about us",
];

function finding(fields: FindingFields): WgdFinding {
  return {
    severity: fields.severity || "medium",
    confidence: fields.confidence || "high",
    ...fields,
  };
}

function uniquePages(input: WgdFindingsInput): PageEvidence[] {
  const pages = input.pages || input.crawl?.pages || [];
  const seen = new Set<string>();
  return pages.filter((page) => {
    const key = page.finalUrl || page.requestedUrl;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isHomepage(page: PageEvidence): boolean {
  try {
    const url = new URL(page.finalUrl || page.requestedUrl);
    return url.pathname === "/" || url.pathname === "";
  } catch {
    return false;
  }
}

function pageUrl(page: PageEvidence): string {
  return page.finalUrl || page.requestedUrl;
}

function isAnalyzedHtmlPage(page: PageEvidence): boolean {
  const htmlContent = !page.contentType || /(?:text\/html|application\/xhtml\+xml)/i.test(page.contentType);
  return !page.error && page.status >= 200 && page.status < 300 && htmlContent;
}

function addCollectionFailures(result: WgdFinding[], pages: PageEvidence[]): void {
  for (const page of pages.filter((item) => item.status === 0 || Boolean(item.error))) {
    result.push(finding({
      code: "page_evidence_collection_failed",
      severity: "high",
      affectedUrl: pageUrl(page),
      evidence: `Page evidence could not be collected${page.error ? ` (${page.error})` : ""}; no on-page or indexability inference was made.`,
      source: "crawl:collection",
      confidence: "high",
      action: "Resolve the fetch failure and collect the page HTML before assessing on-page SEO or indexability.",
      expectedEffect: "Replace an evidence gap with a reliable page-level assessment.",
      acceptanceCriterion: "The URL returns a successfully analyzed HTML response in normalized crawl evidence.",
      verification: `Re-crawl ${pageUrl(page)} and confirm a non-error HTML page record is present.`,
    }));
  }
}

function metadataFinding(
  code: string,
  page: PageEvidence,
  evidence: string,
  action: string,
  acceptanceCriterion: string,
  severity: WgdFindingSeverity = "high"
): WgdFinding {
  return finding({
    code,
    severity,
    affectedUrl: pageUrl(page),
    evidence,
    source: "crawl:page_html",
    confidence: "high",
    action,
    expectedEffect: "Improve index eligibility and the clarity of the search result snippet.",
    acceptanceCriterion,
    verification: `Re-crawl ${pageUrl(page)} and inspect the normalized page evidence.`,
  });
}

function addPageRules(result: WgdFinding[], pages: PageEvidence[]): void {
  for (const page of pages) {
    if (page.indexabilityConflicts?.length) {
      result.push(finding({
        code: "indexability_signal_conflict",
        severity: "high",
        affectedUrl: pageUrl(page),
        evidence: `Conflicting indexability evidence: ${page.indexabilityConflicts.join(" ")}`,
        source: "crawl:indexability_signals",
        confidence: "high",
        action: "Align meta robots, X-Robots-Tag, response status, and canonical signals with the intended index URL.",
        expectedEffect: "Remove contradictory crawler directives and canonical ambiguity.",
        acceptanceCriterion: "The normalized page evidence contains no indexability conflict and all directives support the intended canonical URL.",
        verification: `Re-crawl ${pageUrl(page)} and inspect both HTTP and HTML indexability signals.`,
      }));
    }
    if (page.orphanCandidate === true) {
      result.push(finding({
        code: "orphan_candidate",
        severity: "medium",
        affectedUrl: pageUrl(page),
        evidence: `Orphan candidate in the observed bounded crawl: discovered via ${(page.discoverySources || []).join(", ") || "a seed"} with zero observed inbound internal links.`,
        source: "crawl:observed_link_graph",
        confidence: "medium",
        action: "Confirm whether this page should be discoverable through contextual internal links, then add an appropriate link or intentionally exclude the page.",
        expectedEffect: "Improve crawl discovery and clarify the page's role in the site architecture.",
        acceptanceCriterion: "The page has at least one relevant crawled inbound internal link, or a documented decision explains why it should remain unlinked.",
        verification: `Repeat the bounded crawl from the same start page and inspect observed inbound-link evidence for ${pageUrl(page)}.`,
      }));
    }
    if (!page.headings?.h1?.length) {
      result.push(metadataFinding(
        "missing_h1",
        page,
        "The crawled HTML contains no H1 heading.",
        "Add one descriptive, page-specific H1.",
        "Exactly one meaningful H1 is present in the rendered HTML."
      ));
    }
    if (!page.canonical) {
      result.push(metadataFinding(
        "missing_canonical",
        page,
        "The crawled HTML contains no canonical link.",
        "Add a valid self-referencing canonical URL unless another canonical target is intentional.",
        "A valid canonical link is present and resolves to the intended index URL."
      ));
    }
    const description = page.description?.trim().toLowerCase();
    if (description && GENERIC_DESCRIPTIONS.some((value) => description === value || description.startsWith(`${value}.`))) {
      result.push(metadataFinding(
        "generic_description",
        page,
        `Heuristic: the description “${page.description}” matches a generic phrase.`,
        "Replace it with a page-specific description that accurately summarizes the offer or intent.",
        "The description is unique, specific to the page, and no longer matches the generic-phrase heuristic.",
        "medium"
      ));
    }
    if (page.keywordAlignment?.state === "measured" && page.keywordAlignment.unmatchedKeywords.length > 0) {
      const matched = page.keywordAlignment.matches.length;
      const checked = page.keywordAlignment.checkedKeywords;
      result.push(finding({
        code: "keyword_topic_alignment_gap",
        severity: "low",
        affectedUrl: pageUrl(page),
        evidence: `Heuristic: ${matched} of ${checked} requested keyword(s) matched normalized tokens in the title, description, or H1; ${page.keywordAlignment.unmatchedKeywords.length} did not. This is not a relevance judgment.`,
        source: "crawl:keyword_topic_alignment_heuristic",
        confidence: "medium",
        action: "Manually compare the unmatched requested topics with the page intent and adjust visible metadata or headings only when the topic genuinely belongs on the page.",
        expectedEffect: "Make intended page topics clearer without treating lexical presence as search relevance.",
        acceptanceCriterion: "A human intent review documents each unmatched topic as either intentionally out of scope or accurately represented in the title, description, or H1.",
        verification: `Repeat the normalized-token heuristic for ${pageUrl(page)} and review the result alongside page intent.`,
      }));
    }
    if (typeof page.wordCount === "number" && page.wordCount < 150) {
      result.push(finding({
        code: "thin_content_heuristic",
        severity: "medium",
        affectedUrl: pageUrl(page),
        evidence: `Heuristic: ${page.wordCount} extracted words is below the 150-word review threshold.`,
        source: "crawl:page_html",
        confidence: "medium",
        action: "Review whether the page answers its intended search need; expand only where useful to visitors.",
        expectedEffect: "Improve topical completeness where the short page reflects a genuine content gap.",
        acceptanceCriterion: "A human review confirms the page is purpose-complete, or the missing topic coverage is added.",
        verification: `Re-run word extraction for ${pageUrl(page)} and complete a manual intent review.`,
      }));
    }
    if (page.images && page.images.missingAlt > 0) {
      result.push(finding({
        code: "missing_image_alt",
        severity: "medium",
        affectedUrl: pageUrl(page),
        evidence: `${page.images.missingAlt} of ${page.images.total} image(s) have no alt text.`,
        source: "crawl:page_html",
        confidence: "high",
        action: "Add meaningful alt text to informative images and empty alt attributes to decorative images.",
        expectedEffect: "Improve image context and accessibility for assistive technology.",
        acceptanceCriterion: "Every image has an alt attribute appropriate to its purpose.",
        verification: `Re-crawl ${pageUrl(page)} and run the Lighthouse image-alt audit.`,
      }));
    }
  }
}

function addCrawlRules(result: WgdFinding[], crawl: CrawlEvidence | undefined): void {
  if (!crawl) return;
  const hasSitemap = crawl.sitemapCandidates.some((item) =>
    typeof item.status === "number" && item.status >= 200 && item.status < 300
      && (item.isIndex === true || item.urls.length > 0)
  );
  if (!hasSitemap) {
    result.push(finding({
      code: "missing_sitemap",
      severity: "high",
      scope: "site",
      evidence: "No reachable sitemap was identified in robots.txt or the tested common sitemap locations.",
      source: "crawl:sitemap_discovery",
      confidence: "high",
      action: "Publish a current XML sitemap and reference it from robots.txt.",
      expectedEffect: "Give search engines a reliable discovery inventory for canonical URLs.",
      acceptanceCriterion: "A same-origin XML sitemap returns 2xx and lists the intended canonical URLs.",
      verification: "Fetch robots.txt and each declared sitemap, then validate the XML and sampled URLs.",
    }));
  }
  if (crawl.brokenUrls.length) {
    result.push(finding({
      code: "broken_internal_links",
      severity: "high",
      scope: "site",
      evidence: `${crawl.brokenUrls.length} crawled internal target(s) returned an error or non-success result.`,
      source: "crawl:link_graph",
      confidence: "high",
      action: "Update or remove internal links to broken targets, preserving valid redirects where appropriate.",
      expectedEffect: "Reduce dead ends for users and crawlers.",
      acceptanceCriterion: "All reported internal targets return the intended success response or a deliberate redirect.",
      verification: "Re-crawl the affected link graph and confirm the broken URL list is empty.",
    }));
  }
  for (const [code, groups, label, severity] of [
    ["duplicate_titles", crawl.duplicateTitles, "title", "high"],
    ["duplicate_descriptions", crawl.duplicateDescriptions, "description", "medium"],
  ] as const) {
    const duplicateUrls = Object.values(groups).flat();
    if (!duplicateUrls.length) continue;
    result.push(finding({
      code,
      severity,
      scope: "site",
      evidence: `${Object.keys(groups).length} duplicated ${label} value(s) affect ${new Set(duplicateUrls).size} URL(s).`,
      source: "crawl:metadata_aggregation",
      confidence: "high",
      action: `Create unique, intent-specific ${label} text for each indexable page.`,
      expectedEffect: "Differentiate pages and make their search-result purpose clearer.",
      acceptanceCriterion: `No unintended duplicate ${label} groups remain among indexable pages.`,
      verification: `Re-crawl all indexable pages and compare normalized ${label} values.`,
    }));
  }
  const truncationEvidence = crawl.limitations.find((item) =>
    /\bpage crawl (?:was )?truncated\b/i.test(item)
      || /\bcrawl (?:was )?truncated\b/i.test(item)
      || /\bcrawl stopped\b.*\b(?:limit|capacity)\b/i.test(item)
      || /\b(?:crawl limit|frontier capacity)\b.*\b(?:reached|exceeded|full)\b/i.test(item)
      || /\bfrontier capacity (?:limit|limitation)\b/i.test(item)
  );
  if (truncationEvidence) {
    result.push(finding({
      code: "crawl_truncated",
      severity: "low",
      scope: "report coverage",
      evidence: `Crawler limitation: ${truncationEvidence} ${crawl.pages.length} HTML page(s) were analyzed.`,
      source: "crawl:coverage",
      confidence: "high",
      action: "Run a targeted follow-up crawl for uncrawled priority HTML URLs or split coverage by sitemap/template; increase the limit only when it is below the supported maximum.",
      expectedEffect: "Reduce uncertainty caused by incomplete page coverage.",
      acceptanceCriterion: "Every priority or intended indexable HTML candidate is analyzed or explicitly classified as non-HTML or excluded, with no page-crawl truncation limitation remaining.",
      verification: "Compare the analyzed HTML URL set with validated sitemap/priority candidates and confirm the crawler emits no page-crawl truncation limitation.",
    }));
  }
}

function addLighthouseRules(result: WgdFinding[], lighthouse: LighthouseEvidence[]): void {
  const maxAccessibilityAuditExamples = 8;
  const byUrl = new Map<string, Partial<Record<"mobile" | "desktop", LighthouseEvidence>>>();
  for (const row of lighthouse) {
    if (row.status === "failed") continue;
    const requestedUrl = row.requestedUrl || row.url;
    const profiles = byUrl.get(requestedUrl) || {};
    profiles[row.device] = row;
    byUrl.set(requestedUrl, profiles);
  }
  for (const [url, profiles] of byUrl) {
    const mobile = profiles.mobile;
    const desktop = profiles.desktop;
    if (mobile && desktop) {
      const regressions = Object.keys(desktop.categoryScores || {}).filter((category) => {
        const mobileScore = mobile.categoryScores?.[category];
        const desktopScore = desktop.categoryScores?.[category];
        return typeof mobileScore === "number" && typeof desktopScore === "number" && desktopScore - mobileScore >= 15;
      });
      if (regressions.length) {
        result.push(finding({
          code: "mobile_desktop_regression",
          severity: "high",
          affectedUrl: url,
          evidence: `Mobile scores trail desktop by at least 15 points for: ${regressions.sort().join(", ")}.`,
          source: "lighthouse:profile_comparison",
          confidence: "high",
          action: "Investigate mobile-specific rendering, payload, layout, and interaction bottlenecks.",
          expectedEffect: "Improve the experience and audit results for mobile visitors.",
          acceptanceCriterion: "No Lighthouse category has an unexplained mobile deficit of 15 or more points.",
          verification: "Repeat mobile and desktop Lighthouse runs under the same report configuration.",
        }));
      }
    }
    const failedAccessibilityIds = [...new Set([mobile, desktop]
      .filter((item): item is LighthouseEvidence => Boolean(item))
      .flatMap((item) => item.failedAudits || [])
      .filter((audit) => audit.categories.includes("accessibility"))
      .map((audit) => audit.id.trim())
      .filter(Boolean))].sort();
    const accessibilityScores = [mobile, desktop]
      .map((item) => item?.categoryScores?.accessibility)
      .filter((score): score is number => typeof score === "number");
    if (failedAccessibilityIds.length || accessibilityScores.some((score) => score < 90)) {
      const examples = failedAccessibilityIds
        .slice(0, maxAccessibilityAuditExamples)
        .map((id) => id.slice(0, 80));
      const omitted = failedAccessibilityIds.length - examples.length;
      result.push(finding({
        code: "accessibility_audits_failed",
        severity: "high",
        affectedUrl: url,
        evidence: failedAccessibilityIds.length
          ? `${failedAccessibilityIds.length} unique accessibility ${failedAccessibilityIds.length === 1 ? "audit" : "audits"} failed across Lighthouse lab profiles: ${examples.join(", ")}${omitted ? `, plus ${omitted} more` : ""}.`
          : `The lowest Lighthouse lab accessibility score is ${Math.min(...accessibilityScores)}.`,
        source: "lighthouse:accessibility",
        confidence: "high",
        action: "Resolve the detailed accessibility audit failures and test the affected interactions manually.",
        expectedEffect: "Remove barriers for visitors using assistive technology.",
        acceptanceCriterion: "Reported accessibility audits pass and manual checks confirm the affected experience.",
        verification: "Re-run Lighthouse accessibility audits and the corresponding keyboard/screen-reader checks.",
      }));
    }
  }
}

function addProviderRules(result: WgdFinding[], input: WgdFindingsInput): void {
  const sample = input.yandex?.aiSampleVisibility;
  if (sample && sample.checked > 0 && sample.used === 0) {
    result.push(finding({
      code: "alice_ai_not_used",
      severity: "medium",
      scope: "controlled Alice AI sample",
      evidence: `Controlled-sample result: the domain was used in 0 of ${sample.checked} checked Alice AI response(s); this is not official share of voice.`,
      source: "alice_ai:controlled_sample",
      confidence: "medium",
      action: "Review sampled source selection and strengthen useful, attributable coverage for the sampled intents.",
      expectedEffect: "Increase the chance of being selected as a source for comparable sampled answers.",
      acceptanceCriterion: "A later controlled sample records target use, without representing the sample as official visibility.",
      verification: "Repeat the same documented query sample and compare targetFound and targetUsed evidence.",
    }));
  }
  const ownerGaps = (input.sources || []).filter((source) => source.state === "owner_access_required");
  if (ownerGaps.length) {
    result.push(finding({
      code: "owner_access_gap",
      severity: "low",
      scope: "owner-source coverage",
      evidence: `Verified owner access is still required for: ${ownerGaps.map((source) => source.label || source.id).join(", ")}.`,
      source: "provider_preflight",
      confidence: "high",
      action: "Grant read-only verified-owner access before drawing owner-metric conclusions.",
      expectedEffect: "Add first-party impressions, clicks, indexing, and query evidence where available.",
      acceptanceCriterion: "The relevant source-coverage rows report success and owner snapshots are present.",
      verification: "Repeat provider preflight and confirm the expected verified property is returned.",
    }));
  }
}

/** Build a deterministic severity-first backlog from normalized report evidence. */
export function buildWgdFindings(input: WgdFindingsInput): WgdFinding[] {
  const result: WgdFinding[] = [];
  const pages = uniquePages(input);
  const analyzedPages = pages.filter(isAnalyzedHtmlPage);
  const homepage = analyzedPages.find(isHomepage);
  addCollectionFailures(result, pages);
  if (homepage && !homepage.indexable) {
    result.push(finding({
      code: "homepage_noindex",
      severity: "critical",
      affectedUrl: pageUrl(homepage),
      evidence: "The homepage is classified as non-indexable by normalized crawl evidence.",
      source: "crawl:indexability",
      confidence: "high",
      action: "Remove unintended noindex or robots blocking and confirm the final response is indexable.",
      expectedEffect: "Restore eligibility for the primary site entry point to appear in organic search.",
      acceptanceCriterion: "The final homepage response is 2xx, has no blocking robots directive, and is classified indexable.",
      verification: "Re-crawl the homepage and inspect both HTTP and HTML robots directives.",
    }));
  }
  addCrawlRules(result, input.crawl);
  addPageRules(result, analyzedPages);
  addLighthouseRules(result, input.lighthouse || []);
  addProviderRules(result, input);

  return result.sort((a, b) => {
    const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (severity) return severity;
    const rule = findingCatalogRank(a.code) - findingCatalogRank(b.code);
    if (rule) return rule;
    return `${a.affectedUrl || ""}\0${a.scope || ""}`.localeCompare(`${b.affectedUrl || ""}\0${b.scope || ""}`);
  });
}
