import { describe, expect, it } from "vitest";
import { validateInvocationInputs } from "./input-validation";
import { Capability } from "../artifact/capability";
import { openSubAccountCapability } from "../artifact/examples/open-sub-account";

describe("validateInvocationInputs", () => {
  it("accepts valid inputs", () => {
    const result = validateInvocationInputs(openSubAccountCapability, {
      member_id: "48213",
      account_type: "savings",
      initial_deposit: 100,
    });
    expect(result).toEqual({
      valid: true,
      inputs: { member_id: "48213", account_type: "savings", initial_deposit: 100 },
    });
  });

  it("rejects a missing required input", () => {
    const result = validateInvocationInputs(openSubAccountCapability, {
      account_type: "savings",
      initial_deposit: 100,
    });
    expect(result.valid).toBe(false);
  });

  it("rejects a numeric string for a number input (no implicit coercion)", () => {
    const result = validateInvocationInputs(openSubAccountCapability, {
      member_id: "48213",
      account_type: "savings",
      initial_deposit: "100",
    });
    expect(result.valid).toBe(false);
  });

  it("rejects a number input below its declared min", () => {
    // Synthetic capability: open-sub-account's own initial_deposit input has
    // no min (the $25 rule is the target app's business rule, modeled as
    // the VALIDATION_ERROR business outcome instead — see open-sub-account.ts).
    // This tests the min/max constraint path in isolation.
    const withMinConstraint = {
      inputs: { amount: { type: "number", required: true, min: 25 } },
    } as unknown as Capability;

    expect(validateInvocationInputs(withMinConstraint, { amount: 5 }).valid).toBe(false);
    expect(validateInvocationInputs(withMinConstraint, { amount: 25 }).valid).toBe(true);
  });

  it("rejects an account_type outside the declared enum", () => {
    const result = validateInvocationInputs(openSubAccountCapability, {
      member_id: "48213",
      account_type: "money-market",
      initial_deposit: 100,
    });
    expect(result.valid).toBe(false);
  });
});
