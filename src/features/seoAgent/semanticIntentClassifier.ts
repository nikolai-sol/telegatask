export type SeoSemanticIntentClass =
  | "drug_compliance"
  | "competitor_brand"
  | "own_brand"
  | "facility_navigational"
  | "medical_informational"
  | "supportive_trust"
  | "off_mission";

export type SeoSemanticIntentClassifierConfig = {
  ownBrandTokens: readonly string[];
  competitorBrandTokens: readonly string[];
  drugComplianceTokens: readonly string[];
  facilityTokens: readonly string[];
  facilityGeoTokens: readonly string[];
  medicalTokens: readonly string[];
  supportiveTokens: readonly string[];
  targetIntentClasses: readonly SeoSemanticIntentClass[];
};

export type SeoSemanticIntentMatchedTokens = {
  ownBrandTokens: string[];
  competitorBrandTokens: string[];
  drugComplianceTokens: string[];
  facilityTokens: string[];
  facilityGeoTokens: string[];
  medicalTokens: string[];
  supportiveTokens: string[];
};

export type SeoSemanticIntentClassification = {
  query: string;
  normalizedQuery: string;
  intentClass: SeoSemanticIntentClass;
  matchedTokens: SeoSemanticIntentMatchedTokens;
  isTarget: boolean;
  rule: string;
};

// Conflict order from SEO OS Chapter 6.3:
// drug_compliance > competitor_brand > own_brand > facility_navigational >
// medical_informational > supportive_trust > off_mission.
export const SEMANTIC_INTENT_CLASS_PRIORITY: readonly SeoSemanticIntentClass[] = [
  "drug_compliance",
  "competitor_brand",
  "own_brand",
  "facility_navigational",
  "medical_informational",
  "supportive_trust",
  "off_mission",
];

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeSemanticIntentText(value: unknown): string {
  return cleanString(value)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenMatches(normalizedQuery: string, token: string): boolean {
  const normalizedToken = normalizeSemanticIntentText(token);
  if (!normalizedQuery || !normalizedToken) return false;
  return ` ${normalizedQuery} `.includes(` ${normalizedToken} `);
}

function matchedTokens(normalizedQuery: string, tokens: readonly string[]): string[] {
  const matches: string[] = [];
  for (const token of tokens) {
    if (tokenMatches(normalizedQuery, token) && !matches.includes(token)) {
      matches.push(token);
    }
  }
  return matches;
}

function emptyMatchedTokens(): SeoSemanticIntentMatchedTokens {
  return {
    ownBrandTokens: [],
    competitorBrandTokens: [],
    drugComplianceTokens: [],
    facilityTokens: [],
    facilityGeoTokens: [],
    medicalTokens: [],
    supportiveTokens: [],
  };
}

export function isTargetSemanticIntentClass(
  intentClass: SeoSemanticIntentClass,
  config: SeoSemanticIntentClassifierConfig
): boolean {
  return config.targetIntentClasses.includes(intentClass);
}

export function classifySemanticIntent(
  queryInput: unknown,
  config: SeoSemanticIntentClassifierConfig
): SeoSemanticIntentClassification {
  const query = cleanString(queryInput);
  const normalizedQuery = normalizeSemanticIntentText(query);
  const matched: SeoSemanticIntentMatchedTokens = {
    ...emptyMatchedTokens(),
    ownBrandTokens: matchedTokens(normalizedQuery, config.ownBrandTokens),
    competitorBrandTokens: matchedTokens(normalizedQuery, config.competitorBrandTokens),
    drugComplianceTokens: matchedTokens(normalizedQuery, config.drugComplianceTokens),
    facilityTokens: matchedTokens(normalizedQuery, config.facilityTokens),
    facilityGeoTokens: matchedTokens(normalizedQuery, config.facilityGeoTokens),
    medicalTokens: matchedTokens(normalizedQuery, config.medicalTokens),
    supportiveTokens: matchedTokens(normalizedQuery, config.supportiveTokens),
  };

  let intentClass: SeoSemanticIntentClass = "off_mission";
  let rule = "unmatched";
  if (matched.drugComplianceTokens.length > 0) {
    intentClass = "drug_compliance";
    rule = "drug_compliance_token";
  } else if (matched.competitorBrandTokens.length > 0) {
    intentClass = "competitor_brand";
    rule = "competitor_brand_token";
  } else if (matched.ownBrandTokens.length > 0) {
    intentClass = "own_brand";
    rule = "own_brand_token";
  } else if (matched.facilityTokens.length > 0 && matched.facilityGeoTokens.length > 0) {
    intentClass = "facility_navigational";
    rule = "facility_token_and_geo_token";
  } else if (matched.medicalTokens.length > 0) {
    intentClass = "medical_informational";
    rule = "medical_token";
  } else if (matched.supportiveTokens.length > 0) {
    intentClass = "supportive_trust";
    rule = "supportive_token";
  }

  return {
    query,
    normalizedQuery,
    intentClass,
    matchedTokens: matched,
    isTarget: isTargetSemanticIntentClass(intentClass, config),
    rule,
  };
}
