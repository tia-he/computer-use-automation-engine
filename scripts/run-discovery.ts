/**
 * Real, LLM-backed discovery run against the live mock-bank app.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... npm run discover
 *
 * Requires apps/mock-bank to be running separately (npm --prefix apps/mock-bank run dev)
 * or this script will fail to connect — it does not start the app for you,
 * to keep the evidence trail honest about what was actually running.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { PlaywrightBrowserSurface } from "../src/surface/playwright-surface";
import { AnthropicLlmProvider, DEFAULT_MODEL } from "../src/discovery/anthropic-provider";
import { DiscoveryAgent } from "../src/discovery/agent";
import { compileCapability } from "../src/discovery/recorder";
import { CapabilitySchema } from "../src/artifact/capability";
import { openSubAccountCapability } from "../src/artifact/examples/open-sub-account";
import { mockBankTargetProfile } from "../src/artifact/examples/mock-bank-target-profile";
import { mockBankPolicy } from "../src/guardrails/examples/mock-bank-policy";
import { DiscoveryEvent, DiscoveryResult } from "../src/discovery/types";

const GOAL = "Search for member 48213, open a new savings sub-account with an initial deposit of $500, and reach the confirmation screen.";
const INVOCATION_CONTEXT = { member_id: "48213", account_type: "savings", initial_deposit: 500 };

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is not set. Usage: ANTHROPIC_API_KEY=sk-ant-... npm run discover");
    process.exit(1);
  }

  const runId = `discovery-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const evidenceDir = path.resolve(__dirname, "../evidence/discovery", runId);
  const screenshotsDir = path.join(evidenceDir, "screenshots");
  await mkdir(screenshotsDir, { recursive: true });

  console.log(`Run id: ${runId}`);
  console.log(`Evidence directory: ${path.relative(process.cwd(), evidenceDir)}`);
  console.log("Resetting mock-bank state...");
  await fetch(`${mockBankTargetProfile.entryUrl}reset`, { method: "POST" });

  const surface = await PlaywrightBrowserSurface.launch({ headless: false });
  const provider = new AnthropicLlmProvider(apiKey, process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL);
  const agent = new DiscoveryAgent(surface, provider, mockBankPolicy, runId);

  let stepScreenshots = 0;
  const onStep = async (event: DiscoveryEvent) => {
    console.log(`  step ${event.step}: ${event.action.tool} -> ${event.result}${event.resultDetail ? ` (${event.resultDetail.slice(0, 100)})` : ""}`);
    try {
      const png = await surface.screenshot();
      const file = path.join(screenshotsDir, `step-${String(event.step).padStart(2, "0")}.png`);
      await writeFile(file, png);
      stepScreenshots++;
    } catch {
      // best-effort
    }
  };

  console.log(`\nGoal: ${GOAL}\n`);
  let result: DiscoveryResult = await agent.run(GOAL, mockBankTargetProfile, INVOCATION_CONTEXT, { onStep });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (result.status === "escalated") {
      const req = result.interventionRequest;
      console.log(`\n--- ESCALATED (${req.reason}) ---`);
      console.log(`Step: ${req.stepId}`);
      console.log(`URL: ${req.url}`);
      console.log(`Reason: ${req.explanation}`);
      if (req.screenshotRef) console.log(`Screenshot: ${req.screenshotRef}`);

      const answer = (await rl.question("\nApprove this action? [y/N] ")).trim().toLowerCase();
      if (answer === "y" || answer === "yes") {
        result = await agent.approveAndContinue(req.id);
      } else {
        result = await agent.reject(req.id);
      }
    }
  } finally {
    rl.close();
  }

  await writeFile(path.join(evidenceDir, "discovery-log.json"), JSON.stringify(result.transcript, null, 2));

  console.log(`\n--- RESULT: ${result.status} ---`);
  console.log(`Steps logged: ${result.transcript.length}, screenshots captured: ${stepScreenshots}`);

  if (result.status === "success") {
    const provenance = { discoveryRunId: runId, recordedAt: new Date().toISOString(), model: process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL };
    const { capability, warnings } = compileCapability(
      result.recordedActions,
      INVOCATION_CONTEXT,
      openSubAccountCapability,
      provenance
    );
    const validation = CapabilitySchema.safeParse(capability);
    if (!validation.success) {
      console.error("Compiled capability failed schema validation:", validation.error.format());
    } else {
      await writeFile(path.join(evidenceDir, "capability.json"), JSON.stringify(capability, null, 2));
      console.log(`Draft capability written to ${path.relative(process.cwd(), path.join(evidenceDir, "capability.json"))}`);
    }
    if (warnings.length > 0) {
      console.log("Warnings:", warnings);
    }
  }

  await surface.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
