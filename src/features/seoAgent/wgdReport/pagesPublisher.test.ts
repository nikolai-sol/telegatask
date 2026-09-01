import {
  appendFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open as openFile,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  SEO_PUBLISH_REPORT_HELP,
  runPublishSeoReportCli,
} from "../../../../scripts/publishSeoReport";
import { buildPublishedWgdReport } from "./reportModel";
import { renderWgdHtml } from "./reportRenderer";
import type { WgdPublishedReport, WgdReportPayload } from "./types";
import { publishSeoReport } from "./pagesPublisher";

const REQUIRED_EVIDENCE = [
  "evidence/crawl.json",
  "evidence/provider-preflight.json",
  "evidence/yandex-serp.json",
  "evidence/yandex-ai-probes.json",
] as const;

function sourcePayload(repoRoot: string): WgdReportPayload {
  return {
    generatedAt: "2026-09-01T10:20:30.000Z",
    options: {
      url: "https://example.com/",
      domain: "example.com",
      market: "RU",
      language: "ru",
      region: "225",
      crawlLimit: 1,
      lighthousePageLimit: 0,
      keywords: [],
      aiQueries: [],
      priorityUrls: [],
      outDir: join(repoRoot, "reports"),
      sources: { dataForSeo: "not_applicable" },
    },
    sources: [],
    pages: [],
    lighthouse: [],
    findings: [],
    limitations: ["Lighthouse, LCP, CLS и Google Search Console доступны специалисту."],
    evidenceFiles: [...REQUIRED_EVIDENCE],
  };
}

async function fixture(): Promise<{
  repoRoot: string;
  reportDir: string;
  report: WgdPublishedReport;
}> {
  const repoRoot = await mkdtemp(join(tmpdir(), "seo-pages-repo-"));
  const reportDir = join(repoRoot, "reports", "reviewed-run");
  await mkdir(join(repoRoot, "mini-app"));
  await mkdir(join(reportDir, "evidence"), { recursive: true });
  const report = buildPublishedWgdReport(sourcePayload(repoRoot));
  await writeFile(join(reportDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(reportDir, "report.html"), renderWgdHtml(report));
  for (const path of REQUIRED_EVIDENCE) {
    await writeFile(join(reportDir, path), `${JSON.stringify({ source: path, ok: true }, null, 2)}\n`);
  }
  return { repoRoot, reportDir, report };
}

async function rewriteReport(
  reportDir: string,
  mutate: (report: Record<string, unknown>) => void,
  canonicalHtml = false
): Promise<void> {
  const report = JSON.parse(await readFile(join(reportDir, "report.json"), "utf8"));
  mutate(report);
  await writeFile(join(reportDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (canonicalHtml) await writeFile(join(reportDir, "report.html"), renderWgdHtml(report));
}

async function expectRejectedWithoutDestination(
  setup: (context: Awaited<ReturnType<typeof fixture>>) => Promise<void> | void
): Promise<void> {
  const context = await fixture();
  await setup(context);
  await expect(publishSeoReport({
    reportDir: context.reportDir,
    slug: "flowerlife-school",
    repoRoot: context.repoRoot,
  })).rejects.toThrow();
  await expect(lstat(join(context.repoRoot, "mini-app", "seo-reports", "flowerlife-school")))
    .rejects.toMatchObject({ code: "ENOENT" });
}

describe("publishSeoReport", () => {
  test("publishes the exact byte-identical Pages allowlist", async () => {
    const { repoRoot, reportDir } = await fixture();
    const sourceHtml = await readFile(join(reportDir, "report.html"));
    const sourceJson = await readFile(join(reportDir, "report.json"));

    const result = await publishSeoReport({
      reportDir: join("reports", "reviewed-run"),
      slug: "flowerlife-school",
      repoRoot,
    });

    expect(result).toEqual({
      destination: join(repoRoot, "mini-app", "seo-reports", "flowerlife-school"),
      trackedDestination: "mini-app/seo-reports/flowerlife-school",
      publicUrl: "https://nikolai-sol.github.io/telegatask/seo-reports/flowerlife-school/",
      files: ["evidence/crawl.json", "evidence/provider-preflight.json", "evidence/yandex-ai-probes.json", "evidence/yandex-serp.json", "index.html", "report.json"],
    });
    expect(await readdir(result.destination)).toEqual(["evidence", "index.html", "report.json"]);
    expect(await readdir(join(result.destination, "evidence"))).toEqual([
      "crawl.json", "provider-preflight.json", "yandex-ai-probes.json", "yandex-serp.json",
    ]);
    expect(await readFile(join(result.destination, "index.html"))).toEqual(sourceHtml);
    expect(await readFile(join(result.destination, "report.json"))).toEqual(sourceJson);
    expect(await readdir(reportDir)).toEqual(["evidence", "report.html", "report.json"]);
    expect((await readdir(join(repoRoot, "mini-app", "seo-reports"))).some((name) => name.startsWith("."))).toBe(false);
  });

  test("accepts an absolute source and a one-segment alphanumeric slug", async () => {
    const { repoRoot, reportDir } = await fixture();
    const result = await publishSeoReport({ reportDir, slug: "report7", repoRoot });
    expect(result.destination).toBe(resolve(repoRoot, "mini-app/seo-reports/report7"));
  });

  test.each([
    "", "Flowerlife-school", "flowerlife_ school", "flowerlife_school", "цветы", ".", "..",
    "-flowerlife", "flowerlife-", "flowerlife--school", "flowerlife/school", "flowerlife\\school",
    "flowerlife%2fschool", "a".repeat(64),
  ])("rejects unsafe slug %#", async (slug) => {
    const { repoRoot, reportDir } = await fixture();
    await expect(publishSeoReport({ reportDir, slug, repoRoot })).rejects.toThrow(/slug/i);
  });

  test.each(["report.html", "report.json", "evidence"])("rejects a missing required root entry: %s", async (entry) => {
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      await rename(join(reportDir, entry), join(reportDir, `${entry}.missing`));
    });
  });

  test.each(["manual-query-pack.md", "execution-plan.md", ".hidden"])("rejects unexpected root entry: %s", async (entry) => {
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      await writeFile(join(reportDir, entry), "unexpected");
    });
  });

  test.each(["extra.txt", ".hidden.json", "UPPER.json"])("rejects unexpected evidence entry: %s", async (entry) => {
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      await writeFile(join(reportDir, "evidence", entry), "{}");
    });
  });

  test("rejects nested evidence and source bundles inside the public root", async () => {
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      await mkdir(join(reportDir, "evidence", "nested"));
    });
    const { repoRoot, reportDir } = await fixture();
    const publicSource = join(repoRoot, "mini-app", "seo-reports", "source");
    await mkdir(join(repoRoot, "mini-app", "seo-reports"), { recursive: true });
    await rename(reportDir, publicSource);
    await expect(publishSeoReport({ reportDir: publicSource, slug: "target", repoRoot })).rejects.toThrow(/source/i);
  });

  test.each(["report", "evidence"])("rejects invalid JSON in %s", async (position) => {
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      const path = position === "report" ? join(reportDir, "report.json") : join(reportDir, REQUIRED_EVIDENCE[0]);
      await writeFile(path, "{invalid");
    });
  });

  test("rejects dangerous structural JSON keys at any depth", async () => {
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      await writeFile(join(reportDir, REQUIRED_EVIDENCE[0]), '{"safe":{"__proto__":{"polluted":true}}}');
    });
  });

  test.each([undefined, "1.0", "3.0", 2])("rejects unsupported schema version %#", async (version) => {
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      await rewriteReport(reportDir, (report) => {
        if (version === undefined) delete report.schemaVersion;
        else report.schemaVersion = version;
      });
    });
  });

  test.each(["en", "de", "ru<script>"])("rejects a non-Russian report language: %s", async (language) => {
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      await rewriteReport(reportDir, (report) => {
        (report.options as Record<string, unknown>).language = language;
      }, true);
    });
  });

  test.each(["assessment", "groupedFindings"])("rejects missing derived field: %s", async (field) => {
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      await rewriteReport(reportDir, (report) => delete report[field]);
    });
  });

  test.each(["pages", "sources", "findings", "lighthouse"])("rejects missing published-model array: %s", async (field) => {
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      await rewriteReport(reportDir, (report) => delete report[field]);
    });
  });

  test("rejects forged and out-of-range assessment values", async () => {
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      await rewriteReport(reportDir, (report) => {
        (report.assessment as Record<string, unknown>).displayScore = 101;
      });
    });
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      await rewriteReport(reportDir, (report) => {
        (report.assessment as Record<string, unknown>).completeness = "100";
      });
    });
  });

  test("uses structural equality rather than JSON property order for derived integrity", async () => {
    const { repoRoot, reportDir } = await fixture();
    await rewriteReport(reportDir, (report) => {
      report.assessment = Object.fromEntries(Object.entries(
        report.assessment as Record<string, unknown>
      ).reverse());
    });

    const result = await publishSeoReport({ reportDir, slug: "reordered", repoRoot });

    expect(result.trackedDestination).toBe("mini-app/seo-reports/reordered");
  });

  test.each(["pages", "sources", "findings", "lighthouse"])("rejects malformed children in published-model array: %s", async (field) => {
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      await rewriteReport(reportDir, (report) => {
        (report[field] as unknown[]).push("malformed-child");
      });
    });
  });

  test("rejects stale or non-canonical HTML and missing public markers", async () => {
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      await writeFile(join(reportDir, "report.html"), "<!doctype html><html lang=\"en\"><body>English report</body></html>");
    });
    for (const marker of [
      '<meta name="robots" content="noindex,nofollow">', "SEO-аудит сайта", "Общая оценка",
      "Что мешает росту", "Позиции в Яндексе", "Видимость в ответах Алисы", "Скорость и удобство",
      "Что делать сначала", "Подробнее по страницам", "Методика и доступность данных",
      "Данные проверки для специалиста",
    ]) {
      await expectRejectedWithoutDestination(async ({ reportDir }) => {
        const html = await readFile(join(reportDir, "report.html"), "utf8");
        await writeFile(join(reportDir, "report.html"), html.replace(marker, "removed"));
      });
    }
  });

  test.each([
    '<script>alert(1)</script>', '<base href="https://evil.example/">', '<iframe src="x"></iframe>',
    '<meta http-equiv="refresh" content="0;url=x">', '<div onclick="x()">x</div>',
    '<img src="x">', '<form action="x"></form>', '<style>.x{background:url(x)}</style>',
  ])("rejects active HTML addition %#", async (addition) => {
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      const html = await readFile(join(reportDir, "report.html"), "utf8");
      await writeFile(join(reportDir, "report.html"), html.replace("</body>", `${addition}</body>`));
    });
  });

  test.each([
    "https://evil.example/", "//evil.example/", "/root", "../secret", "%2e%2e/secret",
    "evidence\\crawl.json", "report.json?x=1", "javascript:alert(1)", "data:text/plain,x", "#missing",
  ])("rejects unsafe href %#", async (href) => {
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      const html = await readFile(join(reportDir, "report.html"), "utf8");
      await writeFile(join(reportDir, "report.html"), html.replace("</body>", `<a href="${href}">x</a></body>`));
    });
  });

  test("rejects mismatched, duplicate, incomplete, and missing Lighthouse evidence declarations", async () => {
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      await rewriteReport(reportDir, (report) => {
        (report.evidenceFiles as string[]).push(REQUIRED_EVIDENCE[0]);
      });
    });
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      await rewriteReport(reportDir, (report) => {
        report.evidenceFiles = (report.evidenceFiles as string[]).slice(1);
      });
    });
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      await writeFile(join(reportDir, "evidence", "extra.json"), "{}");
    });
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      await rewriteReport(reportDir, (report) => {
        report.lighthouse = [{
          url: "https://example.com/", device: "mobile", measurementType: "lab",
          fieldData: { source: "CrUX", state: "not_collected" }, rawPath: "evidence/missing.json",
        }];
      }, true);
    });
  });

  test.each([
    { raw: "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----" },
    { raw: `Authorization: Bearer ${["ghp", "123456789012345678901234567890123456"].join("_")}` },
    { raw: "Basic dXNlcjpwYXNzd29yZA==" },
    { raw: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdefghijklmnopqrstuvwxyz" },
    { raw: "eyJhbGciOiJIUzI1NiJ9.e30.abcdefghijklmnopqrstuvwxyz" },
    { raw: "https://user:password@example.com/" },
    { raw: "https://:hunter2@example.com/" },
    { raw: "https://example.com/?api_key=secretvalue" },
    { raw: ["xoxb", "1234567890", "1234567890", "abcdefghijklmnopqrstuvwxyz"].join("-") },
    { raw: ["github", "pat", "11AA0BBBB", "abcdefghijklmnopqrstuvwxyz0123456789"].join("_") },
    { raw: ["rk", "live", "abcdefghijklmnopqrstuvwxyz"].join("_") },
    { raw: ["ASIA", "ABCDEFGHIJKLMNOP"].join("") },
  ])("rejects raw credential-shaped content %#", async ({ raw }) => {
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      await writeFile(join(reportDir, REQUIRED_EVIDENCE[0]), JSON.stringify({ note: raw }));
    });
  });

  test.each([
    '{"note":"Bearer\\u0020abcdefghijk"}',
    '{"note":"Basic\\u0020YTo="}',
    '{"note":"Basic\\u0020YTo"}',
    '{"note":"\\u0065yJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz"}',
    '{"note":"\\u0067ithub_pat_11AA0BBBB_abcdefghijklmnopqrstuvwxyz0123456789"}',
    '{"note":"\\u002d----BEGIN PRIVATE KEY-----\\nsecret\\n-----END PRIVATE KEY-----"}',
  ])("rejects credential patterns revealed only after JSON decoding %#", async (rawJson) => {
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      await writeFile(join(reportDir, REQUIRED_EVIDENCE[0]), rawJson);
    });
  });

  test.each([
    { authentication: "live-secret" },
    { session: "live-secret" },
  ])("rejects decoded credential alias %#", async (value) => {
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      await writeFile(join(reportDir, REQUIRED_EVIDENCE[0]), JSON.stringify(value));
    });
  });

  test.each([
    { token: "live-secret" },
    { privateKey: "live-secret" },
    { headers: [["Authorization", "Bearer live-secret"]] },
    { header: { name: "Authorization", value: "Bearer live-secret" } },
  ])("rejects structured credential form %#", async (value) => {
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      await writeFile(join(reportDir, REQUIRED_EVIDENCE[1]), JSON.stringify(value));
    });
  });

  test("allows exact redaction sentinels and benign security prose", async () => {
    const { repoRoot, reportDir } = await fixture();
    await writeFile(join(reportDir, REQUIRED_EVIDENCE[0]), JSON.stringify({
      token: "[REDACTED]",
      privateKey: "[REDACTED PRIVATE KEY]",
      note: "The authentication token and password policy are documented; Lighthouse and Google Search Console are official names.",
      dottedProse: "release.notes.are.normal and docs.example.com is a hostname",
    }));
    const result = await publishSeoReport({ reportDir, slug: "benign", repoRoot });
    expect(result.files).toContain(REQUIRED_EVIDENCE[0]);
  });

  test("rejects source and Pages boundary symlinks", async () => {
    const first = await fixture();
    const sourceLink = join(first.repoRoot, "source-link");
    await symlink(first.reportDir, sourceLink, "dir");
    await expect(publishSeoReport({ reportDir: sourceLink, slug: "linked", repoRoot: first.repoRoot })).rejects.toThrow(/symlink/i);

    const second = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "seo-pages-outside-"));
    await symlink(outside, join(second.repoRoot, "mini-app", "seo-reports"), "dir");
    await expect(publishSeoReport({ reportDir: second.reportDir, slug: "linked", repoRoot: second.repoRoot })).rejects.toThrow(/symlink/i);
  });

  test("rejects a source bundle reached through a symlinked parent", async () => {
    const { repoRoot } = await fixture();
    await symlink(join(repoRoot, "reports"), join(repoRoot, "linked-reports"), "dir");

    await expect(publishSeoReport({
      reportDir: "linked-reports/reviewed-run",
      slug: "linked-parent",
      repoRoot,
    })).rejects.toThrow(/symlink/i);
  });

  test("rejects an absolute outside source reached through any symlinked parent", async () => {
    const { repoRoot, reportDir } = await fixture();
    const external = await mkdtemp(join(tmpdir(), "seo-pages-external-source-"));
    const linkedParent = join(external, "linked-parent");
    await symlink(join(repoRoot, "reports"), linkedParent, "dir");

    await expect(publishSeoReport({
      reportDir: join(linkedParent, "reviewed-run"),
      slug: "outside-linked-parent",
      repoRoot,
    })).rejects.toThrow(/symlink/i);
  });

  test("rejects a source directory identity swap between validated file reads", async () => {
    const { repoRoot, reportDir } = await fixture();
    const movedSource = `${reportDir}-moved`;
    const attackerRoot = await mkdtemp(join(tmpdir(), "seo-pages-source-swap-"));
    const attackerSource = join(attackerRoot, "reviewed-run");
    await cp(reportDir, attackerSource, { recursive: true });
    let swapped = false;

    await expect(publishSeoReport(
      { reportDir, slug: "source-identity-swap", repoRoot },
      { open: async (path, flags) => {
        const handle = await openFile(path, flags);
        return {
          stat: () => handle.stat(),
          read: (...args: Parameters<typeof handle.read>) => handle.read(...args),
          close: async () => {
            await handle.close();
            if (!swapped && basename(String(path)) === "report.html") {
              await rename(reportDir, movedSource);
              await symlink(attackerSource, reportDir, "dir");
              swapped = true;
            }
          },
        };
      } }
    )).rejects.toThrow(/source|bundle|identity|boundary/i);

    expect(swapped).toBe(true);
    await expect(lstat(join(repoRoot, "mini-app", "seo-reports", "source-identity-swap")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects root/evidence file symlinks without following them", async () => {
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      const target = join(reportDir, "target.html");
      await rename(join(reportDir, "report.html"), target);
      await symlink(target, join(reportDir, "report.html"));
    });
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      const target = join(reportDir, "crawl-target.json");
      await rename(join(reportDir, REQUIRED_EVIDENCE[0]), target);
      await symlink(target, join(reportDir, REQUIRED_EVIDENCE[0]));
    });
  });

  test("preserves an existing destination unless replace is enabled", async () => {
    const { repoRoot, reportDir } = await fixture();
    const destination = join(repoRoot, "mini-app", "seo-reports", "flowerlife-school");
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "old.txt"), "old bytes");

    await expect(publishSeoReport({ reportDir, slug: "flowerlife-school", repoRoot })).rejects.toThrow(/exists/i);
    expect(await readFile(join(destination, "old.txt"), "utf8")).toBe("old bytes");
    expect(await readdir(join(repoRoot, "mini-app", "seo-reports"))).toEqual(["flowerlife-school"]);
  });

  test("atomically replaces a verified old tree without merging stale evidence", async () => {
    const { repoRoot, reportDir } = await fixture();
    const destination = join(repoRoot, "mini-app", "seo-reports", "flowerlife-school");
    await mkdir(join(destination, "evidence"), { recursive: true });
    await writeFile(join(destination, "index.html"), "old");
    await writeFile(join(destination, "evidence", "stale.json"), "old");

    const result = await publishSeoReport({ reportDir, slug: "flowerlife-school", repoRoot, replace: true });

    expect(await readFile(join(result.destination, "index.html"), "utf8")).toContain("SEO-аудит сайта");
    expect(await readdir(join(result.destination, "evidence"))).not.toContain("stale.json");
    expect((await readdir(join(repoRoot, "mini-app", "seo-reports"))).some((name) => name.startsWith("."))).toBe(false);
  });

  test("verifies that a successful replace installs the exact staged directory identity", async () => {
    const { repoRoot, reportDir } = await fixture();
    const root = join(repoRoot, "mini-app", "seo-reports");
    const destination = join(root, "identity-match");
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "old.txt"), "old bytes");
    let stagedIdentity: { dev: number; ino: number } | undefined;

    const result = await publishSeoReport(
      { reportDir, slug: "identity-match", repoRoot, replace: true },
      { exclusiveRename: async (from, to) => {
        if (String(from).includes(".staging-") && basename(to) === "identity-match") {
          const status = await lstat(from);
          stagedIdentity = { dev: status.dev, ino: status.ino };
        }
        await rename(from, to);
      } }
    );

    const installed = await lstat(result.destination);
    expect(installed.isDirectory()).toBe(true);
    expect(installed.isSymbolicLink()).toBe(false);
    expect({ dev: installed.dev, ino: installed.ino }).toEqual(stagedIdentity);
  });

  test("rejects a symlink substituted for validated staging and restores the old destination", async () => {
    const { repoRoot, reportDir } = await fixture();
    const root = join(repoRoot, "mini-app", "seo-reports");
    const destination = join(root, "staging-swap");
    const attacker = await mkdtemp(join(tmpdir(), "seo-pages-staging-attacker-"));
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "old.txt"), "old bytes");
    let swapped = false;

    await expect(publishSeoReport(
      { reportDir, slug: "staging-swap", repoRoot, replace: true },
      { exclusiveRename: async (from, to) => {
        if (!swapped && String(from).includes(".staging-") && basename(to) === "staging-swap") {
          await rename(from, `${from}.genuine`);
          await symlink(attacker, from, "dir");
          swapped = true;
        }
        await rename(from, to);
      } }
    )).rejects.toThrow(/staging|identity|restored/i);

    expect(swapped).toBe(true);
    const restored = await lstat(destination);
    expect(restored.isDirectory()).toBe(true);
    expect(restored.isSymbolicLink()).toBe(false);
    expect(await readFile(join(destination, "old.txt"), "utf8")).toBe("old bytes");
    expect(await readdir(attacker)).toEqual([]);
    expect((await readdir(root)).filter((name) => name.startsWith("."))).toEqual([]);
  });

  test("rolls back old bytes when the staged-to-destination rename fails", async () => {
    const { repoRoot, reportDir } = await fixture();
    const root = join(repoRoot, "mini-app", "seo-reports");
    const destination = join(root, "flowerlife-school");
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "old.txt"), "old bytes");
    await expect(publishSeoReport(
      { reportDir, slug: "flowerlife-school", repoRoot, replace: true },
      { exclusiveRename: async () => {
        throw Object.assign(new Error("injected"), { code: "EIO" });
      } }
    )).rejects.toThrow(/publish/i);

    expect(await readFile(join(destination, "old.txt"), "utf8")).toBe("old bytes");
    expect((await readdir(root)).some((name) => name.startsWith("."))).toBe(false);
  });

  test("rolls back the installed bundle when backup cleanup fails", async () => {
    const { repoRoot, reportDir } = await fixture();
    const root = join(repoRoot, "mini-app", "seo-reports");
    const destination = join(root, "flowerlife-school");
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "old.txt"), "old bytes");
    let failedCleanup = false;

    await expect(publishSeoReport(
      { reportDir, slug: "flowerlife-school", repoRoot, replace: true },
      { rm: async (path, options) => {
        if (!failedCleanup && String(path).includes(".backup-")) {
          failedCleanup = true;
          throw Object.assign(new Error("injected backup cleanup failure"), { code: "EIO" });
        }
        await rm(path, options);
      } }
    )).rejects.toThrow(/cleanup|restored/i);

    expect(await readFile(join(destination, "old.txt"), "utf8")).toBe("old bytes");
    expect(await readdir(root)).toEqual(["flowerlife-school"]);
  });

  test("retains a typed recovery artifact when swap rollback also fails", async () => {
    const { repoRoot, reportDir } = await fixture();
    const root = join(repoRoot, "mini-app", "seo-reports");
    const destination = join(root, "flowerlife-school");
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "old.txt"), "old bytes");
    let renameCalls = 0;
    let caught: unknown;

    try {
      await publishSeoReport(
        { reportDir, slug: "flowerlife-school", repoRoot, replace: true },
        {
          exclusiveRename: async () => {
            throw Object.assign(new Error("injected rename failure"), { code: "EIO" });
          },
          rename: async (from, to) => {
            renameCalls += 1;
            if (renameCalls === 2) {
              throw Object.assign(new Error("injected rename failure"), { code: "EIO" });
            }
            await rename(from, to);
          },
        }
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ name: "PublishSeoReportError", state: "recovery_required" });
    const entries = await readdir(root);
    const backup = entries.find((name) => name.includes(".backup-"));
    expect(backup).toBeTruthy();
    expect(await readFile(join(root, backup!, "old.txt"), "utf8")).toBe("old bytes");
    expect(entries.some((name) => name.includes(".staging-"))).toBe(false);
    expect(entries.some((name) => name.includes(".publish-lock"))).toBe(false);
  });

  test("removes its exact staging tree when an injected stage write fails", async () => {
    const { repoRoot, reportDir } = await fixture();
    const root = join(repoRoot, "mini-app", "seo-reports");
    let writes = 0;

    await expect(publishSeoReport(
      { reportDir, slug: "stage-failure", repoRoot },
      { writeFile: async (path, data, options) => {
        writes += 1;
        if (writes === 2) throw Object.assign(new Error("injected"), { code: "EIO" });
        await writeFile(path, data, options);
      } }
    )).rejects.toThrow();

    expect(await readdir(root)).toEqual([]);
  });

  test("surfaces a recoverable staging artifact when exact staging cleanup fails", async () => {
    const { repoRoot, reportDir } = await fixture();
    const root = join(repoRoot, "mini-app", "seo-reports");
    let writes = 0;
    let caught: unknown;

    try {
      await publishSeoReport(
        { reportDir, slug: "stage-cleanup-failure", repoRoot },
        {
          writeFile: async (path, data, options) => {
            writes += 1;
            if (writes === 2) throw Object.assign(new Error("injected write failure"), { code: "EIO" });
            await writeFile(path, data, options);
          },
          rm: async (path, options) => {
            if (String(path).includes(".staging-")) {
              throw Object.assign(new Error("injected staging cleanup failure"), { code: "EIO" });
            }
            await rm(path, options);
          },
        }
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ name: "PublishSeoReportError", state: "recovery_required" });
    const entries = await readdir(root);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain(".stage-cleanup-failure.staging-");
    await rm(join(root, entries[0]!), { recursive: true, force: true });
  });

  test("cleans the captured staging identity but preserves and reports a lexical decoy", async () => {
    const { repoRoot, reportDir } = await fixture();
    const root = join(repoRoot, "mini-app", "seo-reports");
    const destination = join(root, "staging-cleanup-decoy");
    await mkdir(destination, { recursive: true });
    let stagingPath: string | undefined;
    let genuinePath: string | undefined;
    let swapped = false;
    let caught: unknown;
    const removedPaths: string[] = [];

    try {
      await publishSeoReport(
        { reportDir, slug: "staging-cleanup-decoy", repoRoot },
        {
          beforeMutation: async (operation) => {
            if (!swapped && operation === "before-staging-cleanup") {
              stagingPath = (await readdir(root)).map((name) => join(root, name))
                .find((path) => /\.staging-[0-9a-f-]+$/.test(basename(path)));
              expect(stagingPath).toBeTruthy();
              genuinePath = `${stagingPath}.genuine`;
              await rename(stagingPath!, genuinePath);
              await mkdir(stagingPath!);
              swapped = true;
            }
          },
          rm: async (path, options) => {
            removedPaths.push(String(path));
            await rm(path, options);
          },
        }
      );
    } catch (error) {
      caught = error;
    }

    expect(swapped).toBe(true);
    expect(removedPaths.some((path) => basename(path) === basename(genuinePath!))).toBe(true);
    expect((caught as { recoveryPaths: string[] }).recoveryPaths
      .some((path) => basename(path) === basename(stagingPath!))).toBe(true);
    expect(caught).toMatchObject({ name: "PublishSeoReportError", state: "recovery_required" });
    await expect(lstat(genuinePath!)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await lstat(stagingPath!)).toMatchObject({});
    await rm(stagingPath!, { recursive: true, force: true });
  });

  test("surfaces lock cleanup failure after publication without claiming unchanged state", async () => {
    const { repoRoot, reportDir } = await fixture();
    const root = join(repoRoot, "mini-app", "seo-reports");
    let caught: unknown;

    try {
      await publishSeoReport(
        { reportDir, slug: "lock-cleanup-failure", repoRoot },
        { rm: async (path, options) => {
          if (String(path).endsWith(".publish-lock")) {
            throw Object.assign(new Error("injected lock cleanup failure"), { code: "EIO" });
          }
          await rm(path, options);
        } }
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ name: "PublishSeoReportError", state: "published" });
    expect(await readFile(join(root, "lock-cleanup-failure", "index.html"), "utf8"))
      .toContain("SEO-аудит сайта");
    expect(await lstat(join(root, ".lock-cleanup-failure.publish-lock"))).toMatchObject({});
    await rm(join(root, ".lock-cleanup-failure.publish-lock"), { recursive: true, force: true });
  });

  test("rejects a Pages root identity swap before staging without writing outside or leaving managed staging", async () => {
    const { repoRoot, reportDir } = await fixture();
    const root = join(repoRoot, "mini-app", "seo-reports");
    const movedRoot = join(repoRoot, "mini-app", "seo-reports-original");
    const outside = await mkdtemp(join(tmpdir(), "seo-pages-root-swap-"));
    await mkdir(root);
    let swapped = false;

    await expect(publishSeoReport(
      { reportDir, slug: "root-swap", repoRoot },
      { beforeMutation: async (operation) => {
        if (!swapped && operation === "before-stage") {
          await rename(root, movedRoot);
          await symlink(outside, root, "dir");
          swapped = true;
        }
      } }
    )).rejects.toThrow(/boundary|identity|symlink/i);

    expect(swapped).toBe(true);
    expect(await readdir(outside)).toEqual([]);
    expect(await readdir(movedRoot)).toEqual([]);
    await expect(lstat(join(outside, "root-swap"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("fails closed when an empty destination appears in the final no-replace window", async () => {
    const { repoRoot, reportDir } = await fixture();
    const root = join(repoRoot, "mini-app", "seo-reports");
    const destination = join(root, "no-replace-race");
    let raced = false;

    await expect(publishSeoReport(
      { reportDir, slug: "no-replace-race", repoRoot },
      { beforeMutation: async (operation) => {
        if (!raced && operation === "before-create-commit") {
          await mkdir(destination);
          raced = true;
        }
      } }
    )).rejects.toThrow(/exists|race/i);

    expect(raced).toBe(true);
    expect(await readdir(destination)).toEqual([]);
    expect((await readdir(root)).filter((name) => name.startsWith("."))).toEqual([]);
  });

  test("eliminates the old final-rename callback window for no-replace publication", async () => {
    const { repoRoot, reportDir } = await fixture();
    const root = join(repoRoot, "mini-app", "seo-reports");
    const destination = join(root, "old-rename-window");
    let oldWindowEntered = false;

    const result = await publishSeoReport(
      { reportDir, slug: "old-rename-window", repoRoot },
      { rename: async (from, to) => {
        if (basename(to) === "old-rename-window") {
          oldWindowEntered = true;
          await mkdir(destination);
        }
        await rename(from, to);
      } }
    );

    expect(oldWindowEntered).toBe(false);
    expect(await readFile(join(result.destination, "index.html"), "utf8"))
      .toContain("SEO-аудит сайта");
  });

  test("atomically refuses an empty destination raced into the exclusive claim", async () => {
    const { repoRoot, reportDir } = await fixture();
    const root = join(repoRoot, "mini-app", "seo-reports");
    const destination = join(root, "claim-race");
    let raced = false;

    let stagedSurvivedFailedInstall = false;
    await expect(publishSeoReport(
      { reportDir, slug: "claim-race", repoRoot },
      { beforeMutation: async (operation) => {
        if (!raced && operation === "before-atomic-install") {
          await mkdir(destination);
          raced = true;
        }
        if (operation === "before-staging-cleanup") {
          const staging = (await readdir(root)).find((name) => /\.staging-[0-9a-f-]+$/.test(name));
          stagedSurvivedFailedInstall = Boolean(staging && (await lstat(join(root, staging))).isDirectory());
        }
      } }
    )).rejects.toThrow(/exists|claim|race/i);

    expect(raced).toBe(true);
    expect(stagedSurvivedFailedInstall).toBe(true);
    expect(await readdir(destination)).toEqual([]);
    expect((await readdir(root)).filter((name) => name.startsWith("."))).toEqual([]);
  });

  test("installs an absent destination without sequential writes through its public pathname", async () => {
    const { repoRoot, reportDir } = await fixture();
    let publicPathWrites = 0;

    const result = await publishSeoReport(
      { reportDir, slug: "rename-only-create", repoRoot },
      { writeFile: async (path, data, options) => {
        if (basename(dirname(String(path))) === "rename-only-create") publicPathWrites += 1;
        await writeFile(path, data, options);
      } }
    );

    expect(publicPathWrites).toBe(0);
    expect(await readFile(join(result.destination, "index.html"), "utf8"))
      .toContain("SEO-аудит сайта");
  });

  test("reports truthful moved-root recovery after a swap inside the final replace rename", async () => {
    const { repoRoot, reportDir } = await fixture();
    const root = join(repoRoot, "mini-app", "seo-reports");
    const movedRoot = join(repoRoot, "mini-app", "seo-reports-moved");
    const outside = await mkdtemp(join(tmpdir(), "seo-pages-final-root-swap-"));
    const destination = join(root, "final-root-swap");
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "old.txt"), "old bytes");
    let swapped = false;
    let caught: unknown;

    try {
      await publishSeoReport(
        { reportDir, slug: "final-root-swap", repoRoot, replace: true },
        { exclusiveRename: async (from, to) => {
          if (!swapped && String(from).includes(".staging-") && basename(to) === "final-root-swap") {
            await rename(root, movedRoot);
            await symlink(outside, root, "dir");
            const fakeStaging = join(outside, String(from).split("/").at(-1)!);
            await mkdir(fakeStaging);
            await writeFile(join(fakeStaging, "index.html"), "attacker content");
            swapped = true;
          }
          await rename(from, to);
        } }
      );
    } catch (error) {
      caught = error;
    }

    expect(swapped).toBe(true);
    expect(caught).toMatchObject({ name: "PublishSeoReportError", state: "recovery_required" });
    expect((caught as { recoveryPaths: string[] }).recoveryPaths.some((path) => path.startsWith(movedRoot))).toBe(true);
    expect(await readFile(join(movedRoot, "final-root-swap", "old.txt"), "utf8")).toBe("old bytes");
    expect((await readdir(movedRoot)).filter((name) => name.startsWith("."))).toEqual([]);
    expect(await readFile(join(outside, "final-root-swap", "index.html"), "utf8")).toBe("attacker content");
  });

  test("cleans captured create artifacts after the Pages root moves during atomic install", async () => {
    const { repoRoot, reportDir } = await fixture();
    const root = join(repoRoot, "mini-app", "seo-reports");
    const movedRoot = join(repoRoot, "mini-app", "seo-reports-create-moved");
    const outside = await mkdtemp(join(tmpdir(), "seo-pages-create-root-swap-"));
    let swapped = false;
    let caught: unknown;

    try {
      await publishSeoReport(
        { reportDir, slug: "create-root-swap", repoRoot },
        { exclusiveRename: async (from, to) => {
          if (!swapped) {
            await rename(root, movedRoot);
            await symlink(outside, root, "dir");
            const fakeStaging = join(outside, basename(from));
            await mkdir(fakeStaging);
            await writeFile(join(fakeStaging, "index.html"), "attacker content");
            swapped = true;
          }
          await rename(from, to);
        } }
      );
    } catch (error) {
      caught = error;
    }

    expect(swapped).toBe(true);
    expect(caught).toMatchObject({ name: "PublishSeoReportError", state: "recovery_required" });
    expect((caught as { recoveryPaths: string[] }).recoveryPaths.some((path) => path.startsWith(movedRoot))).toBe(true);
    expect(await readdir(movedRoot)).toEqual([]);
    expect(await readFile(join(outside, "create-root-swap", "index.html"), "utf8"))
      .toBe("attacker content");
  });

  test("rejects a file that grows beyond the cap between lstat and open", async () => {
    const { repoRoot, reportDir } = await fixture();
    let changed = false;

    await expect(publishSeoReport(
      { reportDir, slug: "growing-file", repoRoot },
      { beforeFileOpen: async (path) => {
        if (!changed && path.endsWith(join("evidence", "crawl.json"))) {
          changed = true;
          await appendFile(path, Buffer.alloc(33 * 1024 * 1024, 0x20));
        }
      } }
    )).rejects.toThrow(/size|changed/i);

    expect(changed).toBe(true);
  });

  test("rejects same-size mutation after a file handle was read", async () => {
    const { repoRoot, reportDir } = await fixture();
    const target = join(reportDir, REQUIRED_EVIDENCE[0]);
    const original = await readFile(target);
    const replacement = Buffer.from(original.toString("utf8").replace("true", "null"));
    expect(replacement.length).toBe(original.length);
    let changed = false;

    await expect(publishSeoReport(
      { reportDir, slug: "same-size-mutation", repoRoot },
      { afterFileRead: async (path) => {
        if (!changed && path.endsWith(join("evidence", "crawl.json"))) {
          changed = true;
          await writeFile(path, replacement);
        }
      } }
    )).rejects.toThrow(/changed/i);

    expect(changed).toBe(true);
  });

  test("reads each opened regular file with bounded positional reads instead of readFile", async () => {
    const { repoRoot, reportDir } = await fixture();
    let positionalReads = 0;
    let readFileCalled = false;

    const result = await publishSeoReport(
      { reportDir, slug: "bounded-reads", repoRoot },
      { open: async (path, flags) => {
        const handle = await openFile(path, flags);
        return {
          stat: () => handle.stat(),
          read: async (...args: Parameters<typeof handle.read>) => {
            positionalReads += 1;
            return handle.read(...args);
          },
          readFile: async () => {
            readFileCalled = true;
            throw new Error("unbounded readFile must not be used");
          },
          close: () => handle.close(),
        };
      } }
    );

    expect(result.files).toContain("report.json");
    expect(positionalReads).toBeGreaterThan(0);
    expect(readFileCalled).toBe(false);
  });

  test("rejects invalid UTF-8 in a JSON evidence file", async () => {
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      await writeFile(join(reportDir, REQUIRED_EVIDENCE[0]), Buffer.from([
        0x7b, 0x22, 0x6e, 0x6f, 0x74, 0x65, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d,
      ]));
    });
  });

  test("rejects invalid UTF-8 in HTML even when lossy decoding would equal the canonical rendering", async () => {
    await expectRejectedWithoutDestination(async ({ reportDir }) => {
      const source = JSON.parse(await readFile(join(reportDir, "report.json"), "utf8"));
      source.options.keywords = ["запрос �"];
      const report = buildPublishedWgdReport(source);
      await writeFile(join(reportDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
      await writeFile(join(reportDir, "report.html"), renderWgdHtml(report));
      const html = await readFile(join(reportDir, "report.html"));
      const replacement = Buffer.from([0xef, 0xbf, 0xbd]);
      const index = html.indexOf(replacement);
      expect(index).toBeGreaterThanOrEqual(0);
      await writeFile(join(reportDir, "report.html"), Buffer.concat([
        html.subarray(0, index), Buffer.from([0xff]), html.subarray(index + replacement.length),
      ]));
    });
  });

  test("a same-slug lock prevents interleaving while another slug remains independent", async () => {
    const { repoRoot, reportDir } = await fixture();
    const pagesRoot = join(repoRoot, "mini-app", "seo-reports");
    await mkdir(pagesRoot);
    await mkdir(join(pagesRoot, ".flowerlife-school.publish-lock"));

    await expect(publishSeoReport({ reportDir, slug: "flowerlife-school", repoRoot })).rejects.toThrow(/progress|lock/i);
    const other = await publishSeoReport({ reportDir, slug: "another-report", repoRoot });
    expect(other.trackedDestination).toBe("mini-app/seo-reports/another-report");
  });
});

describe("runPublishSeoReportCli", () => {
  test("shows help only when it is the sole argument", async () => {
    const stdout: string[] = [];
    expect(await runPublishSeoReportCli(["--help"], { stdout: (text) => stdout.push(text) })).toBe(0);
    expect(stdout).toEqual([SEO_PUBLISH_REPORT_HELP]);
    expect(await runPublishSeoReportCli(["--help", "--replace"], { stderr: vi.fn() })).toBe(1);
  });

  test.each([
    [], ["--slug", "x"], ["--report-dir", "x"], ["--slug", "x", "--slug", "y", "--report-dir", "r"],
    ["--report-dir", "r", "--report-dir", "s", "--slug", "x"], ["--report-dir", "--slug", "x"],
    ["--report-dir=r", "--slug", "x"], ["r", "--slug", "x"], ["--unknown"],
    ["--report-dir", "r", "--slug", "x", "--replace", "true"],
    ["--report-dir", "r", "--slug", "x", "--replace", "--replace"],
  ])("rejects strict CLI syntax %#", async (argv) => {
    const publish = vi.fn();
    const stderr = vi.fn();
    expect(await runPublishSeoReportCli(argv, { publish, stderr })).toBe(1);
    expect(publish).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledOnce();
  });

  test("passes parsed options and prints the tracked destination and intended URL", async () => {
    const stdout: string[] = [];
    const publish = vi.fn(async () => ({
      destination: "/repo/mini-app/seo-reports/flowerlife-school",
      trackedDestination: "mini-app/seo-reports/flowerlife-school",
      publicUrl: "https://nikolai-sol.github.io/telegatask/seo-reports/flowerlife-school/",
      files: ["index.html", "report.json"],
    }));
    const code = await runPublishSeoReportCli([
      "--report-dir", "reports/reviewed", "--slug", "flowerlife-school", "--replace",
    ], { publish, stdout: (text) => stdout.push(text) });

    expect(code).toBe(0);
    expect(publish).toHaveBeenCalledWith({ reportDir: "reports/reviewed", slug: "flowerlife-school", replace: true });
    expect(stdout.join("\n")).toContain("mini-app/seo-reports/flowerlife-school");
    expect(stdout.join("\n")).toContain("https://nikolai-sol.github.io/telegatask/seo-reports/flowerlife-school/");
    expect(stdout.join("\n")).not.toMatch(/deployed|pushed/i);
  });

  test("returns a generic failure without echoing hostile values", async () => {
    const stderr: string[] = [];
    const hostile = "TOP-SECRET-HOSTILE-PATH";
    const code = await runPublishSeoReportCli(["--report-dir", hostile, "--slug", "safe"], {
      publish: async () => { throw new Error(hostile); },
      stderr: (text) => stderr.push(text),
    });
    expect(code).toBe(1);
    expect(stderr.join("\n")).toBe("SEO report publication failed. Pages state may have changed; inspect the staging destination before retrying.");
    expect(stderr.join("\n")).not.toContain(hostile);
  });
});
