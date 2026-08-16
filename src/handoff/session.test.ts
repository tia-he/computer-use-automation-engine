import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PlaywrightBrowserSurface } from "../surface/playwright-surface";
import { ReplayEngine } from "../replay/engine";
import { GuardrailPolicy } from "../guardrails/policy";
import { HandoffSession } from "./session";
import { openSubAccountCapability } from "../artifact/examples/open-sub-account";
import { mockBankTargetProfile } from "../artifact/examples/mock-bank-target-profile";
import { MOCK_BANK_URL } from "../test-support/mock-bank";

const validInputs = { member_id: "48213", account_type: "savings", initial_deposit: 500 };
const policy = new GuardrailPolicy({
  id: "test-policy",
  allowedOrigins: [mockBankTargetProfile.allowedOrigin],
  allowedActionKinds: ["navigate", "click", "fill", "select", "extract", "checkpoint"],
});

describe("HandoffSession against the live mock-bank app", () => {
  let surface: PlaywrightBrowserSurface;

  beforeAll(async () => {
    surface = await PlaywrightBrowserSurface.launch({ headless: true });
  });

  afterAll(async () => {
    await surface.close();
  });

  beforeEach(async () => {
    await fetch(`${MOCK_BANK_URL}/reset`, { method: "POST" });
  });

  it("escalates to HUMAN_CONTROL with a real InterventionRequest, then approve() transitions back and completes the run", async () => {
    const engine = new ReplayEngine(surface, policy);
    const session = new HandoffSession(surface, engine, "session-approve");

    const escalated = await session.run(openSubAccountCapability, mockBankTargetProfile, validInputs);
    expect(escalated.status).toBe("escalated");
    expect(session.controlState.current).toBe("HUMAN_CONTROL");
    if (escalated.status !== "escalated") return;

    const request = escalated.interventionRequest;
    expect(request.reason).toBe("APPROVAL_REQUIRED");
    expect(request.stepId).toBe("click-confirm");
    expect(request.screenshotRef).toBeDefined();
    console.log("APPROVAL_REQUIRED intervention:", JSON.stringify(request, null, 2));

    const resumed = await session.approve(request.id);
    expect(session.controlState.current).toBe("COMPLETED");
    expect(resumed.status).toBe("success");
    if (resumed.status !== "success") return;
    expect(resumed.outputs.new_account_number).toMatch(/^SAV-48213-\d+$/);
    expect(resumed.completedStepIds).toEqual(openSubAccountCapability.steps.map((s) => s.id));

    console.log("approve-and-resume result:", JSON.stringify(resumed, null, 2));
  });

  it("reject() ends the run without ever executing the irreversible step", async () => {
    const engine = new ReplayEngine(surface, policy);
    const session = new HandoffSession(surface, engine, "session-reject");

    const escalated = await session.run(openSubAccountCapability, mockBankTargetProfile, validInputs);
    expect(escalated.status).toBe("escalated");
    if (escalated.status !== "escalated") return;

    const result = await session.reject(escalated.interventionRequest.id);
    expect(session.controlState.current).toBe("FAILED");
    expect(result).toMatchObject({ status: "rejected", stepId: "click-confirm" });

    console.log("reject result:", JSON.stringify(result, null, 2));

    // Confirm the account genuinely was not created.
    await surface.navigate(`${MOCK_BANK_URL}/members/48213`);
    const thirdAccountRow = await surface.resolve({
      strategies: [{ kind: "text", text: "SAV-48213-2", exact: false }],
    });
    expect(thirdAccountRow.status).toBe("not_found");
  });

  it("throws when approving/rejecting an id that isn't the pending intervention", async () => {
    const engine = new ReplayEngine(surface, policy);
    const session = new HandoffSession(surface, engine, "session-bad-id");

    await session.run(openSubAccountCapability, mockBankTargetProfile, validInputs);
    await expect(session.approve("not-the-real-id")).rejects.toThrow();
  });

  it("records human click/input/navigation events while HUMAN_CONTROL owns the session", async () => {
    const engine = new ReplayEngine(surface, policy);
    const session = new HandoffSession(surface, engine, "session-human-actions");

    const escalated = await session.run(openSubAccountCapability, mockBankTargetProfile, validInputs);
    expect(escalated.status).toBe("escalated");
    expect(session.controlState.current).toBe("HUMAN_CONTROL");

    // Escalation pauses on the review page (the step right before Confirm).
    // Recording is live on that same page now. A human would drive this
    // with a mouse/keyboard; here the Surface API dispatches the same real
    // DOM events (Playwright's click()/fill() genuinely fire click/input/
    // change), which is what actually exercises the listener + redaction
    // pipeline rather than just calling it directly.
    const backLink = await surface.resolve({ strategies: [{ kind: "text", text: "Back", exact: true }] });
    expect(backLink.status).toBe("resolved");
    if (backLink.status === "resolved") await surface.click(backLink.element); // click + navigation

    const depositInput = await surface.resolve({
      strategies: [{ kind: "attribute", attribute: "name", value: "initialDeposit" }],
    });
    expect(depositInput.status).toBe("resolved");
    if (depositInput.status === "resolved") await surface.fill(depositInput.element, "999"); // input

    await new Promise((resolve) => setTimeout(resolve, 100)); // let events flush

    const types = session.humanActions.map((e) => e.type);
    expect(types).toContain("click");
    expect(types).toContain("navigation");
    expect(types).toContain("input");

    const inputEvent = session.humanActions.find((e) => e.type === "input");
    expect(inputEvent?.value).toBe("999");

    console.log("recorded human actions:", JSON.stringify(session.humanActions, null, 2));
  });
});
