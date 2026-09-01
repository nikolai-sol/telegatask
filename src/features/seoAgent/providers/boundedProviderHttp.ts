export class ProviderDeadlineError extends Error {
  constructor() {
    super("Provider request timed out");
    this.name = "ProviderDeadlineError";
  }
}

export class ProviderBodyLimitError extends Error {
  constructor() {
    super("Provider response exceeded the download limit");
    this.name = "ProviderBodyLimitError";
  }
}

type StreamReader = {
  read(): Promise<{ done: boolean; value?: Uint8Array | string }>;
  cancel?(reason?: unknown): Promise<void>;
  releaseLock?(): void;
};

export type BoundedProviderResponse = {
  headers?: { get(name: string): string | null | undefined };
  body?: {
    getReader?: () => StreamReader;
    cancel?(reason?: unknown): Promise<void>;
    destroy?(error?: Error): void;
    [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | string>;
  } | null;
};

function ignoreCleanupPromise(operation: unknown): void {
  if (operation && typeof (operation as PromiseLike<unknown>).then === "function") {
    void Promise.resolve(operation).catch(() => undefined);
  }
}

/** Cleanup is best-effort and must never extend the deadline it is enforcing. */
function cancelBodyNonBlocking(
  body: BoundedProviderResponse["body"] | undefined,
  reason: Error
): void {
  try {
    ignoreCleanupPromise(body?.cancel?.(reason));
  } catch {
    // Ignore hostile or already-closed response bodies.
  }
  try {
    body?.destroy?.(reason);
  } catch {
    // Ignore hostile or already-closed response bodies.
  }
}

function cancelReaderNonBlocking(reader: StreamReader, reason: Error): void {
  try {
    ignoreCleanupPromise(reader.cancel?.(reason));
  } catch {
    // Ignore hostile or already-closed readers.
  }
}

function boundedMilliseconds(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

/** Bound an arbitrary provider promise even when an injected transport ignores AbortSignal. */
export async function withProviderDeadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ProviderDeadlineError()), boundedMilliseconds(timeoutMs));
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Keep one deadline active from request start through bounded body consumption. */
export async function fetchBoundedProviderText<T extends BoundedProviderResponse>(
  fetchImpl: (url: string, init?: RequestInit) => Promise<T>,
  url: string,
  init: RequestInit,
  options: { timeoutMs: number; maximumBytes: number }
): Promise<{ response: T; text: string }> {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => controller.abort();
  if (upstreamSignal?.aborted) controller.abort();
  else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
  let response: T | undefined;
  try {
    return await withProviderDeadline((async () => {
      response = await fetchImpl(url, { ...init, signal: controller.signal });
      const text = await readBoundedProviderText(response, options.maximumBytes);
      return { response, text };
    })(), options.timeoutMs);
  } catch (error) {
    if (error instanceof ProviderDeadlineError || error instanceof ProviderBodyLimitError) {
      controller.abort();
      cancelBodyNonBlocking(response?.body, error);
    }
    throw error;
  } finally {
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}

function contentLength(response: BoundedProviderResponse): number | null {
  const raw = response.headers?.get("content-length");
  if (!raw || !/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function chunkBuffer(value: Uint8Array | string | undefined): Buffer {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  return value ? Buffer.from(value) : Buffer.alloc(0);
}

/** Consume a provider body with declared and streaming byte limits. */
export async function readBoundedProviderText(
  response: BoundedProviderResponse,
  maximumBytes: number
): Promise<string> {
  const limit = Number.isFinite(maximumBytes) ? Math.max(1, Math.floor(maximumBytes)) : 1;
  const declared = contentLength(response);
  if (declared !== null && declared > limit) throw new ProviderBodyLimitError();
  const body = response.body;
  if (!body) return "";
  const chunks: Buffer[] = [];
  let total = 0;
  const append = (value: Uint8Array | string | undefined) => {
    const chunk = chunkBuffer(value);
    total += chunk.length;
    if (total > limit) throw new ProviderBodyLimitError();
    chunks.push(chunk);
  };

  if (body.getReader) {
    const reader = body.getReader();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        append(next.value);
      }
    } catch (error) {
      if (error instanceof ProviderBodyLimitError) cancelReaderNonBlocking(reader, error);
      throw error;
    } finally {
      reader.releaseLock?.();
    }
  } else if (body[Symbol.asyncIterator]) {
    try {
      for await (const chunk of body as AsyncIterable<Uint8Array | string>) append(chunk);
    } catch (error) {
      if (error instanceof ProviderBodyLimitError) cancelBodyNonBlocking(body, error);
      throw error;
    }
  } else {
    throw new ProviderBodyLimitError();
  }
  return Buffer.concat(chunks, total).toString("utf8");
}
