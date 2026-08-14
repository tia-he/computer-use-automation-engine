import { z } from "zod";

/**
 * Source of truth for the LogicalLocator shape: a Zod schema plus the
 * TypeScript types it validates. src/locator/types.ts re-exports these
 * types so Phase 2 code (resolve.ts, playwright-surface.ts) is unaffected.
 */

export interface RoleLocatorStrategy {
  kind: "role";
  role: string;
  name: string;
}

export interface LabelLocatorStrategy {
  kind: "label";
  text: string;
}

export interface TextLocatorStrategy {
  kind: "text";
  text: string;
  exact?: boolean;
}

export interface AttributeLocatorStrategy {
  kind: "attribute";
  attribute: string;
  value: string;
}

export interface CssLocatorStrategy {
  kind: "css";
  selector: string;
  scope?: LocatorStrategy;
}

export type LocatorStrategy =
  | RoleLocatorStrategy
  | LabelLocatorStrategy
  | TextLocatorStrategy
  | AttributeLocatorStrategy
  | CssLocatorStrategy;

export interface LogicalLocator {
  strategies: LocatorStrategy[];
  description?: string;
}

const RoleLocatorStrategySchema = z.object({
  kind: z.literal("role"),
  role: z.string().min(1),
  name: z.string().min(1),
});

const LabelLocatorStrategySchema = z.object({
  kind: z.literal("label"),
  text: z.string().min(1),
});

const TextLocatorStrategySchema = z.object({
  kind: z.literal("text"),
  text: z.string().min(1),
  exact: z.boolean().optional(),
});

const AttributeLocatorStrategySchema = z.object({
  kind: z.literal("attribute"),
  attribute: z.string().min(1),
  value: z.string().min(1),
});

// `css` is the one recursive strategy (via `scope`), so both it and the
// outer union are wrapped in z.lazy and joined with z.union rather than
// z.discriminatedUnion — discriminatedUnion needs to inspect a member's
// shape eagerly, which a lazy/recursive member can't provide.
const CssLocatorStrategySchema: z.ZodType<CssLocatorStrategy> = z.lazy(() =>
  z.object({
    kind: z.literal("css"),
    selector: z.string().min(1),
    scope: LocatorStrategySchema.optional(),
  })
);

export const LocatorStrategySchema: z.ZodType<LocatorStrategy> = z.lazy(() =>
  z.union([
    RoleLocatorStrategySchema,
    LabelLocatorStrategySchema,
    TextLocatorStrategySchema,
    AttributeLocatorStrategySchema,
    CssLocatorStrategySchema,
  ])
);

export const LogicalLocatorSchema: z.ZodType<LogicalLocator> = z.object({
  strategies: z.array(LocatorStrategySchema).min(1),
  description: z.string().optional(),
});
