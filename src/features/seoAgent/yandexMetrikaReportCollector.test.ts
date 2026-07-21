import { describe, expect, test } from "vitest";
import { weekKeyToDateRange } from "./yandexMetrikaReportCollector";

describe("yandexMetrikaReportCollector", () => {
  test("uses full ISO week date ranges for Metrika reads", () => {
    expect(weekKeyToDateRange("2026-W28")).toEqual({
      date1: "2026-07-06",
      date2: "2026-07-12",
    });
    expect(weekKeyToDateRange("2026-W29")).toEqual({
      date1: "2026-07-13",
      date2: "2026-07-19",
    });
  });
});
