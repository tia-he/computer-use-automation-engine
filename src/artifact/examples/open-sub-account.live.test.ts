import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlaywrightBrowserSurface } from "../../surface/playwright-surface";
import { Condition } from "../condition";
import { ValueRef } from "../value-ref";
import { Step } from "../capability";
import { openSubAccountCapability as capability } from "./open-sub-account";

/**
 * Not part of requirement 14's schema-validation list, but valuable on its
 * own: proves the hand-authored artifact isn't just schema-valid JSON, its
 * LogicalLocators actually resolve against the live app at the right points
 * in the flow. This is throwaway test glue, not a preview of the Phase 4
 * replay engine — no reusable module comes out of it.
 */

function resolveValue(ref: ValueRef, inputs: Record<string, string>): string {
  return ref.kind === "literal" ? ref.value : inputs[ref.name];
}

async function conditionHolds(surface: PlaywrightBrowserSurface, condition: Condition): Promise<boolean> {
  if (condition.kind === "url_matches") {
    const observation = await surface.perceive();
    return new RegExp(condition.pattern).test(observation.url);
  }
  const resolution = await surface.resolve(condition.target);
  return resolution.status === "resolved";
}

async function runStep(surface: PlaywrightBrowserSurface, step: Step, inputs: Record<string, string>): Promise<string | null> {
  const action = step.action;
  switch (action.kind) {
    case "navigate":
      await surface.navigate(resolveValue(action.url, inputs));
      return null;
    case "click": {
      const resolution = await surface.resolve(action.target);
      expect(resolution.status, `step "${step.id}" should resolve`).toBe("resolved");
      if (resolution.status === "resolved") await surface.click(resolution.element);
      return null;
    }
    case "fill": {
      const resolution = await surface.resolve(action.target);
      expect(resolution.status, `step "${step.id}" should resolve`).toBe("resolved");
      if (resolution.status === "resolved") await surface.fill(resolution.element, resolveValue(action.value, inputs));
      return null;
    }
    case "select": {
      const resolution = await surface.resolve(action.target);
      expect(resolution.status, `step "${step.id}" should resolve`).toBe("resolved");
      if (resolution.status === "resolved") await surface.selectOption(resolution.element, resolveValue(action.value, inputs));
      return null;
    }
    case "extract": {
      const resolution = await surface.resolve(action.target);
      expect(resolution.status, `step "${step.id}" should resolve`).toBe("resolved");
      if (resolution.status === "resolved") return surface.extractText(resolution.element);
      return null;
    }
    case "checkpoint": {
      const holds = await conditionHolds(surface, action.condition);
      expect(holds, `checkpoint "${step.id}" should hold`).toBe(true);
      return null;
    }
  }
}

describe("open-sub-account capability against the live mock-bank app", () => {
  let surface: PlaywrightBrowserSurface;

  beforeAll(async () => {
    surface = await PlaywrightBrowserSurface.launch({ headless: true });
  });

  afterAll(async () => {
    await surface.close();
  });

  it("resets mock-bank state, then every step's locator resolves and the outputs extract real values", async () => {
    await surface.navigate("http://localhost:4100/");
    const resetButton = await surface.resolve({
      strategies: [{ kind: "role", role: "button", name: "Reset Demo Data" }],
    });
    expect(resetButton.status).toBe("resolved");
    if (resetButton.status === "resolved") await surface.click(resetButton.element);

    const inputs = { member_id: "48213", account_type: "savings", initial_deposit: "500" };
    const extracted: Record<string, string> = {};

    for (const step of capability.steps) {
      const value = await runStep(surface, step, inputs);
      if (step.action.kind === "extract" && value !== null) {
        extracted[step.id] = value;
      }
    }

    expect(await conditionHolds(surface, capability.successCheckpoint)).toBe(true);
    expect(extracted["extract-account-number"]).toMatch(/^SAV-48213-\d+$/);
    expect(extracted["extract-confirmation-id"]).toMatch(/^CONF-\d+$/);

    console.log("open-sub-account happy-path outputs:", extracted);
  });

  it("detects MEMBER_NOT_FOUND for an unknown member id", async () => {
    await surface.navigate("http://localhost:4100/");
    const memberIdStep = capability.steps.find((s) => s.id === "fill-member-id")!;
    if (memberIdStep.action.kind === "fill") {
      const resolution = await surface.resolve(memberIdStep.action.target);
      if (resolution.status === "resolved") await surface.fill(resolution.element, "99999");
    }
    const searchStep = capability.steps.find((s) => s.id === "click-search")!;
    if (searchStep.action.kind === "click") {
      const resolution = await surface.resolve(searchStep.action.target);
      if (resolution.status === "resolved") await surface.click(resolution.element);
    }

    const outcome = capability.businessOutcomes.find((o) => o.code === "MEMBER_NOT_FOUND")!;
    expect(await conditionHolds(surface, outcome.detector)).toBe(true);
    expect(await conditionHolds(surface, capability.successCheckpoint)).toBe(false);
  });

  it("detects ACCOUNT_NOT_ELIGIBLE for a restricted member", async () => {
    await surface.navigate("http://localhost:4100/members/50822/accounts/new");

    const outcome = capability.businessOutcomes.find((o) => o.code === "ACCOUNT_NOT_ELIGIBLE")!;
    expect(await conditionHolds(surface, outcome.detector)).toBe(true);
  });

  it("detects VALIDATION_ERROR for a deposit below the minimum", async () => {
    await surface.navigate("http://localhost:4100/members/48213/accounts/new");

    const selectStep = capability.steps.find((s) => s.id === "select-account-type")!;
    if (selectStep.action.kind === "select") {
      const resolution = await surface.resolve(selectStep.action.target);
      if (resolution.status === "resolved") await surface.selectOption(resolution.element, "savings");
    }
    const fillStep = capability.steps.find((s) => s.id === "fill-initial-deposit")!;
    if (fillStep.action.kind === "fill") {
      const resolution = await surface.resolve(fillStep.action.target);
      if (resolution.status === "resolved") await surface.fill(resolution.element, "5");
    }
    const continueStep = capability.steps.find((s) => s.id === "click-continue")!;
    if (continueStep.action.kind === "click") {
      const resolution = await surface.resolve(continueStep.action.target);
      if (resolution.status === "resolved") await surface.click(resolution.element);
    }

    const outcome = capability.businessOutcomes.find((o) => o.code === "VALIDATION_ERROR")!;
    expect(await conditionHolds(surface, outcome.detector)).toBe(true);
  });
});
