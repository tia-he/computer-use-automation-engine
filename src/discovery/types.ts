import { LogicalLocator } from "../locator/types";
import { RiskLevel } from "../artifact/capability";
import { InterventionRequest } from "../handoff/types";

export interface DiscoveryEvent {
  step: number;
  observationSummary: string;
  action: { tool: string; input: Record<string, unknown> };
  targetDescription?: string;
  result: "ok" | "policy_denied" | "resolution_failed" | "invalid_input" | "error";
  resultDetail?: string;
  /** Short, model-provided summary only — never the full chain-of-thought, and never copied into a Capability. */
  reasoningSummary?: string;
  timestamp: string;
}

/**
 * What the Recorder consumes. Deliberately mirrors StepAction (minus
 * "checkpoint", which is log-only) and deliberately has no field for model
 * reasoning — that's a structural guarantee raw evidence can't leak into
 * the compiled artifact, not just a convention.
 */
export type RecordedAction =
  | { kind: "navigate"; url: string; risk: RiskLevel }
  | { kind: "click"; target: LogicalLocator; risk: RiskLevel }
  | { kind: "fill"; target: LogicalLocator; value: string; risk: RiskLevel }
  | { kind: "select"; target: LogicalLocator; value: string; risk: RiskLevel }
  | { kind: "extract"; target: LogicalLocator; outputName: string; risk: RiskLevel };

export interface DiscoverySuccessResult {
  status: "success";
  transcript: DiscoveryEvent[];
  recordedActions: RecordedAction[];
  summary: string;
}

export interface DiscoveryEscalatedResult {
  status: "escalated";
  transcript: DiscoveryEvent[];
  recordedActions: RecordedAction[];
  interventionRequest: InterventionRequest;
}

export interface DiscoveryRejectedResult {
  status: "rejected";
  transcript: DiscoveryEvent[];
  recordedActions: RecordedAction[];
}

export interface DiscoveryStoppedResult {
  status: "max_steps_exceeded" | "timeout" | "no_progress" | "policy_blocked";
  transcript: DiscoveryEvent[];
  recordedActions: RecordedAction[];
}

export type DiscoveryResult =
  | DiscoverySuccessResult
  | DiscoveryEscalatedResult
  | DiscoveryRejectedResult
  | DiscoveryStoppedResult;

export interface DiscoveryOptions {
  maxSteps?: number;
  timeoutMs?: number;
  /** Called after each transcript entry is recorded — evidence-writing hook, not used internally. */
  onStep?: (event: DiscoveryEvent) => void | Promise<void>;
}
