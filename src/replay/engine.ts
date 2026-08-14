import { Surface } from "../surface/types";
import { LogicalLocator, ResolvedElement } from "../locator/types";
import { Capability, Step } from "../artifact/capability";
import { TargetProfile } from "../artifact/target-profile";
import { evaluateCondition, describeCondition } from "./condition-eval";
import { resolveValue } from "./value-resolution";
import { validateInvocationInputs } from "./input-validation";
import { ReplayFailureResult, ReplayOptions, ReplayResult, ReplaySuccessResult } from "./types";

type StepFailure = ReplayFailureResult;
type ResolveOutcome = { ok: true; element: ResolvedElement } | { ok: false; failure: StepFailure };

/**
 * Deterministic replay: given a Capability, its TargetProfile, and typed
 * invocation inputs, executes the artifact's steps in order against a
 * Surface with no LLM/heuristic decisions anywhere in this class.
 */
export class ReplayEngine {
  constructor(private readonly surface: Surface) {}

  async replay(
    capability: Capability,
    targetProfile: TargetProfile,
    rawInputs: Record<string, unknown>,
    options: ReplayOptions = {}
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

    const completedStepIds: string[] = [];
    const extractedByStepId: Record<string, string> = {};

    for (const step of capability.steps) {
      if (step.risk === "irreversible" && !(options.allowIrreversible ?? false)) {
        return {
          status: "blocked",
          reason: "irreversible_not_allowed",
          stepId: step.id,
          completedStepIds: [...completedStepIds],
        };
      }

      const failure = await this.executeStep(step, inputs, extractedByStepId, completedStepIds, targetProfile);
      if (failure) return failure;
      completedStepIds.push(step.id);

      await this.dismissKnownInterstitials(targetProfile);

      for (const outcome of capability.businessOutcomes) {
        const evaluation = await evaluateCondition(this.surface, outcome.detector);
        if (!evaluation.holds) continue;

        let message: string | undefined;
        if (outcome.message) {
          const resolution = await this.surface.resolve(outcome.message.target);
          if (resolution.status === "resolved") {
            message = await this.surface.extractText(resolution.element);
          }
        }
        return {
          status: "business_outcome",
          code: outcome.code,
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
    inputs: Record<string, string | number>,
    extractedByStepId: Record<string, string>,
    completedStepIds: string[],
    targetProfile: TargetProfile
  ): Promise<StepFailure | null> {
    const action = step.action;

    try {
      switch (action.kind) {
        case "navigate": {
          const url = resolveValue(action.url, inputs);
          await this.surface.navigate(url, { timeoutMs: targetProfile.defaultTimeouts.navigationMs });
          return null;
        }
        case "click": {
          const resolved = await this.resolveOrFail(action.target, step, completedStepIds);
          if (!resolved.ok) return resolved.failure;
          await this.surface.click(resolved.element);
          return null;
        }
        case "fill": {
          const resolved = await this.resolveOrFail(action.target, step, completedStepIds);
          if (!resolved.ok) return resolved.failure;
          await this.surface.fill(resolved.element, resolveValue(action.value, inputs));
          return null;
        }
        case "select": {
          const resolved = await this.resolveOrFail(action.target, step, completedStepIds);
          if (!resolved.ok) return resolved.failure;
          await this.surface.selectOption(resolved.element, resolveValue(action.value, inputs));
          return null;
        }
        case "extract": {
          const resolved = await this.resolveOrFail(action.target, step, completedStepIds);
          if (!resolved.ok) return resolved.failure;
          extractedByStepId[step.id] = await this.surface.extractText(resolved.element);
          return null;
        }
        case "checkpoint": {
          const evaluation = await evaluateCondition(this.surface, action.condition);
          if (evaluation.holds) return null;
          return {
            status: "failure",
            errorCode: "CHECKPOINT_FAILED",
            failedStepId: step.id,
            expected: describeCondition(action.condition),
            observed: evaluation.observed,
            completedStepIds: [...completedStepIds],
          };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout = action.kind === "navigate" && /timeout/i.test(message);
      return {
        status: "failure",
        errorCode: isTimeout ? "LOAD_TIMEOUT" : "ACTION_FAILED",
        failedStepId: step.id,
        expected: `step "${step.id}" (${action.kind}) to succeed`,
        observed: message,
        detail: message,
        completedStepIds: [...completedStepIds],
      };
    }
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
   * Explicit, minimal seam for recoverable conditions (requirement 11):
   * mock-bank's TargetProfile declares no interstitials today, so this is a
   * no-op in practice, but the mechanism is real — a profile that did
   * declare one would have it dismissed here, once per step, before
   * business-outcome/checkpoint evaluation. Not a retry framework: each
   * declared interstitial is checked and dismissed at most once per step.
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
