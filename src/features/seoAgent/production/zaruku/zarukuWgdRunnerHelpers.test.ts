import { describe, expect, test } from "vitest";
import {
  aiTargetPosition,
  buildPageSnapshot,
  buildSitemapSummary,
  escapeHtml,
  extractGenSearchAnswer,
  extractGenSearchSourceDetails,
  sourceMatchesTarget,
  statusClass,
} from "./zarukuWgdRunnerHelpers";

describe("Zaruku WGD runner pure helpers", () => {
  test("escapes HTML and maps source status classes exactly", () => {
    expect(escapeHtml(`A&B <tag attr="x">'y'</tag>`)).toBe("A&amp;B &lt;tag attr=&quot;x&quot;&gt;&#39;y&#39;&lt;/tag&gt;");
    expect(escapeHtml(null)).toBe("");
    expect(statusClass("success")).toBe("ok");
    expect(statusClass("partial")).toBe("warn");
    expect(statusClass("skipped")).toBe("warn");
    expect(statusClass("failed")).toBe("bad");
  });

  test("builds homepage snapshot from HTML without network access", () => {
    const snapshot = buildPageSnapshot({
      url: "https://zaruku.ru/",
      finalUrl: "https://zaruku.ru/",
      status: 200,
      targetDomain: "zaruku.ru",
      html: `
        <html>
          <head>
            <title>  Test   Title  </title>
            <meta name="description" content=" Description text ">
            <link rel="canonical" href="https://zaruku.ru/">
            <style>.x{display:none}</style>
            <script>window.hidden = true</script>
          </head>
          <body>
            <h1> Main   Heading </h1>
            <a href="/about#team">About</a>
            <a href="https://www.zaruku.ru/about">About duplicate hostname</a>
            <a href="https://external.example/">External</a>
            First&nbsp;Second &amp; Third
          </body>
        </html>
      `,
    });

    expect(snapshot).toMatchObject({
      url: "https://zaruku.ru/",
      finalUrl: "https://zaruku.ru/",
      httpStatus: 200,
      title: "Test Title",
      description: "Description text",
      h1: "Main Heading",
      canonical: "https://zaruku.ru/",
    });
    expect(snapshot.bodySample).toContain("First Second & Third");
    expect(snapshot.bodySample).not.toContain("window.hidden");
    expect(snapshot.internalLinks).toEqual([
      "https://zaruku.ru/about",
      "https://www.zaruku.ru/about",
    ]);
  });

  test("builds sitemap summary with production section aggregation rules", () => {
    const summary = buildSitemapSummary({
      sitemapUrl: "https://zaruku.ru/sitemap.xml",
      status: 200,
      urlPrefix: "https://zaruku.ru/",
      xml: `
        <urlset>
          <url><loc>https://zaruku.ru/</loc></url>
          <url><loc>https://zaruku.ru/map/one/</loc></url>
          <url><loc>https://zaruku.ru/map/two/</loc></url>
          <url><loc>https://zaruku.ru/rak-lyogkogo/</loc></url>
          <url><loc>https://other.example/ignored/</loc></url>
        </urlset>
      `,
    });

    expect(summary).toEqual({
      sitemapUrl: "https://zaruku.ru/sitemap.xml",
      status: 200,
      urlCount: 4,
      sampledUrls: [
        "https://zaruku.ru/",
        "https://zaruku.ru/map/one/",
        "https://zaruku.ru/map/two/",
        "https://zaruku.ru/rak-lyogkogo/",
      ],
      sectionCounts: [
        { section: "/map/", count: 2 },
        { section: "/", count: 1 },
        { section: "/rak-lyogkogo/", count: 1 },
      ],
    });
  });

  test("parses Yandex generative search source details and target positions", () => {
    const payload = {
      items: [
        {
          message: { content: "Answer from message" },
          sources: [
            { url: "https://example.com/page", title: "External", used: true },
            { sourceUrl: "https://zaruku.ru/about/", title: "Target", used: false },
            { url: "https://www.zaruku.ru/", title: "Target used", used: true },
          ],
        },
      ],
    };

    const sources = extractGenSearchSourceDetails(payload);
    expect(sources).toEqual([
      { url: "https://example.com/page", title: "External", used: true },
      { url: "https://zaruku.ru/about/", title: "Target", used: false },
      { url: "https://www.zaruku.ru/", title: "Target used", used: true },
    ]);
    expect(sourceMatchesTarget(sources[1], "zaruku.ru")).toBe(true);
    expect(aiTargetPosition(sources, false, "zaruku.ru")).toBe(2);
    expect(aiTargetPosition(sources, true, "zaruku.ru")).toBe(2);
    expect(extractGenSearchAnswer(payload)).toBe("Answer from message");
  });
});
