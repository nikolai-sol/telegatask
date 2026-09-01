import { readFileSync } from "fs";
import { describe, expect, test } from "vitest";

describe("TASK-073 Mac scheduler", () => {
  test("gates async Hermes independently from the weekly Beget chain", () => {
    const source = readFileSync("src/services/scheduler.ts", "utf8");

    expect(source).toContain('process.env.SEO_ASYNC_HERMES_ENRICHMENT === "1"');
    expect(source).toContain("scripts/runAsyncHermesAdvisory.ts");
    expect(source).toContain('cron.schedule("*/30 * * * *"');
    expect(source).toContain('const schedulerProjectRoot = join(__dirname, "../..");');
    expect(source).toContain("cwd: schedulerProjectRoot");
  });
});
