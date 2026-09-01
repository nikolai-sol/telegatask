import { describe, expect, test, vi } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import {
  LIGHTHOUSE_PROFILE_TIMEOUT_MS,
  collectLighthouseProfiles,
  executeLighthouseProcess,
  type LighthouseExec,
} from "./lighthouseCollector";
import type { DnsResolver } from "./networkSafety";

const PUBLIC_DNS: DnsResolver = async () => [{ address: "93.184.216.34", family: 4 }];

async function proxyConnectStatus(args: string[], authority: string): Promise<string> {
  const chromeFlags = args.find((item) => item.startsWith("--chrome-flags=")) || "";
  const match = /--proxy-server=http:\/\/127\.0\.0\.1:(\d+)/.exec(chromeFlags);
  if (!match) throw new Error("missing Lighthouse safety proxy");
  return new Promise<string>((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port: Number(match[1]) });
    let response = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("proxy response timeout"));
    }, 1_000);
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (!response.includes("\r\n\r\n")) return;
      clearTimeout(timer);
      socket.destroy();
      resolve(response.split("\r\n", 1)[0]);
    });
  });
}

function lighthouseFixture() {
  return {
    finalDisplayedUrl: "https://example.com/",
    categories: {
      performance: { score: 0.76 },
      accessibility: { score: 0.88, auditRefs: [{ id: "color-contrast" }] },
      "best-practices": { score: 0.73 },
      seo: { score: 1, auditRefs: [{ id: "crawlable-anchors" }, { id: "document-title" }] },
    },
    audits: {
      "first-contentful-paint": { numericValue: 1328 },
      "largest-contentful-paint": { numericValue: 2164 },
      "cumulative-layout-shift": { numericValue: 0.011 },
      "total-blocking-time": { numericValue: 42 },
      "speed-index": { numericValue: 4649 },
      "total-byte-weight": { numericValue: 5147000 },
      "unused-javascript": { numericValue: 12000, score: 0.2, title: "Reduce unused JavaScript", description: "Remove unused code" },
      "unused-css-rules": { numericValue: 3000, score: 0.1, title: "Reduce unused CSS", description: "Remove unused CSS" },
      "uses-long-cache-ttl": { score: 0, title: "Serve static assets with an efficient cache policy", description: "Cache static assets" },
      "font-display": { score: 0.5, title: "Ensure text remains visible during webfont load", description: "Use font-display" },
      "render-blocking-resources": { score: 0, title: "Eliminate render-blocking resources", description: "Defer CSS" },
      "color-contrast": { score: 0, title: "Background and foreground colors do not have a sufficient contrast ratio.", description: "Improve contrast" },
      "document-title": { score: 1, title: "Document has a <title> element", description: "Good title" },
      "crawlable-anchors": { score: 0, title: "Links are not crawlable", description: "Use crawlable anchors" },
    },
  };
}

describe("collectLighthouseProfiles", () => {
  test("runs the pinned local CLI with distinct safe mobile and desktop profiles", async () => {
    const calls: { file: string; args: string[]; options: unknown }[] = [];
    const execImpl: LighthouseExec = async (file, args, options) => {
      calls.push({ file, args, options });
      return JSON.stringify(lighthouseFixture());
    };

    const result = await collectLighthouseProfiles(["https://example.com/"], execImpl, { resolveDns: PUBLIC_DNS });

    expect(calls).toHaveLength(2);
    expect(calls[0].file).toBe(process.execPath);
    expect(calls[0].args[0]).toMatch(/lighthouse[/\\]cli[/\\]index\.js$/);
    expect(calls[0].args).not.toContain("-y");
    expect(calls[0].args.join(" ")).not.toContain("npx");
    expect(calls[0].args).toContain("--form-factor=mobile");
    expect(calls[0].args).toContain("--throttling-method=simulate");
    expect(calls[1].args).toContain("--preset=desktop");
    expect(calls[1].args).toContain("--throttling-method=provided");
    expect(calls[0].args.join(" ")).not.toContain("--no-sandbox");
    expect(calls[0].args.join(" ")).toContain("MAP example.com 93.184.216.34");
    expect(calls[0].options).toEqual({
      encoding: "utf8",
      maxBuffer: 40 * 1024 * 1024,
      timeout: LIGHTHOUSE_PROFILE_TIMEOUT_MS,
      killSignal: "SIGTERM",
      windowsHide: true,
    });
    expect(result.map((item) => item.device)).toEqual(["mobile", "desktop"]);
  });

  test("normalizes metrics, byte savings, insights, failed audits, and preserves raw payload", async () => {
    const raw = lighthouseFixture();
    const result = await collectLighthouseProfiles(
      ["https://example.com/"],
      async () => JSON.stringify(raw),
      { resolveDns: PUBLIC_DNS }
    );

    expect(result[0]).toMatchObject({
      url: "https://example.com/",
      device: "mobile",
      status: "success",
      measurementType: "lab",
      fieldData: { source: "CrUX", state: "not_collected" },
      categoryScores: { performance: 76, accessibility: 88, "best-practices": 73, seo: 100 },
      metrics: {
        firstContentfulPaintMs: 1328,
        largestContentfulPaintMs: 2164,
        cumulativeLayoutShift: 0.011,
        totalBlockingTimeMs: 42,
        speedIndexMs: 4649,
      },
      transferSizeBytes: 5147000,
      unusedJavaScriptBytes: 12000,
      unusedCssBytes: 3000,
      insights: ["uses-long-cache-ttl", "font-display", "render-blocking-resources"],
      failedAudits: expect.arrayContaining([
        expect.objectContaining({ id: "color-contrast", categories: ["accessibility"], title: expect.any(String), description: expect.any(String) }),
        expect.objectContaining({ id: "crawlable-anchors", categories: ["seo"] }),
      ]),
      rawPayload: raw,
    });
    expect(result[0].failedAudits).not.toContainEqual(expect.objectContaining({ id: "document-title" }));
    expect(result[0].rawPayload).toEqual(raw);
    expect(Object.keys(result[0])).not.toContain("rawPayload");
  });

  test("preserves requested identity separately from a safe same-origin final path", async () => {
    const raw = { ...lighthouseFixture(), finalDisplayedUrl: "https://example.com/final-path?private=value#fragment" };
    const [result] = await collectLighthouseProfiles(
      ["https://example.com/requested-path?token=secret"],
      async () => JSON.stringify(raw),
      { resolveDns: PUBLIC_DNS }
    );

    expect(result).toMatchObject({
      url: "https://example.com/requested-path",
      requestedUrl: "https://example.com/requested-path",
      finalUrl: "https://example.com/final-path",
      status: "success",
    });
    expect(JSON.stringify(result)).not.toMatch(/secret|private=value|#fragment/);
  });

  test("classifies an unexpected cross-origin final navigation as failed unsafe evidence", async () => {
    const raw = { ...lighthouseFixture(), finalDisplayedUrl: "https://other.example/landing?token=secret" };
    const result = await collectLighthouseProfiles(
      ["https://example.com/requested"],
      async () => JSON.stringify(raw),
      { resolveDns: PUBLIC_DNS }
    );

    expect(result).toHaveLength(2);
    expect(result).toEqual([
      expect.objectContaining({
        url: "https://example.com/requested",
        requestedUrl: "https://example.com/requested",
        finalUrl: "https://other.example/landing",
        device: "mobile",
        status: "failed",
        error: "Lighthouse final navigation left the audited origin",
      }),
      expect.objectContaining({
        url: "https://example.com/requested",
        requestedUrl: "https://example.com/requested",
        finalUrl: "https://other.example/landing",
        device: "desktop",
        status: "failed",
        error: "Lighthouse final navigation left the audited origin",
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("token=secret");
  });

  test("keeps the successful profile when the other profile fails and redacts the failure message", async () => {
    let callCount = 0;
    const result = await collectLighthouseProfiles(["https://example.com/"], async () => {
      callCount += 1;
      if (callCount === 1) throw new Error("spawn failed with token=super-secret");
      return JSON.stringify(lighthouseFixture());
    }, { resolveDns: PUBLIC_DNS });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ device: "mobile", status: "failed", error: "Lighthouse execution failed" });
    expect(result[0].error).not.toContain("super-secret");
    expect(result[1]).toMatchObject({ device: "desktop", status: "success" });
  });

  test("deep-sanitizes raw payload URLs, sensitive fields, and header-like secrets", async () => {
    const raw = {
      ...lighthouseFixture(),
      finalDisplayedUrl: "https://user:password@example.com/?access_token=top-secret#frag",
      request: {
        url: "https://signed:credential@example.com/assets/app.js?sig=signed-value#part",
        headers: [
          { name: "Authorization", value: "Bearer auth-secret" },
          { name: "cookie", value: "session=cookie-secret" },
          { name: "content-type", value: "application/javascript" },
        ],
      },
      apiKey: "api-key-secret",
      nested: { keep: "useful raw evidence" },
    };
    const result = await collectLighthouseProfiles(
      ["https://example.com/"],
      async () => JSON.stringify(raw),
      { resolveDns: PUBLIC_DNS }
    );
    const payload = result[0].rawPayload;
    const serialized = JSON.stringify(payload);

    expect(payload).toMatchObject({
      finalDisplayedUrl: "https://example.com/",
      request: {
        url: "https://example.com/assets/app.js",
        headers: "[REDACTED]",
      },
      apiKey: "[REDACTED]",
      nested: { keep: "useful raw evidence" },
    });
    expect(serialized).not.toMatch(/top-secret|signed-value|auth-secret|cookie-secret|api-key-secret/);
    expect(serialized).not.toMatch(/access_token=|sig=signed-value|user:password@|signed:credential@/);
  });

  test("deduplicates URLs in input order and caps collection at six targets", async () => {
    const calls: string[] = [];
    const urls = [
      "https://example.com/one?first=private",
      "https://example.com/one?second=private",
      "https://example.com/two",
      "https://example.com/three",
      "https://example.com/four",
      "https://example.com/five",
      "https://example.com/six",
      "https://example.com/seven",
    ];
    const result = await collectLighthouseProfiles(urls, async (_file, args) => {
      calls.push(args[1]);
      return JSON.stringify(lighthouseFixture());
    }, { resolveDns: PUBLIC_DNS });

    expect(calls).toHaveLength(12);
    expect(calls.filter((_, index) => index % 2 === 0)).toEqual([
      "https://example.com/one", "https://example.com/two", "https://example.com/three",
      "https://example.com/four", "https://example.com/five", "https://example.com/six",
    ]);
    expect(result).toHaveLength(12);
    expect(result.map((item) => item.url)).toEqual([
      "https://example.com/one", "https://example.com/one",
      "https://example.com/two", "https://example.com/two",
      "https://example.com/three", "https://example.com/three",
      "https://example.com/four", "https://example.com/four",
      "https://example.com/five", "https://example.com/five",
      "https://example.com/six", "https://example.com/six",
    ]);
    expect(result.every((item) => item.finalUrl === "https://example.com/")).toBe(true);
  });

  test("redacts proxy authorization in header-like, header-map, and tuple containers", async () => {
    const raw = {
      ...lighthouseFixture(),
      proxyHeader: { name: "Proxy-Authorization", value: "proxy-header-secret" },
      headers: {
        "Proxy-Authorization": "proxy-map-secret",
        "X-Request-Id": "header-map-secret",
      },
      requestHeaders: [["Proxy-Authorization", "proxy-tuple-secret"], ["X-Request-Id", "tuple-value-secret"]],
      responseHeaders: [{ name: "Proxy-Authorization", value: "proxy-response-secret" }],
    };
    const result = await collectLighthouseProfiles(
      ["https://example.com/"],
      async () => JSON.stringify(raw),
      { resolveDns: PUBLIC_DNS }
    );
    const payload = result[0].rawPayload;
    const serialized = JSON.stringify(payload);

    expect(payload).toMatchObject({
      proxyHeader: { name: "Proxy-Authorization", value: "[REDACTED]" },
      headers: "[REDACTED]",
      requestHeaders: "[REDACTED]",
      responseHeaders: "[REDACTED]",
    });
    expect(serialized).not.toMatch(/proxy-header-secret|proxy-map-secret|header-map-secret|proxy-tuple-secret|tuple-value-secret|proxy-response-secret/);
  });

  test("normalizes Lighthouse 13 insights and failed audits from every category with provenance", async () => {
    const fixture = {
      finalDisplayedUrl: "https://example.com/",
      categories: {
        performance: { score: 0.61, auditRefs: [
          { id: "cache-insight" },
          { id: "font-display-insight" },
          { id: "image-delivery-insight" },
          { id: "render-blocking-insight" },
        ] },
        accessibility: { score: 0.9, auditRefs: [{ id: "button-name" }] },
        "best-practices": { score: 0.8, auditRefs: [{ id: "errors-in-console" }] },
        seo: { score: 0.82, auditRefs: [{ id: "meta-description" }] },
      },
      audits: {
        "first-contentful-paint": { numericValue: 1000 },
        "largest-contentful-paint": { numericValue: 2500 },
        "cumulative-layout-shift": { numericValue: 0.12 },
        "total-blocking-time": { numericValue: 250 },
        "speed-index": { numericValue: 3300 },
        "interaction-to-next-paint": { numericValue: 310 },
        "total-byte-weight": { numericValue: 900000 },
        "unused-javascript": { numericValue: 45000 },
        "unused-css-rules": { numericValue: 12000 },
        "cache-insight": { score: 0, title: "Use efficient cache lifetimes" },
        "font-display-insight": { score: 0.5, title: "Optimize font display" },
        "image-delivery-insight": { score: 0, title: "Improve image delivery" },
        "render-blocking-insight": { score: 0, title: "Render-blocking requests" },
        "button-name": { score: 0, title: "Buttons do not have accessible names" },
        "errors-in-console": { score: 0, title: "Browser errors were logged" },
        "meta-description": { score: 0, title: "Document does not have a meta description" },
      },
    };

    const [result] = await collectLighthouseProfiles(
      ["https://example.com/"],
      async () => JSON.stringify(fixture),
      { resolveDns: PUBLIC_DNS }
    );

    expect(result.insights).toEqual([
      "cache-insight",
      "font-display-insight",
      "image-delivery-insight",
      "render-blocking-insight",
    ]);
    expect(result.metrics).toEqual({
      firstContentfulPaintMs: 1000,
      largestContentfulPaintMs: 2500,
      cumulativeLayoutShift: 0.12,
      totalBlockingTimeMs: 250,
      speedIndexMs: 3300,
      interactionToNextPaintMs: 310,
    });
    expect(result.failedAudits).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "cache-insight", categories: ["performance"] }),
      expect.objectContaining({ id: "button-name", categories: ["accessibility"] }),
      expect.objectContaining({ id: "errors-in-console", categories: ["best-practices"] }),
      expect.objectContaining({ id: "meta-description", categories: ["seo"] }),
    ]));
  });

  test("returns fixed timeout evidence and supplies subprocess cleanup options", async () => {
    const calls: unknown[] = [];
    const execImpl: LighthouseExec = async (_file, _args, options) => {
      calls.push(options);
      throw Object.assign(new Error("secret command detail"), { code: "ETIMEDOUT", killed: true });
    };

    const result = await collectLighthouseProfiles(
      ["https://example.com/"],
      execImpl,
      { resolveDns: PUBLIC_DNS }
    );

    expect(result).toHaveLength(2);
    expect(result.every((item) => item.error === "Lighthouse execution timed out")).toBe(true);
    expect(result.every((item) => item.measurementType === "lab")).toBe(true);
    expect(result.every((item) => item.fieldData.source === "CrUX" && item.fieldData.state === "not_collected")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret command detail");
    expect(calls).toEqual([
      expect.objectContaining({ timeout: LIGHTHOUSE_PROFILE_TIMEOUT_MS, killSignal: "SIGTERM" }),
      expect.objectContaining({ timeout: LIGHTHOUSE_PROFILE_TIMEOUT_MS, killSignal: "SIGTERM" }),
    ]);
  });

  test("does not start Lighthouse when DNS revalidation becomes private", async () => {
    const execImpl = vi.fn<LighthouseExec>();
    const result = await collectLighthouseProfiles(
      ["https://example.com/"],
      execImpl,
      { resolveDns: async () => [{ address: "127.0.0.1", family: 4 }] }
    );

    expect(execImpl).not.toHaveBeenCalled();
    expect(result).toEqual([
      expect.objectContaining({ device: "mobile", status: "failed", error: "Lighthouse target failed public-network validation" }),
      expect.objectContaining({ device: "desktop", status: "failed", error: "Lighthouse target failed public-network validation" }),
    ]);
  });

  test("formats a validated IPv6 address safely in the Chrome resolver rule", async () => {
    const calls: string[][] = [];
    await collectLighthouseProfiles(
      ["https://example.com/"],
      async (_file, args) => {
        calls.push(args);
        return JSON.stringify(lighthouseFixture());
      },
      { resolveDns: async () => [{ address: "2606:4700:4700::1111", family: 6 }] }
    );

    expect(calls[0].join(" ")).toContain('--host-resolver-rules="MAP example.com [2606:4700:4700::1111]"');
  });

  test("routes every browser destination through a validator that blocks private redirect and subresource targets", async () => {
    const resolvedHosts: string[] = [];
    const results = await collectLighthouseProfiles(
      ["https://example.com/"],
      async (_file, args) => {
        expect(await proxyConnectStatus(args, "private.example:443")).toBe("HTTP/1.1 502 Bad Gateway");
        expect(await proxyConnectStatus(args, "127.0.0.1:80")).toBe("HTTP/1.1 502 Bad Gateway");
        return JSON.stringify(lighthouseFixture());
      },
      {
        resolveDns: async (hostname) => {
          resolvedHosts.push(hostname);
          return [{ address: hostname === "example.com" ? "93.184.216.34" : "10.0.0.8", family: 4 }];
        },
      }
    );

    expect(results.every((item) => item.status === "success")).toBe(true);
    expect(resolvedHosts).toContain("private.example");
  });

  test.skipIf(process.platform === "win32")("survives an abrupt browser disconnect from a successful CONNECT tunnel", async () => {
    const script = String.raw`
      const net = require("node:net");
      const { once } = require("node:events");
      const originalConnect = net.connect;

      async function connectAndReset(proxyPort) {
        const client = originalConnect({ host: "127.0.0.1", port: proxyPort });
        client.on("error", () => {});
        await once(client, "connect");
        client.write("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n");
        let response = "";
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("CONNECT response timeout")), 1000);
          client.on("data", (chunk) => {
            response += chunk.toString("latin1");
            if (!response.includes("\r\n\r\n")) return;
            clearTimeout(timer);
            const status = response.split("\r\n", 1)[0];
            if (typeof client.resetAndDestroy === "function") client.resetAndDestroy();
            else client.destroy();
            resolve(status);
          });
        });
      }

      async function connectUntilUpstreamCloses(proxyPort) {
        const client = originalConnect({ host: "127.0.0.1", port: proxyPort });
        client.on("error", () => {});
        await once(client, "connect");
        client.write("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n");
        let response = "";
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            client.destroy();
            reject(new Error("browser socket stayed open after upstream close"));
          }, 1000);
          client.on("data", (chunk) => { response += chunk.toString("latin1"); });
          client.once("close", () => {
            clearTimeout(timer);
            resolve(response.split("\r\n", 1)[0]);
          });
        });
      }

      (async () => {
        const upstreamSockets = new Set();
        let upstreamConnections = 0;
        const upstreamServer = net.createServer((socket) => {
          upstreamConnections += 1;
          upstreamSockets.add(socket);
          socket.on("error", () => {});
          socket.on("close", () => upstreamSockets.delete(socket));
          if (upstreamConnections === 2) {
            setTimeout(() => socket.destroy(), 50);
            return;
          }
          const payload = Buffer.alloc(64 * 1024, 120);
          const pump = () => {
            while (!socket.destroyed && socket.write(payload)) {}
            if (!socket.destroyed) socket.once("drain", pump);
          };
          setImmediate(pump);
        });
        upstreamServer.listen(0, "127.0.0.1");
        await once(upstreamServer, "listening");
        const upstreamPort = upstreamServer.address().port;
        net.connect = () => originalConnect({ host: "127.0.0.1", port: upstreamPort });

        try {
          const { collectLighthouseProfiles } = require("./src/features/seoAgent/wgdReport/lighthouseCollector");
          let exercised = false;
          const fixture = JSON.stringify({ finalDisplayedUrl: "https://example.com/", categories: {}, audits: {} });
          const profiles = await collectLighthouseProfiles(["https://example.com/"], async (_file, args) => {
            if (!exercised) {
              exercised = true;
              const flags = args.find((item) => item.startsWith("--chrome-flags=")) || "";
              const match = /--proxy-server=http:\/\/127\.0\.0\.1:(\d+)/.exec(flags);
              if (!match) throw new Error("missing proxy port");
              const proxyPort = Number(match[1]);
              if (await connectAndReset(proxyPort) !== "HTTP/1.1 200 Connection Established") {
                throw new Error("first CONNECT did not succeed");
              }
              await new Promise((resolve) => setTimeout(resolve, 100));
              if (await connectUntilUpstreamCloses(proxyPort) !== "HTTP/1.1 200 Connection Established") {
                throw new Error("proxy did not propagate upstream tunnel closure");
              }
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            return fixture;
          }, { resolveDns: async () => [{ address: "93.184.216.34", family: 4 }] });
          await new Promise((resolve) => setTimeout(resolve, 50));
          if (profiles.length !== 2) throw new Error("profiles did not settle");
          if (upstreamConnections !== 2) throw new Error("unexpected upstream connection count");
          if (upstreamSockets.size !== 0) throw new Error("orphaned upstream tunnel socket");
          process.stdout.write("CONNECT_TEARDOWN_OK\n");
        } finally {
          net.connect = originalConnect;
          for (const socket of upstreamSockets) socket.destroy();
          await new Promise((resolve) => upstreamServer.close(resolve));
        }
      })().catch((error) => {
        process.stderr.write(String(error && (error.stack || error)) + "\n");
        process.exitCode = 1;
      });
    `;

    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ["-r", "ts-node/register/transpile-only", "-e", script], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("CONNECT regression subprocess timed out"));
      }, 10_000);
      child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
      child.once("error", reject);
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });

    expect(result).toEqual({ code: 0, stdout: "CONNECT_TEARDOWN_OK\n", stderr: "" });
  });

  test.skipIf(process.platform === "win32")("kills the detached Lighthouse process group so Chrome-like grandchildren cannot survive timeout", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wgd-lighthouse-cleanup-"));
    const pidPath = join(directory, "grandchild.pid");
    let grandchildPid: number | undefined;
    const script = [
      "const { spawn } = require('node:child_process')",
      "const { writeFileSync } = require('node:fs')",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
      "writeFileSync(process.argv[1], String(child.pid))",
      "setInterval(() => {}, 1000)",
    ].join(";");
    try {
      await expect(executeLighthouseProcess(process.execPath, ["-e", script, pidPath], {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        // Leave enough startup budget for the nested Node process under a
        // parallel Vitest run; the assertion is about cleanup after timeout.
        timeout: 2_000,
        killSignal: "SIGTERM",
        windowsHide: true,
      })).rejects.toMatchObject({ code: "ETIMEDOUT", killed: true, signal: "SIGTERM" });
      grandchildPid = Number(await readFile(pidPath, "utf8"));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(() => process.kill(grandchildPid, 0)).toThrow();
    } finally {
      if (grandchildPid) {
        try { process.kill(grandchildPid, "SIGKILL"); } catch { /* already terminated */ }
      }
      await rm(directory, { recursive: true, force: true });
    }
  });
});
