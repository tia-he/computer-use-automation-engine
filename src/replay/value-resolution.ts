import { ValueRef } from "../artifact/value-ref";

export function resolveValue(ref: ValueRef, inputs: Record<string, string | number>): string {
  return ref.kind === "literal" ? ref.value : String(inputs[ref.name]);
}
