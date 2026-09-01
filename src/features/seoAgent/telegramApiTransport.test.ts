import { describe, expect, test, vi } from "vitest";
import { callTelegramApi } from "./telegramApiTransport";

function okResponse(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("telegramApiTransport", () => {
  test("retries a transient fetch failure before returning the Telegram result", async () => {
    const networkError = new TypeError("fetch failed", {
      cause: Object.assign(new Error("socket disconnected"), { code: "ECONNRESET" }),
    });
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(okResponse({ message_id: 3173 }));
    const sleep = vi.fn(async () => undefined);

    const result = await callTelegramApi({
      token: "token",
      method: "sendMessage",
      body: { chat_id: 2779103, text: "digest" },
      fetchImpl,
      sleep,
    });

    expect(result).toEqual({ message_id: 3173 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  test("does not retry a permanent Telegram API rejection", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      description: "Bad Request: chat not found",
    }), { status: 400 }));
    const sleep = vi.fn(async () => undefined);

    await expect(callTelegramApi({
      token: "token",
      method: "sendMessage",
      body: { chat_id: 2779103, text: "digest" },
      fetchImpl,
      sleep,
    })).rejects.toThrow("sendMessage failed: Bad Request: chat not found");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("includes the transport cause after the final failed attempt", async () => {
    const networkError = new TypeError("fetch failed", {
      cause: Object.assign(new Error("socket disconnected"), { code: "ECONNRESET" }),
    });
    const fetchImpl = vi.fn(async () => Promise.reject(networkError));

    await expect(callTelegramApi({
      token: "token",
      method: "sendMessage",
      body: { chat_id: 2779103, text: "digest" },
      fetchImpl,
      sleep: async () => undefined,
    })).rejects.toThrow("sendMessage transport failed after 3 attempts: fetch failed; cause=ECONNRESET: socket disconnected");

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
