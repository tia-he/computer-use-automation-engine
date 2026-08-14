import { z } from "zod";
import { LogicalLocatorSchema } from "../locator/schema";
import { ConditionSchema } from "./condition";
import { ValueRef, ValueRefSchema } from "./value-ref";

export const RiskLevelSchema = z.enum(["safe", "risky", "irreversible"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const ApprovalStateSchema = z.enum(["draft", "approved"]);
export type ApprovalState = z.infer<typeof ApprovalStateSchema>;

export const ProvenanceSchema = z.object({
  discoveryRunId: z.string().min(1),
  recordedAt: z.string().datetime(),
  model: z.string().min(1),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

// ---- typed input declarations ---------------------------------------------

const StringInputSchema = z.object({
  type: z.literal("string"),
  required: z.boolean(),
  description: z.string().optional(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().positive().optional(),
  pattern: z.string().optional(),
});

const NumberInputSchema = z.object({
  type: z.literal("number"),
  required: z.boolean(),
  description: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

const EnumInputSchema = z.object({
  type: z.literal("enum"),
  required: z.boolean(),
  description: z.string().optional(),
  values: z.array(z.string().min(1)).min(1),
});

export const InputDeclarationSchema = z.discriminatedUnion("type", [
  StringInputSchema,
  NumberInputSchema,
  EnumInputSchema,
]);
export type InputDeclaration = z.infer<typeof InputDeclarationSchema>;

// ---- typed output declarations ---------------------------------------------

export const OutputDeclarationSchema = z.object({
  type: z.enum(["string", "number"]),
  /** id of the `extract` step in `steps` that produces this output's raw value. */
  sourceStepId: z.string().min(1),
  description: z.string().optional(),
});
export type OutputDeclaration = z.infer<typeof OutputDeclarationSchema>;

// ---- steps: only the actions the mock-bank flow needs -----------------------

const NavigateActionSchema = z.object({ kind: z.literal("navigate"), url: ValueRefSchema });
const ClickActionSchema = z.object({ kind: z.literal("click"), target: LogicalLocatorSchema });
const FillActionSchema = z.object({
  kind: z.literal("fill"),
  target: LogicalLocatorSchema,
  value: ValueRefSchema,
});
const SelectActionSchema = z.object({
  kind: z.literal("select"),
  target: LogicalLocatorSchema,
  value: ValueRefSchema,
});
const ExtractActionSchema = z.object({ kind: z.literal("extract"), target: LogicalLocatorSchema });
const CheckpointActionSchema = z.object({ kind: z.literal("checkpoint"), condition: ConditionSchema });

export const StepActionSchema = z.discriminatedUnion("kind", [
  NavigateActionSchema,
  ClickActionSchema,
  FillActionSchema,
  SelectActionSchema,
  ExtractActionSchema,
  CheckpointActionSchema,
]);
export type StepAction = z.infer<typeof StepActionSchema>;

export const StepSchema = z.object({
  id: z.string().min(1),
  action: StepActionSchema,
  risk: RiskLevelSchema,
  description: z.string().optional(),
});
export type Step = z.infer<typeof StepSchema>;

// ---- capability-specific business outcomes -----------------------------------
//
// Deliberately excludes generic engine/runtime failures (LOCATOR_NOT_FOUND,
// LOAD_TIMEOUT, CHECKPOINT_FAILED, UNEXPECTED_DIALOG, POLICY_DENIED) — those
// are mechanical conditions any capability on any surface can hit, detected
// by the (future) replay engine itself, never declared here. `classification`
// is a literal (always "business_outcome" at this layer) to keep that
// boundary explicit in the data, not just implied by which array it's in.

export const BusinessOutcomeSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/, "code must be UPPER_SNAKE_CASE"),
  classification: z.literal("business_outcome"),
  detector: ConditionSchema,
  message: z.object({ target: LogicalLocatorSchema }).optional(),
});
export type BusinessOutcome = z.infer<typeof BusinessOutcomeSchema>;

// ---- capability ---------------------------------------------------------------

export const CapabilitySchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/, "id must be kebab-case"),
    schemaVersion: z.literal(1),
    capabilityVersion: z.string().regex(/^\d+\.\d+\.\d+$/, "capabilityVersion must be semver, e.g. 1.0.0"),
    description: z.string().min(1),
    targetProfileId: z.string().min(1),
    provenance: ProvenanceSchema,
    approval: ApprovalStateSchema,
    inputs: z.record(z.string(), InputDeclarationSchema),
    outputs: z.record(z.string(), OutputDeclarationSchema),
    steps: z.array(StepSchema).min(1),
    businessOutcomes: z.array(BusinessOutcomeSchema),
    successCheckpoint: ConditionSchema,
  })
  .superRefine((capability, ctx) => {
    const stepIds = capability.steps.map((s) => s.id);
    if (new Set(stepIds).size !== stepIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "step ids must be unique", path: ["steps"] });
    }

    const extractStepIds = new Set(
      capability.steps.filter((s) => s.action.kind === "extract").map((s) => s.id)
    );
    const declaredInputs = new Set(Object.keys(capability.inputs));

    capability.steps.forEach((step, index) => {
      const refs: ValueRef[] = [];
      if (step.action.kind === "navigate") refs.push(step.action.url);
      if (step.action.kind === "fill" || step.action.kind === "select") refs.push(step.action.value);

      for (const ref of refs) {
        if (ref.kind === "input_ref" && !declaredInputs.has(ref.name)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `step "${step.id}" references undeclared input "${ref.name}"`,
            path: ["steps", index],
          });
        }
      }
    });

    for (const [name, output] of Object.entries(capability.outputs)) {
      if (!extractStepIds.has(output.sourceStepId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `output "${name}" references sourceStepId "${output.sourceStepId}", which is not an extract step`,
          path: ["outputs", name],
        });
      }
    }
  });

export type Capability = z.infer<typeof CapabilitySchema>;
