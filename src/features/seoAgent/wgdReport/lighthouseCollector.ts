import { spawn, type ChildProcess } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { connect as netConnect, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import type { DnsResolver, ResolvedPublicUrl } from "./networkSafety";
import { defaultDnsResolver, resolvePublicHttpUrl } from "./networkSafety";
import type { LighthouseEvidence, WgdDevice } from "./types";

export type LighthouseExecOptions = {
  encoding: "utf8";
  maxBuffer: number;
  timeout: number;
  killSignal: "SIGTERM";
  windowsHide: true;
};

/** Narrow process boundary so collection stays deterministic and easy to test. */
export type LighthouseExec = (
  file: string,
  args: string[],
  options: LighthouseExecOptions
) => Promise<string>;

export type LighthouseCollectorDependencies = { resolveDns?: DnsResolver };

type LighthouseAudit = {
  numericValue?: unknown;
  score?: unknown;
  title?: unknown;
  description?: unknown;
};

type LighthouseCategory = {
  score?: unknown;
  auditRefs?: Array<{ id?: unknown }>;
};

type LighthousePayload = {
  finalDisplayedUrl?: unknown;
  categories?: Record<string, LighthouseCategory | undefined>;
  audits?: Record<string, LighthouseAudit | undefined>;
  [key: string]: unknown;
};

const LIGHTHOUSE_CLI_PATH = require.resolve("lighthouse/cli/index.js");
const MAX_BUFFER = 40 * 1024 * 1024;
const MAX_TARGETS = 6;
const CATEGORY_LIST = "performance,accessibility,best-practices,seo";
const BASE_CHROME_FLAGS = "--headless=new --disable-gpu --disable-quic --disable-background-networking --force-webrtc-ip-handling-policy=disable_non_proxied_udp";
const PROCESS_KILL_GRACE_MS = 250;
const INSIGHT_AUDITS = [
  "cache-insight",
  "font-display-insight",
  "image-delivery-insight",
  "render-blocking-insight",
  "uses-long-cache-ttl",
  "font-display",
  "render-blocking-resources",
  "uses-optimized-images",
  "uses-responsive-images",
  "modern-image-formats",
  "efficient-animated-content",
] as const;
const REDACTED = "[REDACTED]";

export const LIGHTHOUSE_PROFILE_TIMEOUT_MS = 120_000;

// Used only for old/trimmed Lighthouse fixtures that omit category.auditRefs.
const ACCESSIBILITY_AUDITS = new Set([
  "aria-allowed-attr", "aria-conditional-attr", "aria-hidden-body", "aria-hidden-focus", "aria-prohibited-attr",
  "aria-valid-attr-value", "aria-valid-attr", "button-name", "bypass", "color-contrast", "duplicate-id-aria",
  "form-field-multiple-labels", "frame-tested", "heading-order", "html-has-lang", "html-lang-valid", "image-alt",
  "input-image-alt", "label", "link-name", "meta-refresh", "object-alt", "tabindex", "table-fake-caption",
  "td-headers-attr", "th-has-data-cells", "valid-lang", "video-caption",
]);
const SEO_AUDITS = new Set([
  "canonical", "crawlable-anchors", "document-title", "hreflang", "http-status-code", "is-crawlable", "link-text",
  "meta-description", "robots-txt", "structured-data", "tap-targets", "viewport",
]);

function processError(message: string, details: Record<string, unknown>): Error {
  return Object.assign(new Error(message), details);
}

function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): boolean {
  const pid = child.pid;
  if (!pid) return false;
  try {
    if (process.platform === "win32") return child.kill(signal);
    process.kill(-pid, signal);
    return true;
  } catch {
    // The group may already have exited; cleanup remains idempotent.
    return false;
  }
}

async function terminateProcessGroup(child: ChildProcess, signal: "SIGTERM"): Promise<void> {
  const signaled = signalProcessGroup(child, signal);
  if (!signaled) return;
  await new Promise((resolve) => setTimeout(resolve, PROCESS_KILL_GRACE_MS));
  signalProcessGroup(child, "SIGKILL");
}

/** Execute the local Lighthouse wrapper in its own process group with bounded output and two-phase cleanup. */
export const executeLighthouseProcess: LighthouseExec = (file, args, options) => new Promise((resolve, reject) => {
  const child = spawn(file, args, {
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: options.windowsHide,
  });
  const chunks: Buffer[] = [];
  let total = 0;
  let settled = false;
  let termination: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const settle = (callback: () => void) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    callback();
  };
  const terminateAndReject = (error: Error) => {
    if (settled || termination) return;
    termination = terminateProcessGroup(child, options.killSignal).then(() => {
      settle(() => reject(error));
    });
  };

  timer = setTimeout(() => terminateAndReject(processError("Lighthouse execution timed out", {
    code: "ETIMEDOUT",
    killed: true,
    signal: options.killSignal,
  })), Math.max(1, Math.floor(options.timeout)));

  child.stdout?.on("data", (rawChunk: Buffer | string) => {
    if (settled) return;
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk, options.encoding);
    total += chunk.length;
    if (total > options.maxBuffer) {
      terminateAndReject(processError("Lighthouse output exceeded the configured limit", {
        code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
        killed: true,
        signal: options.killSignal,
      }));
      return;
    }
    chunks.push(chunk);
  });
  child.once("error", (error) => settle(() => reject(error)));
  child.once("close", (code, signal) => {
    if (settled) return;
    if (code === 0) {
      if (timer) clearTimeout(timer);
      timer = undefined;
      termination = terminateProcessGroup(child, options.killSignal).then(() => {
        settle(() => resolve(Buffer.concat(chunks, total).toString(options.encoding)));
      });
      return;
    }
    terminateAndReject(processError("Lighthouse process exited unsuccessfully", {
      code: typeof code === "number" ? code : "ERR_LIGHTHOUSE_PROCESS",
      killed: Boolean(signal),
      signal: signal || null,
    }));
  });
});

const defaultLighthouseExec: LighthouseExec = executeLighthouseProcess;

type LighthouseSafetyProxy = { url: string; close(): Promise<void> };

function pinnedLookup(address: { address: string; family: 4 | 6 }): (...args: unknown[]) => void {
  return (_hostname: unknown, rawOptions: unknown, rawCallback?: unknown) => {
    const callback = typeof rawOptions === "function" ? rawOptions : rawCallback;
    if (typeof callback !== "function") return;
    if (rawOptions && typeof rawOptions === "object" && "all" in rawOptions && rawOptions.all) {
      callback(null, [address]);
    } else {
      callback(null, address.address, address.family);
    }
  };
}

function fixedProxyFailure(socket: Duplex): void {
  if (!socket.destroyed) socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
}

function createConnectTunnelLifecycle(clientSocket: Duplex): {
  readonly closed: boolean;
  attach(upstream: Socket): void;
  establish(head: Buffer): void;
  failSetup(): void;
} {
  let upstream: Socket | undefined;
  let established = false;
  let setupFailed = false;
  let closed = false;

  const teardown = () => {
    if (closed) return;
    closed = true;
    if (upstream) {
      clientSocket.unpipe(upstream);
      upstream.unpipe(clientSocket);
    }
    if (!clientSocket.destroyed) clientSocket.destroy();
    if (upstream && !upstream.destroyed) upstream.destroy();
  };
  const failSetup = () => {
    if (closed || established || setupFailed) return;
    setupFailed = true;
    if (upstream && !upstream.destroyed) upstream.destroy();
    fixedProxyFailure(clientSocket);
  };

  // These handlers remain until close so repeated EPIPE/ECONNRESET events from
  // Readable.pipe cannot outlive an internal one-shot listener.
  clientSocket.on("error", teardown);
  clientSocket.on("close", teardown);

  return {
    get closed() {
      return closed || clientSocket.destroyed;
    },
    attach(socket) {
      if (upstream) throw new Error("CONNECT upstream already attached");
      upstream = socket;
      upstream.on("error", () => {
        if (established) teardown();
        else failSetup();
      });
      upstream.on("close", () => {
        if (established) teardown();
        else if (!setupFailed) failSetup();
      });
      if (closed && !upstream.destroyed) upstream.destroy();
    },
    establish(head) {
      if (closed || setupFailed || !upstream || clientSocket.destroyed || upstream.destroyed) {
        teardown();
        return;
      }
      established = true;
      clientSocket.write("HTTP/1.1 200 Connection Established\r\nProxy-Agent: TelegaTask-WGD\r\n\r\n");
      if (head.length) upstream.write(head);
      if (closed) return;
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    },
    failSetup,
  };
}

async function startLighthouseSafetyProxy(resolveDns: DnsResolver): Promise<LighthouseSafetyProxy> {
  const sockets = new Set<Socket>();
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  };
  const server = createServer((request, response) => {
    void (async () => {
      const host = typeof request.headers.host === "string" ? request.headers.host : "";
      const candidate = /^https?:\/\//i.test(request.url || "")
        ? request.url!
        : host
          ? `http://${host}${request.url || "/"}`
          : "";
      const resolution = await resolvePublicHttpUrl(candidate, resolveDns);
      const target = new URL(resolution.url);
      const headers = { ...request.headers };
      delete headers["proxy-authorization"];
      delete headers["proxy-connection"];
      const upstream = (target.protocol === "https:" ? httpsRequest : httpRequest)(target, {
        method: request.method,
        headers,
        lookup: pinnedLookup(resolution.addresses[0]) as never,
      }, (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      });
      upstream.once("socket", track);
      upstream.once("error", () => {
        if (!response.headersSent) response.writeHead(502, { Connection: "close", "Content-Length": "0" });
        response.end();
      });
      request.pipe(upstream);
    })().catch(() => {
      request.resume();
      if (!response.headersSent) response.writeHead(502, { Connection: "close", "Content-Length": "0" });
      response.end();
    });
  });
  server.on("connection", (socket) => track(socket));
  server.on("connect", (request, clientSocket, head) => {
    const tunnel = createConnectTunnelLifecycle(clientSocket);
    void (async () => {
      const authority = String(request.url || "").trim();
      const target = new URL(`https://${authority}/`);
      if (target.username || target.password) throw new Error("invalid proxy target");
      const port = target.port ? Number(target.port) : 443;
      if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("invalid proxy port");
      const resolution = await resolvePublicHttpUrl(target.toString(), resolveDns);
      if (tunnel.closed) return;
      const address = resolution.addresses[0];
      const upstream = netConnect({ host: address.address, port, family: address.family });
      tunnel.attach(upstream);
      track(upstream);
      upstream.once("connect", () => tunnel.establish(head));
    })().catch(() => tunnel.failSetup());
  });
  server.on("clientError", (_error, socket) => {
    if (!socket.destroyed) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  let closed = false;
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function score(value: unknown): number | null {
  const number = finiteNumber(value);
  return number === null ? null : Math.round(number * 100);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** Keep process arguments and normalized evidence free of URL userinfo/query secrets. */
function safeTargetUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function sameOrigin(first: string, second: string): boolean {
  try {
    return new URL(first).origin === new URL(second).origin;
  } catch {
    return false;
  }
}

function sensitiveKey(value: string): boolean {
  const key = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return key.includes("authorization") || key === "cookie" || key === "setcookie"
    || key.includes("token") || key.includes("secret") || key.includes("password")
    || key.includes("credential") || key.includes("apikey");
}

function headerContainerKey(value: string): boolean {
  const key = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return key === "headers" || key.endsWith("headers") || key.endsWith("headermap") || key.endsWith("headerlist");
}

function sanitizeRawString(value: string): string {
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return value;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

/** Clone JSON evidence while removing URL credentials/query data and secret values. */
function sanitizeRawPayload(value: unknown, parentKey?: string): unknown {
  if (parentKey && sensitiveKey(parentKey)) return REDACTED;
  if (typeof value === "string") return sanitizeRawString(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeRawPayload(item));
  if (!isObject(value)) return value;

  const entries = Object.entries(value);
  const nameEntry = entries.find(([key]) => key.toLowerCase() === "name");
  const headerName = typeof nameEntry?.[1] === "string" ? nameEntry[1] : "";
  const output: Record<string, unknown> = {};
  for (const [key, item] of entries) {
    if (headerContainerKey(key)) {
      output[key] = REDACTED;
    } else if (sensitiveKey(key) || (key.toLowerCase() === "value" && sensitiveKey(headerName))) {
      output[key] = REDACTED;
    } else {
      output[key] = sanitizeRawPayload(item, key);
    }
  }
  return output;
}

function profileArgs(
  url: string,
  device: WgdDevice,
  resolution: ResolvedPublicUrl,
  proxyUrl: string
): string[] {
  const profile = device === "mobile"
    ? ["--form-factor=mobile", "--throttling-method=simulate"]
    : ["--preset=desktop", "--throttling-method=provided"];
  const firstAddress = resolution.addresses[0];
  const pinnedAddress = firstAddress.family === 6 ? `[${firstAddress.address}]` : firstAddress.address;
  const resolverRule = JSON.stringify(`MAP ${resolution.hostname} ${pinnedAddress}`);
  const chromeFlags = `${BASE_CHROME_FLAGS} --host-resolver-rules=${resolverRule} --proxy-server=${proxyUrl} --proxy-bypass-list=<-loopback>`;
  return [
    LIGHTHOUSE_CLI_PATH,
    url,
    "--quiet",
    "--output=json",
    "--output-path=stdout",
    ...profile,
    `--only-categories=${CATEGORY_LIST}`,
    `--chrome-flags=${chromeFlags}`,
  ];
}

function readAudit(audits: Record<string, LighthouseAudit | undefined>, id: string): LighthouseAudit {
  const audit = audits[id];
  return audit && typeof audit === "object" ? audit : {};
}

function auditFailed(audit: LighthouseAudit): boolean {
  const auditScore = finiteNumber(audit.score);
  return auditScore !== null && auditScore < 1;
}

function categoryAuditIds(category: LighthouseCategory | undefined, fallback: Set<string>): string[] {
  const refs = category?.auditRefs;
  if (Array.isArray(refs)) {
    return refs
      .map((ref) => ref && typeof ref.id === "string" ? ref.id : "")
      .filter(Boolean);
  }
  return Array.from(fallback);
}

function normalizeFailedAudits(
  categories: Record<string, LighthouseCategory | undefined>,
  audits: Record<string, LighthouseAudit | undefined>
): LighthouseEvidence["failedAudits"] {
  const fallbacks: Record<string, Set<string>> = {
    performance: new Set(),
    accessibility: ACCESSIBILITY_AUDITS,
    "best-practices": new Set(),
    seo: SEO_AUDITS,
  };
  const provenance = new Map<string, string[]>();
  for (const category of ["performance", "accessibility", "best-practices", "seo"] as const) {
    for (const id of categoryAuditIds(categories[category], fallbacks[category])) {
      if (!auditFailed(readAudit(audits, id))) continue;
      const existing = provenance.get(id) ?? [];
      if (!existing.includes(category)) existing.push(category);
      provenance.set(id, existing);
    }
  }
  return Array.from(provenance, ([id, auditCategories]) => {
    const audit = readAudit(audits, id);
    const title = typeof audit.title === "string" && audit.title.trim() ? audit.title.trim() : undefined;
    const description = typeof audit.description === "string" && audit.description.trim() ? audit.description.trim() : undefined;
    return {
      id,
      ...(title ? { title } : {}),
      score: finiteNumber(audit.score),
      ...(description ? { description } : {}),
      categories: auditCategories,
    };
  });
}

function normalizePayload(url: string, device: WgdDevice, payload: LighthousePayload): LighthouseEvidence {
  const categories = payload.categories && isObject(payload.categories) ? payload.categories : {};
  const audits = payload.audits && isObject(payload.audits) ? payload.audits : {};
  const performance = categories.performance;
  const accessibility = categories.accessibility;
  const bestPractices = categories["best-practices"];
  const seo = categories.seo;
  const failedAudits = normalizeFailedAudits(categories, audits);
  const insights = INSIGHT_AUDITS.filter((id) => auditFailed(readAudit(audits, id)));
  const hasReportedFinalUrl = typeof payload.finalDisplayedUrl === "string";
  const finalUrl = hasReportedFinalUrl ? safeTargetUrl(payload.finalDisplayedUrl as string) : url;
  if (!finalUrl) return failedEvidence(url, device, "Lighthouse final navigation was unsafe");
  if (!sameOrigin(url, finalUrl)) {
    return failedEvidence(url, device, "Lighthouse final navigation left the audited origin", finalUrl);
  }

  const evidence: LighthouseEvidence = {
    url,
    requestedUrl: url,
    finalUrl,
    device,
    status: "success",
    measurementType: "lab",
    fieldData: { source: "CrUX", state: "not_collected" },
    categoryScores: {
      performance: score(performance?.score),
      accessibility: score(accessibility?.score),
      "best-practices": score(bestPractices?.score),
      seo: score(seo?.score),
    },
    metrics: {
      firstContentfulPaintMs: finiteNumber(readAudit(audits, "first-contentful-paint").numericValue),
      largestContentfulPaintMs: finiteNumber(readAudit(audits, "largest-contentful-paint").numericValue),
      cumulativeLayoutShift: finiteNumber(readAudit(audits, "cumulative-layout-shift").numericValue),
      totalBlockingTimeMs: finiteNumber(readAudit(audits, "total-blocking-time").numericValue),
      speedIndexMs: finiteNumber(readAudit(audits, "speed-index").numericValue),
      interactionToNextPaintMs: finiteNumber(readAudit(audits, "interaction-to-next-paint").numericValue),
    },
    transferSizeBytes: finiteNumber(readAudit(audits, "total-byte-weight").numericValue),
    unusedJavaScriptBytes: finiteNumber(readAudit(audits, "unused-javascript").numericValue),
    unusedCssBytes: finiteNumber(readAudit(audits, "unused-css-rules").numericValue),
    insights,
    failedAudits,
  };
  Object.defineProperty(evidence, "rawPayload", {
    value: sanitizeRawPayload(payload),
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return evidence;
}

function failedEvidence(requestedUrl: string, device: WgdDevice, error: string, finalUrl = requestedUrl): LighthouseEvidence {
  return {
    url: requestedUrl,
    requestedUrl,
    finalUrl,
    device,
    status: "failed",
    measurementType: "lab",
    fieldData: { source: "CrUX", state: "not_collected" },
    error,
    categoryScores: { performance: null, accessibility: null, "best-practices": null, seo: null },
    metrics: {
      firstContentfulPaintMs: null,
      largestContentfulPaintMs: null,
      cumulativeLayoutShift: null,
      totalBlockingTimeMs: null,
      speedIndexMs: null,
      interactionToNextPaintMs: null,
    },
    transferSizeBytes: null,
    unusedJavaScriptBytes: null,
    unusedCssBytes: null,
    insights: [],
    failedAudits: [],
  };
}

function executionTimedOut(error: unknown): boolean {
  if (!isObject(error)) return false;
  return error.code === "ETIMEDOUT" || (error.killed === true && error.signal === "SIGTERM");
}

async function collectOne(
  url: string,
  device: WgdDevice,
  resolution: ResolvedPublicUrl,
  execImpl: LighthouseExec,
  resolveDns: DnsResolver
): Promise<LighthouseEvidence> {
  if (!url) return failedEvidence(url, device, "Invalid Lighthouse URL");
  if (process.platform === "win32" && execImpl === defaultLighthouseExec) {
    return failedEvidence(url, device, "Lighthouse secure process isolation is unavailable on this platform");
  }
  let proxy: LighthouseSafetyProxy | undefined;
  try {
    proxy = await startLighthouseSafetyProxy(resolveDns);
    const raw = await execImpl(process.execPath, profileArgs(url, device, resolution, proxy.url), {
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      timeout: LIGHTHOUSE_PROFILE_TIMEOUT_MS,
      killSignal: "SIGTERM",
      windowsHide: true,
    });
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) return failedEvidence(url, device, "Invalid Lighthouse JSON output");
    return normalizePayload(url, device, parsed as LighthousePayload);
  } catch (error) {
    return failedEvidence(
      url,
      device,
      executionTimedOut(error) ? "Lighthouse execution timed out" : "Lighthouse execution failed"
    );
  } finally {
    await proxy?.close().catch(() => undefined);
  }
}

/** Run independent mobile and desktop Lighthouse profiles for each requested URL. */
export async function collectLighthouseProfiles(
  urls: string[],
  execImpl: LighthouseExec = defaultLighthouseExec,
  dependencies: LighthouseCollectorDependencies = {}
): Promise<LighthouseEvidence[]> {
  const targets: string[] = [];
  const seen = new Set<string>();
  for (const rawUrl of urls) {
    const url = typeof rawUrl === "string" ? safeTargetUrl(rawUrl) : null;
    if (url && !seen.has(url) && targets.length < MAX_TARGETS) {
      seen.add(url);
      targets.push(url);
    }
  }

  const output: LighthouseEvidence[] = [];
  const resolver = dependencies.resolveDns ?? defaultDnsResolver;
  for (const url of targets) {
    let resolution: ResolvedPublicUrl;
    try {
      resolution = await resolvePublicHttpUrl(url, resolver);
    } catch {
      output.push(
        failedEvidence(url, "mobile", "Lighthouse target failed public-network validation"),
        failedEvidence(url, "desktop", "Lighthouse target failed public-network validation")
      );
      continue;
    }
    output.push(
      await collectOne(url, "mobile", resolution, execImpl, resolver),
      await collectOne(url, "desktop", resolution, execImpl, resolver)
    );
  }
  return output;
}
