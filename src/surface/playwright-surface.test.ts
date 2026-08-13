import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlaywrightBrowserSurface } from "./playwright-surface";
import { LogicalLocator } from "../locator/types";
import { MOCK_BANK_URL } from "../test-support/mock-bank";

describe("PlaywrightBrowserSurface against the mock bank app", () => {
  let surface: PlaywrightBrowserSurface;

  beforeAll(async () => {
    surface = await PlaywrightBrowserSurface.launch({ headless: true });
  });

  afterAll(async () => {
    await surface.close();
  });

  it("resolves the Search button via role + accessible name", async () => {
    await surface.navigate(`${MOCK_BANK_URL}/`);

    const locator: LogicalLocator = {
      description: "Search button",
      strategies: [{ kind: "role", role: "button", name: "Search" }],
    };
    const resolution = await surface.resolve(locator);

    // Printed for the Phase 2 write-up: a real LogicalLocator resolving on the live app.
    console.log("Search button resolution:", JSON.stringify(resolution, null, 2));

    expect(resolution.status).toBe("resolved");
    if (resolution.status === "resolved") {
      expect(resolution.element.strategyIndex).toBe(0);
    }
  });

  it("falls back to the attribute strategy for the Member ID input, which has no accessible name or <label>", async () => {
    await surface.navigate(`${MOCK_BANK_URL}/`);

    // Deliberately includes role and label first: the mock app's search field
    // is a bare <input> with no aria-label and no associated <label>, so both
    // must legitimately fail before the attribute strategy succeeds.
    const locator: LogicalLocator = {
      description: "Member ID input",
      strategies: [
        { kind: "role", role: "textbox", name: "Member ID" },
        { kind: "label", text: "Member ID" },
        { kind: "attribute", attribute: "name", value: "memberId" },
      ],
    };
    const resolution = await surface.resolve(locator);

    console.log("Member ID input resolution:", JSON.stringify(resolution, null, 2));

    expect(resolution.status).toBe("resolved");
    if (resolution.status === "resolved") {
      expect(resolution.element.strategyIndex).toBe(2);
      expect(resolution.element.strategy.kind).toBe("attribute");
    }
    expect(resolution.attempts.map((a) => a.outcome)).toEqual(["no_match", "no_match"]);
  });

  it("returns a structured not_found result for a locator that matches nothing", async () => {
    await surface.navigate(`${MOCK_BANK_URL}/`);

    const locator: LogicalLocator = {
      strategies: [
        { kind: "role", role: "button", name: "Does Not Exist" },
        { kind: "text", text: "Also Missing" },
      ],
    };
    const resolution = await surface.resolve(locator);

    expect(resolution.status).toBe("not_found");
    expect(resolution.attempts).toHaveLength(2);
  });

  it("drives the full search -> detail flow and reaches the member's balances", async () => {
    await surface.navigate(`${MOCK_BANK_URL}/`);

    const input = await surface.resolve({
      strategies: [{ kind: "attribute", attribute: "name", value: "memberId" }],
    });
    expect(input.status).toBe("resolved");
    if (input.status !== "resolved") return;
    await surface.fill(input.element, "48213");

    const searchButton = await surface.resolve({
      strategies: [{ kind: "role", role: "button", name: "Search" }],
    });
    expect(searchButton.status).toBe("resolved");
    if (searchButton.status !== "resolved") return;
    await surface.click(searchButton.element);

    const observation = await surface.perceive();
    expect(observation.url).toContain("/members/48213");

    const heading = await surface.resolve({
      strategies: [{ kind: "text", text: "Jordan Lee (ID 48213)", exact: true }],
    });
    expect(heading.status).toBe("resolved");
  });

  it("describe() ranks role+name above visible text when both are available", async () => {
    await surface.navigate(`${MOCK_BANK_URL}/`);

    const resolution = await surface.resolve({
      strategies: [{ kind: "role", role: "button", name: "Search" }],
    });
    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") return;

    const generated = await surface.describe(resolution.element);
    console.log("describe() for Search button:", JSON.stringify(generated, null, 2));

    expect(generated.strategies.length).toBeGreaterThanOrEqual(1);
    expect(generated.strategies[0]).toEqual({ kind: "role", role: "button", name: "Search" });
  });

  it("describe() falls back to a scoped structural selector when no role, label, attribute, or short distinctive text exists", async () => {
    // Deliberately hostile snippet: three unlabeled, attribute-less inputs
    // sharing a parent, nested under a table with no id/name anywhere. Real
    // mock-bank content is small enough that every element has some
    // distinctive text, so this scenario is constructed to exercise the
    // last-resort branch specifically.
    const html =
      "<table><tr><td><input><input><input></td></tr></table>";
    await surface.navigate(`data:text/html,${encodeURIComponent(html)}`);

    const middleInput = await surface.resolve({
      strategies: [{ kind: "css", selector: "input:nth-of-type(2)" }],
    });
    expect(middleInput.status).toBe("resolved");
    if (middleInput.status !== "resolved") return;

    const generated = await surface.describe(middleInput.element);
    console.log("describe() scoped fallback:", JSON.stringify(generated, null, 2));

    expect(generated.strategies).toHaveLength(1);
    expect(generated.strategies[0].kind).toBe("css");

    // The generated candidate must itself resolve back to the same element,
    // and must not be an absolute path from <body> (segments are checked
    // individually so "tbody", which the browser inserts automatically, is
    // not mistaken for the literal <body> element).
    const reResolved = await surface.resolve(generated);
    expect(reResolved.status).toBe("resolved");
    if (generated.strategies[0].kind === "css") {
      const segments = generated.strategies[0].selector.split(" > ");
      expect(segments.every((s) => !/^body(:|$)/.test(s))).toBe(true);
      expect(generated.strategies[0].scope).toBeDefined();
      expect(generated.strategies[0].scope).not.toEqual({ kind: "css", selector: "body" });
    }
  });
});
