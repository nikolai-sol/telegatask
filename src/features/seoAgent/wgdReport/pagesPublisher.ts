import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename as renamePath,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join, parse as parsePath, posix, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import { buildPublishedWgdReport } from "./reportModel";
import { renderWgdHtml } from "./reportRenderer";
import { resolveReportLocale } from "./reportLocalization";
import type { WgdPublishedReport, WgdReportPayload } from "./types";

export type PublishSeoReportOptions = {
  reportDir: string;
  slug: string;
  replace?: boolean;
  repoRoot?: string;
};

export type PublishedSeoReport = {
  destination: string;
  trackedDestination: string;
  publicUrl: string;
  files: string[];
};

type PublisherDependencies = {
  exclusiveRename: (from: string, to: string) => Promise<void>;
  open: typeof open;
  rename: (from: string, to: string) => Promise<void>;
  writeFile: (
    path: string,
    data: Buffer,
    options: { flag: "wx"; mode: number }
  ) => Promise<void>;
  rm: typeof rm;
  beforeMutation: (operation:
    | "before-stage"
    | "before-create-commit"
    | "before-atomic-install"
    | "before-staging-cleanup") => Promise<void>;
  beforeFileOpen: (path: string) => Promise<void>;
  afterFileRead: (path: string) => Promise<void>;
};

type PublicationState = "unchanged" | "published" | "recovery_required";

class PublishSeoReportError extends Error {
  readonly state: PublicationState;
  readonly recoveryPaths: string[];

  constructor(message: string, state: PublicationState = "unchanged", recoveryPaths: string[] = []) {
    super(`SEO report publication rejected: ${message}`);
    this.name = "PublishSeoReportError";
    this.state = state;
    this.recoveryPaths = recoveryPaths;
  }
}

type DirectoryIdentity = {
  path: string;
  canonical: string;
  dev: number;
  ino: number;
};

type TrustedBundle = {
  html: Buffer;
  reportJson: Buffer;
  evidence: Map<string, Buffer>;
  report: WgdPublishedReport;
  files: string[];
};

const PAGES_REPORT_ROOT = "mini-app/seo-reports";
const PAGES_BASE_URL = "https://nikolai-sol.github.io/telegatask/seo-reports/";
const REQUIRED_EVIDENCE = new Set([
  "evidence/crawl.json",
  "evidence/provider-preflight.json",
  "evidence/yandex-serp.json",
  "evidence/yandex-ai-probes.json",
]);
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 1_000_000;
const REDACTION_SENTINELS = new Set(["[REDACTED]", "[REDACTED PRIVATE KEY]"]);
const MANAGER_MARKERS = [
  "SEO-аудит сайта",
  "Общая оценка",
  "Что мешает росту",
  "Позиции в Яндексе",
  "Видимость в ответах Алисы",
  "Скорость и удобство",
  "Что делать сначала",
  "Подробнее по страницам",
  "Методика и доступность данных",
  "Данные проверки для специалиста",
];
const MANAGER_SECTION_IDS = [
  "overall-score",
  "main-problems",
  "yandex-positions",
  "alice-visibility",
  "speed-ux",
  "priority-actions",
  "page-details",
];
const DEFAULT_REPO_ROOT = resolve(__dirname, "../../../..");
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const ATOMIC_RENAME_SCRIPT = String.raw`
import ctypes
import errno
import os
import sys

source = os.fsencode(sys.argv[1])
destination = os.fsencode(sys.argv[2])
libc = ctypes.CDLL(None, use_errno=True)

if sys.platform == "darwin":
    operation = getattr(libc, "renamex_np", None)
    if operation is None:
        sys.exit(75)
    operation.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
    operation.restype = ctypes.c_int
    result = operation(source, destination, 0x4)
elif sys.platform.startswith("linux"):
    operation = getattr(libc, "renameat2", None)
    if operation is None:
        sys.exit(75)
    operation.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    operation.restype = ctypes.c_int
    result = operation(-100, source, -100, destination, 0x1)
else:
    sys.exit(75)

if result != 0:
    sys.exit(73 if ctypes.get_errno() == errno.EEXIST else 74)
`;

function publicationError(
  message: string,
  state: PublicationState = "unchanged",
  recoveryPaths: string[] = []
): PublishSeoReportError {
  return new PublishSeoReportError(message, state, recoveryPaths);
}

function isNodeError(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

async function atomicRenameNoReplace(from: string, to: string): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    execFile(
      "/usr/bin/python3",
      ["-c", ATOMIC_RENAME_SCRIPT, from, to],
      { encoding: "utf8", maxBuffer: 1024, timeout: 30_000 },
      (error) => {
        if (!error) {
          resolvePromise();
          return;
        }
        if (error.code === 73) {
          rejectPromise(Object.assign(new Error("atomic destination exists"), { code: "EEXIST" }));
          return;
        }
        rejectPromise(publicationError("atomic no-clobber rename is unavailable or failed"));
      }
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function assertSlug(slug: string): void {
  if (typeof slug !== "string" || slug.length > 63 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw publicationError("the slug is unsafe");
  }
}

async function requireRealDirectory(path: string, label: string): Promise<string> {
  let status;
  try {
    status = await lstat(path);
  } catch {
    throw publicationError(`${label} is not an accessible directory`);
  }
  if (status.isSymbolicLink()) throw publicationError(`${label} must not be a symlink`);
  if (!status.isDirectory()) throw publicationError(`${label} must be a directory`);
  const canonical = await realpath(path);
  const rechecked = await lstat(path);
  if (rechecked.isSymbolicLink() || !rechecked.isDirectory()) {
    throw publicationError(`${label} changed during verification`);
  }
  return canonical;
}

async function captureDirectoryIdentity(path: string, label: string): Promise<DirectoryIdentity> {
  const canonical = await requireRealDirectory(path, label);
  const status = await lstat(path);
  return { path, canonical, dev: status.dev, ino: status.ino };
}

async function assertDirectoryIdentity(identity: DirectoryIdentity, label: string): Promise<void> {
  const status = await lstat(identity.path).catch(() => undefined);
  if (!status
    || status.isSymbolicLink()
    || !status.isDirectory()
    || status.dev !== identity.dev
    || status.ino !== identity.ino) {
    throw publicationError(`${label} identity changed`);
  }
  const canonical = await realpath(identity.path).catch(() => undefined);
  if (canonical !== identity.canonical) throw publicationError(`${label} boundary changed`);
}

function sameDirectoryIdentity(
  status: { dev: number; ino: number; isDirectory(): boolean; isSymbolicLink(): boolean },
  identity: DirectoryIdentity
): boolean {
  return status.isDirectory()
    && !status.isSymbolicLink()
    && status.dev === identity.dev
    && status.ino === identity.ino;
}

async function assertPathHasIdentity(path: string, identity: DirectoryIdentity, label: string): Promise<void> {
  const status = await lstat(path).catch(() => undefined);
  if (!status || !sameDirectoryIdentity(status, identity)) {
    throw publicationError(`${label} identity changed`);
  }
}

async function findChildByIdentity(
  parent: DirectoryIdentity,
  child: DirectoryIdentity
): Promise<DirectoryIdentity | undefined> {
  await assertDirectoryIdentity(parent, "mini-app boundary");
  for (const name of await readdir(parent.path)) {
    const candidate = join(parent.path, name);
    const status = await lstat(candidate).catch(() => undefined);
    if (status && sameDirectoryIdentity(status, child)) {
      return captureDirectoryIdentity(candidate, "relocated Pages report root");
    }
  }
  return undefined;
}

async function removeCapturedDirectory(
  root: DirectoryIdentity,
  preferredPath: string,
  identity: DirectoryIdentity,
  remover: typeof rm,
  label: string
): Promise<void> {
  await assertDirectoryIdentity(root, "Pages report root");
  const preferred = await lstat(preferredPath).catch(() => undefined);
  const capturedPath = preferred && sameDirectoryIdentity(preferred, identity)
    ? preferredPath
    : (await findChildByIdentity(root, identity))?.path;
  if (!capturedPath) {
    throw publicationError(`${label} identity could not be located`, "recovery_required", [preferredPath]);
  }
  await assertPathHasIdentity(capturedPath, identity, label);
  await remover(capturedPath, { recursive: true, force: true });
  await assertDirectoryIdentity(root, "Pages report root");
  const remainingCaptured = await findChildByIdentity(root, identity);
  if (remainingCaptured) {
    throw publicationError(
      `${label} identity was not removed`,
      "recovery_required",
      [remainingCaptured.path]
    );
  }
  if (await lstat(preferredPath).catch(() => undefined)) {
    throw publicationError(
      `${label} lexical path contains an unexpected entry`,
      "recovery_required",
      [preferredPath]
    );
  }
}

function isWithin(parent: string, candidate: string): boolean {
  const offset = relative(parent, candidate);
  return offset === "" || (!offset.startsWith(`..${sep}`) && offset !== ".." && !isAbsolute(offset));
}

async function symlinkedComponents(path: string, label: string): Promise<Set<string>> {
  const absolute = resolve(path);
  const root = parsePath(absolute).root;
  const links = new Set<string>();
  let cursor = root;
  for (const component of relative(root, absolute).split(sep).filter(Boolean)) {
    cursor = resolve(cursor, component);
    const status = await lstat(cursor).catch(() => undefined);
    if (!status) throw publicationError(`${label} is missing`);
    if (status.isSymbolicLink()) links.add(cursor);
  }
  return links;
}

async function rejectSymlinkedComponents(base: string, candidate: string, label: string): Promise<void> {
  const allowed = await symlinkedComponents(base, "repository path");
  const candidateLinks = await symlinkedComponents(candidate, label);
  if ([...candidateLinks].some((path) => !allowed.has(path))) {
    throw publicationError(`${label} contains a symlinked boundary`);
  }
}

async function ensurePagesRoot(repoRoot: string): Promise<DirectoryIdentity> {
  const canonicalRepo = await requireRealDirectory(repoRoot, "repository root");
  const miniApp = resolve(canonicalRepo, "mini-app");
  const canonicalMiniApp = await requireRealDirectory(miniApp, "mini-app boundary");
  if (!isWithin(canonicalRepo, canonicalMiniApp)) throw publicationError("mini-app escaped the repository");
  const requestedRoot = resolve(canonicalMiniApp, "seo-reports");
  try {
    await mkdir(requestedRoot, { mode: 0o700 });
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) throw publicationError("Pages report root could not be created");
  }
  const canonicalRoot = await requireRealDirectory(requestedRoot, "Pages report root");
  if (relative(canonicalRepo, canonicalRoot).split(sep).join("/") !== PAGES_REPORT_ROOT) {
    throw publicationError("Pages report root escaped its boundary");
  }
  return captureDirectoryIdentity(canonicalRoot, "Pages report root");
}

function sameFileSnapshot(
  left: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number },
  right: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }
): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

async function readRegularFile(
  path: string,
  label: string,
  deps: Partial<PublisherDependencies>
): Promise<Buffer> {
  const before = await lstat(path).catch(() => undefined);
  if (!before) throw publicationError(`${label} is missing`);
  if (before.isSymbolicLink()) throw publicationError(`${label} must not be a symlink`);
  if (!before.isFile()) throw publicationError(`${label} must be a regular file`);
  if (before.size > MAX_FILE_BYTES) throw publicationError(`${label} exceeds the size limit`);
  let handle;
  try {
    await deps.beforeFileOpen?.(path);
    handle = await (deps.open || open)(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const opened = await handle.stat();
    if (!opened.isFile()
      || opened.size > MAX_FILE_BYTES
      || !sameFileSnapshot(before, opened)) {
      throw publicationError(`${label} changed during verification`);
    }
    const value = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < value.length) {
      const { bytesRead } = await handle.read(value, offset, value.length - offset, offset);
      if (bytesRead === 0) throw publicationError(`${label} changed while it was read`);
      offset += bytesRead;
    }
    await deps.afterFileRead?.(path);
    const after = await handle.stat();
    const pathAfter = await lstat(path).catch(() => undefined);
    if (!after.isFile()
      || after.size !== value.length
      || !sameFileSnapshot(opened, after)
      || !pathAfter
      || pathAfter.isSymbolicLink()
      || !sameFileSnapshot(after, pathAfter)) {
      throw publicationError(`${label} changed while it was read`);
    }
    return value;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("SEO report publication rejected:")) throw error;
    throw publicationError(`${label} could not be read safely`);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function parseJson(buffer: Buffer, label: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(UTF8_DECODER.decode(buffer));
  } catch {
    throw publicationError(`${label} is invalid JSON`);
  }
  let nodes = 0;
  const visit = (node: unknown, depth: number): void => {
    nodes += 1;
    if (depth > MAX_JSON_DEPTH || nodes > MAX_JSON_NODES) {
      throw publicationError(`${label} exceeds JSON complexity limits`);
    }
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        throw publicationError(`${label} contains a dangerous structural key`);
      }
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  return value;
}

function keyTokens(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function sensitiveKey(value: string): boolean {
  const tokens = keyTokens(value);
  const normalized = tokens.join("");
  if (tokens.some((token) => new Set([
    "auth", "authentication", "authorization", "oauth", "token", "secret", "password", "passwd", "cookie",
    "credentials", "credential",
  ]).has(token))) return true;
  if (tokens.some((token, index) => token === "private" && tokens[index + 1] === "key")) return true;
  if (tokens.some((token, index) => token === "api" && tokens[index + 1] === "key")) return true;
  return ["apikey", "privatekey", "session", "sessionid", "sessionkey", "sessiontoken", "sessid"].includes(normalized);
}

function isRedacted(value: unknown): boolean {
  return typeof value === "string" && REDACTION_SENTINELS.has(value);
}

function structuredSecrets(value: unknown): boolean {
  if (typeof value === "string") return !isRedacted(value) && rawSecrets(value);
  if (Array.isArray(value)) {
    if (value.length >= 2 && typeof value[0] === "string" && sensitiveKey(value[0]) && !isRedacted(value[1])) {
      return true;
    }
    return value.some(structuredSecrets);
  }
  if (!isRecord(value)) return false;
  if (typeof value.name === "string" && sensitiveKey(value.name) && "value" in value && !isRedacted(value.value)) {
    return true;
  }
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKey(key) && child !== null && child !== "" && !isRedacted(child)) return true;
    if (structuredSecrets(child)) return true;
  }
  return false;
}

function rawSecrets(text: string): boolean {
  const patterns = [
    /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/i,
    /https?:\/\/[^\s/@:]*:[^\s/@]+@/i,
    /[?&](?:api[_-]?key|token|secret|password|passwd|authorization)=((?!%5Bredacted%5D|\[REDACTED\])[^\s&#"']+)/i,
    /\bBearer\s+(?!\[REDACTED\])(?=[A-Za-z0-9+/_.=-]{8,})[A-Za-z0-9+/_.=-]+/i,
    /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{8,}\b/,
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|[sr]k_live_[A-Za-z0-9]{16,}|(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{30,})\b/,
  ];
  if (patterns.some((pattern) => pattern.test(text))) return true;
  for (const match of text.matchAll(/\bBasic\s+(?!\[REDACTED\])([A-Za-z0-9+/]{2,}={0,2})(?![A-Za-z0-9+/=])/gi)) {
    const token = match[1]!;
    const remainder = token.length % 4;
    if (remainder === 1) continue;
    try {
      const padded = `${token}${"=".repeat((4 - remainder) % 4)}`;
      if (Buffer.from(padded, "base64").toString("utf8").includes(":")) return true;
    } catch {
      // Invalid base64 is not a credential-shaped Basic value.
    }
  }
  return false;
}

function assertNoSecrets(buffer: Buffer, parsed: unknown | undefined, label: string): void {
  if (rawSecrets(buffer.toString("utf8")) || (parsed !== undefined && structuredSecrets(parsed))) {
    throw publicationError(`${label} contains credential-shaped content`);
  }
}

function bounded(value: unknown, minimum = 0, maximum = 100): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function nullableScore(value: unknown): boolean {
  return value === null || bounded(value);
}

function assertAssessment(value: unknown): void {
  if (!isRecord(value)
    || !["scored", "preliminary", "insufficient_data"].includes(String(value.state))
    || !bounded(value.completeness)
    || !nullableScore(value.calculatedScore)
    || !nullableScore(value.displayScore)
    || !Array.isArray(value.pages)
    || !isRecord(value.components)) {
    throw publicationError("assessment is malformed");
  }
  const componentNames = Object.keys(value.components).sort();
  if (componentNames.join(",") !== "alice,lighthouse,technical,yandex") {
    throw publicationError("assessment components are malformed");
  }
  const expectedWeights: Record<string, number> = { technical: 40, yandex: 25, lighthouse: 20, alice: 15 };
  for (const [name, weight] of Object.entries(expectedWeights)) {
    const component = value.components[name];
    if (!isRecord(component)
      || component.nominalWeight !== weight
      || !nullableScore(component.score)
      || !bounded(component.effectiveWeight)
      || !bounded(component.collectionCoverage, 0, 1)
      || !bounded(component.scoringCoverage, 0, 1)
      || !Number.isSafeInteger(component.collected)
      || (component.collected as number) < 0
      || !Number.isSafeInteger(component.requested)
      || (component.requested as number) < 0) {
      throw publicationError("assessment component is malformed");
    }
  }
}

function assertReportContract(value: unknown): WgdPublishedReport {
  if (!isRecord(value) || value.schemaVersion !== "2.0") throw publicationError("schema version must be 2.0");
  if (!Array.isArray(value.pages)
    || !Array.isArray(value.sources)
    || !Array.isArray(value.findings)
    || !Array.isArray(value.lighthouse)) {
    throw publicationError("published report arrays are missing");
  }
  if (!isRecord(value.options)
    || typeof value.options.domain !== "string"
    || !value.options.domain.trim()
    || typeof value.options.language !== "string"
    || resolveReportLocale(value.options.language) !== "ru"
    || !Array.isArray(value.options.keywords)
    || !Array.isArray(value.options.aiQueries)
    || !Array.isArray(value.options.priorityUrls)) {
    throw publicationError("report options are malformed or not Russian");
  }
  assertAssessment(value.assessment);
  if (!Array.isArray(value.groupedFindings)) throw publicationError("grouped findings are missing");
  if (!Array.isArray(value.evidenceFiles) || value.evidenceFiles.length === 0) {
    throw publicationError("evidence declarations are missing");
  }
  const declared = value.evidenceFiles;
  if (!declared.every((item): item is string => typeof item === "string"
    && /^evidence\/[a-z0-9][a-z0-9._-]*\.json$/.test(item)
    && !item.includes(".."))) {
    throw publicationError("an evidence declaration is unsafe");
  }
  if (new Set(declared).size !== declared.length) throw publicationError("evidence declarations must be unique");
  for (const required of REQUIRED_EVIDENCE) {
    if (!declared.includes(required)) throw publicationError("required evidence is not declared");
  }
  for (const item of value.lighthouse) {
    if (isRecord(item) && item.rawPath !== undefined
      && (typeof item.rawPath !== "string" || !declared.includes(item.rawPath))) {
      throw publicationError("a Lighthouse raw evidence path is undeclared");
    }
  }
  let rebuilt: WgdPublishedReport;
  try {
    rebuilt = buildPublishedWgdReport(value as WgdReportPayload);
  } catch {
    throw publicationError("report integrity could not be rebuilt");
  }
  if (!isDeepStrictEqual(rebuilt, value)) {
    throw publicationError("published report does not match its canonical rebuilt model");
  }
  return value as WgdPublishedReport;
}

function assertHtmlContract(html: string, report: WgdPublishedReport): void {
  let canonical: string;
  try {
    canonical = renderWgdHtml(report);
  } catch {
    throw publicationError("canonical report HTML could not be rendered");
  }
  if (html !== canonical) throw publicationError("report HTML is not the canonical rendering");
  if (!html.includes('<html lang="ru">')
    || !html.includes('<meta name="robots" content="noindex,nofollow">')) {
    throw publicationError("Russian noindex report markers are missing");
  }
  for (const marker of MANAGER_MARKERS) {
    if (!html.includes(marker)) throw publicationError("a manager report marker is missing");
  }
  const positions = MANAGER_SECTION_IDS.map((id) => html.indexOf(`<section id="${id}"`));
  if (positions.some((position) => position < 0)
    || positions.some((position, index) => index > 0 && position <= positions[index - 1]!)) {
    throw publicationError("manager report sections are missing or out of order");
  }
  if (/<\s*(?:script|base|iframe|object|embed|form)\b/i.test(html)
    || /<meta\b[^>]*http-equiv\s*=\s*["']?refresh\b/i.test(html)
    || /\son[a-z]+\s*=/i.test(html)
    || /\s(?:src|action)\s*=/i.test(html)
    || /url\s*\(/i.test(html)) {
    throw publicationError("active HTML content is forbidden");
  }
  const ids = new Set([...html.matchAll(/\bid\s*=\s*(["'])([a-z0-9][a-z0-9-]*)\1/gi)].map((match) => match[2]!));
  const hrefAttributes = [...html.matchAll(/\bhref\s*=\s*(["'])(.*?)\1/gi)].map((match) => match[2]!);
  if (hrefAttributes.length !== [...html.matchAll(/\bhref\s*=/gi)].length) {
    throw publicationError("an href is not safely quoted");
  }
  const evidenceHrefs = new Set<string>();
  let reportJsonLinked = false;
  const declared = new Set(report.evidenceFiles as string[]);
  for (const href of hrefAttributes) {
    if (href === "report.json") {
      reportJsonLinked = true;
    } else if (declared.has(href)) {
      evidenceHrefs.add(href);
    } else if (/^#[a-z0-9][a-z0-9-]*$/.test(href) && ids.has(href.slice(1))) {
      continue;
    } else {
      throw publicationError("report HTML contains an unsafe link");
    }
  }
  if (!reportJsonLinked || evidenceHrefs.size !== declared.size
    || [...declared].some((path) => !evidenceHrefs.has(path))) {
    throw publicationError("report HTML evidence links do not match declarations");
  }
}

async function readBundle(
  directory: string,
  htmlName: "report.html" | "index.html",
  deps: Partial<PublisherDependencies>
): Promise<TrustedBundle> {
  const rootIdentity = await captureDirectoryIdentity(directory, "bundle root");
  const expectedRoot = ["evidence", htmlName, "report.json"];
  const rootEntries = (await readdir(directory)).sort();
  await assertDirectoryIdentity(rootIdentity, "bundle root");
  if (rootEntries.join("\0") !== expectedRoot.sort().join("\0")) {
    throw publicationError("bundle root entries do not match the allowlist");
  }
  const evidenceDirectory = join(directory, "evidence");
  const evidenceIdentity = await captureDirectoryIdentity(evidenceDirectory, "bundle evidence directory");
  const assertBundleIdentity = async (): Promise<void> => {
    await assertDirectoryIdentity(rootIdentity, "bundle root");
    await assertDirectoryIdentity(evidenceIdentity, "bundle evidence directory");
  };
  const evidenceNames = (await readdir(evidenceDirectory)).sort();
  await assertBundleIdentity();
  if (evidenceNames.length === 0
    || evidenceNames.some((name) => !/^[a-z0-9][a-z0-9._-]*\.json$/.test(name) || name.includes(".."))) {
    throw publicationError("evidence entries do not match the flat JSON allowlist");
  }
  await assertBundleIdentity();
  const html = await readRegularFile(join(directory, htmlName), htmlName, deps);
  await assertBundleIdentity();
  const reportJson = await readRegularFile(join(directory, "report.json"), "report.json", deps);
  await assertBundleIdentity();
  const reportValue = parseJson(reportJson, "report.json");
  assertNoSecrets(reportJson, reportValue, "report.json");
  const report = assertReportContract(reportValue);
  const evidence = new Map<string, Buffer>();
  let totalBytes = html.length + reportJson.length;
  for (const name of evidenceNames) {
    await assertBundleIdentity();
    const relativePath = posix.join("evidence", name);
    const buffer = await readRegularFile(join(evidenceDirectory, name), relativePath, deps);
    await assertBundleIdentity();
    const parsed = parseJson(buffer, relativePath);
    assertNoSecrets(buffer, parsed, relativePath);
    evidence.set(relativePath, buffer);
    totalBytes += buffer.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw publicationError("bundle exceeds the total size limit");
  }
  await assertBundleIdentity();
  let htmlText: string;
  try {
    htmlText = UTF8_DECODER.decode(html);
  } catch {
    throw publicationError(`${htmlName} is not valid UTF-8`);
  }
  assertNoSecrets(html, undefined, htmlName);
  const declared = new Set(report.evidenceFiles as string[]);
  if (declared.size !== evidence.size || [...declared].some((path) => !evidence.has(path))) {
    throw publicationError("declared and actual evidence files differ");
  }
  assertHtmlContract(htmlText, report);
  return {
    html,
    reportJson,
    evidence,
    report,
    files: [...evidence.keys(), "index.html", "report.json"].sort(),
  };
}

async function verifyOldTree(path: string): Promise<void> {
  const root = await lstat(path);
  if (root.isSymbolicLink()) throw publicationError("existing destination must not be a symlink");
  if (!root.isDirectory()) throw publicationError("existing destination must be a directory");
  const walk = async (directory: string): Promise<void> => {
    for (const name of await readdir(directory)) {
      const child = join(directory, name);
      const status = await lstat(child);
      if (status.isSymbolicLink()) throw publicationError("existing destination contains a symlink");
      if (status.isDirectory()) await walk(child);
      else if (!status.isFile()) throw publicationError("existing destination contains a special file");
    }
  };
  await walk(path);
}

async function materializeAndVerifyBundle(
  root: DirectoryIdentity,
  directory: string,
  bundle: TrustedBundle,
  deps: Partial<PublisherDependencies>
): Promise<void> {
  const writer = deps.writeFile || writeFile;
  await assertDirectoryIdentity(root, "Pages report root");
  await mkdir(join(directory, "evidence"), { mode: 0o700 });
  await assertDirectoryIdentity(root, "Pages report root");
  await writer(join(directory, "index.html"), bundle.html, { flag: "wx", mode: 0o600 });
  await assertDirectoryIdentity(root, "Pages report root");
  await writer(join(directory, "report.json"), bundle.reportJson, { flag: "wx", mode: 0o600 });
  await assertDirectoryIdentity(root, "Pages report root");
  for (const [relativePath, buffer] of bundle.evidence) {
    await writer(join(directory, ...relativePath.split("/")), buffer, { flag: "wx", mode: 0o600 });
    await assertDirectoryIdentity(root, "Pages report root");
  }
  const materialized = await readBundle(directory, "index.html", deps);
  await assertDirectoryIdentity(root, "Pages report root");
  if (!materialized.html.equals(bundle.html)
    || !materialized.reportJson.equals(bundle.reportJson)
    || materialized.evidence.size !== bundle.evidence.size
    || [...bundle.evidence].some(([path, value]) => !materialized.evidence.get(path)?.equals(value))) {
    throw publicationError("published bytes differ from the reviewed source");
  }
}

async function stageBundle(
  root: DirectoryIdentity,
  slug: string,
  bundle: TrustedBundle,
  deps: Partial<PublisherDependencies>
): Promise<{ path: string; identity: DirectoryIdentity }> {
  const staging = join(root.path, `.${slug}.staging-${randomUUID()}`);
  const remover = deps.rm || rm;
  await assertDirectoryIdentity(root, "Pages report root");
  await mkdir(staging, { mode: 0o700 });
  try {
    await materializeAndVerifyBundle(root, staging, bundle, deps);
    return {
      path: staging,
      identity: await captureDirectoryIdentity(staging, "staged report bundle"),
    };
  } catch (error) {
    try {
      await assertDirectoryIdentity(root, "Pages report root");
      await remover(staging, { recursive: true, force: true });
      await assertDirectoryIdentity(root, "Pages report root");
    } catch {
      throw publicationError("staging cleanup failed; recovery is required", "recovery_required", [staging]);
    }
    throw error;
  }
}

/**
 * Validate and stage one reviewed report bundle for GitHub Pages.
 * Installation is a single OS-level no-clobber rename of a fully validated sibling directory.
 *
 * Threat model: cooperative local publishers serialized by the per-slug lock. Identity checks
 * detect and recover from pathname relocation, but path-based Node APIs cannot prevent a hostile
 * same-UID process from moving a parent between an operation and its post-check without dirfd/openat.
 */
export async function publishSeoReport(
  options: PublishSeoReportOptions,
  injected: Partial<PublisherDependencies> = {}
): Promise<PublishedSeoReport> {
  assertSlug(options.slug);
  const requestedRepo = resolve(options.repoRoot || DEFAULT_REPO_ROOT);
  const repoRoot = await requireRealDirectory(requestedRepo, "repository root");
  const requestedMiniApp = resolve(requestedRepo, "mini-app");
  const miniAppIdentity = await captureDirectoryIdentity(requestedMiniApp, "mini-app boundary");
  const miniApp = miniAppIdentity.canonical;
  const plannedPagesRoot = resolve(miniApp, "seo-reports");
  const source = isAbsolute(options.reportDir)
    ? resolve(options.reportDir)
    : resolve(repoRoot, options.reportDir);
  const requestedSource = isAbsolute(options.reportDir)
    ? resolve(options.reportDir)
    : resolve(requestedRepo, options.reportDir);
  await rejectSymlinkedComponents(requestedRepo, requestedSource, "source path");
  const sourceCanonical = await requireRealDirectory(source, "source directory");
  if (isWithin(plannedPagesRoot, sourceCanonical) || isWithin(plannedPagesRoot, source)) {
    throw publicationError("source must be outside the public report root");
  }

  // Source validation is intentionally completed before acquiring the mutable Pages root.
  const bundle = await readBundle(sourceCanonical, "report.html", injected);
  let pagesRoot = await ensurePagesRoot(repoRoot);
  let destination = resolve(pagesRoot.path, options.slug);
  const reportedDestination = resolve(requestedRepo, PAGES_REPORT_ROOT, options.slug);
  if (relative(pagesRoot.path, destination) !== options.slug) {
    throw publicationError("destination escaped the Pages report root");
  }

  let staging: string | undefined;
  let stagingIdentity: DirectoryIdentity | undefined;
  let lockCreated = false;
  let committed = false;
  let lock = join(pagesRoot.path, `.${options.slug}.publish-lock`);
  const rename = injected.rename || renamePath;
  const exclusiveRename = injected.exclusiveRename || atomicRenameNoReplace;
  const remover = injected.rm || rm;
  let backup: string | undefined;

  const relocateManagedRoot = async (): Promise<boolean> => {
    const relocated = await findChildByIdentity(miniAppIdentity, pagesRoot).catch(() => undefined);
    if (!relocated) return false;
    pagesRoot = relocated;
    destination = join(relocated.path, options.slug);
    lock = join(relocated.path, basename(lock));
    if (staging) staging = join(relocated.path, basename(staging));
    if (backup) backup = join(relocated.path, basename(backup));
    return true;
  };

  const quarantineDestination = async (): Promise<void> => {
    const unsafe = await lstat(destination).catch(() => undefined);
    if (!unsafe) return;
    const quarantine = join(pagesRoot.path, `.${options.slug}.quarantine-${randomUUID()}`);
    await rename(destination, quarantine);
    const quarantined = await lstat(quarantine).catch(() => undefined);
    if (!quarantined || quarantined.dev !== unsafe.dev || quarantined.ino !== unsafe.ino) {
      throw publicationError(
        "unsafe destination quarantine identity changed; recovery is required",
        "recovery_required",
        [quarantine]
      );
    }
    await remover(quarantine, { recursive: true, force: true });
  };

  try {
    await assertDirectoryIdentity(pagesRoot, "Pages report root");
    await injected.beforeMutation?.("before-stage");
    await assertDirectoryIdentity(pagesRoot, "Pages report root");
    const staged = await stageBundle(pagesRoot, options.slug, bundle, injected);
    staging = staged.path;
    stagingIdentity = staged.identity;
    await assertDirectoryIdentity(pagesRoot, "Pages report root");
    try {
      await mkdir(lock, { mode: 0o700 });
      lockCreated = true;
    } catch (error) {
      if (isNodeError(error, "EEXIST")) throw publicationError("publication for this slug is already in progress");
      throw publicationError("publication lock could not be acquired");
    }
    await assertDirectoryIdentity(pagesRoot, "Pages report root");

    let destinationExists = false;
    try {
      await lstat(destination);
      destinationExists = true;
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw publicationError("destination could not be inspected");
    }
    if (destinationExists && !options.replace) throw publicationError("destination already exists");
    if (destinationExists) {
      await verifyOldTree(destination);
      await assertDirectoryIdentity(pagesRoot, "Pages report root");
      backup = join(pagesRoot.path, `.${options.slug}.backup-${randomUUID()}`);
      await rename(destination, backup);
      await assertDirectoryIdentity(pagesRoot, "Pages report root");
    }

    if (!destinationExists) {
      await assertDirectoryIdentity(pagesRoot, "Pages report root");
      await injected.beforeMutation?.("before-create-commit");
      await assertDirectoryIdentity(pagesRoot, "Pages report root");
    }

    try {
      await assertDirectoryIdentity(pagesRoot, "Pages report root");
      await injected.beforeMutation?.("before-atomic-install");
      await assertDirectoryIdentity(pagesRoot, "Pages report root");
      await exclusiveRename(staging, destination);
      await assertDirectoryIdentity(pagesRoot, "Pages report root");
      await assertPathHasIdentity(destination, stagingIdentity, "installed staged bundle");
      await assertDirectoryIdentity(pagesRoot, "Pages report root");
      staging = undefined;
      stagingIdentity = undefined;
      committed = true;
    } catch (commitError) {
      if (isNodeError(commitError, "EEXIST")) {
        if (backup) {
          throw publicationError(
            "destination appeared during replace; recovery is required",
            "recovery_required",
            [backup, destination]
          );
        }
        throw publicationError("destination race: an entry appeared during atomic install");
      }
      let movedRoot = false;
      try {
        await assertDirectoryIdentity(pagesRoot, "Pages report root");
      } catch {
        movedRoot = await relocateManagedRoot();
        if (!movedRoot) {
          throw publicationError(
            "Pages root moved during commit; recovery is required",
            "recovery_required",
            [reportedDestination]
          );
        }
      }

      if (stagingIdentity && staging) {
        const currentStaging = await lstat(staging).catch(() => undefined);
        if (!currentStaging || !sameDirectoryIdentity(currentStaging, stagingIdentity)) {
          const relocatedStaging = await findChildByIdentity(pagesRoot, stagingIdentity);
          if (relocatedStaging) staging = relocatedStaging.path;
        }
      }

      if (!movedRoot) {
        try {
          await quarantineDestination();
        } catch (quarantineError) {
          if (quarantineError instanceof PublishSeoReportError) throw quarantineError;
          throw publicationError(
            "unsafe destination could not be quarantined; recovery is required",
            "recovery_required",
            [destination]
          );
        }
      }

      if (backup) {
        const rollbackBackup = backup;
        try {
          await assertDirectoryIdentity(pagesRoot, "Pages report root");
          await rename(rollbackBackup, destination);
          backup = undefined;
          await assertDirectoryIdentity(pagesRoot, "Pages report root");
        } catch {
          throw publicationError(
            "publish swap and rollback failed; recovery is required",
            "recovery_required",
            [rollbackBackup, ...(movedRoot ? [reportedDestination] : [])]
          );
        }
        if (movedRoot) {
          throw publicationError(
            "Pages root moved during commit; the prior bundle was restored in the relocated root",
            "recovery_required",
            [destination, reportedDestination]
          );
        }
        throw publicationError("publish swap failed; the prior bundle was restored");
      }
      if (movedRoot) {
        throw publicationError(
          "Pages root moved during create commit; recovery is required",
          "recovery_required",
          [destination, reportedDestination]
        );
      }
      if (commitError instanceof PublishSeoReportError) throw commitError;
      throw publicationError("publish atomic install failed before a result was confirmed");
    }

    if (backup) {
      const cleanupBackup = backup;
      try {
        await assertDirectoryIdentity(pagesRoot, "Pages report root");
        await remover(cleanupBackup, { recursive: true, force: true });
        await assertDirectoryIdentity(pagesRoot, "Pages report root");
        backup = undefined;
      } catch {
        const displaced = join(pagesRoot.path, `.${options.slug}.rollback-${randomUUID()}`);
        let displacedCreated = false;
        try {
          await assertDirectoryIdentity(pagesRoot, "Pages report root");
          await rename(destination, displaced);
          displacedCreated = true;
          committed = false;
          await assertDirectoryIdentity(pagesRoot, "Pages report root");
          await rename(cleanupBackup, destination);
          backup = undefined;
          await assertDirectoryIdentity(pagesRoot, "Pages report root");
        } catch {
          throw publicationError(
            "backup cleanup and transactional rollback failed; recovery is required",
            "recovery_required",
            [backup, ...(displacedCreated ? [displaced] : []), ...(committed ? [destination] : [])]
              .filter((path): path is string => Boolean(path))
          );
        }
        try {
          await remover(displaced, { recursive: true, force: true });
          await assertDirectoryIdentity(pagesRoot, "Pages report root");
        } catch {
          throw publicationError(
            "the prior bundle was restored but cleanup requires recovery",
            "recovery_required",
            [displaced]
          );
        }
        throw publicationError("backup cleanup failed; the prior bundle was restored");
      }
    }
    return {
      destination: reportedDestination,
      trackedDestination: posix.join(PAGES_REPORT_ROOT, options.slug),
      publicUrl: `${PAGES_BASE_URL}${options.slug}/`,
      files: bundle.files,
    };
  } finally {
    let cleanupFailure: PublishSeoReportError | undefined;
    if (staging) {
      const cleanupStaging = staging;
      try {
        await injected.beforeMutation?.("before-staging-cleanup");
        if (!stagingIdentity) {
          throw publicationError(
            "staging identity is unavailable; recovery is required",
            "recovery_required",
            [cleanupStaging]
          );
        }
        await removeCapturedDirectory(
          pagesRoot,
          cleanupStaging,
          stagingIdentity,
          remover,
          "staged report cleanup"
        );
        staging = undefined;
        stagingIdentity = undefined;
      } catch (error) {
        cleanupFailure = error instanceof PublishSeoReportError
          ? error
          : publicationError(
            "staging cleanup failed; recovery is required",
            committed ? "published" : "recovery_required",
            [cleanupStaging]
          );
      }
    }
    if (lockCreated) {
      try {
        await assertDirectoryIdentity(pagesRoot, "Pages report root");
        await remover(lock, { recursive: true, force: true });
        await assertDirectoryIdentity(pagesRoot, "Pages report root");
        lockCreated = false;
      } catch {
        cleanupFailure = publicationError(
          "publication lock cleanup failed; manual cleanup is required",
          committed ? "published" : "recovery_required",
          [lock]
        );
      }
    }
    if (cleanupFailure) throw cleanupFailure;
  }
}
