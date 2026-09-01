import { describe, expect, test } from "vitest";
import { resolveProviderAuditedOrigin } from "./seoDataProvider";

describe("resolveProviderAuditedOrigin", () => {
  test("retains an explicit scheme or a matching URL-prefix property without guessing", () => {
    expect(resolveProviderAuditedOrigin("http://example.com/path", null)).toBe("http://example.com");
    expect(resolveProviderAuditedOrigin("example.com", "https://example.com/blog/")).toBe("https://example.com");
    expect(resolveProviderAuditedOrigin("example.com", "sc-domain:example.com")).toBeNull();
    expect(resolveProviderAuditedOrigin("example.com", "https://www.example.com/")).toBeNull();
  });
});
