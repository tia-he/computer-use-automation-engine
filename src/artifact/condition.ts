import { z } from "zod";
import { LogicalLocator, LogicalLocatorSchema } from "../locator/schema";

/**
 * "Detect this state" — shared by successCheckpoint, mid-flow checkpoint
 * steps, capability business-outcome detectors, and TargetProfile's
 * session/interstitial detectors. One vocabulary, reused everywhere the
 * same concept shows up.
 */
export interface ElementVisibleCondition {
  kind: "element_visible";
  target: LogicalLocator;
}

export interface UrlMatchesCondition {
  kind: "url_matches";
  /** Regex pattern, validated for well-formedness at schema-parse time. */
  pattern: string;
}

export type Condition = ElementVisibleCondition | UrlMatchesCondition;

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

export const ConditionSchema: z.ZodType<Condition> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("element_visible"), target: LogicalLocatorSchema }),
  z.object({
    kind: z.literal("url_matches"),
    pattern: z.string().min(1).refine(isValidRegex, "pattern must be a valid regular expression"),
  }),
]);
