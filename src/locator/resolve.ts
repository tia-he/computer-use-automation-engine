import { LocatorAttempt, LocatorResolution, LocatorStrategy, LogicalLocator } from "./types";

export interface StrategyMatch<Ref> {
  count: number;
  /** Populated only when count === 1. */
  uniqueRef?: Ref;
}

export type StrategyMatcher<Ref> = (strategy: LocatorStrategy) => Promise<StrategyMatch<Ref>>;

/**
 * Deterministic fallback-chain resolution. Surface-independent: it knows
 * nothing about what a "role" or "css" strategy means — that logic lives in
 * the `match` callback a concrete Surface supplies. A future non-browser
 * Surface reuses this function unchanged.
 *
 * For each strategy in order:
 *   - exactly one match  -> resolved, stop
 *   - zero matches        -> record no_match, try next strategy
 *   - multiple matches    -> record ambiguous, try next strategy (never
 *                            silently picks one)
 *   - matcher throws       -> record error, try next strategy
 * If every strategy is exhausted, returns a structured not_found result
 * carrying the full attempt trail instead of guessing.
 */
export async function resolveLogicalLocator<Ref>(
  locator: LogicalLocator,
  match: StrategyMatcher<Ref>
): Promise<LocatorResolution> {
  const attempts: LocatorAttempt[] = [];

  for (let i = 0; i < locator.strategies.length; i++) {
    const strategy = locator.strategies[i];
    let result: StrategyMatch<Ref>;
    try {
      result = await match(strategy);
    } catch (err) {
      attempts.push({
        strategy,
        outcome: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (result.count === 0) {
      attempts.push({ strategy, outcome: "no_match", matchCount: 0 });
      continue;
    }
    if (result.count > 1) {
      attempts.push({ strategy, outcome: "ambiguous", matchCount: result.count });
      continue;
    }

    return {
      status: "resolved",
      element: { ref: result.uniqueRef, strategyIndex: i, strategy },
      attempts,
    };
  }

  return { status: "not_found", attempts };
}
