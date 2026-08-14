import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PlaywrightBrowserSurface } from "../surface/playwright-surface";
import { ReplayEngine } from "./engine";
import { Capability } from "../artifact/capability";
import { openSubAccountCapability } from "../artifact/examples/open-sub-account";
import { mockBankTargetProfile } from "../artifact/examples/mock-bank-target-profile";
import { MOCK_BANK_URL } from "../test-support/mock-bank";

function clone(capability: Capability): Capability {
  return JSON.parse(JSON.stringify(capability));
}

const validInputs = { member_id: "48213", account_type: "savings", initial_deposit: 500 };

describe("ReplayEngine against the live mock-bank app", () => {
  let surface: PlaywrightBrowserSurface;
  let engine: ReplayEngine;

  beforeAll(async () => {
    surface = await PlaywrightBrowserSurface.launch({ headless: true });
    engine = new ReplayEngine(surface);
  });

  afterAll(async () => {
    await surface.close();
  });

  beforeEach(async () => {
    await fetch(`${MOCK_BANK_URL}/reset`, { method: "POST" });
  });

  it("replays the happy path deterministically and returns typed outputs", async () => {
    const result = await engine.replay(openSubAccountCapability, mockBankTargetProfile, validInputs, {
      allowIrreversible: true,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.outputs.new_account_number).toMatch(/^SAV-48213-\d+$/);
    expect(result.outputs.confirmation_id).toMatch(/^CONF-\d+$/);
    expect(result.completedStepIds).toEqual(openSubAccountCapability.steps.map((s) => s.id));

    console.log("success result:", JSON.stringify(result, null, 2));
  });

  it("returns MEMBER_NOT_FOUND as a business outcome, not a crash", async () => {
    const result = await engine.replay(
      openSubAccountCapability,
      mockBankTargetProfile,
      { ...validInputs, member_id: "99999" },
      { allowIrreversible: true }
    );

    expect(result.status).toBe("business_outcome");
    if (result.status !== "business_outcome") return;
    expect(result.code).toBe("MEMBER_NOT_FOUND");
    expect(result.message).toContain("99999");
    expect(result.stepId).toBe("click-search");

    console.log("MEMBER_NOT_FOUND result:", JSON.stringify(result, null, 2));
  });

  it("returns ACCOUNT_NOT_ELIGIBLE for a restricted member", async () => {
    const result = await engine.replay(
      openSubAccountCapability,
      mockBankTargetProfile,
      { ...validInputs, member_id: "50822" },
      { allowIrreversible: true }
    );

    expect(result.status).toBe("business_outcome");
    if (result.status !== "business_outcome") return;
    expect(result.code).toBe("ACCOUNT_NOT_ELIGIBLE");
  });

  it("returns VALIDATION_ERROR for a deposit below the minimum", async () => {
    const result = await engine.replay(
      openSubAccountCapability,
      mockBankTargetProfile,
      { ...validInputs, initial_deposit: 5 },
      { allowIrreversible: true }
    );

    expect(result.status).toBe("business_outcome");
    if (result.status !== "business_outcome") return;
    expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("rejects invalid invocation input before touching the surface", async () => {
    const result = await engine.replay(openSubAccountCapability, mockBankTargetProfile, {
      member_id: "48213",
      account_type: "savings",
      initial_deposit: "not-a-number",
    });

    expect(result).toMatchObject({ status: "failure", errorCode: "INVALID_INPUT", completedStepIds: [] });
  });

  it("returns LOCATOR_NOT_FOUND for a deliberately broken locator", async () => {
    const broken = clone(openSubAccountCapability);
    const fillStep = broken.steps.find((s) => s.id === "fill-member-id")!;
    if (fillStep.action.kind === "fill") {
      fillStep.action.target = {
        strategies: [{ kind: "attribute", attribute: "name", value: "this-attribute-does-not-exist" }],
      };
    }

    const result = await engine.replay(broken, mockBankTargetProfile, validInputs, { allowIrreversible: true });

    expect(result).toMatchObject({
      status: "failure",
      errorCode: "LOCATOR_NOT_FOUND",
      failedStepId: "fill-member-id",
    });

    console.log("LOCATOR_NOT_FOUND result:", JSON.stringify(result, null, 2));
  });

  it("returns CHECKPOINT_FAILED when the final success checkpoint never holds", async () => {
    const broken = clone(openSubAccountCapability);
    broken.successCheckpoint = {
      kind: "element_visible",
      target: { strategies: [{ kind: "text", text: "Account Was Definitely Never Opened", exact: true }] },
    };

    const result = await engine.replay(broken, mockBankTargetProfile, validInputs, { allowIrreversible: true });

    expect(result.status).toBe("failure");
    if (result.status !== "failure") return;
    expect(result.errorCode).toBe("CHECKPOINT_FAILED");
    expect(result.failedStepId).toBe(broken.steps[broken.steps.length - 1].id);
    // The irreversible step still ran (broken checkpoint is only detected
    // after it), so the account was in fact created.
    expect(result.completedStepIds).toContain("click-confirm");
  });

  it("blocks the irreversible confirm step by default and never mutates state", async () => {
    const result = await engine.replay(openSubAccountCapability, mockBankTargetProfile, validInputs);

    expect(result).toMatchObject({ status: "blocked", reason: "irreversible_not_allowed", stepId: "click-confirm" });
    if (result.status !== "blocked") return;
    expect(result.completedStepIds).not.toContain("click-confirm");

    // Confirm the account genuinely was not created.
    await surface.navigate(`${MOCK_BANK_URL}/members/48213`);
    const thirdAccountRow = await surface.resolve({
      strategies: [{ kind: "text", text: "SAV-48213-2", exact: false }],
    });
    expect(thirdAccountRow.status).toBe("not_found");
  });
});
