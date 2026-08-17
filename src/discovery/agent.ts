import { randomUUID } from "node:crypto";
import { Surface, Observation } from "../surface/types";
import { LocatorStrategy } from "../locator/types";
import { RiskLevel } from "../artifact/capability";
import { TargetProfile } from "../artifact/target-profile";
import { GuardrailPolicy } from "../guardrails/policy";
import { ControlStateMachine } from "../handoff/control-state";
import { InterventionRequest } from "../handoff/types";
import { saveInterventionScreenshot } from "../handoff/evidence";
import { ConversationTurn, LlmProvider } from "./llm-provider";
import { TOOL_SCHEMAS, TargetHint, validateToolInput } from "./tools";
import { buildObservationText, buildSystemPrompt } from "./prompt";
import { DiscoveryEvent, DiscoveryOptions, DiscoveryResult, RecordedAction } from "./types";

const DEFAULT_MAX_STEPS = 20;
const DEFAULT_TIMEOUT_MS = 180_000;

function hintToStrategy(hint: TargetHint): LocatorStrategy {
  switch (hint.kind) {
    case "role":
      return { kind: "role", role: hint.role, name: hint.name };
    case "label":
      return { kind: "label", text: hint.text };
    case "text":
      return { kind: "text", text: hint.text };
    case "attribute":
      return { kind: "attribute", attribute: hint.attribute, value: hint.value };
  }
}

interface PendingAction {
  interventionRequest: InterventionRequest;
  /** Absent for a STUCK (explicit "escalate") pause — there's no specific action to resume, just a fresh turn. */
  toolName?: string;
  input?: Record<string, unknown>;
}

/**
 * Goal-driven discovery: perceive -> decide (LLM, forced tool call) ->
 * guardrail check -> act -> observe again. No action outside the fixed tool
 * vocabulary is possible. Reuses Phase 5's ControlStateMachine and
 * InterventionRequest for irreversible actions and explicit escalation —
 * same mechanism as replay, not a parallel one.
 */
export class DiscoveryAgent {
  readonly controlState = new ControlStateMachine();

  private pending?: PendingAction;
  private turns: ConversationTurn[] = [];
  private recordedActions: RecordedAction[] = [];
  private transcript: DiscoveryEvent[] = [];
  private observation: Observation | null = null;
  private lastActionResultText = "";
  private consecutiveDenials = 0;
  private recentActionSignatures: string[] = [];
  private stepCounter = 0;
  private startedAt = 0;

  private goal = "";
  private targetProfile!: TargetProfile;
  private invocationContext: Record<string, string | number> = {};
  private maxSteps = DEFAULT_MAX_STEPS;
  private timeoutMs = DEFAULT_TIMEOUT_MS;
  private onStep?: DiscoveryOptions["onStep"];
  private systemPrompt = "";

  constructor(
    private readonly surface: Surface,
    private readonly provider: LlmProvider,
    private readonly policy: GuardrailPolicy,
    private readonly runId: string
  ) {}

  async run(
    goal: string,
    targetProfile: TargetProfile,
    invocationContext: Record<string, string | number>,
    options: DiscoveryOptions = {}
  ): Promise<DiscoveryResult> {
    this.goal = goal;
    this.targetProfile = targetProfile;
    this.invocationContext = invocationContext;
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onStep = options.onStep;
    this.systemPrompt = buildSystemPrompt(goal, targetProfile, invocationContext);

    this.turns = [];
    this.recordedActions = [];
    this.transcript = [];
    this.observation = null;
    this.lastActionResultText = "No actions taken yet.";
    this.consecutiveDenials = 0;
    this.recentActionSignatures = [];
    this.stepCounter = 0;
    this.startedAt = Date.now();

    return this.loop();
  }

  async approveAndContinue(interventionId: string): Promise<DiscoveryResult> {
    this.assertPending(interventionId);
    const { toolName, input } = this.pending!;
    this.pending = undefined;
    this.controlState.transition("AUTOMATION_CONTROL");

    if (toolName && input) {
      const risk: RiskLevel = toolName === "click" && (input as { irreversible?: boolean }).irreversible ? "irreversible" : "safe";
      await this.performAndRecord(toolName, input, risk);
    } else {
      // STUCK resume: nothing specific to re-execute — re-observe and let
      // the model propose its next action with a fresh turn.
      this.observation = await this.surface.perceive();
      this.lastActionResultText = "A human intervened. Re-assess the current page and continue.";
    }

    return this.loop();
  }

  async reject(interventionId: string): Promise<DiscoveryResult> {
    this.assertPending(interventionId);
    this.pending = undefined;
    this.controlState.transition("FAILED");
    return { status: "rejected", transcript: this.transcript, recordedActions: this.recordedActions };
  }

  private async loop(): Promise<DiscoveryResult> {
    for (; this.stepCounter < this.maxSteps; ) {
      if (Date.now() - this.startedAt > this.timeoutMs) {
        this.controlState.transition("FAILED");
        return { status: "timeout", transcript: this.transcript, recordedActions: this.recordedActions };
      }

      this.stepCounter++;
      const observationText = buildObservationText(this.observation, this.lastActionResultText, this.targetProfile.entryUrl);
      this.turns.push({ role: "observation", text: observationText });

      const decision = await this.provider.decide({ system: this.systemPrompt, tools: TOOL_SCHEMAS, turns: this.turns });
      this.turns.push({ role: "action", toolName: decision.toolName, input: decision.input });

      const validation = validateToolInput(decision.toolName, decision.input);
      if (!validation.ok) {
        this.lastActionResultText = `Invalid input for "${decision.toolName}": ${validation.error}`;
        this.logEvent(observationText, decision, "invalid_input", validation.error);
        continue;
      }
      const input = validation.value as Record<string, unknown>;

      if (decision.toolName === "done") {
        const { successTarget, summary } = input as { successTarget: TargetHint; summary: string };
        const resolution = await this.surface.resolve({ strategies: [hintToStrategy(successTarget)] });
        if (resolution.status !== "resolved") {
          this.lastActionResultText = `"done" rejected: the success target did not resolve on the current page. Keep going or try a different target.`;
          this.logEvent(observationText, decision, "resolution_failed", this.lastActionResultText);
          continue;
        }
        this.logEvent(observationText, decision, "ok");
        this.controlState.transition("COMPLETED");
        return { status: "success", transcript: this.transcript, recordedActions: this.recordedActions, summary };
      }

      if (decision.toolName === "escalate") {
        const { reason } = input as { reason: string };
        const interventionRequest = await this.buildInterventionRequest("STUCK", reason);
        this.logEvent(observationText, decision, "ok", reason);
        this.pending = { interventionRequest };
        this.controlState.transition("HUMAN_CONTROL");
        return { status: "escalated", transcript: this.transcript, recordedActions: this.recordedActions, interventionRequest };
      }

      if (decision.toolName === "checkpoint") {
        const { description } = input as { description: string };
        this.lastActionResultText = `Checkpoint noted: ${description}`;
        this.logEvent(observationText, decision, "ok", description);
        continue;
      }

      // navigate / click / fill / select / extract
      const actionKind = decision.toolName as "navigate" | "click" | "fill" | "select" | "extract";
      const risk: RiskLevel = actionKind === "click" && (input as { irreversible?: boolean }).irreversible ? "irreversible" : "safe";
      const urlForPolicy = actionKind === "navigate" ? (input as { url: string }).url : this.observation?.url ?? this.targetProfile.entryUrl;

      const policyDecision = this.policy.evaluate({ actionKind, risk, url: urlForPolicy, approved: false });

      if (policyDecision.kind === "denied") {
        this.consecutiveDenials++;
        this.lastActionResultText = `Action denied by policy: ${policyDecision.reason}`;
        this.logEvent(observationText, decision, "policy_denied", policyDecision.reason);
        if (this.consecutiveDenials >= 3) {
          this.controlState.transition("FAILED");
          return { status: "policy_blocked", transcript: this.transcript, recordedActions: this.recordedActions };
        }
        continue;
      }
      this.consecutiveDenials = 0;

      if (policyDecision.kind === "requires_approval") {
        const interventionRequest = await this.buildInterventionRequest("APPROVAL_REQUIRED", policyDecision.reason);
        this.pending = { interventionRequest, toolName: decision.toolName, input };
        this.logEvent(observationText, decision, "ok", policyDecision.reason);
        this.controlState.transition("HUMAN_CONTROL");
        return { status: "escalated", transcript: this.transcript, recordedActions: this.recordedActions, interventionRequest };
      }

      const signature = `${actionKind}:${JSON.stringify(input)}`;
      const outcome = await this.performAndRecord(decision.toolName, input, risk);
      this.logEvent(observationText, decision, outcome.ok ? "ok" : "error", outcome.detail);

      this.recentActionSignatures.push(signature);
      if (this.recentActionSignatures.length > 3) this.recentActionSignatures.shift();
      if (this.recentActionSignatures.length === 3 && this.recentActionSignatures.every((s) => s === signature)) {
        this.controlState.transition("FAILED");
        return { status: "no_progress", transcript: this.transcript, recordedActions: this.recordedActions };
      }
    }

    this.controlState.transition("FAILED");
    return { status: "max_steps_exceeded", transcript: this.transcript, recordedActions: this.recordedActions };
  }

  private async performAndRecord(
    toolName: string,
    input: Record<string, unknown>,
    risk: RiskLevel
  ): Promise<{ ok: boolean; detail: string }> {
    try {
      if (toolName === "navigate") {
        const { url } = input as { url: string };
        await this.surface.navigate(url, { timeoutMs: this.targetProfile.defaultTimeouts.navigationMs });
        this.recordedActions.push({ kind: "navigate", url, risk });
        this.lastActionResultText = `Navigated to ${url}.`;
      } else {
        const { target } = input as { target: TargetHint };
        const resolution = await this.surface.resolve({ strategies: [hintToStrategy(target)] });
        if (resolution.status !== "resolved") {
          const outcomes = resolution.attempts.map((a) => a.outcome).join(", ") || "no strategies";
          this.lastActionResultText = `Could not find that element (${outcomes}). Try a different way to identify it.`;
          this.observation = await this.surface.perceive();
          return { ok: false, detail: this.lastActionResultText };
        }

        switch (toolName) {
          case "click": {
            // describe() before click(): a click can trigger navigation, and
            // Playwright Locators re-query the live page on every use — if
            // the target no longer exists after navigating away, describe()
            // would auto-wait for it up to Playwright's default action
            // timeout instead of failing fast.
            const locator = await this.surface.describe(resolution.element);
            await this.surface.click(resolution.element);
            this.recordedActions.push({ kind: "click", target: locator, risk });
            this.lastActionResultText = "Clicked.";
            break;
          }
          case "fill": {
            const { value } = input as { value: string };
            const locator = await this.surface.describe(resolution.element);
            await this.surface.fill(resolution.element, value);
            this.recordedActions.push({ kind: "fill", target: locator, value, risk });
            this.lastActionResultText = `Filled with "${value}".`;
            break;
          }
          case "select": {
            const { value } = input as { value: string };
            const locator = await this.surface.describe(resolution.element);
            await this.surface.selectOption(resolution.element, value);
            this.recordedActions.push({ kind: "select", target: locator, value, risk });
            this.lastActionResultText = `Selected "${value}".`;
            break;
          }
          case "extract": {
            const { outputName } = input as { outputName: string };
            const locator = await this.surface.describe(resolution.element);
            const text = await this.surface.extractText(resolution.element);
            this.recordedActions.push({ kind: "extract", target: locator, outputName, risk });
            this.lastActionResultText = `Extracted "${outputName}" = "${text}".`;
            break;
          }
        }
      }

      this.observation = await this.surface.perceive();
      return { ok: true, detail: this.lastActionResultText };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastActionResultText = `Action failed: ${message}`;
      try {
        this.observation = await this.surface.perceive();
      } catch {
        // page may be in a broken state; keep the previous observation
      }
      return { ok: false, detail: message };
    }
  }

  private async buildInterventionRequest(reason: "APPROVAL_REQUIRED" | "STUCK", explanation: string): Promise<InterventionRequest> {
    const id = randomUUID();
    let screenshotRef: string | undefined;
    try {
      const screenshot = await this.surface.screenshot();
      screenshotRef = await saveInterventionScreenshot(id, screenshot);
    } catch {
      // best-effort
    }
    return {
      id,
      reason,
      runId: this.runId,
      capabilityId: "discovery-in-progress",
      stepId: `step-${this.stepCounter}`,
      explanation,
      url: this.observation?.url ?? this.targetProfile.entryUrl,
      screenshotRef,
      createdAt: new Date().toISOString(),
    };
  }

  private logEvent(
    observationSummary: string,
    decision: { toolName: string; input: Record<string, unknown>; reasoningSummary?: string },
    result: DiscoveryEvent["result"],
    resultDetail?: string
  ): void {
    const event: DiscoveryEvent = {
      step: this.stepCounter,
      observationSummary,
      action: { tool: decision.toolName, input: decision.input },
      result,
      resultDetail,
      reasoningSummary: decision.reasoningSummary,
      timestamp: new Date().toISOString(),
    };
    this.transcript.push(event);
    void this.onStep?.(event);
  }

  private assertPending(interventionId: string): void {
    if (!this.pending || this.pending.interventionRequest.id !== interventionId) {
      throw new Error(`no pending intervention with id "${interventionId}"`);
    }
  }
}
