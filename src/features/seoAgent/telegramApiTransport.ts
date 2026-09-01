type TelegramFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type TelegramApiResponse<T> = {
  ok: boolean;
  description?: string;
  result?: T;
  parameters?: {
    retry_after?: number;
  };
};

function errorDetail(error: unknown): string {
  const root = error instanceof Error ? error : new Error(String(error));
  const cause = (root as Error & { cause?: unknown }).cause;
  if (!cause || typeof cause !== "object") return root.message;
  const causeRecord = cause as { code?: unknown; message?: unknown };
  const causeCode = typeof causeRecord.code === "string" ? `${causeRecord.code}: ` : "";
  const causeMessage = typeof causeRecord.message === "string" ? causeRecord.message : String(cause);
  return `${root.message}; cause=${causeCode}${causeMessage}`;
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function callTelegramApi<T = unknown>(input: {
  token: string;
  method: string;
  body: Record<string, unknown>;
  fetchImpl?: TelegramFetch;
  sleep?: (delayMs: number) => Promise<void>;
  onRetry?: (message: string) => void;
}): Promise<T> {
  const fetchImpl = input.fetchImpl || fetch;
  const sleep = input.sleep || defaultSleep;
  const delaysMs = [1_000, 3_000];

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(`https://api.telegram.org/bot${input.token}/${input.method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input.body),
      });
    } catch (error) {
      const detail = errorDetail(error);
      if (attempt === 3) {
        throw new Error(`${input.method} transport failed after ${attempt} attempts: ${detail}`);
      }
      input.onRetry?.(`${input.method} transport attempt ${attempt} failed: ${detail}; retrying`);
      await sleep(delaysMs[attempt - 1]);
      continue;
    }

    let payload: TelegramApiResponse<T>;
    try {
      payload = await response.json() as TelegramApiResponse<T>;
    } catch (error) {
      const detail = errorDetail(error);
      if (attempt === 3 || (response.status < 500 && response.status !== 429)) {
        throw new Error(`${input.method} response parsing failed: ${detail}`);
      }
      input.onRetry?.(`${input.method} returned an unreadable ${response.status} response; retrying`);
      await sleep(delaysMs[attempt - 1]);
      continue;
    }

    if (response.ok && payload.ok) return payload.result as T;

    const description = payload.description || `HTTP ${response.status}`;
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 3) {
      throw new Error(`${input.method} failed: ${description}`);
    }
    const retryAfterMs = Number(payload.parameters?.retry_after) > 0
      ? Number(payload.parameters?.retry_after) * 1_000
      : delaysMs[attempt - 1];
    input.onRetry?.(`${input.method} attempt ${attempt} failed: ${description}; retrying`);
    await sleep(retryAfterMs);
  }

  throw new Error(`${input.method} failed after retry limit`);
}
