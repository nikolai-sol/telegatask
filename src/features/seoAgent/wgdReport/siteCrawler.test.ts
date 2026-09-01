import { describe, expect, test, vi } from "vitest";
import {
  MAX_HTML_BODY_BYTES,
  MAX_ROBOTS_BODY_BYTES,
  MAX_SITEMAP_BODY_BYTES,
  crawlSite,
  fetchWithTimeout,
  isMutationPath,
  type CrawlSiteDependencies,
} from "./siteCrawler";
import type { DnsResolver } from "./networkSafety";

type FakeResponse = {
  status: number;
  url?: string;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
  text?: () => Promise<string>;
};

const PUBLIC_DNS: DnsResolver = async () => [{ address: "93.184.216.34", family: 4 }];

function bodyStream(body: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(body);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (bytes.length) controller.enqueue(bytes);
      controller.close();
    },
  });
}

function html(status: number, body: string, url?: string): FakeResponse {
  return response(status, body, "text/html; charset=utf-8", url);
}

function response(status: number, body: string, contentType: string, url?: string): FakeResponse {
  return {
    status,
    url,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null) },
    body: bodyStream(body),
  };
}

function fakeFetch(responses: Map<string, FakeResponse>) {
  return async (url: string): Promise<FakeResponse> =>
    responses.get(url) ?? response(404, "not found", "text/plain", url);
}

function fakeDeps(responses: Map<string, FakeResponse>): CrawlSiteDependencies {
  return { fetch: fakeFetch(responses), resolveDns: PUBLIC_DNS };
}

describe("crawlSite", () => {
  test("records YandexBot robots access for checked content URLs", async () => {
    const result = await crawlSite(
      {
        startUrl: "https://example.com/",
        priorityUrls: ["https://example.com/private"],
        robotsUserAgent: "YandexBot",
        limit: 2,
        concurrency: 1,
        timeoutMs: 1_000,
      },
      fakeDeps(new Map([
        ["https://example.com/robots.txt", response(200, "User-agent: YandexBot\nDisallow: /private", "text/plain")],
        ["https://example.com/", html(200, "<title>Home</title>")],
        ["https://example.com/private", html(200, "<title>Private</title>")],
      ]))
    );

    expect(result.robots.access).toEqual({
      state: "measured",
      userAgent: "YandexBot",
      checkedUrlCount: 2,
      blockedUrls: ["https://example.com/private"],
    });
  });

  test.each([
    { status: 404, state: "measured" },
    { status: 410, state: "measured" },
    { status: 500, state: "unavailable" },
  ] as const)("records robots access as $state for status $status", async ({ status, state }) => {
    const result = await crawlSite(
      {
        startUrl: "https://example.com/",
        robotsUserAgent: "Googlebot",
        limit: 1,
        concurrency: 1,
        timeoutMs: 1_000,
      },
      fakeDeps(new Map([
        ["https://example.com/robots.txt", response(status, "", "text/plain")],
        ["https://example.com/", html(200, "<title>Home</title>")],
      ]))
    );

    expect(result.robots.access).toEqual({
      state,
      userAgent: "Googlebot",
      checkedUrlCount: state === "measured" ? 1 : 0,
      blockedUrls: [],
    });
  });

  test("treats 404 robots as measured without reading an oversized body", async () => {
    const oversizedNotFound: FakeResponse = {
      status: 404,
      headers: {
        get: (name) => name.toLowerCase() === "content-length"
          ? String(MAX_ROBOTS_BODY_BYTES + 1)
          : name.toLowerCase() === "content-type"
            ? "text/plain"
            : null,
      },
      body: bodyStream("must not be read"),
    };
    const result = await crawlSite(
      {
        startUrl: "https://example.com/",
        robotsUserAgent: "Googlebot",
        limit: 1,
        concurrency: 1,
        timeoutMs: 1_000,
      },
      fakeDeps(new Map([
        ["https://example.com/robots.txt", oversizedNotFound],
        ["https://example.com/", html(200, "<title>Home</title>")],
      ]))
    );

    expect(result.robots).toMatchObject({
      status: 404,
      access: {
        state: "measured",
        userAgent: "Googlebot",
        checkedUrlCount: 1,
        blockedUrls: [],
      },
    });
  });

  test("rejects literal and DNS-resolved private targets before transport", async () => {
    const fetchImpl = vi.fn(async () => html(200, "<title>Unexpected</title>"));
    const publicResolver: DnsResolver = async () => [{ address: "93.184.216.34", family: 4 }];
    await expect(crawlSite(
      { startUrl: "http://127.0.0.1/", limit: 1, concurrency: 1, timeoutMs: 1_000 },
      { fetch: fetchImpl, resolveDns: publicResolver }
    )).rejects.toThrow("public internet");

    const privateResolver: DnsResolver = async () => [{ address: "10.10.0.7", family: 4 }];
    await expect(crawlSite(
      { startUrl: "https://example.com/", limit: 1, concurrency: 1, timeoutMs: 1_000 },
      { fetch: fetchImpl, resolveDns: privateResolver }
    )).rejects.toThrow("public internet");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("stops when a redirect destination re-resolves to a private address", async () => {
    let rebound = false;
    const requests: string[] = [];
    const resolveDns: DnsResolver = async () => [{
      address: rebound ? "192.168.1.20" : "93.184.216.34",
      family: 4,
    }];
    const fetchImpl = async (url: string): Promise<FakeResponse> => {
      requests.push(url);
      if (url === "https://example.com/") {
        rebound = true;
        return {
          status: 302,
          headers: { get: (name) => (name.toLowerCase() === "location" ? "/next" : "text/html") },
          body: bodyStream(""),
        };
      }
      return response(404, "not found", "text/plain", url);
    };

    const result = await crawlSite(
      { startUrl: "https://example.com/", limit: 1, concurrency: 1, timeoutMs: 1_000 },
      { fetch: fetchImpl, resolveDns }
    );

    expect(requests).not.toContain("https://example.com/next");
    expect(result.pages).toEqual([
      expect.objectContaining({ status: 0, error: "unsafe network destination" }),
    ]);
    expect(JSON.stringify(result)).not.toContain("192.168.1.20");
  });

  test("rejects an oversized declared body without calling response.text", async () => {
    const text = vi.fn(async () => "must not be read");
    const result = await fetchWithTimeout(
      async () => ({
        status: 200,
        headers: {
          get: (name: string) => name.toLowerCase() === "content-length" ? String(MAX_HTML_BODY_BYTES + 1) : "text/html",
        },
        body: new ReadableStream<Uint8Array>(),
        text,
      }),
      "https://example.com/",
      1_000,
      MAX_HTML_BODY_BYTES
    );

    expect(result).toEqual({ error: "response too large" });
    expect(text).not.toHaveBeenCalled();
  });

  test("aborts a chunked body as soon as the byte cap is exceeded", async () => {
    const chunk = new Uint8Array(Math.floor(MAX_HTML_BODY_BYTES / 2) + 1);
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const text = vi.fn(async () => "must not be read");
    const result = await fetchWithTimeout(
      async () => ({ status: 200, headers: { get: () => "text/html" }, body, text }),
      "https://example.com/",
      1_000,
      MAX_HTML_BODY_BYTES
    );

    expect(result).toEqual({ error: "response too large" });
    expect(cancelled).toBe(true);
    expect(text).not.toHaveBeenCalled();
  });

  test("does not let hanging response or reader cancellation change a body-limit result into a timeout", async () => {
    const never = () => new Promise<void>(() => undefined);
    const declared = fetchWithTimeout(
      async () => ({
        status: 200,
        headers: { get: (name: string) => name === "content-length" ? "2" : "text/html" },
        body: { cancel: never },
      }),
      "https://example.com/",
      1_000,
      1
    );
    const streamed = fetchWithTimeout(
      async () => ({
        status: 200,
        headers: { get: () => "text/html" },
        body: {
          getReader: () => ({
            read: async () => ({ done: false, value: new Uint8Array(2) }),
            cancel: never,
          }),
        },
      }),
      "https://example.com/",
      1_000,
      1
    );
    const hostileAsyncBody = fetchWithTimeout(
      async () => ({
        status: 200,
        headers: { get: () => "text/html" },
        body: {
          async *[Symbol.asyncIterator]() {
            yield new Uint8Array(2);
          },
          destroy: () => { throw new Error("hostile cleanup detail"); },
        },
      }),
      "https://example.com/",
      1_000,
      1
    );

    await expect(declared).resolves.toEqual({ error: "response too large" });
    await expect(streamed).resolves.toEqual({ error: "response too large" });
    await expect(hostileAsyncBody).resolves.toEqual({ error: "response too large" });
  });

  test("uses one deadline across DNS, redirect validation, and response consumption", async () => {
    vi.useFakeTimers();
    try {
      let resolverCalls = 0;
      const requests: string[] = [];
      const resolveDns: DnsResolver = async () => {
        resolverCalls += 1;
        if (resolverCalls >= 6) await new Promise((resolve) => setTimeout(resolve, 600));
        return [{ address: "93.184.216.34", family: 4 }];
      };
      const fetchImpl = async (url: string): Promise<FakeResponse> => {
        requests.push(url);
        if (url === "https://example.com/") {
          return {
            status: 302,
            headers: { get: (name) => name.toLowerCase() === "location" ? "/next" : "text/html" },
            body: bodyStream(""),
          };
        }
        return response(404, "not found", "text/plain", url);
      };
      const run = crawlSite(
        { startUrl: "https://example.com/", limit: 1, concurrency: 1, timeoutMs: 1_000 },
        { fetch: fetchImpl, resolveDns }
      );
      let result: Awaited<ReturnType<typeof crawlSite>> | undefined;
      let failure: unknown;
      void run.then((value) => { result = value; }, (error) => { failure = error; });
      for (let turn = 0; turn < 5 && !result && !failure; turn += 1) {
        await vi.advanceTimersByTimeAsync(1_000);
      }
      expect(failure).toBeUndefined();
      expect(result).toBeDefined();
      expect(requests).toContain("https://example.com/");
      expect(requests).not.toContain("https://example.com/next");
      expect(result!.pages).toContainEqual(expect.objectContaining({ error: "timeout" }));
    } finally {
      vi.useRealTimers();
    }
  });

  test("records fixed limitations for oversized robots and sitemap downloads", async () => {
    const declared = (status: number, maximum: number, contentType: string): FakeResponse => ({
      status,
      headers: {
        get: (name) => name.toLowerCase() === "content-length"
          ? String(maximum + 1)
          : name.toLowerCase() === "content-type"
            ? contentType
            : null,
      },
      body: bodyStream("must not be retained"),
    });
    const robotsOversized = await crawlSite(
      { startUrl: "https://example.com/", limit: 1, concurrency: 1, timeoutMs: 1_000 },
      fakeDeps(new Map([
        ["https://example.com/robots.txt", declared(200, MAX_ROBOTS_BODY_BYTES, "text/plain")],
        ["https://example.com/", html(200, "<title>Home</title>")],
      ]))
    );
    expect(robotsOversized.robots.error).toBe("response too large");
    expect(robotsOversized.limitations).toContain(
      `robots.txt response exceeded the ${MAX_ROBOTS_BODY_BYTES}-byte download limit.`
    );

    const sitemapOversized = await crawlSite(
      { startUrl: "https://example.com/", limit: 1, concurrency: 1, timeoutMs: 1_000 },
      fakeDeps(new Map([
        ["https://example.com/robots.txt", response(200, "Sitemap: https://example.com/huge.xml", "text/plain")],
        ["https://example.com/huge.xml", declared(200, MAX_SITEMAP_BODY_BYTES, "application/xml")],
        ["https://example.com/", html(200, "<title>Home</title>")],
      ]))
    );
    expect(sitemapOversized.sitemapCandidates).toContainEqual(expect.objectContaining({
      url: "https://example.com/huge.xml",
      error: "response too large",
    }));
    expect(sitemapOversized.limitations).toContain(
      `Sitemap response exceeded the ${MAX_SITEMAP_BODY_BYTES}-byte download limit for https://example.com/huge.xml.`
    );
  });

  test("classifies direct and repeatedly encoded mutation paths with the shared guard", () => {
    expect(isMutationPath("https://example.com/logout")).toBe(true);
    expect(isMutationPath("https://example.com/%2525252563heckout")).toBe(true);
    expect(isMutationPath("https://example.com/safe/page")).toBe(false);
  });

  test("converts a synchronous fetch exception into a safe failure result", async () => {
    const result = await fetchWithTimeout(() => {
      throw new Error("credentials=secret");
    }, "https://example.com/", 1_000);

    expect(result).toEqual({ error: "fetch failed" });
  });

  test("times out while reading a response body", async () => {
    const result = await fetchWithTimeout(
      async () => ({
        status: 200,
        headers: { get: () => "text/html" },
        body: new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => undefined) }),
      }),
      "https://example.com/",
      10
    );

    expect(result).toEqual({ error: "timeout" });
  });

  test("caps an oversized timeout at fifteen seconds while preserving the body deadline", async () => {
    vi.useFakeTimers();
    try {
      const outcome = fetchWithTimeout(
        async () => ({
          status: 200,
          headers: { get: () => "text/html" },
          body: new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => undefined) }),
        }),
        "https://example.com/",
        15_001
      );
      let settled = false;
      void outcome.then(() => { settled = true; });

      await vi.advanceTimersByTimeAsync(15_000);
      expect(settled).toBe(true);
      await expect(outcome).resolves.toEqual({ error: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  test("crawls same-origin HTML breadth-first and respects exclusions and limit", async () => {
    const responses = new Map([
      ["https://example.com/", html(200, `<a href="/a">A</a><a href="/login">Login</a><a href="https://other.test/x">X</a>`)],
      ["https://example.com/a", html(200, `<title>A</title><a href="/b">B</a>`)],
      ["https://example.com/b", html(404, `<title>Missing</title>`)],
    ]);

    const result = await crawlSite(
      { startUrl: "https://example.com/", limit: 3, concurrency: 2, timeoutMs: 1_000 },
      fakeDeps(responses)
    );

    expect(result.pages.map((page) => page.requestedUrl)).toEqual([
      "https://example.com/",
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(result.excludedUrls).toContain("https://example.com/login");
    expect(result.brokenUrls).toContain("https://example.com/b");
  });

  test("carries requested keyword alignment into normalized page evidence", async () => {
    const result = await crawlSite(
      {
        startUrl: "https://example.com/",
        keywords: ["technical seo"],
        limit: 1,
        concurrency: 1,
        timeoutMs: 1_000,
      },
      fakeDeps(new Map([
        ["https://example.com/", html(200, "<title>Technical SEO services</title><h1>Audit</h1>")],
      ]))
    );

    expect(result.pages[0].keywordAlignment).toMatchObject({
      state: "measured",
      matches: [{ keyword: "technical seo", fields: ["title"] }],
    });
  });

  test("preserves X-Robots-Tag separately and detects conflicts through the crawl boundary", async () => {
    const pageResponse = html(200, "<meta name='robots' content='index, follow'><title>Home</title>");
    pageResponse.headers = {
      get: (name) => {
        if (name.toLowerCase() === "content-type") return "text/html; charset=utf-8";
        if (name.toLowerCase() === "x-robots-tag") return "noindex, nofollow";
        return null;
      },
    };
    const result = await crawlSite(
      { startUrl: "https://example.com/", limit: 1, concurrency: 1, timeoutMs: 1_000 },
      fakeDeps(new Map([["https://example.com/", pageResponse]]))
    );

    expect(result.pages[0]).toMatchObject({
      metaRobots: "index, follow",
      xRobotsTag: "noindex, nofollow",
      indexable: false,
      indexabilityConflicts: [
        "Meta robots and X-Robots-Tag disagree on index/noindex.",
        "Meta robots and X-Robots-Tag disagree on follow/nofollow.",
      ],
    });
  });

  test("rejects a mutation start URL before making any request", async () => {
    const requests: string[] = [];
    const result = await crawlSite(
      { startUrl: "https://example.com/account", limit: 2, concurrency: 1, timeoutMs: 1_000 },
      { fetch: async (url) => {
        requests.push(url);
        return html(200, "<title>Unexpected</title>");
      }, resolveDns: PUBLIC_DNS }
    );

    expect(requests).toEqual([]);
    expect(result.excludedUrls).toEqual(["https://example.com/account"]);
    expect(result.pages).toEqual([]);
    expect(result.limitations).toContain("Start URL excluded by mutation-path policy.");
  });

  test("still enforces the public-host boundary for an excluded mutation start URL", async () => {
    const fetchImpl = vi.fn();
    await expect(crawlSite(
      { startUrl: "http://127.0.0.1/logout", limit: 1, concurrency: 1, timeoutMs: 1_000 },
      { fetch: fetchImpl, resolveDns: PUBLIC_DNS }
    )).rejects.toThrow("public internet");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("stops before fetching a mutation redirect destination", async () => {
    const requests: string[] = [];
    const fetchImpl = async (url: string): Promise<FakeResponse> => {
      requests.push(url);
      if (url === "https://example.com/") {
        return {
          status: 302,
          headers: { get: (name) => (name.toLowerCase() === "location" ? "/%63heckout" : "text/html") },
          body: bodyStream(""),
        };
      }
      return response(404, "not found", "text/plain", url);
    };

    const result = await crawlSite(
      { startUrl: "https://example.com/", limit: 1, concurrency: 1, timeoutMs: 1_000 },
      { fetch: fetchImpl, resolveDns: PUBLIC_DNS }
    );

    expect(requests).not.toContain("https://example.com/%63heckout");
    expect(result.pages).toEqual([
      expect.objectContaining({ requestedUrl: "https://example.com/", status: 0, error: "mutation-path excluded" }),
    ]);
  });

  test("aggregates duplicate metadata, redirects, non-HTML resources, and recursive sitemap evidence", async () => {
    const responses = new Map([
      ["https://example.com/robots.txt", response(200, "Sitemap: https://example.com/custom-index.xml?token=private", "text/plain")],
      [
        "https://example.com/custom-index.xml",
        response(200, `<sitemapindex><sitemap><loc>https://example.com/articles.xml</loc></sitemap></sitemapindex>`, "application/xml"),
      ],
      ["https://example.com/articles.xml", response(200, `<urlset><url><loc>/about?session=private</loc></url></urlset>`, "application/xml")],
      [
        "https://example.com/",
        html(200, `<title>Shared</title><meta name="description" content="Same"><a href="/about">About</a><a href="/asset.pdf">Asset</a>`, "https://example.com/home?secret=yes"),
      ],
      ["https://example.com/about", html(200, `<title>Shared</title><meta name="description" content="Same">`)],
      ["https://example.com/asset.pdf", response(200, "%PDF", "application/pdf")],
    ]);

    const result = await crawlSite(
      { startUrl: "https://user:password@example.com/?access_token=secret", limit: 10, concurrency: 2, timeoutMs: 1_000 },
      fakeDeps(responses)
    );

    expect(result.pages.map((page) => page.requestedUrl)).toEqual(["https://example.com/", "https://example.com/about"]);
    expect(result.pages[0].finalUrl).toBe("https://example.com/home");
    expect(result.redirectChains).toEqual([
      { requestedUrl: "https://example.com/", finalUrl: "https://example.com/home", urls: ["https://example.com/", "https://example.com/home"] },
    ]);
    expect(result.duplicateTitles).toEqual({ Shared: ["https://example.com/home", "https://example.com/about"] });
    expect(result.duplicateDescriptions).toEqual({ Same: ["https://example.com/home", "https://example.com/about"] });
    expect(result.sitemapCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: "https://example.com/custom-index.xml", source: "robots", urls: ["https://example.com/articles.xml"] }),
      expect.objectContaining({ url: "https://example.com/articles.xml", source: "sitemap", urls: ["https://example.com/about"] }),
    ]));
    expect(result).toMatchObject({
      attemptedUrlCount: 3,
      eligibleDiscoveredCount: 3,
      droppedEligibleCount: 0,
      truncated: false,
    });
    expect(JSON.stringify(result)).not.toMatch(/password|access_token|secret|private/);
  });

  test("records timed-out pages without waiting for a fetch implementation that ignores abort", async () => {
    const responses = new Map([
      ["https://example.com/", html(200, `<a href="/slow">Slow</a>`)],
    ]);
    const fetchImpl = async (url: string): Promise<FakeResponse> => {
      if (url === "https://example.com/slow") return new Promise(() => undefined);
      return fakeFetch(responses)(url);
    };

    const result = await crawlSite(
      { startUrl: "https://example.com/", limit: 2, concurrency: 2, timeoutMs: 10 },
      { fetch: fetchImpl, resolveDns: PUBLIC_DNS }
    );

    expect(result.pages).toContainEqual(expect.objectContaining({ requestedUrl: "https://example.com/slow", status: 0, error: "timeout" }));
    expect(result.brokenUrls).toContain("https://example.com/slow");
  });

  test("rejects a response whose final URL leaves the start origin", async () => {
    const responses = new Map([
      ["https://example.com/", html(200, "<title>Outside</title>", "https://evil.test/private?token=secret")],
    ]);

    const result = await crawlSite(
      { startUrl: "https://example.com/", limit: 1, concurrency: 1, timeoutMs: 1_000 },
      fakeDeps(responses)
    );

    expect(result.pages).toEqual([
      expect.objectContaining({ requestedUrl: "https://example.com/", status: 0, error: "cross-origin redirect" }),
    ]);
    expect(JSON.stringify(result)).not.toMatch(/evil\.test|secret/);
  });

  test("adds same-origin URLs found only in a sitemap to the bounded crawl queue", async () => {
    const responses = new Map([
      ["https://example.com/robots.txt", response(200, "Sitemap: https://example.com/pages.xml", "text/plain")],
      ["https://example.com/pages.xml", response(200, "<urlset><url><loc>https://example.com/sitemap-only</loc></url></urlset>", "application/xml")],
      ["https://example.com/", html(200, "<title>Home</title>")],
      ["https://example.com/sitemap-only", html(200, "<title>Sitemap only</title>")],
    ]);

    const result = await crawlSite(
      { startUrl: "https://example.com/", limit: 2, concurrency: 2, timeoutMs: 1_000 },
      fakeDeps(responses)
    );

    expect(result.pages.map((page) => page.requestedUrl)).toEqual(["https://example.com/", "https://example.com/sitemap-only"]);
    expect(result.discoveredUrls).toContain("https://example.com/sitemap-only");
  });

  test("crawls unlinked priority seeds in explicit order and counts them within the page cap", async () => {
    const requests: string[] = [];
    const responses = new Map([
      ["https://example.com/", html(200, "<title>Home</title>")],
      ["https://example.com/landing-b", html(200, "<title>Landing B</title>")],
      ["https://example.com/landing-a", html(200, "<title>Landing A</title>")],
      ["https://example.com/landing-c", html(200, "<title>Landing C</title>")],
    ]);
    const result = await crawlSite(
      {
        startUrl: "https://example.com/",
        priorityUrls: [
          "https://example.com/landing-b",
          "https://example.com/landing-a",
          "https://example.com/landing-c",
        ],
        limit: 3,
        concurrency: 3,
        timeoutMs: 1_000,
      },
      {
        resolveDns: PUBLIC_DNS,
        fetch: async (url) => {
          requests.push(url);
          return fakeFetch(responses)(url);
        },
      }
    );

    expect(result.pages.map((page) => page.requestedUrl)).toEqual([
      "https://example.com/",
      "https://example.com/landing-b",
      "https://example.com/landing-a",
    ]);
    expect(result.pages[1]).toMatchObject({ discoverySources: ["priority"], orphanCandidate: true, inboundInternalLinks: 0 });
    expect(result.pages[1].depth).toBeUndefined();
    expect(requests).not.toContain("https://example.com/landing-c");
  });

  test("rejects private, cross-origin, and mutation priority seeds before transport", async () => {
    const requests: string[] = [];
    const result = await crawlSite(
      {
        startUrl: "https://example.com/",
        priorityUrls: [
          "http://127.0.0.1/private",
          "https://other.example/foreign",
          "https://example.com/logout",
          "https://example.com/safe",
        ],
        limit: 4,
        concurrency: 2,
        timeoutMs: 1_000,
      },
      {
        resolveDns: PUBLIC_DNS,
        fetch: async (url) => {
          requests.push(url);
          return html(200, `<title>${url}</title>`);
        },
      }
    );

    expect(result.pages.map((page) => page.requestedUrl)).toEqual([
      "https://example.com/",
      "https://example.com/safe",
    ]);
    expect(result.excludedUrls).toEqual(expect.arrayContaining([
      "http://127.0.0.1/private",
      "https://other.example/foreign",
      "https://example.com/logout",
    ]));
    expect(requests).not.toContain("http://127.0.0.1/private");
    expect(requests).not.toContain("https://other.example/foreign");
    expect(requests).not.toContain("https://example.com/logout");
  });

  test("rejects a priority seed that re-resolves privately after the start page", async () => {
    const requests: string[] = [];
    let homeFetched = false;
    let resolutionsAfterHome = 0;
    const resolveDns: DnsResolver = async () => {
      if (homeFetched) {
        resolutionsAfterHome += 1;
        if (resolutionsAfterHome >= 2) return [{ address: "10.0.0.7", family: 4 }];
      }
      return [{ address: "93.184.216.34", family: 4 }];
    };
    const result = await crawlSite(
      {
        startUrl: "https://example.com/",
        priorityUrls: ["https://example.com/unlinked"],
        limit: 2,
        concurrency: 1,
        timeoutMs: 1_000,
      },
      {
        resolveDns,
        fetch: async (url) => {
          requests.push(url);
          if (url === "https://example.com/") homeFetched = true;
          return html(200, `<title>${url}</title>`);
        },
      }
    );

    expect(result.pages).toContainEqual(expect.objectContaining({
      requestedUrl: "https://example.com/unlinked",
      status: 0,
      error: "unsafe network destination",
    }));
    expect(requests).not.toContain("https://example.com/unlinked");
  });

  test("applies the same safe redirect boundary to priority seeds", async () => {
    const requests: string[] = [];
    const fetchImpl = async (url: string): Promise<FakeResponse> => {
      requests.push(url);
      if (url === "https://example.com/priority") {
        return {
          status: 302,
          headers: { get: (name) => name.toLowerCase() === "location" ? "/campaign" : "text/html" },
          body: bodyStream(""),
        };
      }
      if (url === "https://example.com/unsafe-priority") {
        return {
          status: 302,
          headers: { get: (name) => name.toLowerCase() === "location" ? "https://private.example/admin" : "text/html" },
          body: bodyStream(""),
        };
      }
      return html(200, `<title>${url}</title>`);
    };
    const result = await crawlSite(
      {
        startUrl: "https://example.com/",
        priorityUrls: ["https://example.com/priority", "https://example.com/unsafe-priority"],
        limit: 3,
        concurrency: 3,
        timeoutMs: 1_000,
      },
      { fetch: fetchImpl, resolveDns: PUBLIC_DNS }
    );

    expect(result.pages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        requestedUrl: "https://example.com/priority",
        finalUrl: "https://example.com/campaign",
        status: 200,
        discoverySources: ["priority"],
      }),
      expect.objectContaining({
        requestedUrl: "https://example.com/unsafe-priority",
        status: 0,
        error: "cross-origin redirect",
      }),
    ]));
    expect(requests).toContain("https://example.com/campaign");
    expect(requests).not.toContain("https://private.example/admin");
  });

  test("derives minimum internal depth, inbound count, and orphan candidates from the observed graph", async () => {
    const responses = new Map([
      ["https://example.com/robots.txt", response(200, "Sitemap: https://example.com/pages.xml", "text/plain")],
      ["https://example.com/pages.xml", response(200, "<urlset><url><loc>/sitemap-only</loc></url></urlset>", "application/xml")],
      ["https://example.com/", html(200, '<a href="/priority">Priority</a><a href="/linked">Linked</a>')],
      ["https://example.com/priority", html(200, "<title>Priority</title>")],
      ["https://example.com/sitemap-only", html(200, "<title>Sitemap only</title>")],
      ["https://example.com/linked", html(200, "<title>Linked</title>")],
    ]);
    const result = await crawlSite(
      {
        startUrl: "https://example.com/",
        priorityUrls: ["https://example.com/priority"],
        limit: 4,
        concurrency: 3,
        timeoutMs: 1_000,
      },
      fakeDeps(responses)
    );
    const page = (url: string) => result.pages.find((item) => item.requestedUrl === url);

    expect(page("https://example.com/")).toMatchObject({ depth: 0, discoverySources: ["start"], inboundInternalLinks: 0, orphanCandidate: false });
    expect(page("https://example.com/priority")).toMatchObject({
      depth: 1,
      discoverySources: ["priority", "internal_link"],
      inboundInternalLinks: 1,
      orphanCandidate: false,
    });
    expect(page("https://example.com/sitemap-only")).toMatchObject({
      discoverySources: ["sitemap"],
      inboundInternalLinks: 0,
      orphanCandidate: true,
    });
    expect(page("https://example.com/sitemap-only")?.depth).toBeUndefined();
    expect(page("https://example.com/linked")).toMatchObject({
      depth: 1,
      discoverySources: ["internal_link"],
      inboundInternalLinks: 1,
      orphanCandidate: false,
    });
  });

  test("attributes links to an exact requested page before a redirect final-url alias", async () => {
    const fetchImpl = async (url: string): Promise<FakeResponse> => {
      if (url === "https://example.com/") return html(200, '<a href="/old">Old</a><a href="/final">Final</a>');
      if (url === "https://example.com/old") {
        return {
          status: 302,
          headers: { get: (name) => name.toLowerCase() === "location" ? "/final" : "text/html" },
          body: bodyStream(""),
        };
      }
      if (url === "https://example.com/final") return html(200, "<title>Final</title>");
      return response(404, "not found", "text/plain", url);
    };

    const result = await crawlSite(
      { startUrl: "https://example.com/", limit: 3, concurrency: 2, timeoutMs: 1_000 },
      { fetch: fetchImpl, resolveDns: PUBLIC_DNS }
    );
    const exactFinal = result.pages.find((page) => page.requestedUrl === "https://example.com/final");

    expect(exactFinal).toMatchObject({ depth: 1, inboundInternalLinks: 1 });
  });

  test("applies mutation exclusions to sitemap-only URLs", async () => {
    const responses = new Map([
      ["https://example.com/robots.txt", response(200, "Sitemap: https://example.com/pages.xml", "text/plain")],
      ["https://example.com/pages.xml", response(200, "<urlset><url><loc>/checkout</loc></url><url><loc>/sitemap-only</loc></url></urlset>", "application/xml")],
      ["https://example.com/", html(200, "<title>Home</title>")],
      ["https://example.com/sitemap-only", html(200, "<title>Sitemap only</title>")],
    ]);

    const result = await crawlSite(
      { startUrl: "https://example.com/", limit: 3, concurrency: 2, timeoutMs: 1_000 },
      fakeDeps(responses)
    );

    expect(result.excludedUrls).toContain("https://example.com/checkout");
    expect(result.pages.map((page) => page.requestedUrl)).not.toContain("https://example.com/checkout");
  });

  test("excludes direct and percent-encoded mutation path variants", async () => {
    const responses = new Map([
      ["https://example.com/", html(200, `<a href="/registration">Register</a><a href="/%72egistration">Encoded</a>`)],
    ]);

    const result = await crawlSite(
      { startUrl: "https://example.com/", limit: 3, concurrency: 1, timeoutMs: 1_000 },
      fakeDeps(responses)
    );

    expect(result.excludedUrls).toEqual(expect.arrayContaining([
      "https://example.com/registration",
      "https://example.com/%72egistration",
    ]));
    expect(result.pages.map((page) => page.requestedUrl)).toEqual(["https://example.com/"]);
  });

  test("bounds extracted link evidence and traversal for a huge unique-link page", async () => {
    const links = Array.from({ length: 1_000 }, (_, index) => `<a href="/page-${index}">${index}</a>`).join("");
    const responses = new Map<string, FakeResponse>([
      ["https://example.com/", html(200, links)],
      ["https://example.com/page-0", html(200, "<title>First</title>")],
    ]);

    const result = await crawlSite(
      { startUrl: "https://example.com/", limit: 2, concurrency: 1, timeoutMs: 1_000 },
      fakeDeps(responses)
    );

    expect(result.pages[0].links).toHaveLength(2);
    expect(result.pages[0].internalLinks).toHaveLength(2);
    expect(result.pages[0].externalLinks).toHaveLength(0);
    expect(result.discoveredUrls).toEqual(["https://example.com/", "https://example.com/page-0"]);
    expect(result.pages.map((page) => page.requestedUrl)).toEqual(["https://example.com/", "https://example.com/page-0"]);
    expect(result.pages[0].linksTruncated).toBe(true);
    expect(result.pages[0].omittedLinkCount).toBe(998);
    expect(result.limitations).toContain("Link evidence truncated for https://example.com/.");
  });

  test("keeps external evidence bounded without starving same-origin discovery", async () => {
    const responses = new Map([
      ["https://example.com/", html(200, `<a href="https://one.test/a">One</a><a href="https://two.test/b">Two</a><a href="/about">About</a>`)],
      ["https://example.com/about", html(200, "<title>About</title>")],
    ]);

    const result = await crawlSite(
      { startUrl: "https://example.com/", limit: 2, concurrency: 1, timeoutMs: 1_000 },
      fakeDeps(responses)
    );

    expect(result.pages[0].externalLinks).toEqual(["https://one.test/a", "https://two.test/b"]);
    expect(result.pages[0].internalLinks).toEqual(["https://example.com/about"]);
    expect(result.pages.map((page) => page.requestedUrl)).toEqual(["https://example.com/", "https://example.com/about"]);
  });

  test("caps stored sitemap URL evidence to the crawl capacity remaining after the start URL", async () => {
    const responses = new Map([
      ["https://example.com/robots.txt", response(200, "Sitemap: https://example.com/pages.xml", "text/plain")],
      [
        "https://example.com/pages.xml",
        response(200, "<urlset><url><loc>/one</loc></url><url><loc>/two</loc></url><url><loc>/three</loc></url></urlset>", "application/xml"),
      ],
      ["https://example.com/", html(200, "<title>Home</title>")],
      ["https://example.com/one", html(200, "<title>One</title>")],
    ]);

    const result = await crawlSite(
      { startUrl: "https://example.com/", limit: 2, concurrency: 2, timeoutMs: 1_000 },
      fakeDeps(responses)
    );

    expect(result.sitemapCandidates.find((candidate) => candidate.url === "https://example.com/pages.xml")?.urls).toEqual([
      "https://example.com/one",
    ]);
  });

  test("caps robots sitemap directives to the sitemap-file budget", async () => {
    const robots = Array.from({ length: 20 }, (_, index) => `Sitemap: https://example.com/map-${index}.xml`).join("\n");
    const responses = new Map([
      ["https://example.com/robots.txt", response(200, robots, "text/plain")],
      ["https://example.com/", html(200, "<title>Home</title>")],
    ]);

    const result = await crawlSite(
      { startUrl: "https://example.com/", limit: 1, concurrency: 1, timeoutMs: 1_000 },
      fakeDeps(responses)
    );

    expect(result.robots.sitemapUrls).toHaveLength(10);
    expect(result.robots.sitemapUrls.at(-1)).toBe("https://example.com/map-9.xml");
  });

  test("caps the crawl at 100 pages and records truncation", async () => {
    const links = Array.from({ length: 100 }, (_, index) => `<a href="/page-${index}">${index}</a>`).join("");
    const responses = new Map<string, FakeResponse>([["https://example.com/", html(200, links)]]);
    for (let index = 0; index < 100; index += 1) {
      responses.set(`https://example.com/page-${index}`, html(200, `<title>Page ${index}</title>`));
    }

    const result = await crawlSite(
      { startUrl: "https://example.com/", limit: 1_000, concurrency: 20, timeoutMs: 1_000 },
      fakeDeps(responses)
    );

    expect(result.pages).toHaveLength(100);
    expect(result.pages.at(-1)?.requestedUrl).toBe("https://example.com/page-98");
    expect(result.limitations).toEqual(expect.arrayContaining([
      "Page crawl capped at 100 URLs.",
      "Crawl concurrency capped at 5.",
      "Page crawl truncated after 100 URLs.",
    ]));
  });

  test("counts unique eligible URLs dropped by the crawl limit", async () => {
    const result = await crawlSite({
      startUrl: "https://example.com/",
      limit: 2,
      concurrency: 1,
      timeoutMs: 1_000,
    }, fakeDeps(new Map([
      ["https://example.com/", html(200, `<a href="/a">A</a><a href="/b">B</a>`)],
      ["https://example.com/a", html(200, "A")],
    ])));

    expect(result).toMatchObject({
      attemptedUrlCount: 2,
      eligibleDiscoveredCount: 3,
      droppedEligibleCount: 1,
      truncated: true,
    });
    expect(result.pages.length).toBeLessThanOrEqual(result.attemptedUrlCount);
    expect(result.truncated).toBe(result.droppedEligibleCount > 0);
  });

  test("counts sitemap URLs observed beyond retained sitemap evidence", async () => {
    const result = await crawlSite(
      { startUrl: "https://example.com/", limit: 2, concurrency: 1, timeoutMs: 1_000 },
      fakeDeps(new Map([
        ["https://example.com/robots.txt", response(200, "Sitemap: https://example.com/pages.xml", "text/plain")],
        ["https://example.com/pages.xml", response(200, "<urlset><url><loc>/a</loc></url><url><loc>/b</loc></url><url><loc>/c</loc></url></urlset>", "application/xml")],
        ["https://example.com/", html(200, "Home")],
        ["https://example.com/a", html(200, "A")],
      ]))
    );

    expect(result.sitemapCandidates.find((candidate) => candidate.url === "https://example.com/pages.xml")?.urls).toEqual([
      "https://example.com/a",
    ]);
    expect(result).toMatchObject({
      attemptedUrlCount: 2,
      eligibleDiscoveredCount: 4,
      droppedEligibleCount: 2,
      truncated: true,
    });
  });

  test("counts a duplicated priority URL only once before queue retention", async () => {
    const result = await crawlSite(
      {
        startUrl: "https://example.com/",
        priorityUrls: ["https://example.com/a", "https://example.com/a", "https://example.com/b"],
        limit: 2,
        concurrency: 1,
        timeoutMs: 1_000,
      },
      fakeDeps(new Map([
        ["https://example.com/", html(200, "Home")],
        ["https://example.com/a", html(200, "A")],
      ]))
    );

    expect(result).toMatchObject({ eligibleDiscoveredCount: 3, droppedEligibleCount: 1, truncated: true });
    expect(result.discoveredUrls).toEqual(["https://example.com/", "https://example.com/a"]);
  });

  test("counts non-HTML URLs as eligible even when they produce no page evidence", async () => {
    const result = await crawlSite(
      { startUrl: "https://example.com/", limit: 2, concurrency: 1, timeoutMs: 1_000 },
      fakeDeps(new Map([
        ["https://example.com/", html(200, `<a href="/download.pdf">PDF</a><a href="/about">About</a>`)],
        ["https://example.com/download.pdf", response(200, "%PDF", "application/pdf")],
      ]))
    );

    expect(result).toMatchObject({ attemptedUrlCount: 2, eligibleDiscoveredCount: 3, droppedEligibleCount: 1, truncated: true });
    expect(result.pages.map((page) => page.requestedUrl)).toEqual(["https://example.com/"]);
  });

  test("does not count mutation-path URLs as eligible crawl candidates", async () => {
    const result = await crawlSite(
      { startUrl: "https://example.com/", limit: 1, concurrency: 1, timeoutMs: 1_000 },
      fakeDeps(new Map([
        ["https://example.com/", html(200, `<a href="/checkout">Checkout</a><a href="/about">About</a>`)],
      ]))
    );

    expect(result.excludedUrls).toContain("https://example.com/checkout");
    expect(result).toMatchObject({ attemptedUrlCount: 1, eligibleDiscoveredCount: 2, droppedEligibleCount: 1, truncated: true });
  });

  test("keeps coverage counters invariant across bounded concurrency", async () => {
    const responses = () => new Map([
      ["https://example.com/", html(200, `<a href="/a">A</a><a href="/b">B</a>`)],
      ["https://example.com/a", html(200, `<a href="/c">C</a>`)],
      ["https://example.com/b", html(200, `<a href="/d">D</a>`)],
    ]);
    const options = { startUrl: "https://example.com/", limit: 3, timeoutMs: 1_000 };
    const sequential = await crawlSite({ ...options, concurrency: 1 }, fakeDeps(responses()));
    const concurrent = await crawlSite({ ...options, concurrency: 2 }, fakeDeps(responses()));

    expect(concurrent).toMatchObject({
      attemptedUrlCount: sequential.attemptedUrlCount,
      eligibleDiscoveredCount: sequential.eligibleDiscoveredCount,
      droppedEligibleCount: sequential.droppedEligibleCount,
      truncated: sequential.truncated,
    });
  });

  test("bounds duplicate invalid-priority limitation evidence", async () => {
    const invalidPriorityUrls = Array.from({ length: 200 }, (_, index) => `not-a-url-${index}`);
    const result = await crawlSite(
      {
        startUrl: "https://example.com/",
        priorityUrls: invalidPriorityUrls,
        limit: 1,
        concurrency: 1,
        timeoutMs: 1_000,
      },
      fakeDeps(new Map([
        ["https://example.com/", html(200, "Home")],
      ]))
    );

    expect(result.limitations).toEqual([
      "A priority URL was skipped because it was not a valid HTTP(S) URL.",
    ]);
  });
});
