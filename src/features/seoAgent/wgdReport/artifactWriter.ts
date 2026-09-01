import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, posix, relative, resolve } from "node:path";
import type { LighthouseEvidence, WgdDevice, WgdReportPayload } from "./types";
import { renderPublishedWgdHtml } from "./reportRenderer";
import { buildPublishedWgdReport, isWritableLighthouseEvidence } from "./reportModel";

export type WgdArtifactWriterOptions = {
  outDir?: string;
  now?: Date;
};

export type WgdArtifactPaths = {
  directory: string;
  reportJson: string;
  reportHtml: string;
  evidenceFiles: string[];
  manualQueryPack?: string;
};

const REQUIRED_EVIDENCE_PATHS = [
  "evidence/crawl.json",
  "evidence/provider-preflight.json",
  "evidence/yandex-serp.json",
  "evidence/yandex-ai-probes.json",
] as const;

function isNodeError(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

function keyTokens(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function includesPair(tokens: string[], first: string, second: string): boolean {
  return tokens.some((token, index) => token === first && tokens[index + 1] === second);
}

function sensitiveKey(value: string): boolean {
  const tokens = keyTokens(value);
  const normalized = tokens.join("");
  const sensitiveTokens = new Set([
    "auth", "authorization", "authentication", "oauth", "token", "secret", "password", "passwd",
    "cookie", "credentials", "credential",
  ]);
  if (tokens.some((token) => sensitiveTokens.has(token))) return true;
  if (includesPair(tokens, "private", "key") || includesPair(tokens, "api", "key")) return true;
  if (tokens.includes("session") && (tokens.length === 1 || tokens.some((token) => ["id", "key", "token", "secret"].includes(token)))) return true;
  return [
    "apikey", "privatekey", "session", "sessionid", "sessionkey", "sessiontoken", "sessid",
  ].includes(normalized);
}

function sensitiveHeaderName(value: unknown): boolean {
  if (typeof value !== "string" || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,128}$/.test(value)) return false;
  return sensitiveKey(value);
}

function sanitizeUrlCandidate(candidate: string): string {
  const protocolRelative = candidate.startsWith("//");
  try {
    const url = new URL(protocolRelative ? `https:${candidate}` : candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return candidate;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return protocolRelative ? `//${url.host}${url.pathname}` : url.toString();
  } catch {
    return "[invalid URL]";
  }
}

function sanitizeString(value: string): string {
  return value
    .replace(/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|$)/gi, "[REDACTED PRIVATE KEY]")
    .replace(/(?:https?:)?\/\/[^\s<>"']+/gi, sanitizeUrlCandidate)
    .replace(/\b((?:proxy[- ]?)?authorization)\s*[:=]\s*[^\r\n,;]+/gi, "$1: [REDACTED]")
    .replace(/\b(bearer|basic)\s+[a-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(/\b(token|secret|password|cookie|api[-_ ]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
}

function sanitize(value: unknown, parentKey?: string): unknown {
  if (parentKey && sensitiveKey(parentKey)) return "[REDACTED]";
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) {
    if (value.length >= 2 && sensitiveHeaderName(value[0])) {
      return [sanitize(value[0]), "[REDACTED]", ...value.slice(2).map((item) => sanitize(item))];
    }
    return value.map((item) => sanitize(item));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const namedSensitiveHeader = sensitiveHeaderName(record.name);
    return Object.fromEntries(Object.entries(record).map(([key, child]) => [
      sanitizeString(key),
      namedSensitiveHeader && key.toLowerCase() === "value" ? "[REDACTED]" : sanitize(child, key),
    ]));
  }
  return value;
}

function slug(value: string, fallback: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || fallback;
}

function timestamp(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error("A valid artifact timestamp is required.");
  const iso = date.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

function pageName(urlValue: string): string {
  try {
    const url = new URL(urlValue);
    return slug(url.pathname === "/" ? "home" : url.pathname, "page");
  } catch {
    return "page";
  }
}

function runtimeDevice(value: unknown): WgdDevice {
  if (value !== "mobile" && value !== "desktop") throw new Error("Lighthouse evidence device must be mobile or desktop.");
  return value;
}

function resolveInside(base: string, child: string): string {
  const resolved = resolve(base, child);
  const offset = relative(base, resolved);
  if (!offset || offset.startsWith("..") || isAbsolute(offset)) throw new Error("Artifact path must remain inside its bundle boundary.");
  return resolved;
}

function evidenceFilePath(evidenceDirectory: string, relativePath: string): string {
  const prefix = "evidence/";
  if (!relativePath.startsWith(prefix)) throw new Error("Evidence path must use the evidence directory.");
  return resolveInside(evidenceDirectory, relativePath.slice(prefix.length));
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function markdownCell(value: unknown): string {
  const printable = value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
  return printable
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, " ");
}

function captureValue(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  return "[capture]";
}

function manualPack(rows: unknown[], context: { region: string; device: string }): string {
  const body = rows
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row)))
    .map((row) => [
      row.source,
      row.query,
      row.reason,
      row.region || context.region,
      row.device || context.device,
      captureValue(row, "targetPosition", "position"),
      captureValue(row, "matchedUrl"),
      captureValue(row, "answerSourcePresence", "sourcePresence", "answerPresence"),
      captureValue(row, "snippet"),
      captureValue(row, "competitorsOrSourcesAbove", "competitorsAbove", "sourcesAbove"),
    ].map(markdownCell).join(" | "))
    .map((row) => `| ${row} |`)
    .join("\n");
  return `# Manual query pack\n\nThese rows require a documented manual check; they are not provider results. Fill every [capture] field and retain the query context.\n\n| Source | Query | Reason | Region | Device | Target position | Matched URL | Answer/source presence | Snippet | Competitors/sources above |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${body}\n`;
}

function rawEvidencePath(
  domain: string,
  item: Pick<LighthouseEvidence, "url" | "device" | "requestedUrl">,
  used: Set<string>
): string {
  const device = runtimeDevice((item as { device?: unknown }).device);
  const base = `lighthouse-${slug(domain, "site")}-${pageName(item.requestedUrl || item.url)}-${device}`;
  let name = `${base}.json`;
  let suffix = 2;
  while (used.has(name)) name = `${base}-${suffix++}.json`;
  used.add(name);
  return posix.join("evidence", name);
}

async function verifiedOutDirectory(outDir: string): Promise<{ requested: string; canonical: string }> {
  const requested = resolve(outDir);
  try {
    const status = await lstat(requested);
    if (status.isSymbolicLink()) throw new Error("Artifact output directory must not be a symlink.");
    if (!status.isDirectory()) throw new Error("Artifact output path must be a directory.");
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
    await mkdir(requested, { recursive: true, mode: 0o700 });
    const status = await lstat(requested);
    if (status.isSymbolicLink() || !status.isDirectory()) throw new Error("Artifact output path must be a real directory.");
  }
  const canonical = await realpath(requested);
  const finalStatus = await lstat(requested);
  if (finalStatus.isSymbolicLink() || !finalStatus.isDirectory()) throw new Error("Artifact output directory boundary changed during verification.");
  return { requested, canonical };
}

async function publishStaging(outDir: string, staging: string, baseName: string): Promise<string> {
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const name = suffix === 1 ? baseName : `${baseName}-${suffix}`;
    const destination = resolveInside(outDir, name);
    const lock = resolveInside(outDir, `.${name}.publish-lock`);
    try {
      await mkdir(lock, { mode: 0o700 });
    } catch (error) {
      if (isNodeError(error, "EEXIST")) continue;
      throw error;
    }
    try {
      try {
        await lstat(destination);
        continue;
      } catch (error) {
        if (!isNodeError(error, "ENOENT")) throw error;
      }
      try {
        await rename(staging, destination);
        return destination;
      } catch (error) {
        if (isNodeError(error, "EEXIST") || isNodeError(error, "ENOTEMPTY")) continue;
        throw error;
      }
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
  throw new Error("Unable to reserve a collision-safe artifact directory.");
}

/** Stage a sanitized bundle in a verified output directory, then publish it with one atomic rename. */
export async function writeWgdArtifacts(
  payload: WgdReportPayload,
  options: WgdArtifactWriterOptions | string = {}
): Promise<WgdArtifactPaths> {
  const normalizedOptions = typeof options === "string" ? { outDir: options } : options;
  const generated = normalizedOptions.now || new Date(payload.generatedAt);
  const outBoundary = await verifiedOutDirectory(normalizedOptions.outDir || payload.options.outDir);
  const outDir = outBoundary.canonical;
  const baseName = `wgd-${slug(payload.options.domain, "site")}-${timestamp(generated)}`;
  const staging = await mkdtemp(join(outDir, ".wgd-staging-"));
  let published = false;

  try {
    const evidenceDirectory = resolveInside(staging, "evidence");
    await mkdir(evidenceDirectory, { mode: 0o700 });
    const evidenceStatus = await lstat(evidenceDirectory);
    if (evidenceStatus.isSymbolicLink() || !evidenceStatus.isDirectory()) throw new Error("Evidence boundary must be a real directory.");

    const yandex = payload.yandex && typeof payload.yandex === "object" && !Array.isArray(payload.yandex)
      ? payload.yandex as Record<string, unknown>
      : {};
    const normalizedEvidence: Array<[string, unknown]> = [
      [REQUIRED_EVIDENCE_PATHS[0], payload.crawl ?? null],
      [REQUIRED_EVIDENCE_PATHS[1], payload.sources ?? []],
      [REQUIRED_EVIDENCE_PATHS[2], { status: yandex.serpStatus ?? null, checks: yandex.serpChecks ?? [] }],
      [REQUIRED_EVIDENCE_PATHS[3], {
        probes: yandex.aiProbes ?? [],
        sampleVisibility: yandex.aiSampleVisibility ?? null,
        limitations: yandex.limitations ?? [],
      }],
    ];
    const evidenceFiles: string[] = [...REQUIRED_EVIDENCE_PATHS];
    for (const [relativePath, evidence] of normalizedEvidence) {
      await atomicWrite(evidenceFilePath(evidenceDirectory, relativePath), prettyJson(sanitize(evidence)));
    }

    const usedNames = new Set<string>();
    const lighthouse: LighthouseEvidence[] | undefined = Array.isArray(payload.lighthouse) ? [] : undefined;
    for (const candidate of payload.lighthouse || []) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
      if (!isWritableLighthouseEvidence(candidate)) {
        const device = (candidate as { device?: unknown }).device;
        if (typeof device === "string" && /[\\/]|\.\./.test(device)) runtimeDevice(device);
        continue;
      }
      const item = candidate;
      const relativePath = rawEvidencePath(payload.options.domain, item, usedNames);
      const path = evidenceFilePath(evidenceDirectory, relativePath);
      const { rawPayload, rawPath: _unsafeRawPath, ...summary } = item;
      await atomicWrite(path, prettyJson(sanitize(rawPayload ?? summary)));
      evidenceFiles.push(relativePath);
      lighthouse!.push(sanitize({
        ...summary,
        device: runtimeDevice(item.device),
        measurementType: "lab",
        fieldData: {
          source: "CrUX",
          state: item.fieldData?.state === "unavailable" ? "unavailable" : "not_collected",
        },
        rawPath: relativePath,
      }) as LighthouseEvidence);
    }

    const { manualQueryPackPath: _unsafeManualPath, ...payloadWithoutManualPath } = payload;
    const preliminaryReportPayload = sanitize({
      ...payloadWithoutManualPath,
      evidenceFiles,
      ...(lighthouse ? { lighthouse } : {}),
    }) as WgdReportPayload;
    const preliminaryYandex = preliminaryReportPayload.yandex && typeof preliminaryReportPayload.yandex === "object" && !Array.isArray(preliminaryReportPayload.yandex)
      ? preliminaryReportPayload.yandex as Record<string, unknown>
      : undefined;
    const rows = Array.isArray(preliminaryYandex?.manualQueries) ? preliminaryYandex.manualQueries : [];
    const hasManualPack = rows.length > 0;
    const reportPayload: WgdReportPayload = {
      ...preliminaryReportPayload,
      ...(hasManualPack ? { manualQueryPackPath: "manual-query-pack.md" } : {}),
    };
    if (hasManualPack) {
      await atomicWrite(
        resolveInside(staging, "manual-query-pack.md"),
        manualPack(rows, { region: reportPayload.options.region, device: "desktop" })
      );
    }
    const publishedReport = buildPublishedWgdReport(reportPayload);
    await atomicWrite(resolveInside(staging, "report.json"), prettyJson(publishedReport));
    await atomicWrite(resolveInside(staging, "report.html"), renderPublishedWgdHtml(publishedReport));

    const publishedDirectory = await publishStaging(outDir, staging, baseName);
    published = true;
    const directory = resolveInside(outBoundary.requested, relative(outDir, publishedDirectory));
    return {
      directory,
      reportJson: join(directory, "report.json"),
      reportHtml: join(directory, "report.html"),
      evidenceFiles,
      ...(hasManualPack ? { manualQueryPack: join(directory, "manual-query-pack.md") } : {}),
    };
  } finally {
    if (!published) await rm(staging, { recursive: true, force: true });
  }
}
