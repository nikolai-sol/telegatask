import { describe, expect, test } from "vitest";
import { zarukuSeoProductionConfig } from "./zarukuSeoProductionConfig";

describe("zarukuSeoProductionConfig", () => {
  test("enables the safe GSC activation path for Zaruku", () => {
    expect(zarukuSeoProductionConfig.gscSiteUrl).toBe("sc-domain:zaruku.ru");
    expect(zarukuSeoProductionConfig.selectedSources).toEqual([
      "crawler",
      "gsc",
      "yandex_webmaster",
      "yandex_serp_rank",
    ]);
  });
});
