import type { HtmlAnalysisInput, KeywordAlignmentField, PageEvidence, SeoSignalConflict } from "./types";

const TAG_ATTRIBUTE_PATTERN = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const NON_CONTENT_PATTERN = /<(?:script|style|noscript|template)\b[^>]{0,16384}>[\s\S]*?<\/(?:script|style|noscript|template)\s*>/gi;
const RAW_TEXT_BLOCK_PATTERN = /<!--[\s\S]*?-->|<(script|style|template|noscript)\b[^>]{0,16384}>[\s\S]*?<\/\1\s*>/gi;
const HTML_ENTITY_PATTERN = /&(?:amp|lt|gt|quot|apos|nbsp|#39|#x27|#X27|#\d+|#x[\da-f]+|#X[\dA-F]+);/g;

function decodeEntities(value: string): string {
  return value.replace(HTML_ENTITY_PATTERN, (entity) => {
    const lower = entity.toLowerCase();
    const named: Record<string, string> = {
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&quot;": '"',
      "&apos;": "'",
      "&nbsp;": " ",
      "&#39;": "'",
      "&#x27;": "'",
    };
    if (named[lower]) return named[lower];
    const numeric = lower.startsWith("&#x")
      ? Number.parseInt(lower.slice(3, -1), 16)
      : Number.parseInt(lower.slice(2, -1), 10);
    if (!Number.isFinite(numeric)) return entity;
    try {
      return String.fromCodePoint(numeric);
    } catch {
      return entity;
    }
  });
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const source = tag.slice(1, -1).slice(0, 16_384);
  TAG_ATTRIBUTE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_ATTRIBUTE_PATTERN.exec(source))) {
    const name = match[1].toLowerCase();
    if (name === "meta" || name === "link" || name === "a" || name === "img" || name === "script") {
      continue;
    }
    if (!(name in attributes)) {
      attributes[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
    }
  }
  return attributes;
}

function tags(html: string, tagName: string): string[] {
  const pattern = new RegExp(`<${tagName}\\b[^>]{0,16384}>`, "gi");
  return html.match(pattern) ?? [];
}

function textContent(value: string): string {
  return decodeEntities(value.replace(/<[^>]{0,16384}>/g, " ").replace(/\s+/g, " ")).trim();
}

function firstMetaValue(html: string, key: string): string | undefined {
  for (const tag of tags(html, "meta")) {
    const attributes = parseAttributes(tag);
    if ((attributes.name ?? "").toLowerCase() === key || (attributes.property ?? "").toLowerCase() === key) {
      const value = textContent(attributes.content ?? "");
      if (value) return value;
    }
  }
  return undefined;
}

function headerValues(headers: HtmlAnalysisInput["headers"], key: string): string[] {
  const values: string[] = [];
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (name.toLowerCase() !== key) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === "string" && item.trim()) values.push(item.trim());
    }
  }
  return values;
}

function resolveHttpUrl(value: string, baseUrl: string): string | undefined {
  const raw = decodeEntities(value).trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return sanitizeEvidenceUrl(url.toString());
  } catch {
    return undefined;
  }
}

/** Normalize an ephemeral comparison identity without persisting query-bearing URLs. */
function resolveComparisonHttpUrl(value: string, baseUrl?: string): string | undefined {
  const raw = decodeEntities(value).trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.username = "";
    url.password = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

/** Keep only safe, stable URL identity in persisted evidence. */
function sanitizeEvidenceUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function isUrlMetadataKey(key: string): boolean {
  if (key === "og:url") return true;
  if (/^og:(?:image|video|audio)(?::(?:url|secure_url))?$/.test(key)) return true;
  if (/^twitter:image(?::src)?$/.test(key)) return true;
  if (/^twitter:player(?::stream)?$/.test(key)) return true;
  return /^twitter:app:url(?::[^:]+)?$/.test(key);
}

function collectMetadata(html: string, prefix: string, baseUrl: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const tag of tags(html, "meta")) {
    const attributes = parseAttributes(tag);
    const key = (attributes.property ?? attributes.name ?? "").toLowerCase();
    if (!key.startsWith(prefix)) continue;
    const rawValue = textContent(attributes.content ?? "");
    const value = isUrlMetadataKey(key) ? resolveHttpUrl(rawValue, baseUrl) : rawValue;
    if (value && !(key in result)) result[key] = value;
  }
  return result;
}

function getBodyText(html: string): string {
  const body = /<body\b[^>]{0,16384}>([\s\S]*?)<\/body\s*>/i.exec(html)?.[1] ?? html;
  return textContent(body.replace(NON_CONTENT_PATTERN, " ").replace(/<!--[\s\S]*?-->/g, " "));
}

function maskRawTextBlocks(html: string): string {
  const masked = html.replace(RAW_TEXT_BLOCK_PATTERN, " ");
  return masked
    .replace(/<!--[\s\S]*$/gi, " ")
    .replace(/<(?:script|style|template|noscript)\b[^>]{0,16384}>[\s\S]*$/gi, " ");
}

function normalizeSchemaType(value: string): string | undefined {
  const type = value.trim();
  if (!type) return undefined;
  if (/^https?:\/\//i.test(type)) return sanitizeEvidenceUrl(type);
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(type)) return undefined;
  return type;
}

function getSchemaTypes(value: unknown, output: string[], seen: Set<string>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) getSchemaTypes(item, output, seen);
    return;
  }
  const object = value as Record<string, unknown>;
  const type = object["@type"];
  for (const item of Array.isArray(type) ? type : [type]) {
    if (typeof item !== "string") continue;
    const normalized = normalizeSchemaType(item);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      output.push(normalized);
    }
  }
  for (const item of Object.values(object)) getSchemaTypes(item, output, seen);
}

function collectSchema(html: string): { types: string[]; errors: string[] } {
  const types: string[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  const scripts = new RegExp(
    `<script\\b[^>]{0,16384}\\btype\\s*=\\s*(?:"application/ld\\+json[^\"]*"|'application/ld\\+json[^']*'|application/ld\\+json)[^>]{0,16384}>([\\s\\S]*?)<\\/script\\s*>`,
    "gi"
  );
  let match: RegExpExecArray | null;
  while ((match = scripts.exec(html))) {
    const source = decodeEntities(match[1].trim());
    try {
      getSchemaTypes(JSON.parse(source), types, seen);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`JSON-LD parse error: ${message}`);
    }
  }
  return { types, errors };
}

export type HtmlAnalysisOptions = {
  /** Maximum distinct HTTP(S) links retained in page evidence. Omit for legacy unbounded analysis. */
  maxLinks?: number;
  /** Maximum same-origin links retained in page evidence. */
  maxInternalLinks?: number;
  /** Maximum cross-origin links retained in page evidence. */
  maxExternalLinks?: number;
  /** Requested report keywords used only for an explicit on-page token-presence heuristic. */
  keywords?: string[];
  /** Receives each unique normalized same-origin link before link evidence limits apply. */
  onDiscoveredInternalUrl?: (url: string) => void;
};

function linkLimit(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value ?? 0)) : fallback;
}

function collectLinks(
  html: string,
  finalUrl: string,
  limits: { total: number; internal: number; external: number },
  onDiscoveredInternalUrl?: (url: string) => void
): { links: string[]; internal: string[]; external: string[]; truncated: boolean; omitted: number } {
  let base: URL;
  try {
    base = new URL(finalUrl);
  } catch {
    return { links: [], internal: [], external: [], truncated: false, omitted: 0 };
  }
  const links: string[] = [];
  const internal: string[] = [];
  const external: string[] = [];
  const retained = new Set<string>();
  const observedInternal = new Set<string>();
  let omitted = 0;
  const linkTags = /<a\b[^>]{0,16384}>/gi;
  let tag: RegExpExecArray | null;
  while ((tag = linkTags.exec(html))) {
    const href = parseAttributes(tag[0]).href;
    const normalized = href ? resolveHttpUrl(href, base.toString()) : undefined;
    if (!normalized) continue;
    const isInternal = new URL(normalized).origin === base.origin;
    if (isInternal && !observedInternal.has(normalized)) {
      observedInternal.add(normalized);
      onDiscoveredInternalUrl?.(normalized);
    }
    if (retained.has(normalized)) continue;
    const category = isInternal ? internal : external;
    const categoryLimit = isInternal ? limits.internal : limits.external;
    if (links.length >= limits.total || category.length >= categoryLimit) {
      omitted += 1;
      continue;
    }
    retained.add(normalized);
    links.push(normalized);
    category.push(normalized);
  }
  return { links, internal, external, truncated: omitted > 0, omitted };
}

function collectImages(html: string): { total: number; missingAlt: number } {
  let missingAlt = 0;
  const imageTags = tags(html, "img");
  for (const tag of imageTags) {
    const alt = parseAttributes(tag).alt;
    if (alt === undefined || !alt.trim()) missingAlt += 1;
  }
  return { total: imageTags.length, missingAlt };
}

function collectHeadings(html: string): PageEvidence["headings"] {
  const headings = {} as NonNullable<PageEvidence["headings"]>;
  for (let level = 1; level <= 6; level += 1) {
    const pattern = new RegExp(`<h${level}\\b[^>]{0,16384}>([\\s\\S]*?)<\\/h${level}\\s*>`, "gi");
    headings[`h${level}` as keyof typeof headings] = Array.from(html.matchAll(pattern), (match) => textContent(match[1]));
  }
  return headings;
}

function hasRobotsDirective(value: string | undefined, directive: "index" | "noindex" | "follow" | "nofollow"): boolean {
  if (!value) return false;
  return new RegExp(`(?:^|[,;:\\s])${directive}(?:$|[,;\\s])`, "i").test(value);
}

function signalConflicts(input: {
  status: number;
  finalUrl: string;
  canonical?: string;
  canonicalTargets: string[];
  hreflang: Array<{ language: string; url: string }>;
  metaRobots?: string;
  xRobotsTag?: string;
}): SeoSignalConflict[] {
  const conflicts: SeoSignalConflict[] = [];
  if ((hasRobotsDirective(input.metaRobots, "index") && hasRobotsDirective(input.xRobotsTag, "noindex"))
    || (hasRobotsDirective(input.metaRobots, "noindex") && hasRobotsDirective(input.xRobotsTag, "index"))) {
    conflicts.push({ code: "robots_index_disagreement", category: "robots" });
  }
  if ((hasRobotsDirective(input.metaRobots, "follow") && hasRobotsDirective(input.xRobotsTag, "nofollow"))
    || (hasRobotsDirective(input.metaRobots, "nofollow") && hasRobotsDirective(input.xRobotsTag, "follow"))) {
    conflicts.push({ code: "robots_follow_disagreement", category: "robots" });
  }
  if (input.canonical && input.finalUrl && input.canonical !== input.finalUrl) {
    conflicts.push({ code: "canonical_differs_from_final", category: "canonical" });
  }
  if (input.canonical && (input.status < 200 || input.status >= 300)) {
    conflicts.push({ code: "canonical_on_non_2xx", category: "canonical" });
  }
  if (new Set(input.canonicalTargets).size > 1) {
    conflicts.push({ code: "multiple_canonical_targets", category: "canonical" });
  }
  const targetsByLanguage = new Map<string, Set<string>>();
  for (const item of input.hreflang) {
    const language = item.language.toLocaleLowerCase("en-US");
    const targets = targetsByLanguage.get(language) ?? new Set<string>();
    targets.add(item.url);
    targetsByLanguage.set(language, targets);
  }
  if ([...targetsByLanguage.values()].some((targets) => targets.size > 1)) {
    conflicts.push({ code: "hreflang_language_has_multiple_targets", category: "hreflang" });
  }
  return conflicts;
}

const LEGACY_CONFLICT_MESSAGES: Record<SeoSignalConflict["code"], string> = {
  robots_index_disagreement: "Meta robots and X-Robots-Tag disagree on index/noindex.",
  robots_follow_disagreement: "Meta robots and X-Robots-Tag disagree on follow/nofollow.",
  canonical_differs_from_final: "Canonical points away from the crawled final URL.",
  canonical_on_non_2xx: "Canonical is present on a non-2xx response.",
  multiple_canonical_targets: "Multiple canonical targets are declared.",
  hreflang_language_has_multiple_targets: "A hreflang language is mapped to multiple targets.",
};

function normalizedTokens(value: string): string[] {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Transparent token-presence heuristic; it never claims semantic relevance or search intent fit. */
export function measureKeywordTopicAlignment(
  page: Pick<PageEvidence, "title" | "description" | "headings">,
  keywords: string[] | undefined
): NonNullable<PageEvidence["keywordAlignment"]> {
  const method = "normalized_token_presence" as const;
  const note = "A bounded heuristic checks normalized keyword tokens in title, description, and H1; it is not a relevance judgment.";
  if (keywords === undefined) {
    return { state: "not_measured", method, checkedKeywords: 0, matches: [], unmatchedKeywords: [], note: "Keyword inputs were not supplied; topic alignment was not measured." };
  }
  const uniqueKeywords: string[] = [];
  const seen = new Set<string>();
  for (const rawKeyword of keywords) {
    const keyword = String(rawKeyword || "").trim();
    const key = keyword.normalize("NFKC").toLocaleLowerCase("en-US");
    if (keyword && !seen.has(key)) {
      seen.add(key);
      uniqueKeywords.push(keyword);
    }
  }
  if (!uniqueKeywords.length) {
    return { state: "no_keywords", method, checkedKeywords: 0, matches: [], unmatchedKeywords: [], note: "No requested keywords were supplied; topic alignment was not measured." };
  }

  const fieldValues: Array<[KeywordAlignmentField, string]> = [
    ["title", page.title || ""],
    ["description", page.description || ""],
    ["h1", page.headings?.h1?.join(" ") || ""],
  ];
  if (!fieldValues.some(([, value]) => normalizedTokens(value).length > 0)) {
    return { state: "not_measured", method, checkedKeywords: uniqueKeywords.length, matches: [], unmatchedKeywords: uniqueKeywords, note: "Title, description, and H1 evidence was unavailable; topic alignment was not measured." };
  }
  const tokenSets = new Map(fieldValues.map(([field, value]) => [field, new Set(normalizedTokens(value))]));
  const matches: NonNullable<PageEvidence["keywordAlignment"]>["matches"] = [];
  const unmatchedKeywords: string[] = [];
  for (const keyword of uniqueKeywords) {
    const tokens = normalizedTokens(keyword);
    const fields = fieldValues
      .map(([field]) => field)
      .filter((field) => tokens.length > 0 && tokens.every((token) => tokenSets.get(field)?.has(token)));
    if (fields.length) matches.push({ keyword, fields });
    else unmatchedKeywords.push(keyword);
  }
  return { state: "measured", method, checkedKeywords: uniqueKeywords.length, matches, unmatchedKeywords, note };
}

/** Extract on-page SEO evidence without requiring a DOM or parser dependency. */
export function analyzeHtmlPage(input: HtmlAnalysisInput, options: HtmlAnalysisOptions = {}): PageEvidence {
  const requestedUrl = sanitizeEvidenceUrl(input.requestedUrl) ?? "";
  const finalUrl = sanitizeEvidenceUrl(input.finalUrl) ?? "";
  const evidenceHtml = maskRawTextBlocks(input.html);
  const contentType = headerValues(input.headers, "content-type")[0];
  const metaRobots = firstMetaValue(evidenceHtml, "robots");
  const xRobotsValues = headerValues(input.headers, "x-robots-tag");
  const xRobotsTag = xRobotsValues.length ? xRobotsValues.join(", ") : undefined;
  const robotsValues = [metaRobots, ...xRobotsValues].filter(
    (value): value is string => Boolean(value)
  );
  const robots = robotsValues.length ? robotsValues.join(", ") : undefined;
  const baseUrl = finalUrl || requestedUrl;
  const comparisonBaseUrl = resolveComparisonHttpUrl(input.finalUrl)
    ?? resolveComparisonHttpUrl(input.requestedUrl);
  const canonicalTags = tags(evidenceHtml, "link").filter((tag) => {
    const attributes = parseAttributes(tag);
    return (attributes.rel ?? "").toLowerCase().split(/\s+/).includes("canonical");
  });
  const canonicalTargets = canonicalTags.flatMap((tag) => {
    const attributes = parseAttributes(tag);
    const target = resolveHttpUrl(attributes.href ?? "", baseUrl);
    return target ? [target] : [];
  });
  const comparisonCanonicalTargets = canonicalTags.flatMap((tag) => {
    const attributes = parseAttributes(tag);
    const target = comparisonBaseUrl
      ? resolveComparisonHttpUrl(attributes.href ?? "", comparisonBaseUrl)
      : undefined;
    return target ? [target] : [];
  });
  const canonical = canonicalTargets[0];
  const hreflang: Array<{ language: string; url: string }> = [];
  const comparisonHreflang: Array<{ language: string; url: string }> = [];
  for (const tag of tags(evidenceHtml, "link")) {
    const attributes = parseAttributes(tag);
    if (!(attributes.rel ?? "").toLowerCase().split(/\s+/).includes("alternate")) continue;
    const language = attributes.hreflang?.trim();
    const url = attributes.href ? resolveHttpUrl(attributes.href, baseUrl) : undefined;
    const comparisonUrl = attributes.href && comparisonBaseUrl
      ? resolveComparisonHttpUrl(attributes.href, comparisonBaseUrl)
      : undefined;
    if (language && url) hreflang.push({ language, url });
    if (language && comparisonUrl) comparisonHreflang.push({ language, url: comparisonUrl });
  }
  const schema = collectSchema(input.html);
  const sharedLimit = linkLimit(options.maxLinks, Number.POSITIVE_INFINITY);
  const internalLimit = linkLimit(options.maxInternalLinks, sharedLimit);
  const externalLimit = linkLimit(options.maxExternalLinks, sharedLimit);
  const totalLimit = options.maxLinks === undefined && Number.isFinite(internalLimit) && Number.isFinite(externalLimit)
    ? internalLimit + externalLimit
    : sharedLimit;
  const links = collectLinks(
    evidenceHtml,
    baseUrl,
    { total: totalLimit, internal: internalLimit, external: externalLimit },
    options.onDiscoveredInternalUrl
  );
  const bodyText = getBodyText(evidenceHtml);
  const wordCount = bodyText.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  const images = collectImages(evidenceHtml);
  const titleMatch = /<title\b[^>]{0,16384}>([\s\S]*?)<\/title\s*>/i.exec(evidenceHtml);
  const title = titleMatch ? textContent(titleMatch[1]) || undefined : undefined;
  const description = firstMetaValue(evidenceHtml, "description");
  const headings = collectHeadings(evidenceHtml);
  const indexable = input.status >= 200 && input.status < 300 && !hasRobotsDirective(robots, "noindex");
  const conflicts = signalConflicts({
    status: input.status,
    finalUrl: comparisonBaseUrl ?? finalUrl,
    canonical: comparisonCanonicalTargets[0] ?? canonical,
    canonicalTargets: comparisonCanonicalTargets,
    hreflang: comparisonHreflang,
    metaRobots,
    xRobotsTag,
  });
  const keywordAlignment = measureKeywordTopicAlignment({ title, description, headings }, options.keywords);

  return {
    requestedUrl,
    finalUrl,
    status: input.status,
    contentType,
    title,
    titleLength: title?.length,
    description,
    descriptionLength: description?.length,
    metaRobots,
    xRobotsTag,
    robots,
    canonical,
    hreflang,
    headings,
    links: links.links,
    internalLinks: links.internal,
    externalLinks: links.external,
    linksTruncated: links.truncated || undefined,
    omittedLinkCount: links.truncated ? links.omitted : undefined,
    schemaTypes: schema.types,
    schemaErrors: schema.errors,
    openGraph: collectMetadata(evidenceHtml, "og:", baseUrl),
    twitterCards: collectMetadata(evidenceHtml, "twitter:", baseUrl),
    images,
    wordCount,
    indexable,
    signalConflicts: conflicts,
    indexabilityConflicts: conflicts.map((conflict) => LEGACY_CONFLICT_MESSAGES[conflict.code]),
    keywordAlignment,
  };
}
