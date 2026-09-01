import { access, lstat, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { LighthouseEvidence, WgdReportPayload } from "./types";
import { writeWgdArtifacts } from "./artifactWriter";

const RUN_NAME = "wgd-example-com-20260831-102030Z";
const REQUIRED_EVIDENCE = [
  "evidence/crawl.json",
  "evidence/provider-preflight.json",
  "evidence/yandex-serp.json",
  "evidence/yandex-ai-probes.json",
];

function payload(outDir: string, manual = true): WgdReportPayload {
  return {
    generatedAt: "2026-08-31T10:20:30.000Z",
    options: {
      url: "https://user:password@example.com/?token=private",
      domain: "example.com",
      market: "RU",
      language: "ru",
      region: "225",
      crawlLimit: 5,
      lighthousePageLimit: 1,
      keywords: [],
      aiQueries: [],
      priorityUrls: [],
      outDir,
      sources: { dataForSeo: "not_applicable" },
    },
    sources: [{ id: "crawler", state: "success", message: "Collected" }],
    crawl: {
      attemptedUrlCount: 1, eligibleDiscoveredCount: 1, droppedEligibleCount: 0, truncated: false,
      pages: [], robots: { url: "https://example.com/robots.txt", status: 200, sitemapUrls: [] },
      sitemapCandidates: [], discoveredUrls: [], excludedUrls: [], brokenUrls: [], redirectChains: [],
      duplicateTitles: {}, duplicateDescriptions: {}, limitations: [],
    },
    lighthouse: [{
      measurementType: "lab",
      fieldData: { source: "CrUX", state: "not_collected" },
      url: "https://example.com/", device: "mobile", status: "success",
      rawPayload: {
        finalDisplayedUrl: "https://example.com/?key=secret",
        signedUrl: "//signed:password@example.com/asset.js?signature=secret",
        apiKey: "never-write-this",
        auth: "auth-field-secret",
        requestAuthHeader: "opaque-auth-value",
        headers: { Authorization: "Bearer map-secret", Cookie: "cookie-secret", "X-Request-Id": "safe-id" },
        headerList: [{ name: "Proxy-Authorization", value: "Basic list-secret" }],
        headerTuples: [["authorization", "Bearer tuple-secret"], ["X-Request-Id", "safe-tuple"]],
        note: "Authorization: Bearer prose-secret\ntoken=field-secret",
        urlMap: { "//map-user:map-password@example.com/path?map-token=map-secret": "safe-map-value" },
      },
    }],
    yandex: {
      serpChecks: [], serpStatus: { state: "no_keywords", message: "No keywords", checkedAt: "2026-08-31T10:20:00Z" },
      aiProbes: [], aiSampleVisibility: { used: 0, checked: 0, rate: null },
      manualQueries: manual ? [{ source: "alice_ai", query: "best <flowers>", reason: "manual check" }] : [],
      limitations: [],
    },
    findings: [],
    limitations: [],
  };
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

describe("writeWgdArtifacts", () => {
  test("publishes a complete bundle with normalized evidence links and expanded manual capture fields", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "wgd-artifacts-"));
    const result = await writeWgdArtifacts(payload(outDir));

    expect(result.directory).toBe(join(outDir, RUN_NAME));
    expect(await readdir(result.directory)).toEqual(expect.arrayContaining(["evidence", "manual-query-pack.md", "report.html", "report.json"]));
    expect(await readdir(result.directory)).not.toContain("execution-plan.md");
    expect(result.evidenceFiles).toEqual([
      ...REQUIRED_EVIDENCE,
      "evidence/lighthouse-example-com-home-mobile.json",
    ]);

    const json = await readFile(result.reportJson, "utf8");
    const html = await readFile(result.reportHtml, "utf8");
    const evidence = await readFile(join(result.directory, result.evidenceFiles.at(-1)!), "utf8");
    const manual = await readFile(result.manualQueryPack!, "utf8");
    for (const relativePath of result.evidenceFiles) {
      expect(await exists(join(result.directory, relativePath))).toBe(true);
      expect(html).toContain(`href="${relativePath}"`);
    }
    expect(`${json}${html}${evidence}${manual}`).not.toMatch(
      /password|private|never-write-this|key=secret|map-secret|map-password|map-token|cookie-secret|list-secret|tuple-secret|prose-secret|field-secret|auth-field-secret|opaque-auth-value/
    );
    expect(evidence).toContain("safe-id");
    expect(evidence).toContain("safe-tuple");
    expect(json).not.toContain("rawPayload");
    expect(json).toContain("evidence/lighthouse-example-com-home-mobile.json");
    expect(json).toContain('"manualQueryPackPath": "manual-query-pack.md"');
    expect(html).toContain('href="manual-query-pack.md"');
    expect(html).toContain("best &lt;flowers&gt;");
    for (const heading of [
      "Source", "Query", "Reason", "Region", "Device", "Target position", "Matched URL",
      "Answer/source presence", "Snippet", "Competitors/sources above",
    ]) expect(manual).toContain(heading);
    expect(manual).toContain("| 225 | desktop |");
  });

  test("serializes one schema-2 scored model and renders the same recalculated assessment", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "wgd-published-model-"));
    const input = payload(outDir, false);
    input.assessment = { displayScore: 100, status: "good", forged: true };
    input.groupedFindings = [{ code: "homepage_noindex", forged: true }];

    const result = await writeWgdArtifacts(input);
    const report = JSON.parse(await readFile(result.reportJson, "utf8"));
    const html = await readFile(result.reportHtml, "utf8");

    expect(report.schemaVersion).toBe("2.0");
    expect(report.assessment).not.toHaveProperty("forged");
    expect(report.groupedFindings).toEqual([]);
    expect(report.assessment.pages).toEqual([]);
    expect(html).not.toContain("100 / 100");
    expect(`${JSON.stringify(report)}${html}`).not.toContain("forged");
  });

  test("filters malformed report arrays before JSON and HTML publication", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "wgd-malformed-model-"));
    const input = payload(outDir, false);
    input.pages = [null] as unknown as typeof input.pages;
    input.sources = [null, { id: "broken" }, input.sources![0]] as unknown as typeof input.sources;
    input.lighthouse = [null, ...(input.lighthouse || [])] as unknown as typeof input.lighthouse;
    const yandex = input.yandex as Record<string, unknown>;
    yandex.serpChecks = [null];
    yandex.aiProbes = [null];

    const result = await writeWgdArtifacts(input);
    const report = JSON.parse(await readFile(result.reportJson, "utf8"));
    const html = await readFile(result.reportHtml, "utf8");

    expect(report.pages).toEqual([]);
    expect(report.sources).toEqual([{ id: "crawler", state: "success", message: "Collected" }]);
    expect(report.lighthouse).toHaveLength(1);
    expect(report.yandex.serpChecks).toEqual([]);
    expect(report.yandex.aiProbes).toEqual([]);
    expect(html).toContain("<!doctype html>");
  });

  test("ignores an unsupported Lighthouse device while retaining valid profiles", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "wgd-lighthouse-device-"));
    const input = payload(outDir, false);
    input.lighthouse = [
      { url: "https://example.com/tablet", device: "tablet" },
      ...(input.lighthouse || []),
    ] as unknown as typeof input.lighthouse;

    const result = await writeWgdArtifacts(input);
    const report = JSON.parse(await readFile(result.reportJson, "utf8"));

    expect(report.lighthouse).toHaveLength(1);
    expect(report.lighthouse[0].device).toBe("mobile");
  });

  test("normalizes legacy profiles to explicit lab provenance and an uncollected CrUX field-data state", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "wgd-lighthouse-provenance-"));
    const input = payload(outDir, false);
    const legacyProfile = (input.lighthouse as unknown as Array<Record<string, unknown>>)[0];
    delete legacyProfile.measurementType;
    delete legacyProfile.fieldData;
    const result = await writeWgdArtifacts(input);
    const report = JSON.parse(await readFile(result.reportJson, "utf8"));
    const html = await readFile(result.reportHtml, "utf8");

    expect(report.lighthouse[0]).toMatchObject({
      measurementType: "lab",
      fieldData: { source: "CrUX", state: "not_collected" },
    });
    expect(html).toContain("Lighthouse моделирует загрузку в лабораторных условиях");
    expect(html).toContain("Данные CrUX");
    expect(html).toContain("Данные не собирались");
    expect(html).not.toContain("Данные CrUX о реальных посетителях не собирались");
  });

  test("redacts private-key fields, PEM variants, and session credential aliases", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "wgd-private-key-redaction-"));
    const input = payload(outDir);
    const raw = (input.lighthouse as LighthouseEvidence[])[0].rawPayload!;
    Object.assign(raw, {
      privateKey: "PRIVATE-KEY-FIELD-SECRET",
      private_key: "PRIVATE-KEY-SNAKE-SECRET",
      sessionId: "SESSION-ID-SECRET",
      sessionKey: "SESSION-KEY-SECRET",
      oauthToken: "OAUTH-TOKEN-SECRET",
      pemBlocks: [
        "-----BEGIN PRIVATE KEY-----\nPLAIN-PEM-SECRET\n-----END PRIVATE KEY-----",
        "-----BEGIN RSA PRIVATE KEY-----\nRSA-PEM-SECRET\n-----END RSA PRIVATE KEY-----",
        "-----BEGIN EC PRIVATE KEY-----\nEC-PEM-SECRET\n-----END EC PRIVATE KEY-----",
        "-----BEGIN OPENSSH PRIVATE KEY-----\nOPENSSH-PEM-SECRET\n-----END OPENSSH PRIVATE KEY-----",
      ],
    });

    const result = await writeWgdArtifacts(input);
    const evidence = JSON.parse(await readFile(join(result.directory, result.evidenceFiles.at(-1)!), "utf8"));
    const serialized = JSON.stringify(evidence);

    expect(evidence.privateKey).toBe("[REDACTED]");
    expect(evidence.private_key).toBe("[REDACTED]");
    expect(evidence.sessionId).toBe("[REDACTED]");
    expect(evidence.sessionKey).toBe("[REDACTED]");
    expect(evidence.oauthToken).toBe("[REDACTED]");
    expect(evidence.pemBlocks).toEqual(Array(4).fill("[REDACTED PRIVATE KEY]"));
    expect(serialized).not.toMatch(/FIELD-SECRET|SNAKE-SECRET|SESSION-|OAUTH-TOKEN-SECRET|PEM-SECRET|BEGIN .*PRIVATE KEY/);
  });

  test("uses the requested Lighthouse identity for raw evidence names and preserves the final URL", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "wgd-lighthouse-identity-"));
    const input = payload(outDir, false);
    const lighthouse = (input.lighthouse as LighthouseEvidence[])[0];
    lighthouse.url = "https://example.com/legacy-final";
    lighthouse.requestedUrl = "https://example.com/requested-page";
    lighthouse.finalUrl = "https://example.com/final-page";

    const result = await writeWgdArtifacts(input);
    const report = JSON.parse(await readFile(result.reportJson, "utf8"));

    expect(result.evidenceFiles).toContain("evidence/lighthouse-example-com-requested-page-mobile.json");
    expect(report.lighthouse[0]).toMatchObject({
      requestedUrl: "https://example.com/requested-page",
      finalUrl: "https://example.com/final-page",
    });
  });

  test("preserves benign author and authority metadata", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "wgd-author-preservation-"));
    const input = payload(outDir);
    const raw = (input.lighthouse as LighthouseEvidence[])[0].rawPayload!;
    Object.assign(raw, {
      author: "Alice Writer",
      "article:author": "Editorial Team",
      authority: "Example Standards Authority",
    });

    const result = await writeWgdArtifacts(input);
    const evidence = JSON.parse(await readFile(join(result.directory, result.evidenceFiles.at(-1)!), "utf8"));

    expect(evidence.author).toBe("Alice Writer");
    expect(evidence["article:author"]).toBe("Editorial Team");
    expect(evidence.authority).toBe("Example Standards Authority");
  });

  test("uses collision-safe directories and never carries a stale manual pack into a later run", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "wgd-artifacts-collision-"));
    const first = await writeWgdArtifacts(payload(outDir, true));
    const second = await writeWgdArtifacts(payload(outDir, false));

    expect(first.directory).toBe(join(outDir, RUN_NAME));
    expect(second.directory).toBe(join(outDir, `${RUN_NAME}-2`));
    expect(first.directory).not.toBe(second.directory);
    expect(await exists(join(first.directory, "manual-query-pack.md"))).toBe(true);
    expect(await exists(join(second.directory, "manual-query-pack.md"))).toBe(false);
    expect(await readdir(outDir)).not.toEqual(expect.arrayContaining([expect.stringMatching(/^\.wgd-staging-/)]));
  });

  test("publishes concurrent same-second runs to distinct complete directories", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "wgd-artifacts-concurrent-"));
    const results = await Promise.all([
      writeWgdArtifacts(payload(outDir, true)),
      writeWgdArtifacts(payload(outDir, false)),
    ]);

    expect(results.map((result) => result.directory).sort()).toEqual([
      join(outDir, RUN_NAME),
      join(outDir, `${RUN_NAME}-2`),
    ]);
    for (const result of results) {
      expect(await readdir(result.directory)).toEqual(expect.arrayContaining(["evidence", "report.html", "report.json"]));
    }
  });

  test("rejects symlink and non-directory output boundaries", async () => {
    const parent = await mkdtemp(join(tmpdir(), "wgd-out-boundary-"));
    const target = join(parent, "target");
    const linked = join(parent, "linked");
    const file = join(parent, "file");
    await mkdir(target);
    await symlink(target, linked, "dir");
    await writeFile(file, "not a directory");

    await expect(writeWgdArtifacts(payload(linked))).rejects.toThrow(/symlink/i);
    await expect(writeWgdArtifacts(payload(file))).rejects.toThrow(/directory/i);
    expect(await readdir(target)).toEqual([]);
  });

  test("never follows a pre-existing run or evidence symlink", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "wgd-existing-symlink-"));
    const outside = await mkdtemp(join(tmpdir(), "wgd-outside-"));
    const occupied = join(outDir, RUN_NAME);
    await mkdir(occupied);
    await symlink(outside, join(occupied, "evidence"), "dir");

    const result = await writeWgdArtifacts(payload(outDir));

    expect(result.directory).toBe(join(outDir, `${RUN_NAME}-2`));
    expect(await readdir(outside)).toEqual([]);
    expect((await lstat(join(occupied, "evidence"))).isSymbolicLink()).toBe(true);
  });

  test("never follows a pre-existing run-directory symlink", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "wgd-run-symlink-"));
    const outside = await mkdtemp(join(tmpdir(), "wgd-run-outside-"));
    await symlink(outside, join(outDir, RUN_NAME), "dir");

    const result = await writeWgdArtifacts(payload(outDir));

    expect(result.directory).toBe(join(outDir, `${RUN_NAME}-2`));
    expect(await readdir(outside)).toEqual([]);
  });

  test("rejects an invalid runtime device without traversal and cleans staging", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "wgd-device-traversal-"));
    const input = payload(outDir);
    (input.lighthouse as LighthouseEvidence[])[0].device = "../../escape" as "mobile";

    await expect(writeWgdArtifacts(input)).rejects.toThrow(/device/i);

    expect(await readdir(outDir)).toEqual([]);
    expect(await exists(join(outDir, "escape.json"))).toBe(false);
  });
});
