import { describe, expect, test } from "vitest";
import rowsFixture from "./fixtures/metrika/sectionTrafficRows.json";
import { buildMetrikaSectionTrafficReport } from "./metrikaSectionTraffic";

describe("metrikaSectionTraffic", () => {
  test("aggregates weekly Metrika rows by configured section URL patterns", () => {
    const report = buildMetrikaSectionTrafficReport({
      generatedAt: "2026-07-10T12:00:00.000Z",
      weekKey: "2026-W28",
      domain: "zaruku.ru",
      sectionRules: [
        { section: "/melanoma/", urlIncludes: ["/melanoma/"] },
        { section: "/map/", urlIncludes: ["/map/"] },
        { section: "/content/", urlIncludes: ["/"] },
      ],
      rows: rowsFixture,
    });

    expect(report.schemaVersion).toBe("seo_os_metrika_section_traffic_v1");
    expect(report.summary.totalVisits).toBe(22);
    expect(report.sections).toHaveLength(2);
    expect(report.sections[0]).toMatchObject({
      section: "/melanoma/",
      visits: 15,
      users: 12,
      organic: { yandex: 10, google: 5, other: 0 },
      avgPageDepth: 2.666667,
      avgVisitDurationSeconds: 100,
      bounceRate: 26.666667,
    });
    expect(report.sections[1]).toMatchObject({
      section: "/map/",
      visits: 7,
      users: 6,
      organic: { yandex: 0, google: 0, other: 7 },
    });
  });

  test("returns unavailable report without throwing when collector input is unavailable", () => {
    const report = buildMetrikaSectionTrafficReport({
      generatedAt: "2026-07-10T12:00:00.000Z",
      weekKey: "2026-W28",
      domain: "zaruku.ru",
      sectionRules: [{ section: "/melanoma/", urlIncludes: ["/melanoma/"] }],
      rows: [],
      unavailableReason: "SEO_METRIKA_REPORT_READS is not enabled.",
    });

    expect(report.status).toBe("unavailable");
    expect(report.sections).toEqual([]);
    expect(report.unavailableReason).toBe("SEO_METRIKA_REPORT_READS is not enabled.");
  });
});
