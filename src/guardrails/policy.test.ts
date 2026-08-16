import { describe, expect, it } from "vitest";
import { GuardrailPolicy } from "./policy";

function policy() {
  return new GuardrailPolicy({
    id: "test-policy",
    allowedOrigins: ["http://localhost:4100"],
    allowedActionKinds: ["navigate", "click", "fill"],
  });
}

describe("GuardrailPolicy", () => {
  it("allows a safe action within the allowed origin and action kinds", () => {
    const decision = policy().evaluate({
      actionKind: "click",
      risk: "safe",
      url: "http://localhost:4100/members/48213",
      approved: false,
    });
    expect(decision).toEqual({ kind: "allowed" });
  });

  it("denies an action outside the allowed origin", () => {
    const decision = policy().evaluate({
      actionKind: "navigate",
      risk: "safe",
      url: "http://evil.example.com/",
      approved: false,
    });
    expect(decision.kind).toBe("denied");
  });

  it("denies an action kind not in the allowlist", () => {
    const decision = policy().evaluate({
      actionKind: "select",
      risk: "safe",
      url: "http://localhost:4100/",
      approved: false,
    });
    expect(decision.kind).toBe("denied");
  });

  it("requires approval for an unapproved irreversible step", () => {
    const decision = policy().evaluate({
      actionKind: "click",
      risk: "irreversible",
      url: "http://localhost:4100/",
      approved: false,
    });
    expect(decision.kind).toBe("requires_approval");
  });

  it("allows an approved irreversible step", () => {
    const decision = policy().evaluate({
      actionKind: "click",
      risk: "irreversible",
      url: "http://localhost:4100/",
      approved: true,
    });
    expect(decision).toEqual({ kind: "allowed" });
  });

  it("treats an unparseable url as denied, not a crash", () => {
    const decision = policy().evaluate({
      actionKind: "navigate",
      risk: "safe",
      url: "not-a-url",
      approved: false,
    });
    expect(decision.kind).toBe("denied");
  });
});
