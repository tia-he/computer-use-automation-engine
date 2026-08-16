import { randomUUID } from "node:crypto";
import { Surface } from "../surface/types";
import { LogicalLocator, ResolvedElement } from "../locator/types";
import { Capability, Step } from "../artifact/capability";
import { TargetProfile } from "../artifact/target-profile";
import { GuardrailPolicy } from "../guardrails/policy";
import { InterventionRequest } from "../handoff/types";
import { saveInterventionScreenshot } from "../handoff/evidence";
import { evaluateCondition, describeCondition } from "./condition-eval";
import { resolveValue } from "./value-resolution";
import { validateInvocationInputs } from "./input-validation";
import {
  ReplayEscalatedResult,
  ReplayFailureResult,
  ReplayOptions,
  ReplayResult,
  ReplaySuccessResult,
} from "./types";

type StepOutcome =
  | { kind: "ok" }
  | { kind: "failure"; result: ReplayFailureResult }
  | { kind: "escalated"; result: ReplayEscalatedResult };

type ResolveOutcome = { ok: true; element: ResolvedElement } | { ok: false; failure: ReplayFailureResult };

/**
 * Deterministic replay: given a Capability, its TargetProfile, and typed
 * invocation inputs, executes the artifact's steps in order against a
 * Surface with no LLM/heuristic decisions anywhere in this class. Every
 * action — including safe ones — is checked against `policy` immediately
 * before it runs, not only validated when the artifact was authored.
 */
export class ReplayEngine {
  constructor(
    private readonly surface: Surface,
    private readonly policy: GuardrailPolicy
  ) {}

  async replay(
    capability: Capability,
    targetProfile: TargetProfile,
    rawInputs: Record<string, unknown>,
    options: ReplayOptions
  ): Promise<ReplayResult> {
    const inputValidation = validateInvocationInputs(capability, rawInputs);
    if (!inputValidation.valid) {
      return {
        status: "failure",
        errorCode: "INVALID_INPUT",
        expected: inputValidation.expected,
        observed: inputValidation.observed,
        completedStepIds: [],
      };
    }
    const inputs = inputValidation.inputs;
    const approvedStepIds = new Set(options.approvedStepIds ?? []);

    const resumeIndex = options.resumeAfterStepId
      ? capability.steps.findIndex((s) => s.id === options.resumeAfterStepId)
      : -1;
    const completedStepIds: string[] = resumeIndex >= 0 ? capability.steps.slice(0, resumeIndex + 1).map((s) => s.id) : [];
    let skipping = resumeIndex >= 0;
    // Scoped to this call, not the engine instance — the same ReplayEngine
    // is reused across a resumed call, and extracted values from an
    // unrelated prior run must never leak in. A capability whose extract
    // steps precede its escalation point would need those values threaded
    // through ReplayOptions on resume; open-sub-account's extract steps are
    // both after its irreversible step, so that case isn't exercised here
    // (see write-up for the limitation).
    const extractedByStepId: Record<string, string> = {};

    for (const step of capability.steps) {
      if (skipping) {
        if (step.id === options.resumeAfterStepId) skipping = false;
        continue;
      }

      const outcome = await this.executeStep(
        step,
        capability,
        targetProfile,
        inputs,
        approvedStepIds,
        completedStepIds,
        extractedByStepId,
        options.runId
      );
      if (outcome.kind === "failure") return outcome.result;
      if (outcome.kind === "escalated") return outcome.result;
      completedStepIds.push(step.id);

      await this.dismissKnownInterstitials(targetProfile);

      for (const businessOutcome of capability.businessOutcomes) {
        const evaluation = await evaluateCondition(this.surface, businessOutcome.detector);
        if (!evaluation.holds) continue;

        let message: string | undefined;
        if (businessOutcome.message) {
          const resolution = await this.surface.resolve(businessOutcome.message.target);
          if (resolution.status === "resolved") {
            message = await this.surface.extractText(resolution.element);
          }
        }
        return {
          status: "business_outcome",
          code: businessOutcome.code,
          message,
          stepId: step.id,
          completedStepIds: [...completedStepIds],
        };
      }
    }

    const finalCheck = await evaluateCondition(this.surface, capability.successCheckpoint);
    if (!finalCheck.holds) {
      return {
        status: "failure",
        errorCode: "CHECKPOINT_FAILED",
        failedStepId: capability.steps[capability.steps.length - 1]?.id,
        expected: describeCondition(capability.successCheckpoint),
        observed: finalCheck.observed,
        completedStepIds: [...completedStepIds],
      };
    }

    return this.collectOutputs(capability, extractedByStepId, completedStepIds);
  }

  private async executeStep(
    step: Step,
    capability: Capability,
    targetProfile: TargetProfile,
    inputs: Record<string, string | number>,
    approvedStepIds: Set<string>,
    completedStepIds: string[],
    extractedByStepId: Record<string, string>,
    runId: string
  ): Promise<StepOutcome> {
    const action = step.action;

    const currentUrl =
      action.kind === "navigate" ? resolveValue(action.url, inputs) : (await this.surface.perceive()).url;

    const decision = this.policy.evaluate({
      actionKind: action.kind,
      risk: step.risk,
      url: currentUrl,
      approved: approvedStepIds.has(step.id),
    });

    if (decision.kind === "denied") {
      return {
        kind: "failure",
        result: {
          status: "failure",
          errorCode: "POLICY_DENIED",
          failedStepId: step.id,
          expected: "policy to allow this action",
          observed: decision.reason,
          completedStepIds: [...completedStepIds],
        },
      };
    }

    if (decision.kind === "requires_approval") {
      const interventionRequest = await this.buildInterventionRequest(step, capability, currentUrl, decision.reason, runId);
      return { kind: "escalated", result: { status: "escalated", interventionRequest, completedStepIds: [...completedStepIds] } };
    }

    try {
      switch (action.kind) {
        case "navigate": {
          await this.surface.navigate(currentUrl, { timeoutMs: targetProfile.defaultTimeouts.navigationMs });
          return { kind: "ok" };
        }
        case "click": {
          const resolved = await this.resolveOrFail(action.target, step, completedStepIds);
          if (!resolved.ok) return { kind: "failure", result: resolved.failure };
          await this.surface.click(resolved.element);
          return { kind: "ok" };
        }
        case "fill": {
          const resolved = await this.resolveOrFail(action.target, step, completedStepIds);
          if (!resolved.ok) return { kind: "failure", result: resolved.failure };
          await this.surface.fill(resolved.element, resolveValue(action.value, inputs));
          return { kind: "ok" };
        }
        case "select": {
          const resolved = await this.resolveOrFail(action.target, step, completedStepIds);
          if (!resolved.ok) return { kind: "failure", result: resolved.failure };
          await this.surface.selectOption(resolved.element, resolveValue(action.value, inputs));
          return { kind: "ok" };
        }
        case "extract": {
          const resolved = await this.resolveOrFail(action.target, step, completedStepIds);
          if (!resolved.ok) return { kind: "failure", result: resolved.failure };
          extractedByStepId[step.id] = await this.surface.extractText(resolved.element);
          return { kind: "ok" };
        }
        case "checkpoint": {
          const evaluation = await evaluateCondition(this.surface, action.condition);
          if (evaluation.holds) return { kind: "ok" };
          return {
            kind: "failure",
            result: {
              status: "failure",
              errorCode: "CHECKPOINT_FAILED",
              failedStepId: step.id,
              expected: describeCondition(action.condition),
              observed: evaluation.observed,
              completedStepIds: [...completedStepIds],
            },
          };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout = action.kind === "navigate" && /timeout/i.test(message);
      return {
        kind: "failure",
        result: {
          status: "failure",
          errorCode: isTimeout ? "LOAD_TIMEOUT" : "ACTION_FAILED",
          failedStepId: step.id,
          expected: `step "${step.id}" (${action.kind}) to succeed`,
          observed: message,
          detail: message,
          completedStepIds: [...completedStepIds],
        },
      };
    }
  }

  private async buildInterventionRequest(
    step: Step,
    capability: Capability,
    url: string,
    reason: string,
    runId: string
  ): Promise<InterventionRequest> {
    const id = randomUUID();
    let screenshotRef: string | undefined;
    try {
      const screenshot = await this.surface.screenshot();
      screenshotRef = await saveInterventionScreenshot(id, screenshot);
    } catch {
      // Evidence capture is best-effort; a failed screenshot shouldn't block escalation.
    }
    return {
      id,
      reason: "APPROVAL_REQUIRED",
      runId,
      capabilityId: capability.id,
      stepId: step.id,
      explanation: reason,
      url,
      screenshotRef,
      createdAt: new Date().toISOString(),
    };
  }

  private async resolveOrFail(
    target: LogicalLocator,
    step: Step,
    completedStepIds: string[]
  ): Promise<ResolveOutcome> {
    const resolution = await this.surface.resolve(target);
    if (resolution.status === "resolved") {
      return { ok: true, element: resolution.element };
    }
    const outcomes = resolution.attempts.map((a) => `${a.strategy.kind}:${a.outcome}`).join(", ") || "no strategies";
    return {
      ok: false,
      failure: {
        status: "failure",
        errorCode: "LOCATOR_NOT_FOUND",
        failedStepId: step.id,
        expected: `an element matching ${target.description ?? JSON.stringify(target.strategies[0])}`,
        observed: `no strategy matched (${outcomes})`,
        detail: JSON.stringify(resolution.attempts),
        completedStepIds: [...completedStepIds],
      },
    };
  }

  /**
   * Explicit, minimal seam for recoverable conditions: mock-bank's
   * TargetProfile declares no interstitials today, so this is a no-op in
   * practice, but the mechanism is real — a profile that did declare one
   * would have it dismissed here, once per step, before business-outcome/
   * checkpoint evaluation.
   */
  private async dismissKnownInterstitials(targetProfile: TargetProfile): Promise<void> {
    for (const interstitial of targetProfile.knownInterstitials ?? []) {
      const evaluation = await evaluateCondition(this.surface, interstitial.detector);
      if (!evaluation.holds) continue;
      const resolution = await this.surface.resolve(interstitial.dismissTarget);
      if (resolution.status === "resolved") {
        await this.surface.click(resolution.element);
      }
    }
  }

  private collectOutputs(
    capability: Capability,
    extractedByStepId: Record<string, string>,
    completedStepIds: string[]
  ): ReplaySuccessResult | ReplayFailureResult {
    const outputs: Record<string, string | number> = {};

    for (const [name, declaration] of Object.entries(capability.outputs)) {
      const raw = extractedByStepId[declaration.sourceStepId];
      if (declaration.type === "number") {
        const parsed = Number(raw);
        if (Number.isNaN(parsed)) {
          return {
            status: "failure",
            errorCode: "ACTION_FAILED",
            expected: `output "${name}" to parse as a number`,
            observed: raw,
            completedStepIds: [...completedStepIds],
          };
        }
        outputs[name] = parsed;
      } else {
        outputs[name] = raw;
      }
    }

    return { status: "success", outputs, completedStepIds: [...completedStepIds] };
  }
}
