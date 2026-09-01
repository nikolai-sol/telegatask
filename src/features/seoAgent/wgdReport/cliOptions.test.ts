import { describe, expect, test } from "vitest";
import { parseWgdCliOptions } from "./cliOptions";

describe("parseWgdCliOptions", () => {
  test("normalizes a Russian report and skips DataForSEO", () => {
    const options = parseWgdCliOptions([
      "--url", "flowerlife-school.com",
      "--market", "RU",
      "--language", "ru",
      "--keyword", "цветок жизни школа",
    ]);
    expect(options.url).toBe("https://flowerlife-school.com/");
    expect(options.domain).toBe("flowerlife-school.com");
    expect(options.region).toBe("225");
    expect(options.sources.dataForSeo).toBe("not_applicable");
    expect(options.keywords).toEqual(["цветок жизни школа"]);
  });

  test("rejects non-http input", () => {
    expect(() => parseWgdCliOptions(["--url", "file:///tmp/a"])).toThrow("HTTP or HTTPS");
  });

  test.each([
    "http://127.0.0.1/",
    "http://10.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://service.local/",
  ])("rejects a literal or special-name non-public target: %s", (url) => {
    expect(() => parseWgdCliOptions(["--url", url])).toThrow("public internet");
  });

  test("rejects credentials embedded in the report URL", () => {
    expect(() => parseWgdCliOptions(["--url", "https://user:password@example.com/"])).toThrow(
      "credentials"
    );
  });

  test("rejects sensitive query parameters in a priority URL", () => {
    expect(() => parseWgdCliOptions([
      "--url", "https://example.com/",
      "--priority-url", "https://example.com/about?api_key=secret",
    ])).toThrow("credentials");
  });

  test("rejects an unlisted credential query parameter in a priority URL", () => {
    expect(() => parseWgdCliOptions([
      "--url", "https://example.com/",
      "--priority-url", "https://example.com/about?oauth_token=secret",
    ])).toThrow("query parameters");
  });

  test("rejects any query string on the primary URL", () => {
    expect(() => parseWgdCliOptions([
      "--url", "https://example.com/?utm_source=newsletter",
    ])).toThrow("query parameters");
  });

  test("rejects any query string on a priority URL", () => {
    expect(() => parseWgdCliOptions([
      "--url", "https://example.com/",
      "--priority-url", "https://example.com/about?section=seo",
    ])).toThrow("query parameters");
  });

  test("keeps repeated evidence inputs ordered and applies bounded defaults", () => {
    expect(parseWgdCliOptions([
      "--url", "https://example.com",
      "--keyword", "one",
      "--keyword", "two",
      "--ai-query", "where to start",
      "--ai-query", "what to fix",
      "--priority-url", "example.com/about",
    ])).toMatchObject({
      crawlLimit: 100,
      lighthousePageLimit: 6,
      outDir: "reports",
      keywords: ["one", "two"],
      aiQueries: ["where to start", "what to fix"],
      priorityUrls: ["https://example.com/about"],
    });
  });

  test("deduplicates keyword and AI inputs case-insensitively while preserving first spelling", () => {
    expect(parseWgdCliOptions([
      "--url", "https://example.com/",
      "--keyword", "  Search Term  ",
      "--keyword", "search term",
      "--ai-query", "What is Example?",
      "--ai-query", "what is example?",
    ])).toMatchObject({
      keywords: ["Search Term"],
      aiQueries: ["What is Example?"],
    });
  });

  test("rejects provider inputs above documented count and length budgets", () => {
    const keywords = Array.from({ length: 51 }, (_, index) => ["--keyword", `keyword ${index}`]).flat();
    const aiQueries = Array.from({ length: 21 }, (_, index) => ["--ai-query", `query ${index}`]).flat();
    expect(() => parseWgdCliOptions(["--url", "https://example.com/", ...keywords]))
      .toThrow("--keyword may be provided at most 50 times");
    expect(() => parseWgdCliOptions(["--url", "https://example.com/", ...aiQueries]))
      .toThrow("--ai-query may be provided at most 20 times");
    expect(() => parseWgdCliOptions([
      "--url", "https://example.com/", "--keyword", "k".repeat(201),
    ])).toThrow("--keyword must be at most 200 characters");
    expect(() => parseWgdCliOptions([
      "--url", "https://example.com/", "--ai-query", "q".repeat(1001),
    ])).toThrow("--ai-query must be at most 1000 characters");
  });

  test("accepts the configured crawl and Lighthouse page ceilings", () => {
    expect(parseWgdCliOptions([
      "--url", "https://example.com/",
      "--crawl-limit", "100",
      "--lighthouse-page-limit", "6",
    ])).toMatchObject({ crawlLimit: 100, lighthousePageLimit: 6 });
  });

  test("rejects crawl and Lighthouse page limits above their ceilings", () => {
    expect(() => parseWgdCliOptions([
      "--url", "https://example.com/",
      "--crawl-limit", "101",
    ])).toThrow("at most 100");
    expect(() => parseWgdCliOptions([
      "--url", "https://example.com/",
      "--lighthouse-page-limit", "7",
    ])).toThrow("at most 6");
  });
});
