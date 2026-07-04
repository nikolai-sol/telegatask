import { execFileSync } from "child_process";
import { cleanNumber, cleanString, readLighthouseScore, type LighthouseSummary } from "../zarukuWgdRunnerHelpers";
import type { ZarukuSeoProductionConfig } from "../zarukuSeoProductionConfig";

type LighthouseExecOptions = {
  encoding: "utf8";
  maxBuffer: number;
};

export type LighthouseExec = (file: string, args: string[], options: LighthouseExecOptions) => string;

const lighthouseArgs = (url: string): string[] => [
  "lighthouse",
  url,
  "--quiet",
  "--output=json",
  "--output-path=stdout",
  "--preset=desktop",
  "--throttling-method=provided",
  "--only-categories=performance,accessibility,best-practices,seo",
  "--chrome-flags=--headless=new --no-sandbox --disable-gpu",
];

const lighthouseExecOptions: LighthouseExecOptions = {
  encoding: "utf8",
  maxBuffer: 40 * 1024 * 1024,
};

function defaultLighthouseExec(file: string, args: string[], options: LighthouseExecOptions): string {
  return execFileSync(file, args, options);
}

export function collectLocalLighthouse(
  config: Pick<ZarukuSeoProductionConfig, "targetUrl">,
  execImpl: LighthouseExec = defaultLighthouseExec
): LighthouseSummary {
  const url = config.targetUrl;
  try {
    const raw = execImpl("npx", lighthouseArgs(url), lighthouseExecOptions);
    const payload = JSON.parse(raw) as {
      finalDisplayedUrl?: string;
      categories?: Record<string, { score?: number } | undefined>;
      audits?: Record<string, { numericValue?: number; displayValue?: string } | undefined>;
    };
    const categories = payload.categories || {};
    const audits = payload.audits || {};
    return {
      status: "success",
      message: "Local Lighthouse desktop/provided completed successfully",
      pageUrl: payload.finalDisplayedUrl || url,
      performanceScore: readLighthouseScore(categories, "performance"),
      accessibilityScore: readLighthouseScore(categories, "accessibility"),
      bestPracticesScore: readLighthouseScore(categories, "best-practices"),
      seoScore: readLighthouseScore(categories, "seo"),
      firstContentfulPaintMs: cleanNumber(audits["first-contentful-paint"]?.numericValue),
      largestContentfulPaintMs: cleanNumber(audits["largest-contentful-paint"]?.numericValue),
      cumulativeLayoutShift: cleanNumber(audits["cumulative-layout-shift"]?.numericValue),
      totalBlockingTimeMs: cleanNumber(audits["total-blocking-time"]?.numericValue),
      speedIndexMs: cleanNumber(audits["speed-index"]?.numericValue),
      totalByteWeight: cleanString(audits["total-byte-weight"]?.displayValue) || null,
    };
  } catch (err) {
    return {
      status: "failed",
      message: err instanceof Error ? err.message : "Local Lighthouse failed",
      pageUrl: url,
      performanceScore: null,
      accessibilityScore: null,
      bestPracticesScore: null,
      seoScore: null,
      firstContentfulPaintMs: null,
      largestContentfulPaintMs: null,
      cumulativeLayoutShift: null,
      totalBlockingTimeMs: null,
      speedIndexMs: null,
      totalByteWeight: null,
    };
  }
}
