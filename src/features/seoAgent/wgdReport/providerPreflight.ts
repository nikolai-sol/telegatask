import type { SourceCoverage, WgdReportOptions } from "./types";

export type ProviderPreflightEnv = Partial<Record<
  | "DATAFORSEO_AUTH_BASE64"
  | "DATAFORSEO_LOGIN"
  | "DATAFORSEO_PASSWORD"
  | "YANDEX_SEARCH_API_KEY"
  | "YANDEX_SEARCH_FOLDER_ID"
  | "YANDEX_GEN_SEARCH_IAM_TOKEN"
  | "YANDEX_GEN_SEARCH_API_KEY"
  | "YANDEX_GEN_SEARCH_FOLDER_ID"
  | "YANDEX_WEBMASTER_OAUTH_TOKEN"
  | "YANDEX_WEBMASTER_REFRESH_TOKEN"
  | "YANDEX_WEBMASTER_CLIENT_ID"
  | "YANDEX_WEBMASTER_CLIENT_SECRET"
  | "GSC_ENABLED"
  | "GSC_SITE_URL"
  | "SEO_REPORT_GSC_TEAM_ID"
  | "GOOGLE_OAUTH_CLIENT_ID"
  | "GOOGLE_OAUTH_CLIENT_SECRET",
  string | undefined
>>;

export type ProviderPreflightDeps = {
  checkDataForSeo?: (signal?: AbortSignal) => Promise<boolean>;
  checkYandexHost?: (domain: string, signal?: AbortSignal) => Promise<boolean>;
  checkGscProperty?: (domain: string, signal?: AbortSignal) => Promise<boolean>;
  accessCheckTimeoutMs?: number;
  now?: () => Date;
};

export const PROVIDER_PREFLIGHT_TIMEOUT_MS = 30_000;

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasDataForSeoCredentials(env: ProviderPreflightEnv): boolean {
  return Boolean(clean(env.DATAFORSEO_AUTH_BASE64) || (clean(env.DATAFORSEO_LOGIN) && clean(env.DATAFORSEO_PASSWORD)));
}

function hasYandexSearchCredentials(env: ProviderPreflightEnv): boolean {
  return Boolean(clean(env.YANDEX_SEARCH_API_KEY) && clean(env.YANDEX_SEARCH_FOLDER_ID));
}

function hasYandexAiCredentials(env: ProviderPreflightEnv): boolean {
  const auth = clean(env.YANDEX_GEN_SEARCH_IAM_TOKEN) || clean(env.YANDEX_GEN_SEARCH_API_KEY);
  const folder = clean(env.YANDEX_GEN_SEARCH_FOLDER_ID) || clean(env.YANDEX_SEARCH_FOLDER_ID);
  return Boolean(auth && folder);
}

function hasYandexWebmasterCredentials(env: ProviderPreflightEnv): boolean {
  if (clean(env.YANDEX_WEBMASTER_OAUTH_TOKEN)) return true;
  return Boolean(
    clean(env.YANDEX_WEBMASTER_REFRESH_TOKEN) &&
      clean(env.YANDEX_WEBMASTER_CLIENT_ID) &&
      clean(env.YANDEX_WEBMASTER_CLIENT_SECRET)
  );
}

function coverage(
  id: string,
  label: string,
  state: SourceCoverage["state"],
  message: string,
  checkedAt: string
): SourceCoverage {
  return { id, label, state, message, checkedAt };
}

function boundedTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return PROVIDER_PREFLIGHT_TIMEOUT_MS;
  return Math.min(PROVIDER_PREFLIGHT_TIMEOUT_MS, Math.max(1, Math.floor(value!)));
}

async function safeAccessCheck(
  check: ((signal: AbortSignal) => Promise<boolean>) | undefined,
  timeoutMs: number
): Promise<"granted" | "denied" | "failed"> {
  if (!check) return "denied";
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("provider preflight deadline"));
    }, boundedTimeout(timeoutMs));
  });
  try {
    return (await Promise.race([
      Promise.resolve().then(() => check(controller.signal)),
      deadline,
    ])) ? "granted" : "denied";
  } catch {
    return "failed";
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}

/**
 * Classify provider availability without exposing credentials or provider error
 * bodies. Property checks are injected so callers can reuse the existing
 * Yandex Webmaster and GSC sources at their own authenticated boundary.
 */
export async function preflightProviders(
  options: WgdReportOptions,
  env: ProviderPreflightEnv,
  deps: ProviderPreflightDeps = {}
): Promise<SourceCoverage[]> {
  const checkedAt = (deps.now?.() || new Date()).toISOString();
  const accessCheckTimeoutMs = boundedTimeout(deps.accessCheckTimeoutMs);
  const rows: SourceCoverage[] = [];
  const russianProfile = options.market === "RU" || options.language.toLowerCase() === "ru";

  if (russianProfile || options.sources.dataForSeo === "not_applicable") {
    rows.push(coverage(
      "dataforseo",
      "DataForSEO",
      "not_applicable",
      "DataForSEO is not used for the Russian market profile.",
      checkedAt
    ));
  } else if (!hasDataForSeoCredentials(env)) {
    rows.push(coverage("dataforseo", "DataForSEO", "unavailable", "DataForSEO credentials are not configured.", checkedAt));
  } else {
    const state = await safeAccessCheck((signal) => deps.checkDataForSeo!(signal), accessCheckTimeoutMs);
    rows.push(coverage(
      "dataforseo",
      "DataForSEO",
      state === "granted" ? "success" : "unavailable",
      state === "granted" ? "DataForSEO is available." : "DataForSEO availability could not be confirmed.",
      checkedAt
    ));
  }

  rows.push(hasYandexSearchCredentials(env)
    ? coverage("yandex_search", "Yandex Search API", "success", "Yandex Search API credentials are configured.", checkedAt)
    : coverage("yandex_search", "Yandex Search API", "unavailable", "Yandex Search API credentials are not configured.", checkedAt));

  rows.push(hasYandexAiCredentials(env)
    ? coverage("alice_ai", "Alice AI sample", "success", "Yandex generative search credentials are configured.", checkedAt)
    : coverage("alice_ai", "Alice AI sample", "unavailable", "Yandex generative search credentials are not configured.", checkedAt));

  if (!hasYandexWebmasterCredentials(env)) {
    rows.push(coverage(
      "yandex_webmaster",
      "Yandex Webmaster",
      "owner_access_required",
      "Verified Yandex Webmaster owner access is required for this domain.",
      checkedAt
    ));
  } else {
    const state = await safeAccessCheck(
      (signal) => deps.checkYandexHost?.(options.domain, signal) ?? Promise.resolve(false),
      accessCheckTimeoutMs
    );
    rows.push(coverage(
      "yandex_webmaster",
      "Yandex Webmaster",
      state === "granted" ? "success" : state === "failed" ? "unavailable" : "owner_access_required",
      state === "granted"
        ? "Verified Yandex Webmaster host access was confirmed."
        : state === "failed"
          ? "Yandex Webmaster host access could not be checked safely."
          : "Credentials are present, but verified host access is required for this domain.",
      checkedAt
    ));
  }

  const gscState = await safeAccessCheck(
    (signal) => deps.checkGscProperty?.(options.domain, signal) ?? Promise.resolve(false),
    accessCheckTimeoutMs
  );
  rows.push(coverage(
    "gsc",
    "Google Search Console",
    gscState === "granted" ? "success" : gscState === "failed" ? "unavailable" : "owner_access_required",
    gscState === "granted"
      ? "Verified Google Search Console property access was confirmed."
      : gscState === "failed"
        ? "Google Search Console property access could not be checked safely."
        : "Verified Google Search Console owner access is required for this domain.",
    checkedAt
  ));

  return rows;
}
