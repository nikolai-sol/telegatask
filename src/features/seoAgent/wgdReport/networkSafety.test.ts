import { describe, expect, test, vi } from "vitest";
import {
  isPublicIpAddress,
  resolvePublicHttpUrl,
  type DnsResolver,
} from "./networkSafety";

describe("public-only network boundary", () => {
  test.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "224.0.0.1",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
  ])("rejects non-public address %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });

  test.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])(
    "accepts public address %s",
    (address) => {
      expect(isPublicIpAddress(address)).toBe(true);
    }
  );

  test.each([
    "http://localhost/",
    "http://api.localhost/",
    "http://printer.local/",
    "http://metadata.google.internal/",
    "http://metadata.internal/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
  ])("rejects forbidden literal or special hostname %s without DNS", async (url) => {
    const resolver = vi.fn<DnsResolver>();
    await expect(resolvePublicHttpUrl(url, resolver)).rejects.toThrow("public internet");
    expect(resolver).not.toHaveBeenCalled();
  });

  test("rejects a hostname when any DNS answer is non-public without leaking resolver errors", async () => {
    const resolver: DnsResolver = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "192.168.1.5", family: 4 },
    ];
    await expect(resolvePublicHttpUrl("https://example.com/", resolver)).rejects.toThrow(
      "public internet"
    );

    const failingResolver: DnsResolver = async () => {
      throw new Error("ENOTFOUND secret.internal");
    };
    await expect(resolvePublicHttpUrl("https://example.com/", failingResolver)).rejects.toThrow(
      "could not be resolved safely"
    );
    await expect(resolvePublicHttpUrl("https://example.com/", failingResolver)).rejects.not.toThrow(
      /ENOTFOUND|secret\.internal/
    );
  });

  test("returns only validated public addresses for transport pinning", async () => {
    const result = await resolvePublicHttpUrl("https://Example.com/path", async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);

    expect(result).toEqual({
      url: "https://example.com/path",
      hostname: "example.com",
      addresses: [
        { address: "93.184.216.34", family: 4 },
        { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
      ],
    });
  });
});
