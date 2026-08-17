import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PlaywrightBrowserSurface } from "../surface/playwright-surface";
import { GuardrailPolicy } from "../guardrails/policy";
import { DiscoveryAgent } from "./agent";
import { compileCapability } from "./recorder";
import { CapabilitySchema } from "../artifact/capability";
import { openSubAccountCapability } from "../artifact/examples/open-sub-account";
import { mockBankTargetProfile } from "../artifact/examples/mock-bank-target-profile";
import { MOCK_BANK_URL } from "../test-support/mock-bank";
import { ScriptedLlmProvider } from "../test-support/scripted-llm-provider";
import { ConversationTurn, ToolInvocation } from "./llm-provider";

const invocationContext = { member_id: "48213", account_type: "savings", initial_deposit: 500 };
const policy = new GuardrailPolicy({
  id: "test-policy",
  allowedOrigins: [mockBankTargetProfile.allowedOrigin],
  allowedActionKinds: ["navigate", "click", "fill", "select", "extract", "checkpoint"],
});

function lastObservationOf(turns: ConversationTurn[]): string {
  return [...turns].reverse().find((t) => t.role === "observation")?.text ?? "";
}

describe("DiscoveryAgent against the live mock-bank app", () => {
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

  it("drives the full flow live, escalates at the irreversible confirm, and compiles a schema-valid draft Capability", async () => {
    const provider = new ScriptedLlmProvider((turns, callIndex): ToolInvocation => {
      const observation = lastObservationOf(turns);
      switch (callIndex) {
        case 0:
          return { toolName: "navigate", input: { url: "http://localhost:4100/" } };
        case 1:
          return { toolName: "fill", input: { target: { kind: "attribute", attribute: "name", value: "memberId" }, value: "48213" } };
        case 2:
          return { toolName: "click", input: { target: { kind: "role", role: "button", name: "Search" }, irreversible: false } };
        case 3:
          return { toolName: "checkpoint", input: { description: "Reached member detail page" } };
        case 4:
          return {
            toolName: "click",
            input: { target: { kind: "role", role: "link", name: "Open Sub-Account" }, irreversible: false },
          };
        case 5:
          return {
            toolName: "select",
            input: { target: { kind: "attribute", attribute: "name", value: "accountType" }, value: "savings" },
          };
        case 6:
          return {
            toolName: "fill",
            input: { target: { kind: "attribute", attribute: "name", value: "initialDeposit" }, value: "500" },
          };
        case 7:
          return { toolName: "click", input: { target: { kind: "role", role: "button", name: "Continue" }, irreversible: false } };
        case 8:
          return {
            toolName: "click",
            input: { target: { kind: "role", role: "button", name: "Confirm & Open Account" }, irreversible: true },
          };
        case 9: {
          const match = observation.match(/"(SAV-[\w-]+)"/);
          if (!match) throw new Error(`expected an account number in observation:\n${observation}`);
          return { toolName: "extract", input: { target: { kind: "text", text: match[1] }, outputName: "new_account_number" } };
        }
        case 10: {
          const match = observation.match(/"(CONF-[\w-]+)"/);
          if (!match) throw new Error(`expected a confirmation id in observation:\n${observation}`);
          return { toolName: "extract", input: { target: { kind: "text", text: match[1] }, outputName: "confirmation_id" } };
        }
        case 11:
          return {
            toolName: "done",
            input: {
              successTarget: { kind: "role", role: "heading", name: "Account Opened" },
              summary: "Opened a savings sub-account for member 48213 with a $500 deposit.",
            },
          };
        default:
          throw new Error(`script exhausted at call ${callIndex}`);
      }
    });

    const agent = new DiscoveryAgent(surface, provider, policy, "discovery-run-1");
    const escalated = await agent.run("Open a new savings sub-account for member 48213 with a $500 deposit.", mockBankTargetProfile, invocationContext);

    expect(escalated.status).toBe("escalated");
    expect(agent.controlState.current).toBe("HUMAN_CONTROL");
    if (escalated.status !== "escalated") return;
    expect(escalated.interventionRequest.reason).toBe("APPROVAL_REQUIRED");

    const result = await agent.approveAndContinue(escalated.interventionRequest.id);
    expect(agent.controlState.current).toBe("COMPLETED");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;

    expect(result.recordedActions.map((a) => a.kind)).toEqual([
      "navigate",
      "fill",
      "click",
      "click",
      "select",
      "fill",
      "click",
      "click",
      "extract",
      "extract",
    ]);
    expect(result.recordedActions.filter((a) => a.risk === "irreversible")).toHaveLength(1);

    const provenance = { discoveryRunId: "discovery-run-1", recordedAt: new Date().toISOString(), model: "scripted-test-model" };
    const { capability, warnings } = compileCapability(result.recordedActions, invocationContext, openSubAccountCapability, provenance);

    expect(warnings).toEqual([]);
    expect(CapabilitySchema.safeParse(capability).success).toBe(true);
    expect(capability.approval).toBe("draft");
    expect(Object.keys(capability.outputs)).toEqual(["new_account_number", "confirmation_id"]);

    console.log("discovery transcript (event count):", result.transcript.length + escalated.transcript.length);
    console.log("compiled capability (discovered steps):", JSON.stringify(capability.steps.map((s) => s.action.kind), null, 2));
  }, 30000);

  it("reject() ends the discovery run without executing the irreversible action", async () => {
    const provider = new ScriptedLlmProvider([
      { toolName: "navigate", input: { url: "http://localhost:4100/" } },
      { toolName: "fill", input: { target: { kind: "attribute", attribute: "name", value: "memberId" }, value: "48213" } },
      { toolName: "click", input: { target: { kind: "role", role: "button", name: "Search" }, irreversible: false } },
      { toolName: "click", input: { target: { kind: "role", role: "link", name: "Open Sub-Account" }, irreversible: false } },
      {
        toolName: "select",
        input: { target: { kind: "attribute", attribute: "name", value: "accountType" }, value: "savings" },
      },
      {
        toolName: "fill",
        input: { target: { kind: "attribute", attribute: "name", value: "initialDeposit" }, value: "500" },
      },
      { toolName: "click", input: { target: { kind: "role", role: "button", name: "Continue" }, irreversible: false } },
      {
        toolName: "click",
        input: { target: { kind: "role", role: "button", name: "Confirm & Open Account" }, irreversible: true },
      },
    ]);

    const agent = new DiscoveryAgent(surface, provider, policy, "discovery-run-reject");
    const escalated = await agent.run("Open a savings sub-account for member 48213.", mockBankTargetProfile, invocationContext);
    expect(escalated.status).toBe("escalated");
    if (escalated.status !== "escalated") return;

    const result = await agent.reject(escalated.interventionRequest.id);
    expect(agent.controlState.current).toBe("FAILED");
    expect(result.status).toBe("rejected");

    await surface.navigate(`${MOCK_BANK_URL}/members/48213`);
    // SAV-48213-1 is the seeded default account (see store.ts); a newly
    // opened one would be SAV-48213-2.
    const newAccountRow = await surface.resolve({ strategies: [{ kind: "text", text: "SAV-48213-2", exact: false }] });
    expect(newAccountRow.status).toBe("not_found");
  }, 30000);

  it("stops with no_progress when the model repeats an action that keeps failing to resolve", async () => {
    // After the first click, the not-found page has no "Search" button —
    // the identical target hint fails to resolve twice more, and the
    // repeat-detector compares proposed actions, not outcomes.
    const provider = new ScriptedLlmProvider([
      { toolName: "navigate", input: { url: "http://localhost:4100/" } },
      { toolName: "click", input: { target: { kind: "role", role: "button", name: "Search" }, irreversible: false } },
      { toolName: "click", input: { target: { kind: "role", role: "button", name: "Search" }, irreversible: false } },
      { toolName: "click", input: { target: { kind: "role", role: "button", name: "Search" }, irreversible: false } },
    ]);
    const agent = new DiscoveryAgent(surface, provider, policy, "discovery-run-no-progress");
    const result = await agent.run("Do something.", mockBankTargetProfile, invocationContext, { maxSteps: 10 });
    expect(result.status).toBe("no_progress");
  });

  it("stops with policy_blocked after repeated denials of an out-of-origin navigate", async () => {
    const provider = new ScriptedLlmProvider([
      { toolName: "navigate", input: { url: "http://evil.example.com/" } },
      { toolName: "navigate", input: { url: "http://evil.example.com/page2" } },
      { toolName: "navigate", input: { url: "http://evil.example.com/page3" } },
    ]);
    const agent = new DiscoveryAgent(surface, provider, policy, "discovery-run-policy-blocked");
    const result = await agent.run("Go somewhere disallowed.", mockBankTargetProfile, invocationContext, { maxSteps: 10 });
    expect(result.status).toBe("policy_blocked");
    expect(agent.controlState.current).toBe("FAILED");
  });

  it("stops with max_steps_exceeded when the model never calls done", async () => {
    const provider = new ScriptedLlmProvider((_turns, callIndex) => ({
      toolName: "checkpoint",
      input: { description: `still looking, step ${callIndex}` },
    }));
    const agent = new DiscoveryAgent(surface, provider, policy, "discovery-run-max-steps");
    const result = await agent.run("Never finish.", mockBankTargetProfile, invocationContext, { maxSteps: 3 });
    expect(result.status).toBe("max_steps_exceeded");
    expect(result.transcript).toHaveLength(3);
  });

  it("stops with timeout when the run exceeds its time budget", async () => {
    const provider = new ScriptedLlmProvider((_turns, callIndex) => ({
      toolName: "checkpoint",
      input: { description: `step ${callIndex}` },
    }));
    const agent = new DiscoveryAgent(surface, provider, policy, "discovery-run-timeout");
    const result = await agent.run("Never finish.", mockBankTargetProfile, invocationContext, { maxSteps: 1000, timeoutMs: 1 });
    expect(result.status).toBe("timeout");
  });
});
