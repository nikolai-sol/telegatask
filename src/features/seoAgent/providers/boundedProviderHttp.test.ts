import { describe, expect, test, vi } from "vitest";
import {
  fetchBoundedProviderText,
  ProviderBodyLimitError,
  ProviderDeadlineError,
} from "./boundedProviderHttp";

function never(): Promise<never> {
  return new Promise(() => undefined);
}

describe("bounded provider HTTP cleanup", () => {
  test("does not let a never-settling body cancel defeat the request deadline", async () => {
    const cancel = vi.fn(never);
    const operation = fetchBoundedProviderText(
      async () => ({
        headers: { get: () => null },
        body: {
          getReader: () => ({ read: never, cancel: vi.fn(never) }),
          cancel,
        },
      }),
      "https://provider.example/data",
      {},
      { timeoutMs: 5, maximumBytes: 1024 }
    ).then(() => "resolved", (error) => error?.constructor);

    const outcome = await Promise.race([
      operation,
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 100)),
    ]);
    expect(outcome).toBe(ProviderDeadlineError);
    expect(cancel).toHaveBeenCalledOnce();
  });

  test("does not await a never-settling reader cancel after crossing the byte cap", async () => {
    const readerCancel = vi.fn(never);
    const operation = fetchBoundedProviderText(
      async () => ({
        headers: { get: () => null },
        body: {
          getReader: () => ({
            read: vi.fn(async () => ({ done: false, value: new Uint8Array(2) })),
            cancel: readerCancel,
          }),
        },
      }),
      "https://provider.example/data",
      {},
      { timeoutMs: 1_000, maximumBytes: 1 }
    ).then(() => "resolved", (error) => error?.constructor);

    const outcome = await Promise.race([
      operation,
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 100)),
    ]);
    expect(outcome).toBe(ProviderBodyLimitError);
    expect(readerCancel).toHaveBeenCalledOnce();
  });
});
