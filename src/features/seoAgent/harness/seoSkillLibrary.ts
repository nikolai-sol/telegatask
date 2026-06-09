export type SeoProceduralSkill = {
  id: string;
  triggerKeywords: string[];
  title: string;
  procedureSteps: string[];
};

export const SEO_SKILL_LIBRARY: SeoProceduralSkill[] = [
  {
    id: "low-mobile-lcp-diagnosis",
    triggerKeywords: ["lcp", "largest contentful paint", "pagespeed", "performance", "core web vitals", "slow", "mobile"],
    title: "Low mobile LCP diagnosis",
    procedureSteps: [
      "Confirm the LCP metric and affected URL from PageSpeed or Lighthouse evidence.",
      "Identify the LCP element and whether it is image, hero text, product media, or render-blocked content.",
      "Check render-blocking CSS/JS, image size, lazy-loading, server latency, and font loading.",
      "Prioritize fixes that improve the measured URL before making site-wide assumptions.",
    ],
  },
  {
    id: "high-impressions-low-ctr-diagnosis",
    triggerKeywords: ["gsc", "search console", "impressions", "ctr", "click-through", "low ctr", "snippet", "average position"],
    title: "High impressions / low CTR diagnosis",
    procedureSteps: [
      "Use only Search Console evidence for impressions, clicks, CTR, and average position.",
      "Group queries by intent and landing page.",
      "Compare title, description, and visible page promise against the query intent.",
      "Recommend snippet and landing-page changes only for pages with evidence of impressions.",
    ],
  },
  {
    id: "internal-404-links",
    triggerKeywords: ["404", "broken link", "internal link", "not found", "crawl error", "dead url"],
    title: "Internal 404 links",
    procedureSteps: [
      "Confirm the broken URL and linking source from crawler evidence.",
      "Decide whether to fix the link target, restore the missing page, or redirect to the closest equivalent.",
      "Avoid recommending redirects without a relevant destination.",
      "Re-crawl the affected section after fixes.",
    ],
  },
  {
    id: "missing-metadata",
    triggerKeywords: ["title", "meta description", "metadata", "h1", "missing title", "missing description", "snippet"],
    title: "Missing metadata",
    procedureSteps: [
      "Confirm which metadata field is missing from crawler or Lighthouse evidence.",
      "Map the page to one primary search intent.",
      "Write unique title/H1/description recommendations for that page only.",
      "Avoid claiming CTR impact unless GSC evidence is available.",
    ],
  },
  {
    id: "pages-blocked-from-indexation",
    triggerKeywords: ["noindex", "robots", "x-robots", "indexable", "blocked", "sitemap", "robots.txt"],
    title: "Pages blocked from indexation",
    procedureSteps: [
      "Confirm the blocking signal: meta robots, X-Robots-Tag, robots.txt, canonical, or HTTP status.",
      "Determine whether the block is intentional.",
      "If unintentional, recommend the smallest template or page-level change.",
      "Validate with a fresh crawl after the change.",
    ],
  },
  {
    id: "thin-content-weak-landing-page-content",
    triggerKeywords: ["thin content", "content", "landing page", "weak", "copy", "low word count", "intent", "query"],
    title: "Thin content / weak landing page content",
    procedureSteps: [
      "Confirm weak content from page evidence, query mismatch, or low coverage.",
      "Identify missing buyer questions, proof, comparison, FAQ, and next-step content.",
      "Tie content recommendations to a target page and intent.",
      "Mark demand confidence low if GSC or rank evidence is unavailable.",
    ],
  },
  {
    id: "structured-data-missing",
    triggerKeywords: ["schema", "structured data", "json-ld", "product schema", "faq schema", "breadcrumbs"],
    title: "Structured data missing",
    procedureSteps: [
      "Confirm whether structured data is absent or incomplete from Lighthouse/crawler evidence.",
      "Choose schema types that match the visible page content.",
      "Do not recommend markup for content that is not visible to users.",
      "Validate with a rich results or schema validator after implementation.",
    ],
  },
];
