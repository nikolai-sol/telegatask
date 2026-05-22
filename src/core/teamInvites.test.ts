import { describe, expect, it } from "vitest";
import {
  buildInviteDeepLink,
  evaluateInviteActivation,
  extractInviteCodeFromStartPayload,
  generateInviteCode,
} from "./teamInvites";

describe("teamInvites", () => {
  it("generateInviteCode returns expected format", () => {
    const code = generateInviteCode(8);
    expect(code).toMatch(/^[A-Za-z0-9]{8}$/);
  });

  it("activateInvite success decision", () => {
    const status = evaluateInviteActivation({
      code: "Ab12Cd34",
      inviteCode: "Ab12Cd34",
      status: "invited",
      nowMs: Date.now(),
      inviteExpiresAt: Date.now() + 1000,
    });
    expect(status).toBe("success");
  });

  it("activateInvite invalid decision", () => {
    const status = evaluateInviteActivation({
      code: "Ab12Cd34",
      inviteCode: null,
      status: "invited",
    });
    expect(status).toBe("invalid");
  });

  it("activateInvite expired decision", () => {
    const status = evaluateInviteActivation({
      code: "Ab12Cd34",
      inviteCode: "Ab12Cd34",
      status: "invited",
      nowMs: Date.now(),
      inviteExpiresAt: Date.now() - 1000,
    });
    expect(status).toBe("expired");
  });

  it("activateInvite idempotent decision for already active member", () => {
    const status = evaluateInviteActivation({
      code: "Ab12Cd34",
      inviteCode: "Ab12Cd34",
      status: "invited",
      userAlreadyMember: true,
    });
    expect(status).toBe("idempotent");
  });

  it("extract invite payload and build deep link", () => {
    expect(extractInviteCodeFromStartPayload("invite_Ab12Cd34")).toBe("Ab12Cd34");
    expect(extractInviteCodeFromStartPayload("other")).toBeNull();
    expect(buildInviteDeepLink("my_bot", "Ab12Cd34")).toBe("https://t.me/my_bot?start=invite_Ab12Cd34");
  });
});
