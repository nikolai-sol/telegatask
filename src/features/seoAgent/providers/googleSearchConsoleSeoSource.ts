import { getStoredGscCredential } from "../gscCredentialRepository";
import type { SeoSearchConsoleSnapshot } from "../types";
import {
  buildGscDateRange,
  parsePositiveInteger,
  readGoogleSearchConsoleRuntimeConfig,
} from "./googleSearchConsoleConfig";
import { SeoProviderError, SeoProviderNotConfiguredError } from "./seoDataProvider";
import {
  fetchBoundedProviderText,
  ProviderBodyLimitError,
  ProviderDeadlineError,
} from "./boundedProviderHttp";

type GoogleSearchConsoleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type GoogleSearchConsoleQueryRow = {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
};

type GoogleSearchConsoleQueryResponse = {
  rows?: GoogleSearchConsoleQueryRow[];
};

export type GoogleSearchConsoleDailyQueryFact = {
  reportDate: string;
  query: string;
  page: string;
  country: string;
  device: string;
  impressions: number;
  clicks: number;
  ctr: number | null;
  position: number | null;
};

type GoogleSearchConsoleSiteEntry = {
  siteUrl?: string;
  permissionLevel?: string;
};

type GoogleSearchConsoleSitesResponse = {
  siteEntry?: GoogleSearchConsoleSiteEntry[];
};

export const OWNER_PROVIDER_REQUEST_TIMEOUT_MS = 15_000;
export const OWNER_PROVIDER_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export type GoogleSearchConsoleSourceDeps = {
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
};

type OwnerHttpContext = {
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  requestTimeoutMs: number;
  maxResponseBytes: number;
  signal?: AbortSignal;
};

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boundedDependencyValue(value: number | undefined, maximum: number): number {
  if (!Number.isFinite(value)) return maximum;
  return Math.min(maximum, Math.max(1, Math.floor(value!)));
}

function failureReason(error: unknown): string {
  if (error instanceof ProviderDeadlineError) return "deadline";
  if (error instanceof ProviderBodyLimitError) return "body_limit";
  return "transport";
}

async function ownerRequest(
  context: OwnerHttpContext,
  url: string,
  init: RequestInit,
  category: string,
  safeMessage: string
): Promise<{ response: Response; text: string }> {
  try {
    return await fetchBoundedProviderText(
      context.fetchImpl,
      url,
      { ...init, ...(context.signal ? { signal: context.signal } : {}) },
      { timeoutMs: context.requestTimeoutMs, maximumBytes: context.maxResponseBytes }
    );
  } catch (error) {
    throw new SeoProviderError({
      category,
      safeMessage,
      statusCode: 502,
      internalCause: { reason: failureReason(error) },
    });
  }
}

function parseJson<T>(text: string, category: string, safeMessage: string): T {
  try {
    return JSON.parse(text || "{}") as T;
  } catch {
    throw new SeoProviderError({ category, safeMessage, statusCode: 502 });
  }
}

async function exchangeRefreshTokenForAccessToken(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}, context: OwnerHttpContext): Promise<string> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    refresh_token: input.refreshToken,
    grant_type: "refresh_token",
  });

  const { response, text } = await ownerRequest(context, "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  }, "gsc_auth", "Google Search Console token refresh failed");

  const json = parseJson<GoogleSearchConsoleTokenResponse>(text, "gsc_auth", "Google Search Console token refresh failed");
  if (!response.ok || !json.access_token) {
    throw new SeoProviderError({
      category: "gsc_auth",
      statusCode: 502,
      safeMessage: "Google Search Console token refresh failed",
      internalCause: {
        status: response.status,
      },
    });
  }

  return json.access_token;
}

async function runSearchAnalyticsQuery(input: {
  accessToken: string;
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions: string[];
  rowLimit: number;
}, context: OwnerHttpContext): Promise<GoogleSearchConsoleQueryRow[]> {
  const encodedSiteUrl = encodeURIComponent(input.siteUrl);
  const { response, text } = await ownerRequest(
    context,
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodedSiteUrl}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: input.startDate,
        endDate: input.endDate,
        dimensions: input.dimensions,
        rowLimit: input.rowLimit,
      }),
    },
    "gsc_query",
    "Google Search Console query failed"
  );

  if (!response.ok) {
    throw new SeoProviderError({
      category: "gsc_query",
      statusCode: 502,
      safeMessage: "Google Search Console query failed",
      internalCause: {
        status: response.status,
        siteUrl: input.siteUrl,
        dimensions: input.dimensions,
      },
    });
  }

  const json = parseJson<GoogleSearchConsoleQueryResponse>(text, "gsc_query", "Google Search Console returned invalid data");
  return Array.isArray(json.rows) ? json.rows : [];
}

async function listVerifiedSites(accessToken: string, context: OwnerHttpContext): Promise<string[]> {
  const { response, text } = await ownerRequest(context, "https://searchconsole.googleapis.com/webmasters/v3/sites", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }, "gsc_sites", "Google Search Console sites lookup failed");

  if (!response.ok) {
    throw new SeoProviderError({
      category: "gsc_sites",
      statusCode: 502,
      safeMessage: "Google Search Console sites lookup failed",
      internalCause: {
        status: response.status,
      },
    });
  }

  const json = parseJson<GoogleSearchConsoleSitesResponse>(text, "gsc_sites", "Google Search Console returned invalid data");
  return (json.siteEntry || [])
    .map((entry) => (typeof entry.siteUrl === "string" ? entry.siteUrl.trim() : ""))
    .filter(Boolean);
}

function buildSummaryMetrics(rows: GoogleSearchConsoleQueryRow[]): Pick<
  SeoSearchConsoleSnapshot,
  "clicks" | "impressions" | "ctr" | "averagePosition"
> {
  let clicks = 0;
  let impressions = 0;
  let weightedPosition = 0;

  for (const row of rows) {
    const rowClicks = safeNumber(row.clicks) ?? 0;
    const rowImpressions = safeNumber(row.impressions) ?? 0;
    const rowPosition = safeNumber(row.position) ?? 0;
    clicks += rowClicks;
    impressions += rowImpressions;
    weightedPosition += rowPosition * rowImpressions;
  }

  const ctr = impressions > 0 ? (clicks / impressions) * 100 : null;
  const averagePosition = impressions > 0 ? weightedPosition / impressions : null;

  return {
    clicks: clicks || null,
    impressions: impressions || null,
    ctr,
    averagePosition,
  };
}

function extractTopDimensionValues(rows: GoogleSearchConsoleQueryRow[]): string[] {
  return rows
    .map((row) => (Array.isArray(row.keys) && typeof row.keys[0] === "string" ? row.keys[0].trim() : ""))
    .filter(Boolean);
}

function dailyFactFromRow(reportDate: string, row: GoogleSearchConsoleQueryRow): GoogleSearchConsoleDailyQueryFact | null {
  const keys = Array.isArray(row.keys) ? row.keys : [];
  const query = typeof keys[0] === "string" ? keys[0].trim() : "";
  const page = typeof keys[1] === "string" ? keys[1].trim() : "";
  const country = typeof keys[2] === "string" ? keys[2].trim() : "";
  const device = typeof keys[3] === "string" ? keys[3].trim() : "";
  if (!query || !page || !country || !device) return null;
  return {
    reportDate,
    query,
    page,
    country,
    device,
    impressions: safeNumber(row.impressions) ?? 0,
    clicks: safeNumber(row.clicks) ?? 0,
    ctr: safeNumber(row.ctr),
    position: safeNumber(row.position),
  };
}

export class GoogleSearchConsoleSeoSource {
  private readonly fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  private readonly requestTimeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(deps: GoogleSearchConsoleSourceDeps = {}) {
    this.fetchImpl = deps.fetchImpl || ((url, init) => fetch(url, init));
    this.requestTimeoutMs = boundedDependencyValue(deps.requestTimeoutMs, OWNER_PROVIDER_REQUEST_TIMEOUT_MS);
    this.maxResponseBytes = boundedDependencyValue(deps.maxResponseBytes, OWNER_PROVIDER_MAX_RESPONSE_BYTES);
  }

  private http(signal?: AbortSignal): OwnerHttpContext {
    return {
      fetchImpl: this.fetchImpl,
      requestTimeoutMs: this.requestTimeoutMs,
      maxResponseBytes: this.maxResponseBytes,
      ...(signal ? { signal } : {}),
    };
  }

  async getSnapshot(
    domain: string,
    options: { teamId: string; siteUrl?: string | null; refreshTokenOverride?: string },
    signal?: AbortSignal
  ): Promise<SeoSearchConsoleSnapshot> {
    const http = this.http(signal);
    const storedCredential = await getStoredGscCredential(options.teamId);
    const refreshToken =
      options?.refreshTokenOverride ||
      storedCredential?.refreshToken ||
      "";
    const config = readGoogleSearchConsoleRuntimeConfig({
      requestedDomain: domain,
      refreshToken,
      siteUrlOverride: options.siteUrl,
    });
    if (!storedCredential?.verifiedSiteUrls.includes(config.siteUrl) && !options.refreshTokenOverride) {
      throw new SeoProviderNotConfiguredError(
        `Google Search Console Team credential does not have access to selected property ${config.siteUrl}`
      );
    }
    const dateRange = buildGscDateRange(config.dateRangeDays);
    const accessToken = await exchangeRefreshTokenForAccessToken({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: config.refreshToken,
    }, http);

    const queryRows = await runSearchAnalyticsQuery({
      accessToken,
      siteUrl: config.siteUrl,
      startDate: dateRange.startDate || "",
      endDate: dateRange.endDate || "",
      dimensions: ["query"],
      rowLimit: 10,
    }, http);
    const pageRows = await runSearchAnalyticsQuery({
      accessToken,
      siteUrl: config.siteUrl,
      startDate: dateRange.startDate || "",
      endDate: dateRange.endDate || "",
      dimensions: ["page"],
      rowLimit: 10,
    }, http);
    const countryRows = await runSearchAnalyticsQuery({
      accessToken,
      siteUrl: config.siteUrl,
      startDate: dateRange.startDate || "",
      endDate: dateRange.endDate || "",
      dimensions: ["country"],
      rowLimit: 10,
    }, http);
    const deviceRows = await runSearchAnalyticsQuery({
      accessToken,
      siteUrl: config.siteUrl,
      startDate: dateRange.startDate || "",
      endDate: dateRange.endDate || "",
      dimensions: ["device"],
      rowLimit: 10,
    }, http);

    const summary = buildSummaryMetrics(queryRows);

    return {
      property: config.siteUrl,
      siteUrl: config.siteUrl,
      dateRange,
      clicks: summary.clicks,
      impressions: summary.impressions,
      ctr: summary.ctr,
      averagePosition: summary.averagePosition,
      topQueries: extractTopDimensionValues(queryRows),
      topPages: extractTopDimensionValues(pageRows),
      countries: extractTopDimensionValues(countryRows),
      devices: extractTopDimensionValues(deviceRows),
    };
  }

  async getDailyQueryFacts(
    domain: string,
    options: {
      teamId: string;
      siteUrl?: string | null;
      refreshTokenOverride?: string;
      reportDate: string;
      rowLimit?: number;
    }
  ): Promise<GoogleSearchConsoleDailyQueryFact[]> {
    const http = this.http();
    const storedCredential = await getStoredGscCredential(options.teamId);
    const refreshToken =
      options?.refreshTokenOverride ||
      storedCredential?.refreshToken ||
      "";
    const config = readGoogleSearchConsoleRuntimeConfig({
      requestedDomain: domain,
      refreshToken,
      siteUrlOverride: options.siteUrl,
    });
    if (!storedCredential?.verifiedSiteUrls.includes(config.siteUrl) && !options.refreshTokenOverride) {
      throw new SeoProviderNotConfiguredError(
        `Google Search Console Team credential does not have access to selected property ${config.siteUrl}`
      );
    }
    const accessToken = await exchangeRefreshTokenForAccessToken({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: config.refreshToken,
    }, http);
    const reportDate = options.reportDate.slice(0, 10);
    const rows = await runSearchAnalyticsQuery({
      accessToken,
      siteUrl: config.siteUrl,
      startDate: reportDate,
      endDate: reportDate,
      dimensions: ["query", "page", "country", "device"],
      rowLimit: options.rowLimit || 25000,
    }, http);
    return rows
      .map((row) => dailyFactFromRow(reportDate, row))
      .filter((row): row is GoogleSearchConsoleDailyQueryFact => Boolean(row));
  }

  async smokeTest(domain: string, options: { teamId: string; siteUrl?: string | null; refreshTokenOverride?: string }): Promise<{
    snapshot: SeoSearchConsoleSnapshot;
    verifiedSiteUrls: string[];
  }> {
    const http = this.http();
    const storedCredential = await getStoredGscCredential(options.teamId);
    const refreshToken =
      options?.refreshTokenOverride ||
      storedCredential?.refreshToken ||
      "";
    const config = readGoogleSearchConsoleRuntimeConfig({
      requestedDomain: domain,
      refreshToken,
      siteUrlOverride: options.siteUrl,
    });
    const accessToken = await exchangeRefreshTokenForAccessToken({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: config.refreshToken,
    }, http);
    const verifiedSiteUrls = await listVerifiedSites(accessToken, http);
    if (!verifiedSiteUrls.includes(config.siteUrl)) {
      throw new SeoProviderNotConfiguredError(
        `Google Search Console account does not have access to configured property ${config.siteUrl}`
      );
    }

    return {
      snapshot: await this.getSnapshot(domain, { ...options, refreshTokenOverride: refreshToken }),
      verifiedSiteUrls,
    };
  }

  static getPlannedDateRange(): SeoSearchConsoleSnapshot["dateRange"] {
    const days = parsePositiveInteger(process.env.GSC_DEFAULT_DATE_RANGE_DAYS, 28);
    return buildGscDateRange(days);
  }
}
