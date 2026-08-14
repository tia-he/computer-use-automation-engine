import { describe, expect, it } from "vitest";
import { TargetProfileSchema } from "./target-profile";
import { mockBankTargetProfile } from "./examples/mock-bank-target-profile";

describe("TargetProfileSchema", () => {
  it("parses a valid target profile", () => {
    const result = TargetProfileSchema.safeParse(mockBankTargetProfile);
    expect(result.success).toBe(true);
  });

  it("round-trips through JSON", () => {
    const json = JSON.parse(JSON.stringify(mockBankTargetProfile));
    expect(TargetProfileSchema.safeParse(json).success).toBe(true);
  });

  it("fails when entryUrl is missing", () => {
    const profile = JSON.parse(JSON.stringify(mockBankTargetProfile));
    delete profile.entryUrl;
    expect(TargetProfileSchema.safeParse(profile).success).toBe(false);
  });

  it("fails when entryUrl is not a valid URL", () => {
    const profile = JSON.parse(JSON.stringify(mockBankTargetProfile));
    profile.entryUrl = "not-a-url";
    expect(TargetProfileSchema.safeParse(profile).success).toBe(false);
  });

  it("accepts a profile with a sessionExpiredDetector and knownInterstitials", () => {
    const profile = {
      ...JSON.parse(JSON.stringify(mockBankTargetProfile)),
      sessionExpiredDetector: { kind: "url_matches", pattern: "/login$" },
      knownInterstitials: [
        {
          code: "WELCOME_BANNER",
          detector: { kind: "element_visible", target: { strategies: [{ kind: "text", text: "Welcome" }] } },
          dismissTarget: { strategies: [{ kind: "role", role: "button", name: "Dismiss" }] },
        },
      ],
    };
    expect(TargetProfileSchema.safeParse(profile).success).toBe(true);
  });
});
