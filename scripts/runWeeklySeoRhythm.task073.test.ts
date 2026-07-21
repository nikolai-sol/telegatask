import { readFileSync } from "fs";
import { describe, expect, test } from "vitest";

describe("TASK-073 deterministic weekly chain", () => {
  test("contains no in-chain Hermes or LLM invocation", () => {
    const source = readFileSync("scripts/runWeeklySeoRhythm.ts", "utf8");

    expect(source).not.toContain("enrichWeeklyTop10DigestAdvisory");
    expect(source).not.toContain("createDefaultHermesDigestAdvisoryClient");
    expect(source).not.toContain("new LLMService");
    expect(source).not.toContain("SEO_DIGEST_LLM_ENRICHMENT");
    expect(source).toContain('state: "advisory_pending"');
  });
});
