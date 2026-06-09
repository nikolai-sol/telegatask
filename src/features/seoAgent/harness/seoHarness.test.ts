import { describe, expect, test } from "vitest";
import { runSeoHarness } from "./seoHarness";
import type { SeoFinding, SeoSourceStatus } from "../types";

const statuses: SeoSourceStatus[] = [
  {
    source: "crawler",
    status: "success",
    message: "crawler source completed successfully",
    collectedAt: 1,
  },
  {
    source: "gsc",
    status: "skipped",
    message: "not selected",
    collectedAt: 1,
  },
];

function finding(overrides: Partial<SeoFinding> = {}): SeoFinding {
  return {
    id: "finding-1",
    teamId: "untrusted-team",
    companyId: "untrusted-company",
    domain: "wrong.example",
    url: "https://example.com/",
    type: "technical_issue",
    category: "technical",
    title: "Fix technical issue",
    description: "Crawler evidence found a technical issue.",
    source: "crawler",
    severity: "high",
    confidence: "high",
    evidence: [{ source: "crawler", message: "Crawler found the issue." }],
    recommendation: "Fix the issue.",
    labels: ["Technical crawler data"],
    targetKeywords: [],
    sourceType: "recommendation",
    sourceId: "recommendation:fix",
    ...overrides,
  };
}

describe("SEO harness v0.1 contract", () => {
  test("preserves trusted team/company and produces draft-only output", () => {
    const result = runSeoHarness({
      domain: "example.com",
      teamId: "team-1",
      companyId: "company-1",
      sourceStatuses: statuses,
      normalizedSourceOutputs: {
        searchConsole: {} as never,
        pagespeed: {} as never,
        crawler: {} as never,
        rankTracking: {},
        keywords: [],
        opportunities: [],
        recommendations: [],
        technical: { issueCount: 1, highlights: [] },
        sourceStatuses: statuses,
      },
      llmFindings: [finding()],
    });

    expect(result.findings[0]).toMatchObject({
      teamId: "team-1",
      companyId: "company-1",
      domain: "example.com",
      source: "crawler",
      recommendation: "Fix the issue.",
    });
    expect(result.draftTasks[0]).toMatchObject({
      teamId: "team-1",
      companyId: "company-1",
      priority: "priority",
    });
  });

  test("blocks findings without evidence", () => {
    const result = runSeoHarness({
      domain: "example.com",
      teamId: "team-1",
      companyId: "company-1",
      sourceStatuses: statuses,
      normalizedSourceOutputs: {
        searchConsole: {} as never,
        pagespeed: {} as never,
        crawler: {} as never,
        rankTracking: {},
        keywords: [],
        opportunities: [],
        recommendations: [],
        technical: { issueCount: 0, highlights: [] },
        sourceStatuses: statuses,
      },
      llmFindings: [finding({ evidence: [] })],
    });

    expect(result.findings).toHaveLength(0);
    expect(result.draftTasks).toHaveLength(0);
    expect(result.blockedActions[0]?.reason).toContain("evidence is missing");
  });
});
