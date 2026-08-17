import { ValueRef } from "../artifact/value-ref";
import { Capability, OutputDeclaration, Provenance, Step } from "../artifact/capability";
import { RecordedAction } from "./types";

/**
 * Exact-match only, per the brief: encode a recorded literal as an
 * input_ref when it exactly equals one of this run's invocation values,
 * otherwise keep it as a literal. No fuzzy/semantic inference.
 */
export function toValueRef(literalValue: string, invocationContext: Record<string, string | number>): ValueRef {
  for (const [name, value] of Object.entries(invocationContext)) {
    if (String(value) === literalValue) {
      return { kind: "input_ref", name };
    }
  }
  return { kind: "literal", value: literalValue };
}

function recordedActionToStep(action: RecordedAction, id: string, invocationContext: Record<string, string | number>): Step {
  switch (action.kind) {
    case "navigate":
      return { id, risk: action.risk, action: { kind: "navigate", url: toValueRef(action.url, invocationContext) } };
    case "click":
      return { id, risk: action.risk, action: { kind: "click", target: action.target } };
    case "fill":
      return {
        id,
        risk: action.risk,
        action: { kind: "fill", target: action.target, value: toValueRef(action.value, invocationContext) },
      };
    case "select":
      return {
        id,
        risk: action.risk,
        action: { kind: "select", target: action.target, value: toValueRef(action.value, invocationContext) },
      };
    case "extract":
      return { id, risk: action.risk, action: { kind: "extract", target: action.target } };
  }
}

export interface CompileResult {
  capability: Capability;
  /** Templated outputs the run never actually extracted — surfaced, not silently dropped. */
  warnings: string[];
}

/**
 * Pure transform: RecordedAction[] -> Capability. Needs no Surface — the
 * describe()-generated LogicalLocators are already embedded in each
 * RecordedAction by the time this runs.
 *
 * `template` supplies inputs, businessOutcomes, and successCheckpoint
 * verbatim (they describe the app's contract, not the discovered path).
 * Only `outputs`' sourceStepId is remapped, matched by the outputName the
 * model gave each extract call against the template's output names.
 */
export function compileCapability(
  recordedActions: RecordedAction[],
  invocationContext: Record<string, string | number>,
  template: Capability,
  provenance: Provenance
): CompileResult {
  const steps: Step[] = recordedActions.map((action, index) =>
    recordedActionToStep(action, `step-${index + 1}`, invocationContext)
  );

  const outputs: Record<string, OutputDeclaration> = {};
  const warnings: string[] = [];

  for (const [name, declaration] of Object.entries(template.outputs)) {
    const index = recordedActions.findIndex((a) => a.kind === "extract" && a.outputName === name);
    if (index === -1) {
      warnings.push(`template output "${name}" was never extracted during this run`);
      continue;
    }
    outputs[name] = { ...declaration, sourceStepId: steps[index].id };
  }

  const capability: Capability = {
    id: template.id,
    schemaVersion: template.schemaVersion,
    capabilityVersion: template.capabilityVersion,
    description: template.description,
    targetProfileId: template.targetProfileId,
    provenance,
    approval: "draft",
    inputs: template.inputs,
    outputs,
    steps,
    businessOutcomes: template.businessOutcomes,
    successCheckpoint: template.successCheckpoint,
  };

  return { capability, warnings };
}
