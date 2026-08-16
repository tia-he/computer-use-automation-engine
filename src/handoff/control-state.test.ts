import { describe, expect, it } from "vitest";
import { ControlStateMachine, InvalidControlTransitionError } from "./control-state";

describe("ControlStateMachine", () => {
  it("follows the escalate -> approve -> complete happy path", () => {
    const machine = new ControlStateMachine();
    expect(machine.current).toBe("AUTOMATION_CONTROL");

    machine.transition("HUMAN_CONTROL");
    expect(machine.current).toBe("HUMAN_CONTROL");

    machine.transition("AUTOMATION_CONTROL");
    expect(machine.current).toBe("AUTOMATION_CONTROL");

    machine.transition("COMPLETED");
    expect(machine.current).toBe("COMPLETED");
    expect(machine.history).toHaveLength(3);
  });

  it("allows HUMAN_CONTROL -> FAILED (reject)", () => {
    const machine = new ControlStateMachine();
    machine.transition("HUMAN_CONTROL");
    machine.transition("FAILED");
    expect(machine.current).toBe("FAILED");
  });

  it("rejects an invalid transition (COMPLETED is terminal)", () => {
    const machine = new ControlStateMachine();
    machine.transition("COMPLETED");
    expect(() => machine.transition("HUMAN_CONTROL")).toThrow(InvalidControlTransitionError);
  });

  it("rejects a direct AUTOMATION_CONTROL -> AUTOMATION_CONTROL no-op", () => {
    const machine = new ControlStateMachine();
    expect(() => machine.transition("AUTOMATION_CONTROL")).toThrow(InvalidControlTransitionError);
  });

  it("rejects skipping HUMAN_CONTROL to go straight from FAILED to COMPLETED", () => {
    const machine = new ControlStateMachine();
    machine.transition("FAILED");
    expect(() => machine.transition("COMPLETED")).toThrow(InvalidControlTransitionError);
  });
});
