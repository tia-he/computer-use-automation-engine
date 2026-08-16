import { Surface } from "../surface/types";
import { ReplayEngine } from "../replay/engine";
import { ReplayResult } from "../replay/types";
import { Capability } from "../artifact/capability";
import { TargetProfile } from "../artifact/target-profile";
import { ControlStateMachine } from "./control-state";
import { HumanActionEvent, InterventionRequest } from "./types";

interface RunContext {
  capability: Capability;
  targetProfile: TargetProfile;
  inputs: Record<string, unknown>;
  approvedStepIds: string[];
}

/**
 * Orchestrates one run's escalate/approve/reject/resume lifecycle around a
 * single ReplayEngine + Surface pair. Owns the ControlStateMachine and the
 * currently-pending InterventionRequest (if any) so a caller — a CLI, an
 * HTTP handler, a test — can inspect and resolve it across separate calls
 * while the underlying browser session stays open and untouched.
 */
export class HandoffSession {
  readonly controlState = new ControlStateMachine();

  private pending?: InterventionRequest;
  private runContext?: RunContext;
  private lastCompletedStepIds: string[] = [];
  private humanActionEvents: HumanActionEvent[] = [];

  constructor(
    private readonly surface: Surface,
    private readonly engine: ReplayEngine,
    private readonly runId: string
  ) {}

  get pendingIntervention(): InterventionRequest | undefined {
    return this.pending;
  }

  get humanActions(): ReadonlyArray<HumanActionEvent> {
    return this.humanActionEvents;
  }

  async run(
    capability: Capability,
    targetProfile: TargetProfile,
    inputs: Record<string, unknown>
  ): Promise<ReplayResult> {
    this.runContext = { capability, targetProfile, inputs, approvedStepIds: [] };
    const result = await this.engine.replay(capability, targetProfile, inputs, { runId: this.runId });
    return this.handle(result);
  }

  async approve(interventionId: string): Promise<ReplayResult> {
    this.assertPending(interventionId);
    const ctx = this.runContext!;
    const stepId = this.pending!.stepId;

    await this.surface.stopHumanActionRecording();
    this.controlState.transition("AUTOMATION_CONTROL");
    ctx.approvedStepIds.push(stepId);
    const resumeAfterStepId = this.lastCompletedStepIds.at(-1);
    this.pending = undefined;

    const result = await this.engine.replay(ctx.capability, ctx.targetProfile, ctx.inputs, {
      runId: this.runId,
      approvedStepIds: [...ctx.approvedStepIds],
      resumeAfterStepId,
    });
    return this.handle(result);
  }

  async reject(interventionId: string): Promise<ReplayResult> {
    this.assertPending(interventionId);
    const stepId = this.pending!.stepId;

    await this.surface.stopHumanActionRecording();
    this.controlState.transition("FAILED");
    this.pending = undefined;

    return { status: "rejected", stepId, completedStepIds: this.lastCompletedStepIds };
  }

  private async handle(result: ReplayResult): Promise<ReplayResult> {
    this.lastCompletedStepIds = result.completedStepIds;

    if (result.status === "escalated") {
      this.pending = result.interventionRequest;
      this.controlState.transition("HUMAN_CONTROL");
      this.humanActionEvents = [];
      await this.surface.startHumanActionRecording((event) => this.humanActionEvents.push(event));
    } else if (result.status === "success" || result.status === "business_outcome") {
      this.controlState.transition("COMPLETED");
    } else if (result.status === "failure") {
      this.controlState.transition("FAILED");
    }

    return result;
  }

  private assertPending(interventionId: string): void {
    if (!this.pending || this.pending.id !== interventionId) {
      throw new Error(`no pending intervention with id "${interventionId}"`);
    }
  }
}
