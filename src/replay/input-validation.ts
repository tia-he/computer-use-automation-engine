import { Capability, InputDeclaration } from "../artifact/capability";

export interface InputValidationSuccess {
  valid: true;
  inputs: Record<string, string | number>;
}

export interface InputValidationFailure {
  valid: false;
  expected: string;
  observed: string;
}

export type InputValidationResult = InputValidationSuccess | InputValidationFailure;

/**
 * Validated strictly: a "number" input must arrive as a JS number, not a
 * numeric string. Typed inputs stay typed — no implicit coercion.
 */
export function validateInvocationInputs(
  capability: Capability,
  rawInputs: Record<string, unknown>
): InputValidationResult {
  const resolved: Record<string, string | number> = {};

  for (const [name, declaration] of Object.entries(capability.inputs)) {
    const value = rawInputs[name];

    if (value === undefined || value === null) {
      if (declaration.required) {
        return {
          valid: false,
          expected: `input "${name}" (${declaration.type}, required)`,
          observed: "missing",
        };
      }
      continue;
    }

    const failure = validateOne(name, declaration, value);
    if (failure) return failure;

    resolved[name] = value as string | number;
  }

  return { valid: true, inputs: resolved };
}

function validateOne(
  name: string,
  declaration: InputDeclaration,
  value: unknown
): InputValidationFailure | null {
  switch (declaration.type) {
    case "string": {
      if (typeof value !== "string") {
        return { valid: false, expected: `input "${name}" to be a string`, observed: typeof value };
      }
      if (declaration.minLength !== undefined && value.length < declaration.minLength) {
        return {
          valid: false,
          expected: `input "${name}" length >= ${declaration.minLength}`,
          observed: `length ${value.length}`,
        };
      }
      if (declaration.maxLength !== undefined && value.length > declaration.maxLength) {
        return {
          valid: false,
          expected: `input "${name}" length <= ${declaration.maxLength}`,
          observed: `length ${value.length}`,
        };
      }
      if (declaration.pattern !== undefined && !new RegExp(declaration.pattern).test(value)) {
        return { valid: false, expected: `input "${name}" to match /${declaration.pattern}/`, observed: value };
      }
      return null;
    }
    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) {
        return { valid: false, expected: `input "${name}" to be a number`, observed: typeof value };
      }
      if (declaration.min !== undefined && value < declaration.min) {
        return { valid: false, expected: `input "${name}" >= ${declaration.min}`, observed: String(value) };
      }
      if (declaration.max !== undefined && value > declaration.max) {
        return { valid: false, expected: `input "${name}" <= ${declaration.max}`, observed: String(value) };
      }
      return null;
    }
    case "enum": {
      if (typeof value !== "string" || !declaration.values.includes(value)) {
        return {
          valid: false,
          expected: `input "${name}" to be one of ${JSON.stringify(declaration.values)}`,
          observed: String(value),
        };
      }
      return null;
    }
  }
}
