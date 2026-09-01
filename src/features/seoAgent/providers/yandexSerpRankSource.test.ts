import { describe, expect, test, vi } from "vitest";
import { YandexSerpRankSource } from "./yandexSerpRankSource";

const ENV = {
  YANDEX_SEARCH_API_KEY: "test-key",
  YANDEX_SEARCH_FOLDER_ID: "folder",
  YANDEX_SEARCH_MODE: "sync",
};

function run(source: YandexSerpRankSource) {
  return source.run({
    targetDomain: "example.com",
    keywords: ["example keyword"],
    region: "225",
    language: "ru",
    device: "desktop",
  });
}

describe("YandexSerpRankSource provider budgets", () => {
  test("records the exact Yandex search depth", async () => {
    const source = new YandexSerpRankSource({
      env: ENV,
      fetchImpl: async () => new Response(JSON.stringify({
        response: {
          rawData: Buffer.from(
            "<response><results><grouping><group><doc><url>https://example.com/</url></doc></group></grouping></results></response>"
          ).toString("base64"),
        },
      }), { status: 200 }),
    });

    const result = await run(source);

    expect(result.checks[0].checkedDepth).toBe(20);
  });

  test("does not match a target beyond the checked Yandex depth", async () => {
    const documents = [
      ...Array.from({ length: 20 }, (_, index) =>
        `<group><doc><url>https://competitor-${index + 1}.example/</url></doc></group>`),
      "<group><doc><url>https://example.com/</url></doc></group>",
    ].join("");
    const source = new YandexSerpRankSource({
      env: ENV,
      fetchImpl: async () => new Response(JSON.stringify({
        response: {
          rawData: Buffer.from(
            `<response><results><grouping>${documents}</grouping></results></response>`
          ).toString("base64"),
        },
      }), { status: 200 }),
    });

    const result = await run(source);

    expect(result.checks[0]).toMatchObject({ found: false, checkedDepth: 20 });
    expect(result.checks[0].position).toBeUndefined();
  });

  test("turns a hanging fetch into fixed partial evidence within the request deadline", async () => {
    const source = new YandexSerpRankSource({
      env: ENV,
      fetchImpl: async () => new Promise<Response>(() => undefined),
      requestTimeoutMs: 10,
      overallTimeoutMs: 25,
    });

    const result = await run(source);

    expect(result.checks).toEqual([]);
    expect(result.status).toMatchObject({ state: "partial_success", errorCode: "YANDEX_SEARCH_PARTIAL" });
    expect(JSON.stringify(result)).not.toContain("timed out");
  });

  test("rejects an oversized declared body before reading it", async () => {
    const read = vi.fn();
    const cancel = vi.fn(async () => undefined);
    const source = new YandexSerpRankSource({
      env: ENV,
      maxResponseBytes: 16,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": "17" }),
        body: { getReader: () => ({ read }), cancel },
      } as unknown as Response),
    });

    const result = await run(source);

    expect(read).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(result.status.state).toBe("partial_success");
  });

  test("aborts a chunked provider body as soon as its byte cap is exceeded", async () => {
    const cancel = vi.fn(async () => undefined);
    let reads = 0;
    const source = new YandexSerpRankSource({
      env: ENV,
      maxResponseBytes: 8,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: {
          getReader: () => ({
            read: async () => ({ done: false, value: new Uint8Array(++reads === 1 ? 5 : 4) }),
            cancel,
          }),
        },
      } as unknown as Response),
    });

    const result = await run(source);

    expect(cancel).toHaveBeenCalledOnce();
    expect(result.status.state).toBe("partial_success");
  });
});
