/**
 * Surface-independent locator representation. No Surface implementation
 * (Playwright, desktop accessibility, etc.) may be referenced from this file.
 *
 * The actual shapes are defined in ./schema.ts (Zod schema + inferred-shape
 * TS types) so the same LogicalLocator definition is used both at runtime
 * (validating artifacts) and at compile time (Surface, resolve()). This file
 * re-exports them so existing imports (`from "../locator/types"`) keep working.
 */
export type {
  RoleLocatorStrategy,
  LabelLocatorStrategy,
  TextLocatorStrategy,
  AttributeLocatorStrategy,
  CssLocatorStrategy,
  LocatorStrategy,
  LogicalLocator,
} from "./schema";

import { LocatorStrategy } from "./schema";

export interface ResolvedElement {
  /** Opaque; only the Surface that produced it knows what this is. */
  ref: unknown;
  strategyIndex: number;
  strategy: LocatorStrategy;
}

export interface LocatorAttempt {
  strategy: LocatorStrategy;
  outcome: "no_match" | "ambiguous" | "error";
  matchCount?: number;
  errorMessage?: string;
}

export type LocatorResolution =
  | { status: "resolved"; element: ResolvedElement; attempts: LocatorAttempt[] }
  | { status: "not_found"; attempts: LocatorAttempt[] };
