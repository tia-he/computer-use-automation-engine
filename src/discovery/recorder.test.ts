import { describe, expect, it } from "vitest";
import { compileCapability, toValueRef } from "./recorder";
import { RecordedAction } from "./types";
import { CapabilitySchema } from "../artifact/capability";
import { openSubAccountCapability } from "../artifact/examples/open-sub-account";

const invocationContext = { member_id: "48213", account_type: "savings", initial_deposit: 500 };

describe("toValueRef", () => {
  it("encodes an exact match against the invocation context as input_ref", () => {
    expect(toValueRef("48213", invocationContext)).toEqual({ kind: "input_ref", name: "member_id" });
    expect(toValueRef("savings", invocationContext)).toEqual({ kind: "input_ref", name: "account_type" });
    expect(toValueRef("500", invocationContext)).toEqual({ kind: "input_ref", name: "initial_deposit" });
  });

  it("keeps a non-matching value as a literal", () => {
    expect(toValueRef("http://localhost:4100/", invocationContext)).toEqual({
      kind: "literal",
      value: "http://localhost:4100/",
    });
  });

  it("does not fuzzy-match a substring or prefix", () => {
    expect(toValueRef("482134", invocationContext)).toEqual({ kind: "literal", value: "482134" });
  });
});

describe("compileCapability", () => {
  const nameStrategy = (name: string) => ({ strategies: [{ kind: "role" as const, role: "button", name }] });

  const recordedActions: RecordedAction[] = [
    { kind: "navigate", url: "http://localhost:4100/", risk: "safe" },
    {
      kind: "fill",
      target: { strategies: [{ kind: "attribute", attribute: "name", value: "memberId" }] },
      value: "48213",
      risk: "safe",
    },
    { kind: "click", target: nameStrategy("Search"), risk: "safe" },
    { kind: "click", target: nameStrategy("Confirm & Open Account"), risk: "irreversible" },
    {
      kind: "extract",
      target: { strategies: [{ kind: "text", text: "SAV-48213-1" }] },
      outputName: "new_account_number",
      risk: "safe",
    },
    {
      kind: "extract",
      target: { strategies: [{ kind: "text", text: "CONF-1000" }] },
      outputName: "confirmation_id",
      risk: "safe",
    },
  ];

  const provenance = { discoveryRunId: "run-1", recordedAt: "2026-08-17T00:00:00.000Z", model: "test-model" };

  it("produces a Capability that parses against the Phase 3 schema", () => {
    const { capability, warnings } = compileCapability(recordedActions, invocationContext, openSubAccountCapability, provenance);
    expect(warnings).toEqual([]);
    const result = CapabilitySchema.safeParse(capability);
    expect(result.success).toBe(true);
  });

  it("parameterizes the matching fill value and leaves the navigate URL literal", () => {
    const { capability } = compileCapability(recordedActions, invocationContext, openSubAccountCapability, provenance);
    const fillStep = capability.steps.find((s) => s.action.kind === "fill")!;
    expect(fillStep.action.kind).toBe("fill");
    if (fillStep.action.kind === "fill") {
      expect(fillStep.action.value).toEqual({ kind: "input_ref", name: "member_id" });
    }
    const navigateStep = capability.steps[0];
    expect(navigateStep.action).toEqual({ kind: "navigate", url: { kind: "literal", value: "http://localhost:4100/" } });
  });

  it("marks the recorded irreversible action as irreversible in the compiled step", () => {
    const { capability } = compileCapability(recordedActions, invocationContext, openSubAccountCapability, provenance);
    const confirmStep = capability.steps.find(
      (s) => s.action.kind === "click" && s.action.target.strategies[0].kind === "role" && (s.action.target.strategies[0] as { name: string }).name === "Confirm & Open Account"
    );
    expect(confirmStep?.risk).toBe("irreversible");
  });

  it("remaps output sourceStepId to the newly discovered extract steps, not the template's", () => {
    const { capability } = compileCapability(recordedActions, invocationContext, openSubAccountCapability, provenance);
    expect(capability.outputs.new_account_number.sourceStepId).toBe("step-5");
    expect(capability.outputs.confirmation_id.sourceStepId).toBe("step-6");
    expect(capability.outputs.new_account_number.sourceStepId).not.toBe(
      openSubAccountCapability.outputs.new_account_number.sourceStepId
    );
  });

  it("copies inputs, businessOutcomes, and successCheckpoint verbatim from the template", () => {
    const { capability } = compileCapability(recordedActions, invocationContext, openSubAccountCapability, provenance);
    expect(capability.inputs).toEqual(openSubAccountCapability.inputs);
    expect(capability.businessOutcomes).toEqual(openSubAccountCapability.businessOutcomes);
    expect(capability.successCheckpoint).toEqual(openSubAccountCapability.successCheckpoint);
  });

  it("sets approval to draft and carries the real provenance", () => {
    const { capability } = compileCapability(recordedActions, invocationContext, openSubAccountCapability, provenance);
    expect(capability.approval).toBe("draft");
    expect(capability.provenance).toEqual(provenance);
  });

  it("warns instead of failing when a templated output was never extracted", () => {
    const incomplete = recordedActions.slice(0, 4); // no extract steps at all
    const { capability, warnings } = compileCapability(incomplete, invocationContext, openSubAccountCapability, provenance);
    expect(warnings).toHaveLength(2);
    expect(Object.keys(capability.outputs)).toHaveLength(0);
    expect(CapabilitySchema.safeParse(capability).success).toBe(true);
  });
});
