import { describe, expect, test, vi } from "vitest";
import { zarukuSeoProductionConfig } from "../zarukuSeoProductionConfig";
import {
  collectYandexGenSearchProbes,
  type YandexGenSearchFetch,
  type YandexGenSearchSleep,
} from "./yandexGenSearchProbeCollector";

const oneQueryConfig = {
  ...zarukuSeoProductionConfig,
  aiProbeQueries: ["Что такое портал За руку zaruku.ru для онкопациентов?"],
};

function response(status: number, body: unknown): Awaited<ReturnType<YandexGenSearchFetch>> {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status });
}

describe("collectYandexGenSearchProbes", () => {
  test("returns checked aiProbes output from fixture API response without live network", async () => {
    const fetchImpl: YandexGenSearchFetch = async (url, init) => {
      expect(url).toBe("https://searchapi.api.cloud.yandex.net/v2/gen/search");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({
        Authorization: "Api-Key test-key",
        "Content-Type": "application/json",
      });
      expect(JSON.parse(String(init.body))).toEqual({
        folderId: "folder-1",
        messages: [
          {
            role: "ROLE_USER",
            content: "Что такое портал За руку zaruku.ru для онкопациентов?",
          },
        ],
        responseFormat: "RESP_FORMAT_JSON",
      });
      return response(200, {
        answer: "AI answer",
        sources: [
          { url: "https://external.example/", title: "External", used: true },
          { sourceUrl: "https://zaruku.ru/about/", title: "Target", used: false },
          { url: "https://www.zaruku.ru/", title: "Target used", used: true },
        ],
      });
    };

    await expect(
      collectYandexGenSearchProbes(oneQueryConfig, {
        env: {
          YANDEX_GEN_SEARCH_API_KEY: "test-key",
          YANDEX_SEARCH_FOLDER_ID: "folder-1",
        },
        fetchImpl,
        sleepImpl: async () => undefined,
      })
    ).resolves.toEqual([
      {
        channel: "Yandex Search API generative response",
        status: "checked",
        query: "Что такое портал За руку zaruku.ru для онкопациентов?",
        result: "AI answer",
        sources: [
          "https://external.example/",
          "https://zaruku.ru/about/",
          "https://www.zaruku.ru/",
        ],
        sourceDetails: [
          { url: "https://external.example/", title: "External", used: true },
          { url: "https://zaruku.ru/about/", title: "Target", used: false },
          { url: "https://www.zaruku.ru/", title: "Target used", used: true },
        ],
        usedSources: [
          "https://external.example/",
          "https://www.zaruku.ru/",
        ],
        targetFound: true,
        targetUsed: true,
        sourcePosition: 2,
        usedSourcePosition: 2,
      },
    ]);
  });

  test("preserves not_configured output and inter-query throttling", async () => {
    const sleeps: number[] = [];
    const sleepImpl: YandexGenSearchSleep = async (ms) => {
      sleeps.push(ms);
    };
    const fetchImpl: YandexGenSearchFetch = async () => {
      throw new Error("fetch should not be called without config");
    };

    const results = await collectYandexGenSearchProbes(
      {
        ...zarukuSeoProductionConfig,
        aiProbeQueries: ["q1", "q2"],
      },
      {
        env: {},
        fetchImpl,
        sleepImpl,
      }
    );

    expect(results).toEqual([
      {
        channel: "Yandex Search API generative response",
        status: "not_configured",
        query: "q1",
        result: "Missing YANDEX_GEN_SEARCH_API_KEY or YANDEX_GEN_SEARCH_IAM_TOKEN and folder id.",
        sources: [],
        sourceDetails: [],
        usedSources: [],
        targetFound: false,
        targetUsed: false,
        sourcePosition: null,
        usedSourcePosition: null,
      },
      {
        channel: "Yandex Search API generative response",
        status: "not_configured",
        query: "q2",
        result: "Missing YANDEX_GEN_SEARCH_API_KEY or YANDEX_GEN_SEARCH_IAM_TOKEN and folder id.",
        sources: [],
        sourceDetails: [],
        usedSources: [],
        targetFound: false,
        targetUsed: false,
        sourcePosition: null,
        usedSourcePosition: null,
      },
    ]);
    expect(sleeps).toEqual([1300]);
  });

  test("preserves permission_denied and failed output shapes", async () => {
    const deniedFetch: YandexGenSearchFetch = async () => response(403, { message: "denied" });
    const failedFetch: YandexGenSearchFetch = async () => response(500, { message: "server failed" });

    await expect(
      collectYandexGenSearchProbes(oneQueryConfig, {
        env: {
          YANDEX_GEN_SEARCH_IAM_TOKEN: "iam-token",
          YANDEX_GEN_SEARCH_FOLDER_ID: "folder-1",
        },
        fetchImpl: deniedFetch,
        sleepImpl: async () => undefined,
      })
    ).resolves.toEqual([
      {
        channel: "Yandex Search API generative response",
        status: "permission_denied",
        query: "Что такое портал За руку zaruku.ru для онкопациентов?",
        result: "Permission denied. Grant search-api.webSearch.user to the service account/API key on the configured Yandex Cloud folder.",
        sources: [],
        sourceDetails: [],
        usedSources: [],
        targetFound: false,
        targetUsed: false,
        sourcePosition: null,
        usedSourcePosition: null,
      },
    ]);

    await expect(
      collectYandexGenSearchProbes(oneQueryConfig, {
        env: {
          YANDEX_GEN_SEARCH_IAM_TOKEN: "iam-token",
          YANDEX_GEN_SEARCH_FOLDER_ID: "folder-1",
        },
        fetchImpl: failedFetch,
        sleepImpl: async () => undefined,
      })
    ).resolves.toEqual([
      {
        channel: "Yandex Search API generative response",
        status: "failed",
        query: "Что такое портал За руку zaruku.ru для онкопациентов?",
        result: "Yandex generative search request failed.",
        sources: [],
        sourceDetails: [],
        usedSources: [],
        targetFound: false,
        targetUsed: false,
        sourcePosition: null,
        usedSourcePosition: null,
      },
    ]);
  });

  test("returns fixed failed evidence when fetch or body consumption hangs", async () => {
    const fetchImpl: YandexGenSearchFetch = async () => new Promise(() => undefined);

    const result = await collectYandexGenSearchProbes(oneQueryConfig, {
      env: {
        YANDEX_GEN_SEARCH_API_KEY: "test-key",
        YANDEX_SEARCH_FOLDER_ID: "folder-1",
      },
      fetchImpl,
      requestTimeoutMs: 10,
      overallTimeoutMs: 25,
    });

    expect(result).toEqual([
      expect.objectContaining({
        status: "failed",
        result: "Yandex generative search request failed.",
        sources: [],
      }),
    ]);
  });

  test("rejects an oversized declared response without consuming its body", async () => {
    const read = vi.fn();
    const fetchImpl: YandexGenSearchFetch = async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": "33" }),
      body: { getReader: () => ({ read }) },
    });

    const result = await collectYandexGenSearchProbes(oneQueryConfig, {
      env: {
        YANDEX_GEN_SEARCH_API_KEY: "test-key",
        YANDEX_SEARCH_FOLDER_ID: "folder-1",
      },
      fetchImpl,
      maxResponseBytes: 32,
    });

    expect(read).not.toHaveBeenCalled();
    expect(result[0]).toMatchObject({ status: "failed", result: "Yandex generative search request failed." });
  });
});
