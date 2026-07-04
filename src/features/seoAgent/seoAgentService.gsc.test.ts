import { beforeEach, describe, expect, test, vi } from "vitest";
import { runSeoAnalysis } from "./seoAgentService";
import type { SeoAnalysisRun, SeoCompanyConfig } from "./types";

let persistedRun: SeoAnalysisRun | null = null;

vi.mock("./seoAnalysisRunRepository", () => ({
  createSeoAnalysisRun: vi.fn(async (input) => {
    persistedRun = {
      id: "run-1",
      status: "draft",
      createdAt: 1,
      ...input,
    };
    return persistedRun;
  }),
  findSeoAnalysisRunById: vi.fn(async () => persistedRun),
  findSeoAnalysisRunByTeamAndId: vi.fn(async () => persistedRun),
  updateSeoAnalysisRunStatusForTeam: vi.fn(async () => true),
}));

vi.mock("./seoDraftTaskRepository", () => ({
  createSeoDraftTasks: vi.fn(async () => []),
  findSeoDraftTaskById: vi.fn(async () => null),
  listSeoDraftTasksByRun: vi.fn(async () => []),
  markSeoDraftTaskConverted: vi.fn(async () => null),
  updateSeoDraftTaskStatus: vi.fn(async () => null),
}));

vi.mock("./gscCredentialRepository", () => ({
  getStoredGscCredential: vi.fn(async () => null),
}));

vi.mock("./providers/basicCrawlerSeoSource", () => ({
  BasicCrawlerSeoSource: class {
    async getSnapshot() {
      return {
        pageUrl: "https://zaruku.ru/",
        finalUrl: "https://zaruku.ru/",
        httpStatus: 200,
        hasTitle: true,
        hasMetaDescription: true,
        hasH1: true,
        hasCanonical: true,
        robotsTxtReachable: true,
        sitemapXmlReachable: true,
        isIndexable: true,
      };
    }
  },
}));

const config: SeoCompanyConfig = {
  id: "config-1",
  teamId: "team-1",
  companyId: "company-1",
  domain: "zaruku.ru",
  gscSiteUrl: "sc-domain:zaruku.ru",
  targetDomainAliases: ["zaruku.ru", "www.zaruku.ru"],
  markets: ["RU"],
  languages: ["ru"],
  competitors: [],
  importantSections: [],
  brandKeywords: [],
  excludeKeywords: [],
  trackingKeywords: [],
  targetLocation: "Russia",
  targetRegion: "225",
  targetDevice: "desktop",
  createdAt: 1,
  updatedAt: 1,
  createdByUserId: "user-1",
};

describe("runSeoAnalysis GSC activation path", () => {
  beforeEach(() => {
    persistedRun = null;
    delete process.env.GSC_ENABLED;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
  });

  test("marks selected GSC as skipped when credentials are not configured", async () => {
    const run = await runSeoAnalysis({
      teamId: "team-1",
      companyId: "company-1",
      config,
      mode: "quick_audit",
      createdByUserId: "user-1",
      sources: ["crawler", "gsc"],
      keywords: [],
      location: "Russia",
      region: "225",
      language: "ru",
      device: "desktop",
    });

    expect(run.sources).toEqual(["crawler", "gsc"]);
    expect(run.sourceStatuses.find((item) => item.source === "crawler")).toMatchObject({
      source: "crawler",
      status: "success",
    });
    expect(run.sourceStatuses.find((item) => item.source === "gsc")).toMatchObject({
      source: "gsc",
      status: "skipped",
      message: "Google Search Console source is not configured yet",
      errorCode: "GSC_NOT_CONFIGURED",
    });
    expect(run.searchConsole).toMatchObject({
      property: null,
      siteUrl: null,
      clicks: null,
      impressions: null,
      ctr: null,
      averagePosition: null,
      topQueries: [],
      topPages: [],
    });
  });
});
