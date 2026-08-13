import { describe, expect, it } from "vitest";
import { resolveLogicalLocator, StrategyMatcher } from "./resolve";
import { LocatorStrategy, LogicalLocator } from "./types";

const role: LocatorStrategy = { kind: "role", role: "button", name: "Search" };
const label: LocatorStrategy = { kind: "label", text: "Member ID" };
const attribute: LocatorStrategy = { kind: "attribute", attribute: "name", value: "memberId" };

function matcherFromCounts(counts: Record<string, number>, ref = "fake-ref"): StrategyMatcher<string> {
  return async (strategy) => {
    const count = counts[strategy.kind] ?? 0;
    return count === 1 ? { count, uniqueRef: ref } : { count };
  };
}

describe("resolveLogicalLocator", () => {
  it("resolves via the primary strategy when it matches uniquely", async () => {
    const locator: LogicalLocator = { strategies: [role, label] };
    const result = await resolveLogicalLocator(locator, matcherFromCounts({ role: 1 }));

    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.element.strategyIndex).toBe(0);
      expect(result.element.strategy).toBe(role);
      expect(result.element.ref).toBe("fake-ref");
    }
    expect(result.attempts).toHaveLength(0);
  });

  it("falls back to the next strategy when the primary has no match", async () => {
    const locator: LogicalLocator = { strategies: [role, label, attribute] };
    const result = await resolveLogicalLocator(locator, matcherFromCounts({ role: 0, label: 1 }));

    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.element.strategyIndex).toBe(1);
      expect(result.element.strategy).toBe(label);
    }
    expect(result.attempts).toEqual([{ strategy: role, outcome: "no_match", matchCount: 0 }]);
  });

  it("skips a strategy that matches ambiguously and falls back", async () => {
    const locator: LogicalLocator = { strategies: [role, label, attribute] };
    const result = await resolveLogicalLocator(locator, matcherFromCounts({ role: 3, label: 0, attribute: 1 }));

    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.element.strategyIndex).toBe(2);
    }
    expect(result.attempts).toEqual([
      { strategy: role, outcome: "ambiguous", matchCount: 3 },
      { strategy: label, outcome: "no_match", matchCount: 0 },
    ]);
  });

  it("returns a structured not_found result when every strategy fails", async () => {
    const locator: LogicalLocator = { strategies: [role, label, attribute] };
    const result = await resolveLogicalLocator(locator, matcherFromCounts({ role: 0, label: 2, attribute: 0 }));

    expect(result.status).toBe("not_found");
    expect(result.attempts).toEqual([
      { strategy: role, outcome: "no_match", matchCount: 0 },
      { strategy: label, outcome: "ambiguous", matchCount: 2 },
      { strategy: attribute, outcome: "no_match", matchCount: 0 },
    ]);
  });

  it("records a matcher error and continues to the next strategy rather than throwing", async () => {
    const locator: LogicalLocator = { strategies: [role, attribute] };
    const matcher: StrategyMatcher<string> = async (strategy) => {
      if (strategy === role) throw new Error("boom");
      return { count: 1, uniqueRef: "fake-ref" };
    };
    const result = await resolveLogicalLocator(locator, matcher);

    expect(result.status).toBe("resolved");
    expect(result.attempts).toEqual([{ strategy: role, outcome: "error", errorMessage: "boom" }]);
  });
});
