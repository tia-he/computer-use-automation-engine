import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { runDemo } from "./demo-flow";
import { DeterministicDemoProvider } from "./demo-provider";
import { validateToolInput } from "./tools";
import { CapabilitySchema } from "../artifact/capability";
import { openSubAccountCapability } from "../artifact/examples/open-sub-account";
import { MOCK_BANK_URL } from "../test-support/mock-bank";

describe("DeterministicDemoProvider", () => {
  it("implements LlmProvider and returns a schema-valid tool call for the first turn", async () => {
    const provider = new DeterministicDemoProvider();
    const decision = await provider.decide({
      system: "",
      tools: [],
      turns: [{ role: "observation", text: "No page loaded yet." }],
    });

    expect(decision.toolName).toBe("navigate");
    expect(validateToolInput(decision.toolName, decision.input).ok).toBe(true);
  });

  it("is a plain script, not stateful reasoning: the same call index always returns the same tool", async () => {
    const a = new DeterministicDemoProvider();
    const b = new DeterministicDemoProvider();
    const turns = [{ role: "observation" as const, text: "anything" }];

    const first = await a.decide({ system: "", tools: [], turns });
    const second = await b.decide({ system: "", tools: [], turns });
    expect(first).toEqual(second);
  });
});

describe("demo flow: discovery -> Capability -> ReplayEngine (no LLM)", () => {
  beforeEach(async () => {
    await fetch(`${MOCK_BANK_URL}/reset`, { method: "POST" });
  });

  it("runs discovery with the deterministic provider and replays the generated Capability with fresh inputs", async () => {
    const phases: string[] = [];
    const result = await runDemo({
      headless: true,
      approve: async ({ phase }) => {
        phases.push(phase);
        return true;
      },
    });

    // Both real approval/handoff paths were actually exercised: once during
    // discovery, once independently during replay.
    expect(phases).toEqual(["discovery", "replay"]);

    // The artifact ReplayEngine consumed is the one on disk, not some other
    // in-memory object.
    const onDisk = JSON.parse(await readFile(result.capabilityPath, "utf-8"));
    expect(result.capability).toEqual(onDisk);
    expect(CapabilitySchema.safeParse(onDisk).success).toBe(true);

    // Genuinely discovered, not copied from the hand-authored template:
    // step ids are freshly assigned and the step list itself differs.
    expect(result.capability.steps.map((s) => s.id)).toEqual(result.capability.steps.map((_, i) => `step-${i + 1}`));
    expect(result.capability.steps).not.toEqual(openSubAccountCapability.steps);

    // Template-derived parts (per Phase 6 design) are still present and correct.
    expect(result.capability.businessOutcomes).toEqual(openSubAccountCapability.businessOutcomes);
    expect(result.capability.successCheckpoint).toEqual(openSubAccountCapability.successCheckpoint);

    expect(result.replaySuccess.status).toBe("success");
    if (result.replaySuccess.status === "success") {
      expect(result.replaySuccess.outputs.new_account_number).toMatch(/^SAV-48213-\d+$/);
      expect(result.replaySuccess.outputs.confirmation_id).toMatch(/^CONF-\d+$/);
    }

    expect(result.replayBusinessOutcome.status).toBe("business_outcome");
    if (result.replayBusinessOutcome.status === "business_outcome") {
      expect(result.replayBusinessOutcome.code).toBe("MEMBER_NOT_FOUND");
    }
  }, 60000);
});

describe("replay has no LlmProvider dependency", () => {
  it("ReplayEngine and HandoffSession source never reference any LlmProvider implementation", async () => {
    const engineSource = await readFile(path.resolve(__dirname, "../replay/engine.ts"), "utf-8");
    const sessionSource = await readFile(path.resolve(__dirname, "../handoff/session.ts"), "utf-8");
    const forbidden = /llm-provider|LlmProvider|AnthropicLlmProvider|DeterministicDemoProvider|ScriptedLlmProvider/;

    expect(engineSource).not.toMatch(forbidden);
    expect(sessionSource).not.toMatch(forbidden);
  });
});
