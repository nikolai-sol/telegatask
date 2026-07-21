export type MetrikaSectionRule = {
  section: string;
  urlIncludes: readonly string[];
};

export type MetrikaSectionTrafficRow = {
  url: string;
  visits: number;
  users: number;
  pageDepth: number;
  avgVisitDurationSeconds: number;
  bounceRate: number;
  searchEngine: string | null;
};

export type MetrikaSectionTrafficSection = {
  section: string;
  visits: number;
  users: number;
  avgPageDepth: number;
  avgVisitDurationSeconds: number;
  bounceRate: number;
  organic: {
    yandex: number;
    google: number;
    other: number;
  };
  sampleUrls: string[];
};

export type MetrikaSectionTrafficReport = {
  schemaVersion: "seo_os_metrika_section_traffic_v1";
  status: "available" | "unavailable";
  generatedAt: string;
  weekKey: string;
  domain: string;
  requestCount: number;
  summary: {
    totalVisits: number;
    totalUsers: number;
    sectionsWithTraffic: number;
  };
  sections: MetrikaSectionTrafficSection[];
  unavailableReason: string | null;
};

type MutableSection = {
  section: string;
  visits: number;
  users: number;
  weightedPageDepth: number;
  weightedDuration: number;
  weightedBounceRate: number;
  organic: {
    yandex: number;
    google: number;
    other: number;
  };
  sampleUrls: Set<string>;
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.pathname || "/";
  } catch {
    return value;
  }
}

function matchesRule(pathOrUrl: string, rule: MetrikaSectionRule): boolean {
  const path = normalizeUrl(pathOrUrl);
  return rule.urlIncludes.some((part) => {
    const needle = cleanString(part);
    return needle && path.includes(needle);
  });
}

function sectionForUrl(url: string, rules: readonly MetrikaSectionRule[]): string | null {
  const sorted = [...rules].sort((a, b) => {
    const aLength = Math.max(...a.urlIncludes.map((item) => item.length), 0);
    const bLength = Math.max(...b.urlIncludes.map((item) => item.length), 0);
    return bLength - aLength;
  });
  return sorted.find((rule) => matchesRule(url, rule))?.section || null;
}

function organicBucket(searchEngine: string | null): keyof MetrikaSectionTrafficSection["organic"] {
  const engine = cleanString(searchEngine).toLowerCase();
  if (engine.includes("yandex") || engine.includes("яндекс")) return "yandex";
  if (engine.includes("google") || engine.includes("гугл")) return "google";
  return "other";
}

export function buildMetrikaSectionTrafficReport(input: {
  generatedAt: string;
  weekKey: string;
  domain: string;
  sectionRules: readonly MetrikaSectionRule[];
  rows: readonly MetrikaSectionTrafficRow[];
  requestCount?: number;
  unavailableReason?: string | null;
}): MetrikaSectionTrafficReport {
  if (input.unavailableReason) {
    return {
      schemaVersion: "seo_os_metrika_section_traffic_v1",
      status: "unavailable",
      generatedAt: input.generatedAt,
      weekKey: input.weekKey,
      domain: input.domain,
      requestCount: input.requestCount || 0,
      summary: {
        totalVisits: 0,
        totalUsers: 0,
        sectionsWithTraffic: 0,
      },
      sections: [],
      unavailableReason: input.unavailableReason,
    };
  }

  const bySection = new Map<string, MutableSection>();
  for (const row of input.rows) {
    const url = cleanString(row.url);
    const section = sectionForUrl(url, input.sectionRules);
    if (!section) continue;
    const visits = cleanNumber(row.visits);
    if (visits <= 0) continue;
    const users = cleanNumber(row.users);
    const current = bySection.get(section) || {
      section,
      visits: 0,
      users: 0,
      weightedPageDepth: 0,
      weightedDuration: 0,
      weightedBounceRate: 0,
      organic: {
        yandex: 0,
        google: 0,
        other: 0,
      },
      sampleUrls: new Set<string>(),
    };
    current.visits += visits;
    current.users += users;
    current.weightedPageDepth += cleanNumber(row.pageDepth) * visits;
    current.weightedDuration += cleanNumber(row.avgVisitDurationSeconds) * visits;
    current.weightedBounceRate += cleanNumber(row.bounceRate) * visits;
    current.organic[organicBucket(row.searchEngine)] += visits;
    if (current.sampleUrls.size < 5) current.sampleUrls.add(url);
    bySection.set(section, current);
  }

  const sections = Array.from(bySection.values())
    .map((section) => ({
      section: section.section,
      visits: section.visits,
      users: section.users,
      avgPageDepth: rounded(section.weightedPageDepth / section.visits),
      avgVisitDurationSeconds: rounded(section.weightedDuration / section.visits),
      bounceRate: rounded(section.weightedBounceRate / section.visits),
      organic: section.organic,
      sampleUrls: Array.from(section.sampleUrls),
    }))
    .sort((a, b) => {
      const visitsDiff = b.visits - a.visits;
      if (visitsDiff) return visitsDiff;
      return a.section.localeCompare(b.section);
    });

  return {
    schemaVersion: "seo_os_metrika_section_traffic_v1",
    status: "available",
    generatedAt: input.generatedAt,
    weekKey: input.weekKey,
    domain: input.domain,
    requestCount: input.requestCount || 0,
    summary: {
      totalVisits: sections.reduce((sum, section) => sum + section.visits, 0),
      totalUsers: sections.reduce((sum, section) => sum + section.users, 0),
      sectionsWithTraffic: sections.length,
    },
    sections,
    unavailableReason: null,
  };
}
