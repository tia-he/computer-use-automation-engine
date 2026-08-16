import { z } from "zod";
import { RiskLevel } from "../artifact/capability";

export const ActionKindSchema = z.enum(["navigate", "click", "fill", "select", "extract", "checkpoint"]);
export type ActionKind = z.infer<typeof ActionKindSchema>;

export const GuardrailPolicyConfigSchema = z.object({
  id: z.string().min(1),
  allowedOrigins: z.array(z.string().url()).min(1),
  allowedActionKinds: z.array(ActionKindSchema).min(1),
});
export type GuardrailPolicyConfig = z.infer<typeof GuardrailPolicyConfigSchema>;

export interface PolicyContext {
  actionKind: ActionKind;
  risk: RiskLevel;
  /** The URL this action targets (navigate) or currently operates within (everything else). */
  url: string;
  /** Whether this specific step has already been explicitly approved for this run. */
  approved: boolean;
}

export type PolicyDecision =
  | { kind: "allowed" }
  | { kind: "denied"; reason: string }
  | { kind: "requires_approval"; reason: string };

/**
 * Shared by replay (this phase) and, later, discovery — same policy object,
 * same evaluate() call, checked before every single action rather than only
 * at artifact-authoring time.
 */
export class GuardrailPolicy {
  private readonly config: GuardrailPolicyConfig;

  constructor(config: GuardrailPolicyConfig) {
    this.config = GuardrailPolicyConfigSchema.parse(config);
  }

  evaluate(context: PolicyContext): PolicyDecision {
    const origin = this.originOf(context.url);
    if (!origin || !this.config.allowedOrigins.includes(origin)) {
      return { kind: "denied", reason: `origin "${origin ?? context.url}" is not in the allowed origins list` };
    }
    if (!this.config.allowedActionKinds.includes(context.actionKind)) {
      return { kind: "denied", reason: `action kind "${context.actionKind}" is not permitted by policy` };
    }
    if (context.risk === "irreversible" && !context.approved) {
      return { kind: "requires_approval", reason: "step is irreversible and has not been approved for this run" };
    }
    return { kind: "allowed" };
  }

  private originOf(url: string): string | null {
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  }
}
