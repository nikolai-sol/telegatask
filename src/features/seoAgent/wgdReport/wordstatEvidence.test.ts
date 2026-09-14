import { describe, expect, test, vi } from "vitest";
import type { PageEvidence, WgdReportOptions } from "./types";
import {
  analyzeWordstatDemand,
  collectWordstatEvidence,
  parseWordstatCount,
} from "./wordstatEvidence";

function page(
  url: string,
  signals: Partial<Pick<PageEvidence, "title" | "description" | "headings" | "discoveryOrder">>
): PageEvidence {
  return {
    requestedUrl: url,
    finalUrl: url,
    status: 200,
    indexable: true,
    signalConflicts: [],
    ...signals,
  };
}

function options(): WgdReportOptions {
  return {
    url: "https://flowerlife-school.com/",
    domain: "flowerlife-school.com",
    market: "RU",
    language: "ru",
    region: "225",
    crawlLimit: 100,
    lighthousePageLimit: 6,
    keywords: [
      "цветок жизни школа",
      "онлайн курсы саморазвития",
      "курсы ароматерапии онлайн",
    ],
    aiQueries: [],
    priorityUrls: [],
    outDir: "reports",
    sources: { dataForSeo: "not_applicable" },
  };
}

describe("Wordstat demand analysis", () => {
  test("accepts only safe non-negative integer counts", () => {
    expect(parseWordstatCount(42)).toBe(42);
    expect(parseWordstatCount("9040")).toBe(9040);
    for (const value of [-1, 1.5, "2.5", "nope", Number.MAX_SAFE_INTEGER + 1, null]) {
      expect(parseWordstatCount(value)).toBeNull();
    }
  });

  test("classifies covered, partial, and missing clusters against prominent page signals", () => {
    const evidence = analyzeWordstatDemand({
      checkedAt: "2026-09-14T10:00:00.000Z",
      options: options(),
      pages: [
        page("https://flowerlife-school.com/", {
          title: "Школа Цветок жизни — платформа саморазвития",
          headings: { h1: ["Цветок жизни"], h2: [] },
          discoveryOrder: 0,
        }),
        page("https://flowerlife-school.com/courses/", {
          title: "Онлайн-курсы саморазвития",
          description: "Выберите обучение и начните онлайн",
          headings: { h1: ["Курсы саморазвития"], h2: ["Обучение онлайн для начинающих"] },
          discoveryOrder: 1,
        }),
      ],
      seeds: [
        { seed: "цветок жизни школа", totalCount: 9000, phrases: [{ phrase: "школа цветок жизни", count: 5000 }] },
        { seed: "онлайн курсы саморазвития", totalCount: 4000, phrases: [{ phrase: "обучение онлайн для начинающих", count: 1000 }] },
        { seed: "курсы ароматерапии онлайн", totalCount: 4000, phrases: [{ phrase: "ароматерапия обучение", count: 900 }] },
      ],
    });

    expect(evidence.clusters.map(({ seed, coverage, brand }) => ({ seed, coverage, brand }))).toEqual([
      { seed: "цветок жизни школа", coverage: "covered", brand: true },
      { seed: "онлайн курсы саморазвития", coverage: "covered", brand: false },
      { seed: "курсы ароматерапии онлайн", coverage: "partial", brand: false },
    ]);
    expect(evidence.primaryRecommendation).toMatchObject({
      seed: "курсы ароматерапии онлайн",
      coverage: "partial",
      demand: 4000,
    });
  });

  test("selects the best page deterministically and does not invent a gap without measurements", () => {
    const evidence = analyzeWordstatDemand({
      checkedAt: "2026-09-14T10:00:00.000Z",
      options: { ...options(), keywords: ["курс духовного развития", "нет данных"] },
      pages: [
        page("https://flowerlife-school.com/later/", {
          title: "Курс духовного роста",
          discoveryOrder: 2,
        }),
        page("https://flowerlife-school.com/first/", {
          title: "Курс духовного развития",
          discoveryOrder: 1,
        }),
      ],
      seeds: [
        { seed: "курс духовного развития", totalCount: 800, phrases: [{ phrase: "духовное развитие курс", count: 700 }] },
        { seed: "нет данных", totalCount: null, phrases: [], measured: false },
      ],
    });

    expect(evidence.clusters[0]).toMatchObject({
      coverage: "partial",
      bestPage: "https://flowerlife-school.com/first/",
    });
    expect(evidence.clusters[1].coverage).toBe("not_measured");
    expect(evidence.primaryRecommendation?.seed).toBe("курс духовного развития");
  });
});

describe("collectWordstatEvidence", () => {
  test("bounds requests, enriches only the top three non-brand gaps, and never leaks credentials", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const body = JSON.parse(String(init?.body || "{}"));
      if (url.endsWith("/topRequests")) {
        const count = body.phrase.includes("ароматерапии") ? "5000" : body.phrase.includes("духовного") ? "4000" : "3000";
        return new Response(JSON.stringify({
          totalCount: count,
          topRequests: Array.from({ length: 25 }, (_, index) => ({ phrase: `${body.phrase} ${index}`, count: String(1000 - index) })),
        }), { status: 200 });
      }
      if (url.endsWith("/dynamics")) {
        return new Response(JSON.stringify({ dynamics: [{ date: "2026-08-01", count: "100" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ regions: [{ regionId: "225", count: "200", share: 0.4, affinityIndex: 120 }] }), { status: 200 });
    });

    const evidence = await collectWordstatEvidence(options(), [page(options().url, {
      title: "Школа Цветок жизни",
      headings: { h1: ["Школа Цветок жизни"], h2: [] },
    })], {
      env: { YANDEX_SEARCH_API_KEY: "super-secret", YANDEX_SEARCH_FOLDER_ID: "folder-secret" },
      fetch,
      now: () => new Date("2026-09-14T10:00:00.000Z"),
    });

    expect(evidence.status.state).toBe("success");
    expect(evidence.clusters.every((cluster) => cluster.phrases.length <= 20)).toBe(true);
    expect(calls).toHaveLength(7); // 3 top requests + dynamics/regions for two non-brand gaps.
    expect(calls.slice(0, 3).every((call) => call.url.endsWith("/topRequests"))).toBe(true);
    expect(calls.every((call) => (call.init?.headers as Record<string, string>).Authorization === "Api-Key super-secret")).toBe(true);
    expect(JSON.stringify(evidence)).not.toContain("super-secret");
    expect(evidence.requestCount).toBeLessThanOrEqual(16);
  });

  test("keeps valid evidence on partial failures and returns unavailable without credentials", async () => {
    let index = 0;
    const partial = await collectWordstatEvidence(options(), [], {
      env: { YANDEX_SEARCH_API_KEY: "key", YANDEX_SEARCH_FOLDER_ID: "folder" },
      fetch: async () => {
        index += 1;
        return index === 1
          ? new Response(JSON.stringify({ totalCount: "99", topRequests: [] }), { status: 200 })
          : new Response("secret backend error", { status: 500 });
      },
      now: () => new Date("2026-09-14T10:00:00.000Z"),
    });
    expect(partial.status.state).toBe("partial");
    expect(JSON.stringify(partial)).not.toContain("secret backend error");

    const unavailable = await collectWordstatEvidence(options(), [], { env: {} });
    expect(unavailable.status.state).toBe("unavailable");
    expect(unavailable.clusters.every((cluster) => cluster.coverage === "not_measured")).toBe(true);
    expect(unavailable.requestCount).toBe(0);
  });
});
