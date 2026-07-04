import { describe, expect, test } from "vitest";
import { zarukuSeoProductionConfig } from "../zarukuSeoProductionConfig";
import { collectHomepageSnapshot } from "./homepageSnapshotCollector";
import type { FetchText } from "./httpText";

describe("collectHomepageSnapshot", () => {
  test("returns the current page output contract from fixture HTML without live network", async () => {
    const fetchImpl: FetchText = async () => ({
      status: 200,
      finalUrl: "https://zaruku.ru/",
      text: `
        <html>
          <head>
            <title>«За руку» test</title>
            <meta name="description" content="Описание портала">
            <link rel="canonical" href="https://zaruku.ru/">
          </head>
          <body>
            <h1>Все о диагностике и лечении рака</h1>
            <a href="/map#top">Map</a>
            <a href="https://www.zaruku.ru/about">About</a>
            <a href="https://external.example/">Ignored</a>
            Visible text for word count.
          </body>
        </html>
      `,
    });

    const snapshot = await collectHomepageSnapshot(zarukuSeoProductionConfig, fetchImpl);

    expect(snapshot).toEqual({
      url: "https://zaruku.ru/",
      finalUrl: "https://zaruku.ru/",
      httpStatus: 200,
      title: "«За руку» test",
      description: "Описание портала",
      h1: "Все о диагностике и лечении рака",
      canonical: "https://zaruku.ru/",
      wordCount: 17,
      bodySample: "«За руку» test Все о диагностике и лечении рака Map About Ignored Visible text for word count.",
      internalLinks: [
        "https://zaruku.ru/map",
        "https://www.zaruku.ru/about",
      ],
    });
  });

  test("preserves empty HTML behavior for a successful fetch", async () => {
    const fetchImpl: FetchText = async () => ({
      status: 204,
      finalUrl: "https://zaruku.ru/",
      text: "",
    });

    await expect(collectHomepageSnapshot(zarukuSeoProductionConfig, fetchImpl)).resolves.toEqual({
      url: "https://zaruku.ru/",
      finalUrl: "https://zaruku.ru/",
      httpStatus: 204,
      title: null,
      description: null,
      h1: null,
      canonical: null,
      wordCount: 0,
      bodySample: "",
      internalLinks: [],
    });
  });

  test("preserves current fetch failure behavior", async () => {
    const fetchImpl: FetchText = async () => {
      throw new Error("network failed");
    };

    await expect(collectHomepageSnapshot(zarukuSeoProductionConfig, fetchImpl)).rejects.toThrow("network failed");
  });
});
