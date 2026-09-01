import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type DnsAddress = { address: string; family: 4 | 6 };
export type DnsResolver = (
  hostname: string
) => Promise<readonly (DnsAddress | { address: string; family?: number } | string)[]>;

export type ResolvedPublicUrl = {
  url: string;
  hostname: string;
  addresses: DnsAddress[];
};

const DEFAULT_DNS_TIMEOUT_MS = 5_000;
const MAX_DNS_TIMEOUT_MS = 15_000;

const IPV4_NON_PUBLIC_RANGES: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const FORBIDDEN_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "metadata.google",
  "metadata.aws.internal",
  "metadata.azure.internal",
  "metadata.internal",
  "instance-data",
  "instance-data.ec2.internal",
]);

export class UnsafeNetworkTargetError extends Error {
  constructor(message = "URL must target a public internet host.") {
    super(message);
    this.name = "UnsafeNetworkTargetError";
  }
}

function boundedTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_DNS_TIMEOUT_MS;
  return Math.min(MAX_DNS_TIMEOUT_MS, Math.max(1, Math.floor(value!)));
}

function stripIpv6Brackets(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
}

function ipv4Number(value: string): number | null {
  if (isIP(value) !== 4) return null;
  const parts = value.split(".").map(Number);
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function ipv4InRange(value: number, base: string, prefix: number): boolean {
  const baseValue = ipv4Number(base);
  if (baseValue === null) return false;
  if (prefix === 0) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

function ipv6Number(value: string): bigint | null {
  let input = stripIpv6Brackets(value);
  if (input.includes("%")) return null;
  if (input.includes(".")) {
    const separator = input.lastIndexOf(":");
    const ipv4 = separator >= 0 ? input.slice(separator + 1) : "";
    const number = ipv4Number(ipv4);
    if (number === null) return null;
    input = `${input.slice(0, separator)}:${((number >>> 16) & 0xffff).toString(16)}:${(number & 0xffff).toString(16)}`;
  }
  const halves = input.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = halves.length === 2
    ? [...left, ...Array.from({ length: missing }, () => "0"), ...right]
    : left;
  if (groups.length !== 8 || groups.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null;
  return groups.reduce((result, part) => (result << 16n) | BigInt(parseInt(part, 16)), 0n);
}

function ipv6InRange(value: bigint, base: string, prefix: number): boolean {
  const baseValue = ipv6Number(base);
  if (baseValue === null) return false;
  const shift = BigInt(128 - prefix);
  return (value >> shift) === (baseValue >> shift);
}

/** True only for globally routable unicast addresses accepted by the audit boundary. */
export function isPublicIpAddress(rawAddress: string): boolean {
  const address = stripIpv6Brackets(rawAddress);
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Number(address);
    return value !== null && !IPV4_NON_PUBLIC_RANGES.some(([base, prefix]) => ipv4InRange(value, base, prefix));
  }
  if (family !== 6) return false;
  const value = ipv6Number(address);
  if (value === null || !ipv6InRange(value, "2000::", 3)) return false;
  return ![
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["3fff::", 20],
  ].some(([base, prefix]) => ipv6InRange(value, String(base), Number(prefix)));
}

export function isForbiddenHostname(rawHostname: string): boolean {
  const hostname = stripIpv6Brackets(rawHostname).replace(/\.$/, "").toLowerCase();
  return FORBIDDEN_HOSTS.has(hostname)
    || hostname.endsWith(".localhost")
    || hostname === "local"
    || hostname.endsWith(".local");
}

export const defaultDnsResolver: DnsResolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((item) => ({
    address: item.address,
    family: item.family === 6 ? 6 : 4,
  }));

async function resolveWithDeadline(
  resolver: DnsResolver,
  hostname: string,
  timeoutMs: number
): Promise<readonly (DnsAddress | { address: string; family?: number } | string)[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new UnsafeNetworkTargetError("URL host could not be resolved safely.")),
      boundedTimeout(timeoutMs)
    );
  });
  try {
    return await Promise.race([Promise.resolve().then(() => resolver(hostname)), deadline]);
  } catch (error) {
    if (error instanceof UnsafeNetworkTargetError) throw error;
    throw new UnsafeNetworkTargetError("URL host could not be resolved safely.");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Resolve and validate every address before an outbound request or process handoff. */
export async function resolvePublicHttpUrl(
  value: string,
  resolver: DnsResolver = defaultDnsResolver,
  timeoutMs = DEFAULT_DNS_TIMEOUT_MS
): Promise<ResolvedPublicUrl> {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new UnsafeNetworkTargetError();
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
    throw new UnsafeNetworkTargetError();
  }
  parsed.hash = "";
  const hostname = stripIpv6Brackets(parsed.hostname).replace(/\.$/, "").toLowerCase();
  if (!hostname || isForbiddenHostname(hostname)) throw new UnsafeNetworkTargetError();

  const literalFamily = isIP(hostname);
  const rawAnswers = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await resolveWithDeadline(resolver, hostname, timeoutMs);
  if (!Array.isArray(rawAnswers) || rawAnswers.length === 0) {
    throw new UnsafeNetworkTargetError("URL host could not be resolved safely.");
  }

  const addresses: DnsAddress[] = [];
  const seen = new Set<string>();
  for (const answer of rawAnswers) {
    const rawAddress = typeof answer === "string" ? answer : answer?.address;
    const address = stripIpv6Brackets(String(rawAddress || ""));
    const family = isIP(address);
    if ((family !== 4 && family !== 6) || !isPublicIpAddress(address)) {
      throw new UnsafeNetworkTargetError();
    }
    const key = `${family}:${address}`;
    if (!seen.has(key)) {
      seen.add(key);
      addresses.push({ address, family });
    }
  }
  if (!addresses.length) throw new UnsafeNetworkTargetError();
  parsed.hostname = literalFamily === 6 ? `[${hostname}]` : hostname;
  return { url: parsed.toString(), hostname, addresses };
}
