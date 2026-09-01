import { describe, expect, test, vi } from "vitest";
import {
  OWNER_PROVIDER_MAX_RESPONSE_BYTES,
  YandexWebmasterSeoSource,
  selectVerifiedYandexHost,
} from "./yandexWebmasterSeoSource";

describe("selectVerifiedYandexHost", () => {
  const exact = {
    host_id: "https:example.com:443",
    ascii_host_url: "https://example.com/",
    verified: true,
  };

  test("selects only a verified host with the audited origin", () => {
    expect(selectVerifiedYandexHost([exact], "https://example.com/path")?.host_id)
      .toBe("https:example.com:443");
    expect(selectVerifiedYandexHost([exact], "http://example.com/path")).toBeNull();
    expect(selectVerifiedYandexHost([exact], "https://www.example.com/path")).toBeNull();
  });

  test("does not let a configured host id bypass verification or exact origin matching", () => {
    expect(selectVerifiedYandexHost([
      { ...exact, verified: false },
    ], "https://example.com/", exact.host_id)).toBeNull();
    expect(selectVerifiedYandexHost([
      { ...exact, ascii_host_url: "https://foreign.example/" },
    ], "https://example.com/", exact.host_id)).toBeNull();
  });

  test("does not accept parent or child-domain approximations", () => {
    expect(selectVerifiedYandexHost([
      { ...exact, ascii_host_url: "https://sub.example.com/", host_id: "https:sub.example.com:443" },
    ], "https://example.com/")).toBeNull();
    expect(selectVerifiedYandexHost([exact], "https://sub.example.com/")).toBeNull();
  });

  test("refuses a scheme-less audited target instead of guessing HTTPS provenance", () => {
    expect(selectVerifiedYandexHost([exact], "example.com")).toBeNull();
  });

  test("bounds and aborts owner response collection", async () => {
    const previousEnabled = process.env.YANDEX_WEBMASTER_ENABLED;
    const previousToken = process.env.YANDEX_WEBMASTER_OAUTH_TOKEN;
    process.env.YANDEX_WEBMASTER_ENABLED = "true";
    process.env.YANDEX_WEBMASTER_OAUTH_TOKEN = "configured";
    try {
      const oversized = new YandexWebmasterSeoSource({
        fetchImpl: vi.fn(async () => new Response("{}", {
          status: 200,
          headers: { "Content-Length": String(OWNER_PROVIDER_MAX_RESPONSE_BYTES + 1) },
        })),
      });
      await expect(oversized.getSnapshot("https://example.com/"))
        .rejects.toMatchObject({ safeMessage: "Yandex Webmaster request failed" });

      let aborted = false;
      const hanging = new YandexWebmasterSeoSource({
        requestTimeoutMs: 5,
        fetchImpl: vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("aborted", "AbortError"));
          }, { once: true });
        })),
      });
      await expect(hanging.getSnapshot("https://example.com/"))
        .rejects.toMatchObject({ safeMessage: "Yandex Webmaster request failed" });
      expect(aborted).toBe(true);
    } finally {
      if (previousEnabled === undefined) delete process.env.YANDEX_WEBMASTER_ENABLED;
      else process.env.YANDEX_WEBMASTER_ENABLED = previousEnabled;
      if (previousToken === undefined) delete process.env.YANDEX_WEBMASTER_OAUTH_TOKEN;
      else process.env.YANDEX_WEBMASTER_OAUTH_TOKEN = previousToken;
    }
  });

  test("does not retain raw provider error bodies in owner-source failures", async () => {
    const previousEnabled = process.env.YANDEX_WEBMASTER_ENABLED;
    const previousToken = process.env.YANDEX_WEBMASTER_OAUTH_TOKEN;
    process.env.YANDEX_WEBMASTER_ENABLED = "true";
    process.env.YANDEX_WEBMASTER_OAUTH_TOKEN = "configured";
    const secret = "provider-secret-token-value";
    try {
      const source = new YandexWebmasterSeoSource({
        fetchImpl: vi.fn(async () => new Response(JSON.stringify({ error: secret }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        })),
      });
      const error = await source.getSnapshot("https://example.com/").catch((value: unknown) => value);
      expect(error).toMatchObject({ safeMessage: "Yandex Webmaster request failed" });
      expect(JSON.stringify(error)).not.toContain(secret);
    } finally {
      if (previousEnabled === undefined) delete process.env.YANDEX_WEBMASTER_ENABLED;
      else process.env.YANDEX_WEBMASTER_ENABLED = previousEnabled;
      if (previousToken === undefined) delete process.env.YANDEX_WEBMASTER_OAUTH_TOKEN;
      else process.env.YANDEX_WEBMASTER_OAUTH_TOKEN = previousToken;
    }
  });
});
