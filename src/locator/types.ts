/**
 * Surface-independent locator representation. No Surface implementation
 * (Playwright, desktop accessibility, etc.) may be referenced from this file.
 */

export type LocatorStrategy =
  | RoleLocatorStrategy
  | LabelLocatorStrategy
  | TextLocatorStrategy
  | AttributeLocatorStrategy
  | CssLocatorStrategy;

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
  /** Defaults to true: match the element's full trimmed text, not a substring. */
  exact?: boolean;
}

export interface AttributeLocatorStrategy {
  kind: "attribute";
  attribute: string;
  value: string;
}

export interface CssLocatorStrategy {
  kind: "css";
  /** Selector evaluated relative to `scope` (or the whole page if scope is omitted). */
  selector: string;
  /** Anchor to resolve first; never an absolute path from <body>. */
  scope?: LocatorStrategy;
}

export interface LogicalLocator {
  /** Ordered, most-robust-first. Resolution tries each until one succeeds. */
  strategies: LocatorStrategy[];
  /** Human-readable label for logs/review, e.g. "Search button". */
  description?: string;
}

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
