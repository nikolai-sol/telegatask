import { afterEach, describe, expect, test, vi } from "vitest";
import aiProbesFixture from "../../baseline/fixtures/aiProbes.json";
import draftTasksFixture from "../../baseline/fixtures/draftTasks.json";
import lighthouseFixture from "../../baseline/fixtures/lighthouse.json";
import pageFixture from "../../baseline/fixtures/page.json";
import runFixture from "../../baseline/fixtures/run.json";
import sitemapFixture from "../../baseline/fixtures/sitemap.json";
import yandexQueriesFixture from "../../baseline/fixtures/yandexQueries.json";
import { renderZarukuWgdHtmlReport } from "./zarukuWgdHtmlReportRenderer";

describe("renderZarukuWgdHtmlReport", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("preserves the Zaruku HTML report outline and key dynamic rows", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T10:00:00.000Z"));

    const html = renderZarukuWgdHtmlReport({
      run: runFixture,
      draftTasks: draftTasksFixture,
      page: pageFixture,
      sitemap: sitemapFixture,
      lighthouse: lighthouseFixture,
      yandexQueries: yandexQueriesFixture,
      aiProbes: aiProbesFixture,
      jsonPath: "/tmp/wgd-zaruku-cancer-portal.json",
      htmlPath: "/tmp/wgd-zaruku-cancer-portal.html",
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<html lang=\"ru\">");
    expect(html).toContain("<title>WGD Report - zaruku.ru</title>");
    expect(html).toContain("Website Growth Diagnostic · zaruku.ru · Yandex Webmaster + Yandex SERP + crawler + Lighthouse · 2026-07-03T10:00:00.000Z");
    expect(html).toContain("zaruku.ru: портал поддержки людей с онкозаболеваниями");
    expect(html).toContain("<h2>Executive Snapshot</h2>");
    expect(html).toContain("<h2>Главные выводы</h2>");
    expect(html).toContain("<h2>Google Search Console: owned demand</h2>");
    expect(html).toContain("<h2>Страница и структура</h2>");
    expect(html).toContain("<h2>Yandex Webmaster: top queries</h2>");
    expect(html).toContain("<h2>Yandex SERP rank checks</h2>");
    expect(html).toContain("<h2>Lighthouse</h2>");
    expect(html).toContain("<h2>Как усилить портал</h2>");
    expect(html).toContain("<h2>Yandex Alisa / AI source position</h2>");
    expect(html).toContain("<summary>Source statuses</summary>");
    expect(html).toContain("<summary>Draft tasks</summary>");
    expect(html).toContain("JSON: /tmp/wgd-zaruku-cancer-portal.json");
    expect(html).toContain("HTML: /tmp/wgd-zaruku-cancer-portal.html");
    expect(html).toContain("Yandex Search API generative response");
  });
});
