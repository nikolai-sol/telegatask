import { describe, expect, it } from "vitest";
import { mergeSeenInChats, normalizeTelegramUsername } from "./observedUsers";

describe("observedUsers helpers", () => {
  it("normalizes telegram usernames", () => {
    expect(normalizeTelegramUsername("  @Nick_Name  ")).toBe("nick_name");
    expect(normalizeTelegramUsername("")).toBeNull();
    expect(normalizeTelegramUsername(undefined)).toBeNull();
  });

  it("caps seenInChats list and moves latest chat to front", () => {
    const seed = Array.from({ length: 55 }, (_, i) => String(i + 1));
    const merged = mergeSeenInChats(seed, "42");
    expect(merged.length).toBe(50);
    expect(merged[0]).toBe("42");
    expect(merged.filter((x) => x === "42").length).toBe(1);
  });
});
