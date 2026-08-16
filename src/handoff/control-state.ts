import { ControlState } from "./types";

const ALLOWED_TRANSITIONS: Record<ControlState, ControlState[]> = {
  AUTOMATION_CONTROL: ["HUMAN_CONTROL", "COMPLETED", "FAILED"],
  HUMAN_CONTROL: ["AUTOMATION_CONTROL", "FAILED"],
  COMPLETED: [],
  FAILED: [],
};

export class InvalidControlTransitionError extends Error {
  constructor(
    public readonly from: ControlState,
    public readonly to: ControlState
  ) {
    super(`invalid control-state transition: ${from} -> ${to}`);
    this.name = "InvalidControlTransitionError";
  }
}

export interface ControlTransitionRecord {
  from: ControlState;
  to: ControlState;
  at: string;
}

/**
 * Who currently owns the live session. A no-op "transition" to the current
 * state is treated as invalid too — callers must know what state they're
 * leaving, not just where they want to go.
 */
export class ControlStateMachine {
  private state: ControlState = "AUTOMATION_CONTROL";
  private readonly transitions: ControlTransitionRecord[] = [];

  get current(): ControlState {
    return this.state;
  }

  get history(): ReadonlyArray<ControlTransitionRecord> {
    return this.transitions;
  }

  transition(to: ControlState): void {
    if (!ALLOWED_TRANSITIONS[this.state].includes(to)) {
      throw new InvalidControlTransitionError(this.state, to);
    }
    this.transitions.push({ from: this.state, to, at: new Date().toISOString() });
    this.state = to;
  }
}
