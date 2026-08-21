import { ConversationTurn, LlmProvider, ToolInvocation, ToolSchema } from "./llm-provider";

/**
 * NOT a model. This is a fixed, fully deterministic script for the
 * open-sub-account goal, so the discovery -> Capability -> replay pipeline
 * can be demonstrated for free: no network calls, no API key, identical
 * output on every run. It performs no reasoning — decide() just returns the
 * next scripted tool call. Two calls read the immediately-prior observation
 * text to pick up a value the app just generated (the account number, the
 * confirmation id); that's string extraction, not planning.
 *
 * For a real model actually deciding what to do, use AnthropicLlmProvider.
 */
export const DEMO_GOAL =
  "Open a savings sub-account for member 48213 with an initial deposit of $100, and complete the process through account creation.";

export const DEMO_INVOCATION_CONTEXT = {
  member_id: "48213",
  account_type: "savings",
  initial_deposit: 100,
};

type ScriptStep = ToolInvocation | ((observation: string) => ToolInvocation);

function extractFromObservation(observation: string, pattern: RegExp, outputName: string): ToolInvocation {
  const match = observation.match(pattern);
  if (!match) {
    throw new Error(
      `DeterministicDemoProvider: expected to find a value matching ${pattern} in the observation for "${outputName}", but didn't:\n${observation}`
    );
  }
  return { toolName: "extract", input: { target: { kind: "text", text: match[1] }, outputName } };
}

const SCRIPT: ScriptStep[] = [
  { toolName: "navigate", input: { url: "http://localhost:4100/" } },
  {
    toolName: "fill",
    input: {
      target: { kind: "attribute", attribute: "name", value: "memberId" },
      value: DEMO_INVOCATION_CONTEXT.member_id,
    },
  },
  { toolName: "click", input: { target: { kind: "role", role: "button", name: "Search" }, irreversible: false } },
  { toolName: "checkpoint", input: { description: "Reached member detail page" } },
  {
    toolName: "click",
    input: { target: { kind: "role", role: "link", name: "Open Sub-Account" }, irreversible: false },
  },
  {
    toolName: "select",
    input: {
      target: { kind: "attribute", attribute: "name", value: "accountType" },
      value: DEMO_INVOCATION_CONTEXT.account_type,
    },
  },
  {
    toolName: "fill",
    input: {
      target: { kind: "attribute", attribute: "name", value: "initialDeposit" },
      value: String(DEMO_INVOCATION_CONTEXT.initial_deposit),
    },
  },
  { toolName: "click", input: { target: { kind: "role", role: "button", name: "Continue" }, irreversible: false } },
  {
    toolName: "click",
    input: { target: { kind: "role", role: "button", name: "Confirm & Open Account" }, irreversible: true },
  },
  (observation) => extractFromObservation(observation, /"(SAV-[\w-]+)"/, "new_account_number"),
  (observation) => extractFromObservation(observation, /"(CONF-[\w-]+)"/, "confirmation_id"),
  {
    toolName: "done",
    input: {
      successTarget: { kind: "role", role: "heading", name: "Account Opened" },
      summary: "Opened a savings sub-account for member 48213.",
    },
  },
];

export class DeterministicDemoProvider implements LlmProvider {
  private callIndex = 0;

  async decide(input: { system: string; tools: ToolSchema[]; turns: ConversationTurn[] }): Promise<ToolInvocation> {
    const step = SCRIPT[Math.min(this.callIndex, SCRIPT.length - 1)];
    this.callIndex++;
    if (typeof step === "function") {
      const observation = [...input.turns].reverse().find((t) => t.role === "observation")?.text ?? "";
      return step(observation);
    }
    return step;
  }
}
