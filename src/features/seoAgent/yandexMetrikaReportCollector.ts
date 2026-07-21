import {
  buildMetrikaSectionTrafficReport,
  type MetrikaSectionRule,
  type MetrikaSectionTrafficReport,
  type MetrikaSectionTrafficRow,
} from "./metrikaSectionTraffic";

export type YandexMetrikaReportConfig = {
  readsFlag: string;
  tokenEnvVar: string;
  counterIdEnvVar: string;
  apiEndpoint: string;
  maxRowsPerRequest: number;
  sectionUrlPatterns: readonly MetrikaSectionRule[];
};

export type YandexMetrikaRawSnapshot = {
  schemaVersion: "seo_os_metrika_raw_snapshot_v1";
  generatedAt: string;
  weekKey: string;
  domain: string;
  status: "available" | "unavailable";
  requestCount: number;
  request: {
    endpoint: string;
    counterIdPresent: boolean;
    date1: string;
    date2: string;
    metrics: string;
    dimensions: string;
    filters: string;
    limit: number;
  };
  response: unknown | null;
  unavailableReason: string | null;
};

export type YandexMetrikaSectionTrafficCollection = {
  report: MetrikaSectionTrafficReport;
  rawSnapshot: YandexMetrikaRawSnapshot;
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function metric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function mondayOfIsoWeek(year: number, week: number): Date {
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const day = simple.getUTCDay() || 7;
  if (day <= 4) {
    simple.setUTCDate(simple.getUTCDate() - day + 1);
  } else {
    simple.setUTCDate(simple.getUTCDate() + 8 - day);
  }
  return simple;
}

export function weekKeyToDateRange(weekKey: string): { date1: string; date2: string } {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!match) throw new Error(`Invalid weekKey: ${weekKey}`);
  const monday = mondayOfIsoWeek(Number(match[1]), Number(match[2]));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    date1: monday.toISOString().slice(0, 10),
    date2: sunday.toISOString().slice(0, 10),
  };
}

function unavailable(input: {
  generatedAt: string;
  weekKey: string;
  domain: string;
  config: YandexMetrikaReportConfig;
  date1: string;
  date2: string;
  reason: string;
  requestCount?: number;
}): YandexMetrikaSectionTrafficCollection {
  const requestCount = input.requestCount || 0;
  const request = {
    endpoint: input.config.apiEndpoint,
    counterIdPresent: false,
    date1: input.date1,
    date2: input.date2,
    metrics: "ym:s:visits,ym:s:users,ym:s:pageDepth,ym:s:avgVisitDurationSeconds,ym:s:bounceRate",
    dimensions: "ym:s:startURL,ym:s:lastsignSearchEngine",
    filters: "ym:s:lastsignTrafficSource=='organic'",
    limit: input.config.maxRowsPerRequest,
  };
  return {
    report: buildMetrikaSectionTrafficReport({
      generatedAt: input.generatedAt,
      weekKey: input.weekKey,
      domain: input.domain,
      sectionRules: input.config.sectionUrlPatterns,
      rows: [],
      requestCount,
      unavailableReason: input.reason,
    }),
    rawSnapshot: {
      schemaVersion: "seo_os_metrika_raw_snapshot_v1",
      generatedAt: input.generatedAt,
      weekKey: input.weekKey,
      domain: input.domain,
      status: "unavailable",
      requestCount,
      request,
      response: null,
      unavailableReason: input.reason,
    },
  };
}

function parseRows(response: unknown): MetrikaSectionTrafficRow[] {
  const data = response && typeof response === "object" ? (response as { data?: unknown }).data : null;
  if (!Array.isArray(data)) return [];
  return data.map((item) => {
    const row = item && typeof item === "object" ? item as { dimensions?: unknown; metrics?: unknown } : {};
    const dimensions = Array.isArray(row.dimensions) ? row.dimensions : [];
    const metrics = Array.isArray(row.metrics) ? row.metrics : [];
    const urlDimension = dimensions[0] && typeof dimensions[0] === "object" ? dimensions[0] as { name?: unknown } : {};
    const searchEngineDimension = dimensions[1] && typeof dimensions[1] === "object"
      ? dimensions[1] as { name?: unknown }
      : {};
    return {
      url: cleanString(urlDimension.name),
      visits: metric(metrics[0]),
      users: metric(metrics[1]),
      pageDepth: metric(metrics[2]),
      avgVisitDurationSeconds: metric(metrics[3]),
      bounceRate: metric(metrics[4]),
      searchEngine: cleanString(searchEngineDimension.name) || null,
    };
  });
}

export async function collectYandexMetrikaSectionTraffic(input: {
  generatedAt: string;
  weekKey: string;
  domain: string;
  config: YandexMetrikaReportConfig;
  env?: Record<string, string | undefined>;
}): Promise<YandexMetrikaSectionTrafficCollection> {
  const env = input.env || process.env;
  const { date1, date2 } = weekKeyToDateRange(input.weekKey);
  if (env[input.config.readsFlag] !== "1") {
    return unavailable({
      generatedAt: input.generatedAt,
      weekKey: input.weekKey,
      domain: input.domain,
      config: input.config,
      date1,
      date2,
      reason: `${input.config.readsFlag} is not enabled.`,
    });
  }
  const token = cleanString(env[input.config.tokenEnvVar]);
  const counterId = cleanString(env[input.config.counterIdEnvVar]);
  if (!token || !counterId) {
    return unavailable({
      generatedAt: input.generatedAt,
      weekKey: input.weekKey,
      domain: input.domain,
      config: input.config,
      date1,
      date2,
      reason: `${input.config.tokenEnvVar} and ${input.config.counterIdEnvVar} are required for Metrika reads.`,
    });
  }

  const url = new URL(input.config.apiEndpoint);
  url.searchParams.set("ids", counterId);
  url.searchParams.set("date1", date1);
  url.searchParams.set("date2", date2);
  url.searchParams.set("metrics", "ym:s:visits,ym:s:users,ym:s:pageDepth,ym:s:avgVisitDurationSeconds,ym:s:bounceRate");
  url.searchParams.set("dimensions", "ym:s:startURL,ym:s:lastsignSearchEngine");
  url.searchParams.set("filters", "ym:s:lastsignTrafficSource=='organic'");
  url.searchParams.set("limit", String(input.config.maxRowsPerRequest));
  url.searchParams.set("accuracy", "full");

  try {
    const response = await fetch(url, {
      headers: {
        authorization: `OAuth ${token}`,
      },
    });
    const json = await response.json() as unknown;
    if (!response.ok) {
      return unavailable({
        generatedAt: input.generatedAt,
        weekKey: input.weekKey,
        domain: input.domain,
        config: input.config,
        date1,
        date2,
        requestCount: 1,
        reason: `Yandex Metrika API returned ${response.status}.`,
      });
    }
    const rows = parseRows(json);
    const report = buildMetrikaSectionTrafficReport({
      generatedAt: input.generatedAt,
      weekKey: input.weekKey,
      domain: input.domain,
      sectionRules: input.config.sectionUrlPatterns,
      rows,
      requestCount: 1,
    });
    return {
      report,
      rawSnapshot: {
        schemaVersion: "seo_os_metrika_raw_snapshot_v1",
        generatedAt: input.generatedAt,
        weekKey: input.weekKey,
        domain: input.domain,
        status: "available",
        requestCount: 1,
        request: {
          endpoint: input.config.apiEndpoint,
          counterIdPresent: true,
          date1,
          date2,
          metrics: "ym:s:visits,ym:s:users,ym:s:pageDepth,ym:s:avgVisitDurationSeconds,ym:s:bounceRate",
          dimensions: "ym:s:startURL,ym:s:lastsignSearchEngine",
          filters: "ym:s:lastsignTrafficSource=='organic'",
          limit: input.config.maxRowsPerRequest,
        },
        response: json,
        unavailableReason: null,
      },
    };
  } catch (error) {
    return unavailable({
      generatedAt: input.generatedAt,
      weekKey: input.weekKey,
      domain: input.domain,
      config: input.config,
      date1,
      date2,
      requestCount: 1,
      reason: String((error as Error)?.message || error),
    });
  }
}
