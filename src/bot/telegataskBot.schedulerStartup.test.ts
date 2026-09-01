import { readFileSync } from "fs";
import { describe, expect, test } from "vitest";

describe("Telegatask bot scheduler startup", () => {
  test("starts the scheduler before long polling blocks", () => {
    const source = readFileSync("src/bot/telegataskBot.ts", "utf8");
    const schedulerStart = source.indexOf("startScheduler(bot!);");
    const longPollingStart = source.indexOf("await bot!.launch({");

    expect(schedulerStart).toBeGreaterThan(-1);
    expect(longPollingStart).toBeGreaterThan(-1);
    expect(schedulerStart).toBeLessThan(longPollingStart);
  });
});
