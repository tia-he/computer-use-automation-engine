import { describe, expect, it } from "vitest";
import { CapabilitySchema } from "./capability";
import { openSubAccountCapability } from "./examples/open-sub-account";

function base() {
  // A minimal, otherwise-valid capability used as a starting point for
  // negative tests, so each test only breaks the one thing it's checking.
  return JSON.parse(JSON.stringify(openSubAccountCapability));
}

describe("CapabilitySchema", () => {
  it("parses a valid capability", () => {
    const result = CapabilitySchema.safeParse(openSubAccountCapability);
    expect(result.success).toBe(true);
  });

  it("round-trips through JSON (the artifact is genuinely serializable)", () => {
    const json = JSON.parse(JSON.stringify(openSubAccountCapability));
    const result = CapabilitySchema.safeParse(json);
    expect(result.success).toBe(true);
  });

  it("fails when a required field is missing", () => {
    const capability = base();
    delete capability.description;
    expect(CapabilitySchema.safeParse(capability).success).toBe(false);
  });

  it("fails on an unsupported action kind", () => {
    const capability = base();
    capability.steps[0].action = { kind: "hover", target: { strategies: [{ kind: "text", text: "x" }] } };
    expect(CapabilitySchema.safeParse(capability).success).toBe(false);
  });

  it("fails on a malformed LogicalLocator (empty strategies array)", () => {
    const capability = base();
    capability.steps[1].action.target = { strategies: [] };
    expect(CapabilitySchema.safeParse(capability).success).toBe(false);
  });

  it("fails on a malformed LogicalLocator (role strategy missing name)", () => {
    const capability = base();
    capability.steps[2].action.target = { strategies: [{ kind: "role", role: "button" }] };
    expect(CapabilitySchema.safeParse(capability).success).toBe(false);
  });

  it("fails on an invalid risk value", () => {
    const capability = base();
    capability.steps[0].risk = "dangerous";
    expect(CapabilitySchema.safeParse(capability).success).toBe(false);
  });

  it("fails on a malformed business outcome (wrong classification literal)", () => {
    const capability = base();
    capability.businessOutcomes[0].classification = "hard_failure";
    expect(CapabilitySchema.safeParse(capability).success).toBe(false);
  });

  it("fails on a malformed business outcome (missing detector)", () => {
    const capability = base();
    delete capability.businessOutcomes[0].detector;
    expect(CapabilitySchema.safeParse(capability).success).toBe(false);
  });

  it("fails on a malformed business outcome (lowercase code)", () => {
    const capability = base();
    capability.businessOutcomes[0].code = "member_not_found";
    expect(CapabilitySchema.safeParse(capability).success).toBe(false);
  });

  it("fails when a step references an undeclared input", () => {
    const capability = base();
    capability.steps[1].action.value = { kind: "input_ref", name: "not_a_declared_input" };
    const result = CapabilitySchema.safeParse(capability);
    expect(result.success).toBe(false);
  });

  it("fails when an output references a non-extract step", () => {
    const capability = base();
    capability.outputs.new_account_number.sourceStepId = "click-confirm";
    const result = CapabilitySchema.safeParse(capability);
    expect(result.success).toBe(false);
  });

  it("fails when two steps share the same id", () => {
    const capability = base();
    capability.steps[1].id = capability.steps[0].id;
    expect(CapabilitySchema.safeParse(capability).success).toBe(false);
  });
});
