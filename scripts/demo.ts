/**
 * Zero-cost, reproducible portfolio demo: goal -> discovery
 * (DeterministicDemoProvider, no API key, no network calls to any model) ->
 * generated Capability -> deterministic replay through ReplayEngine (no
 * provider anywhere in that path). Approval prompts are real: the
 * irreversible "Confirm & Open Account" step pauses and waits for you.
 *
 * Usage:
 *   npm run demo
 *
 * Requires apps/mock-bank running separately:
 *   npm --prefix apps/mock-bank run dev
 */
import readline from "node:readline/promises";
import { runDemo } from "../src/discovery/demo-flow";

// A fresh interface per question (rather than one long-lived interface
// reused across both approval prompts) avoids a Node readline quirk where
// piped/non-interactive stdin can report ERR_USE_AFTER_CLOSE on a second
// question() call once the underlying stream has reached EOF.
async function promptYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const result = await runDemo({
    headless: false,
    log: (line) => console.log(line),
    approve: async ({ phase, request }) => {
      console.log(`\n--- [${phase}] APPROVAL REQUIRED ---`);
      console.log(`Step: ${request.stepId}`);
      console.log(`Reason: ${request.explanation}`);
      if (request.screenshotRef) console.log(`Screenshot: ${request.screenshotRef}`);
      return promptYesNo("Approve this irreversible action? [y/N] ");
    },
  });

  console.log("\n[Done]");
  console.log(`Capability: ${result.capabilityPath}`);
  console.log(`Discovery log: ${result.discoveryLogPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
