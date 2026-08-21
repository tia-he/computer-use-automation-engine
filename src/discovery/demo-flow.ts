import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PlaywrightBrowserSurface } from "../surface/playwright-surface";
import { mockBankPolicy } from "../guardrails/examples/mock-bank-policy";
import { mockBankTargetProfile } from "../artifact/examples/mock-bank-target-profile";
import { openSubAccountCapability } from "../artifact/examples/open-sub-account";
import { Capability, CapabilitySchema } from "../artifact/capability";
import { InterventionRequest } from "../handoff/types";
import { DiscoveryAgent } from "./agent";
import { DEMO_GOAL, DEMO_INVOCATION_CONTEXT, DeterministicDemoProvider } from "./demo-provider";
import { compileCapability } from "./recorder";
import { ReplayEngine } from "../replay/engine";
import { ReplayResult } from "../replay/types";
import { HandoffSession } from "../handoff/session";

export type ApprovalCallback = (context: {
  phase: "discovery" | "replay";
  request: InterventionRequest;
}) => Promise<boolean>;

export interface DemoOptions {
  headless?: boolean;
  approve: ApprovalCallback;
  log?: (line: string) => void;
}

export interface DemoResult {
  runId: string;
  evidenceDir: string;
  capabilityPath: string;
  discoveryLogPath: string;
  capability: Capability;
  replaySuccess: ReplayResult;
  replayBusinessOutcome: ReplayResult;
}

const RESET_URL = `${mockBankTargetProfile.entryUrl}reset`;

async function assertMockBankReachable(): Promise<void> {
  try {
    const res = await fetch(mockBankTargetProfile.entryUrl);
    if (!res.ok) throw new Error(`unexpected status ${res.status}`);
  } catch (err) {
    throw new Error(
      `Cannot reach mock-bank at ${mockBankTargetProfile.entryUrl}. Start it first: npm --prefix apps/mock-bank run dev\n(${
        err instanceof Error ? err.message : String(err)
      })`
    );
  }
}

/**
 * Runs the full portfolio demo: goal -> discovery (DeterministicDemoProvider,
 * real guardrails, real approval/handoff) -> compiled Capability, written to
 * disk and read back -> that on-disk artifact replayed twice through the
 * real ReplayEngine (a fresh success, and a business outcome) with no
 * provider anywhere in the replay path.
 */
export async function runDemo(options: DemoOptions): Promise<DemoResult> {
  const log = options.log ?? (() => {});
  const runId = `demo-${Date.now()}`;
  const evidenceDir = path.resolve(__dirname, "../../evidence/discovery/demo");
  await mkdir(evidenceDir, { recursive: true });

  await assertMockBankReachable();

  const surface = await PlaywrightBrowserSurface.launch({ headless: options.headless ?? true });

  try {
    log("[Discovery]");
    log(`Goal: ${DEMO_GOAL}`);
    log(`Invocation context: ${JSON.stringify(DEMO_INVOCATION_CONTEXT)}`);

    await fetch(RESET_URL, { method: "POST" });

    const provider = new DeterministicDemoProvider();
    const discoveryRunId = `${runId}-discovery`;
    const agent = new DiscoveryAgent(surface, provider, mockBankPolicy, discoveryRunId);

    let discoveryResult = await agent.run(DEMO_GOAL, mockBankTargetProfile, DEMO_INVOCATION_CONTEXT, {
      maxSteps: 20,
      timeoutMs: 20 * 60 * 1000,
    });

    let approvalScreenshotSaved = false;
    while (discoveryResult.status === "escalated") {
      const request = discoveryResult.interventionRequest;
      log(`Approval required: ${request.explanation} (step ${request.stepId})`);

      if (!approvalScreenshotSaved) {
        try {
          const png = await surface.screenshot();
          await writeFile(path.join(evidenceDir, "approval-required.png"), png);
          approvalScreenshotSaved = true;
        } catch {
          // best-effort
        }
      }

      const approved = await options.approve({ phase: "discovery", request });
      if (approved) {
        log("Approved.");
        discoveryResult = await agent.approveAndContinue(request.id);
      } else {
        log("Rejected.");
        discoveryResult = await agent.reject(request.id);
      }
    }

    if (discoveryResult.status !== "success") {
      throw new Error(`Discovery did not succeed (status: ${discoveryResult.status})`);
    }
    log(`Discovery result: SUCCESS (${discoveryResult.recordedActions.length} actions recorded)`);

    const discoveryLogPath = path.join(evidenceDir, "discovery-log.json");
    await writeFile(discoveryLogPath, JSON.stringify(discoveryResult.transcript, null, 2));

    const provenance = {
      discoveryRunId,
      recordedAt: new Date().toISOString(),
      model: "deterministic-demo-provider",
    };
    const { capability, warnings } = compileCapability(
      discoveryResult.recordedActions,
      DEMO_INVOCATION_CONTEXT,
      openSubAccountCapability,
      provenance
    );
    const schemaCheck = CapabilitySchema.safeParse(capability);
    if (!schemaCheck.success) {
      throw new Error(`Generated capability failed schema validation: ${JSON.stringify(schemaCheck.error.format())}`);
    }
    if (warnings.length > 0) {
      log(`Warnings: ${warnings.join("; ")}`);
    }

    const capabilityPath = path.join(evidenceDir, "capability.json");
    await writeFile(capabilityPath, JSON.stringify(capability, null, 2));
    log(`Capability generated: ${path.relative(process.cwd(), capabilityPath)}`);

    // Prove the artifact that gets replayed is the one actually written to
    // disk, not the in-memory object compileCapability just returned.
    const capabilityFromDisk = CapabilitySchema.parse(JSON.parse(await readFile(capabilityPath, "utf-8")));

    const replayEngine = new ReplayEngine(surface, mockBankPolicy);

    // --- Replay: fresh inputs, escalates again on its own, then succeeds ---
    log("");
    log("[Replay — no LLM]");
    await fetch(RESET_URL, { method: "POST" });
    const successInputs = { member_id: "48213", account_type: "savings", initial_deposit: 250 };
    log(`Inputs: ${JSON.stringify(successInputs)}`);

    const handoff = new HandoffSession(surface, replayEngine, `${runId}-replay-success`);
    let replaySuccess = await handoff.run(capabilityFromDisk, mockBankTargetProfile, successInputs);
    while (replaySuccess.status === "escalated") {
      const request = replaySuccess.interventionRequest;
      log(`Approval required: ${request.explanation} (step ${request.stepId})`);
      const approved = await options.approve({ phase: "replay", request });
      if (approved) {
        log("Approved.");
        replaySuccess = await handoff.approve(request.id);
      } else {
        log("Rejected.");
        replaySuccess = await handoff.reject(request.id);
      }
    }
    log(`Result: ${replaySuccess.status.toUpperCase()}`);
    if (replaySuccess.status === "success") {
      log(`Outputs: ${JSON.stringify(replaySuccess.outputs)}`);
    }

    // --- Replay: same on-disk capability, a business outcome, no escalation ---
    log("");
    log("[Replay — business outcome]");
    await fetch(RESET_URL, { method: "POST" });
    const businessOutcomeInputs = { member_id: "99999", account_type: "savings", initial_deposit: 100 };
    log(`Inputs: ${JSON.stringify(businessOutcomeInputs)}`);

    const replayBusinessOutcome = await replayEngine.replay(capabilityFromDisk, mockBankTargetProfile, businessOutcomeInputs, {
      runId: `${runId}-replay-business-outcome`,
    });
    log(
      `Result: ${
        replayBusinessOutcome.status === "business_outcome" ? replayBusinessOutcome.code : replayBusinessOutcome.status.toUpperCase()
      }`
    );

    return {
      runId,
      evidenceDir,
      capabilityPath,
      discoveryLogPath,
      capability: capabilityFromDisk,
      replaySuccess,
      replayBusinessOutcome,
    };
  } finally {
    await surface.close();
  }
}
