import { z } from "zod";
import { ToolSchema } from "./llm-provider";

/**
 * Deliberately a subset of LocatorStrategy (no "css"): the model reasons
 * about what it can see on the page — a role+name, a label, visible text,
 * or a known attribute — not about structural selectors.
 */
export const TargetHintSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("role"), role: z.string().min(1), name: z.string().min(1) }),
  z.object({ kind: z.literal("label"), text: z.string().min(1) }),
  z.object({ kind: z.literal("text"), text: z.string().min(1) }),
  z.object({ kind: z.literal("attribute"), attribute: z.string().min(1), value: z.string().min(1) }),
]);
export type TargetHint = z.infer<typeof TargetHintSchema>;

const TARGET_HINT_JSON_SCHEMA = {
  type: "object",
  description: "Identify the control by exactly one of: role+name, label, visible text, or a known attribute.",
  properties: {
    kind: { type: "string", enum: ["role", "label", "text", "attribute"] },
    role: { type: "string", description: "Required when kind is 'role', e.g. 'button', 'textbox', 'link'." },
    name: { type: "string", description: "Required when kind is 'role': the accessible name." },
    text: { type: "string", description: "Required when kind is 'label' or 'text'." },
    attribute: { type: "string", description: "Required when kind is 'attribute', e.g. 'name'." },
    value: { type: "string", description: "Required when kind is 'attribute': the attribute's value." },
  },
  required: ["kind"],
};

export const NavigateInputSchema = z.object({ url: z.string().min(1) });
export const ClickInputSchema = z.object({ target: TargetHintSchema, irreversible: z.boolean() });
export const FillInputSchema = z.object({ target: TargetHintSchema, value: z.string() });
export const SelectInputSchema = z.object({ target: TargetHintSchema, value: z.string() });
export const ExtractInputSchema = z.object({ target: TargetHintSchema, outputName: z.string().min(1) });
export const CheckpointInputSchema = z.object({ description: z.string().min(1) });
export const DoneInputSchema = z.object({ successTarget: TargetHintSchema, summary: z.string().min(1) });
export const EscalateInputSchema = z.object({ reason: z.string().min(1) });

export const TOOL_INPUT_SCHEMAS = {
  navigate: NavigateInputSchema,
  click: ClickInputSchema,
  fill: FillInputSchema,
  select: SelectInputSchema,
  extract: ExtractInputSchema,
  checkpoint: CheckpointInputSchema,
  done: DoneInputSchema,
  escalate: EscalateInputSchema,
} as const;

export type ToolName = keyof typeof TOOL_INPUT_SCHEMAS;

export type ToolInputValidation<T extends ToolName> =
  | { ok: true; value: z.infer<(typeof TOOL_INPUT_SCHEMAS)[T]> }
  | { ok: false; error: string };

export function validateToolInput(toolName: string, input: unknown): ToolInputValidation<ToolName> {
  const schema = (TOOL_INPUT_SCHEMAS as Record<string, z.ZodTypeAny>)[toolName];
  if (!schema) {
    return { ok: false, error: `unknown tool "${toolName}"` };
  }
  const result = schema.safeParse(input);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  return { ok: true, value: result.data };
}

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: "navigate",
    description: "Go to a specific URL.",
    inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  {
    name: "click",
    description: "Click a control on the page.",
    inputSchema: {
      type: "object",
      properties: {
        target: TARGET_HINT_JSON_SCHEMA,
        irreversible: {
          type: "boolean",
          description:
            "True only if this click performs a real, hard-to-undo mutation (e.g. a final confirmation that changes data). False for ordinary navigation/search clicks.",
        },
      },
      required: ["target", "irreversible"],
    },
  },
  {
    name: "fill",
    description: "Type a value into a text input, replacing its current contents.",
    inputSchema: {
      type: "object",
      properties: { target: TARGET_HINT_JSON_SCHEMA, value: { type: "string" } },
      required: ["target", "value"],
    },
  },
  {
    name: "select",
    description: "Choose an option in a dropdown by its underlying value (not its visible label).",
    inputSchema: {
      type: "object",
      properties: { target: TARGET_HINT_JSON_SCHEMA, value: { type: "string" } },
      required: ["target", "value"],
    },
  },
  {
    name: "extract",
    description: "Read the visible text of an element and record it as a named output the caller will get back.",
    inputSchema: {
      type: "object",
      properties: {
        target: TARGET_HINT_JSON_SCHEMA,
        outputName: { type: "string", description: "Use the exact output name requested by the goal." },
      },
      required: ["target", "outputName"],
    },
  },
  {
    name: "checkpoint",
    description: "Declare that you've reached an expected intermediate state. For your own progress tracking only — does not affect the page.",
    inputSchema: {
      type: "object",
      properties: { description: { type: "string" } },
      required: ["description"],
    },
  },
  {
    name: "done",
    description: "Declare the goal achieved. Must point at an element currently on the page that proves success.",
    inputSchema: {
      type: "object",
      properties: { successTarget: TARGET_HINT_JSON_SCHEMA, summary: { type: "string" } },
      required: ["successTarget", "summary"],
    },
  },
  {
    name: "escalate",
    description: "Stop and ask a human for help because you are stuck, confused, or unsafe to proceed.",
    inputSchema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
];
