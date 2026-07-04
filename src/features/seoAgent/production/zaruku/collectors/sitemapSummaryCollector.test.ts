import { describe, expect, test } from "vitest";
import { zarukuSeoProductionConfig } from "../zarukuSeoProductionConfig";
import { collectSitemapSummary } from "./sitemapSummaryCollector";
import type { FetchText } from "./httpText";

describe("collectSitemapSummary", () => {
  test("returns the current sitemap output contract from fixture XML without live network", async () => {
    const fetchImpl: FetchText = async () => ({
      status: 200,
      finalUrl: "https://zaruku.ru/sitemap.xml",
      text: `
        <urlset>
          <url><loc>https://zaruku.ru/</loc></url>
          <url><loc>https://zaruku.ru/map/one/</loc></url>
          <url><loc>https://zaruku.ru/map/two/</loc></url>
          <url><loc>https://zaruku.ru/obshie-temy/a/</loc></url>
          <url><loc>https://zaruku.ru/rak-lyogkogo/a/</loc></url>
          <url><loc>https://outside.example/ignored/</loc></url>
        </urlset>
      `,
    });

    const summary = await collectSitemapSummary(zarukuSeoProductionConfig, fetchImpl);

    expect(summary).toEqual({
      sitemapUrl: "https://zaruku.ru/sitemap.xml",
      status: 200,
      urlCount: 5,
      sampledUrls: [
        "https://zaruku.ru/",
        "https://zaruku.ru/map/one/",
        "https://zaruku.ru/map/two/",
        "https://zaruku.ru/obshie-temy/a/",
        "https://zaruku.ru/rak-lyogkogo/a/",
      ],
      sectionCounts: [
        { section: "/map/", count: 2 },
        { section: "/", count: 1 },
        { section: "/obshie-temy/", count: 1 },
        { section: "/rak-lyogkogo/", count: 1 },
      ],
    });
  });

  test("preserves current fetch failure behavior as an empty summary", async () => {
    const fetchImpl: FetchText = async () => {
      throw new Error("network failed");
    };

    await expect(collectSitemapSummary(zarukuSeoProductionConfig, fetchImpl)).resolves.toEqual({
      sitemapUrl: "https://zaruku.ru/sitemap.xml",
      status: null,
      urlCount: 0,
      sampledUrls: [],
      sectionCounts: [],
    });
  });
});
