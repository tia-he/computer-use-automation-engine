import { z } from "zod";

/**
 * Explicit typed reference to a parameter value. Deliberately not a template
 * string: there is no interpolation syntax and nothing here is executable.
 */
export interface LiteralValueRef {
  kind: "literal";
  value: string;
}

export interface InputValueRef {
  kind: "input_ref";
  name: string;
}

export type ValueRef = LiteralValueRef | InputValueRef;

export const ValueRefSchema: z.ZodType<ValueRef> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("literal"), value: z.string() }),
  z.object({ kind: z.literal("input_ref"), name: z.string().min(1) }),
]);
