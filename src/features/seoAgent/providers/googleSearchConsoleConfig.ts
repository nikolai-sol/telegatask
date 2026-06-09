import crypto from "crypto";
import type { SeoSearchConsoleSnapshot } from "../types";
import { SeoProviderNotConfiguredError } from "./seoDataProvider";

type GoogleSearchConsoleBaseConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  dateRangeDays: number;
  configuredSiteUrls: string[];
};

type GoogleSearchConsoleRuntimeConfig = GoogleSearchConsoleBaseConfig & {
  refreshToken: string;
  siteUrl: string;
};

type GoogleSearchConsoleOAuthState = {
  siteUrl: string;
  teamId: string;
  companyId: string;
  ts: number;
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parsePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(String(value || "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed);
}

function parseSiteUrls(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePropertyDomain(siteUrl: string): string {
  const trimmed = cleanString(siteUrl);
  if (!trimmed) return "";
  if (trimmed.startsWith("sc-domain:")) {
    return trimmed.slice("sc-domain:".length).trim().toLowerCase();
  }

  try {
    const url = new URL(trimmed);
    return url.hostname.trim().toLowerCase();
  } catch {
    return trimmed
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .trim()
      .toLowerCase();
  }
}

function normalizeRequestedDomain(domain: string): string {
  const trimmed = cleanString(domain);
  if (trimmed.startsWith("sc-domain:")) {
    return trimmed.slice("sc-domain:".length).trim().toLowerCase();
  }
  return trimmed
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase();
}

export function readGoogleSearchConsoleBaseConfig(): GoogleSearchConsoleBaseConfig {
  const enabled = cleanString(process.env.GSC_ENABLED).toLowerCase();
  if (enabled !== "true") {
    throw new SeoProviderNotConfiguredError("Google Search Console source is not configured yet");
  }

  const configuredSiteUrls = Array.from(
    new Set([
      ...parseSiteUrls(process.env.GSC_SITE_URLS),
      ...parseSiteUrls(process.env.GSC_SITE_URL),
    ])
  );
  const clientId = cleanString(process.env.GOOGLE_OAUTH_CLIENT_ID);
  const clientSecret = cleanString(process.env.GOOGLE_OAUTH_CLIENT_SECRET);
  const redirectUri = cleanString(process.env.GOOGLE_OAUTH_REDIRECT_URI);
  const dateRangeDays = parsePositiveInteger(process.env.GSC_DEFAULT_DATE_RANGE_DAYS, 28);

  if (!clientId || !clientSecret || !redirectUri) {
    throw new SeoProviderNotConfiguredError("Google Search Console OAuth credentials are not configured yet");
  }

  return {
    configuredSiteUrls,
    clientId,
    clientSecret,
    redirectUri,
    dateRangeDays,
  };
}

export function resolveConfiguredGscSiteUrl(requestedDomain: string): string {
  const { configuredSiteUrls } = readGoogleSearchConsoleBaseConfig();
  const normalizedRequested = normalizeRequestedDomain(requestedDomain);
  if (!normalizedRequested) return configuredSiteUrls[0] || "";

  const exactMatch = configuredSiteUrls.find(
    (siteUrl) => normalizePropertyDomain(siteUrl) === normalizedRequested
  );
  if (exactMatch) return exactMatch;

  const suffixMatch = configuredSiteUrls.find((siteUrl) => {
    const propertyDomain = normalizePropertyDomain(siteUrl);
    return (
      propertyDomain === normalizedRequested ||
      propertyDomain.endsWith(`.${normalizedRequested}`) ||
      normalizedRequested.endsWith(`.${propertyDomain}`)
    );
  });
  if (suffixMatch) return suffixMatch;

  const requested = cleanString(requestedDomain);
  if (requested.startsWith("sc-domain:") || /^https?:\/\//i.test(requested)) return requested;
  if (normalizedRequested) return `sc-domain:${normalizedRequested}`;

  throw new SeoProviderNotConfiguredError(
    `Google Search Console property is not configured for domain ${requestedDomain}`
  );
}

export function readGoogleSearchConsoleRuntimeConfig(input: {
  requestedDomain: string;
  refreshToken: string;
  siteUrlOverride?: string | null;
}): GoogleSearchConsoleRuntimeConfig {
  const baseConfig = readGoogleSearchConsoleBaseConfig();
  const refreshToken = cleanString(input.refreshToken);
  const siteUrl = cleanString(input.siteUrlOverride) || resolveConfiguredGscSiteUrl(input.requestedDomain);

  if (!refreshToken) {
    throw new SeoProviderNotConfiguredError("Google Search Console refresh token is not configured yet");
  }

  return {
    ...baseConfig,
    refreshToken,
    siteUrl,
  };
}

export function formatGscDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildGscDateRange(days: number): SeoSearchConsoleSnapshot["dateRange"] {
  const end = new Date();
  end.setDate(end.getDate() - 3);
  const start = new Date(end);
  start.setDate(end.getDate() - Math.max(1, days - 1));

  return {
    startDate: formatGscDate(start),
    endDate: formatGscDate(end),
    days,
  };
}

function encodeStatePayload(payload: GoogleSearchConsoleOAuthState): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeStatePayload(payload: string): GoogleSearchConsoleOAuthState {
  const raw = Buffer.from(payload, "base64url").toString("utf8");
  const parsed = JSON.parse(raw) as Partial<GoogleSearchConsoleOAuthState>;
  return {
    siteUrl: cleanString(parsed.siteUrl),
    teamId: cleanString(parsed.teamId),
    companyId: cleanString(parsed.companyId),
    ts: Number(parsed.ts || 0),
  };
}

function buildStateSignature(payload: string, clientSecret: string): string {
  return crypto.createHmac("sha256", clientSecret).update(payload).digest("base64url");
}

export function buildGoogleSearchConsoleAuthState(siteUrl: string, teamId: string, companyId: string): string {
  const { clientSecret } = readGoogleSearchConsoleBaseConfig();
  const payload = encodeStatePayload({
    siteUrl,
    teamId,
    companyId,
    ts: Date.now(),
  });
  return `${payload}.${buildStateSignature(payload, clientSecret)}`;
}

export function parseGoogleSearchConsoleAuthState(state: string): GoogleSearchConsoleOAuthState {
  const { clientSecret } = readGoogleSearchConsoleBaseConfig();
  const [payload, signature] = String(state || "").split(".");
  if (!payload || !signature) {
    throw new SeoProviderNotConfiguredError("Invalid Google Search Console OAuth state");
  }
  const expected = buildStateSignature(payload, clientSecret);
  if (signature !== expected) {
    throw new SeoProviderNotConfiguredError("Invalid Google Search Console OAuth state signature");
  }

  const parsed = decodeStatePayload(payload);
  if (!parsed.siteUrl || !parsed.teamId || !parsed.companyId || !parsed.ts) {
    throw new SeoProviderNotConfiguredError("Invalid Google Search Console OAuth state payload");
  }
  if (Date.now() - parsed.ts > 15 * 60 * 1000) {
    throw new SeoProviderNotConfiguredError("Google Search Console OAuth state expired");
  }
  return parsed;
}

export function buildGoogleSearchConsoleAuthUrl(siteUrl: string, teamId: string, companyId: string): string {
  const { clientId, redirectUri } = readGoogleSearchConsoleBaseConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    state: buildGoogleSearchConsoleAuthState(siteUrl, teamId, companyId),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
