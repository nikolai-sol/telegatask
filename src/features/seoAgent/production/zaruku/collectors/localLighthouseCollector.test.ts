import { describe, expect, test } from "vitest";
import { zarukuSeoProductionConfig } from "../zarukuSeoProductionConfig";
import { collectLocalLighthouse, type LighthouseExec } from "./localLighthouseCollector";

describe("collectLocalLighthouse", () => {
  test("returns the current lighthouse output contract from fixture process output", () => {
    const execImpl: LighthouseExec = (file, args, options) => {
      expect(file).toBe("npx");
      expect(args).toEqual([
        "lighthouse",
        "https://zaruku.ru/",
        "--quiet",
        "--output=json",
        "--output-path=stdout",
        "--preset=desktop",
        "--throttling-method=provided",
        "--only-categories=performance,accessibility,best-practices,seo",
        "--chrome-flags=--headless=new --no-sandbox --disable-gpu",
      ]);
      expect(options).toEqual({
        encoding: "utf8",
        maxBuffer: 40 * 1024 * 1024,
      });
      return JSON.stringify({
        finalDisplayedUrl: "https://zaruku.ru/",
        categories: {
          performance: { score: 0.76 },
          accessibility: { score: 0.88 },
          "best-practices": { score: 0.73 },
          seo: { score: 1 },
        },
        audits: {
          "first-contentful-paint": { numericValue: 1328.111 },
          "largest-contentful-paint": { numericValue: 2164.696 },
          "cumulative-layout-shift": { numericValue: 0.011184224073467084 },
          "total-blocking-time": { numericValue: 0 },
          "speed-index": { numericValue: 4649 },
          "total-byte-weight": { displayValue: "Total size was 5,147 KiB" },
        },
      });
    };

    expect(collectLocalLighthouse(zarukuSeoProductionConfig, execImpl)).toEqual({
      status: "success",
      message: "Local Lighthouse desktop/provided completed successfully",
      pageUrl: "https://zaruku.ru/",
      performanceScore: 76,
      accessibilityScore: 88,
      bestPracticesScore: 73,
      seoScore: 100,
      firstContentfulPaintMs: 1328.111,
      largestContentfulPaintMs: 2164.696,
      cumulativeLayoutShift: 0.011184224073467084,
      totalBlockingTimeMs: 0,
      speedIndexMs: 4649,
      totalByteWeight: "Total size was 5,147 KiB",
    });
  });

  test("preserves missing metric behavior as null values", () => {
    const execImpl: LighthouseExec = () => JSON.stringify({});

    expect(collectLocalLighthouse(zarukuSeoProductionConfig, execImpl)).toEqual({
      status: "success",
      message: "Local Lighthouse desktop/provided completed successfully",
      pageUrl: "https://zaruku.ru/",
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
    });
  });

  test("preserves current failure fallback without running Lighthouse", () => {
    const execImpl: LighthouseExec = () => {
      throw new Error("Lighthouse failed");
    };

    expect(collectLocalLighthouse(zarukuSeoProductionConfig, execImpl)).toEqual({
      status: "failed",
      message: "Lighthouse failed",
      pageUrl: "https://zaruku.ru/",
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
    });
  });
});
