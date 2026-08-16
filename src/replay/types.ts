import { InterventionRequest } from "../handoff/types";

/**
 * Generic execution error codes. These are mechanical failures any
 * capability on any surface can hit — never declared by a Capability
 * artifact (see src/artifact/capability.ts's businessOutcomes, which are
 * capability-specific and deliberately disjoint from this list).
 *
 * LOCATOR_AMBIGUOUS is intentionally not included: Phase 2's resolve()
 * contract folds ambiguity into a "not_found" status (each strategy's
 * attempt records "ambiguous" vs "no_match", but there is no distinct
 * top-level "ambiguous" result to report) — so LOCATOR_NOT_FOUND already
 * covers it, with per-strategy detail preserved in `detail`.
 */
export type ExecutionErrorCode =
  | "LOCATOR_NOT_FOUND"
  | "LOAD_TIMEOUT"
  | "CHECKPOINT_FAILED"
  | "INVALID_INPUT"
  | "ACTION_FAILED"
  | "POLICY_DENIED";

export interface ReplaySuccessResult {
  status: "success";
  outputs: Record<string, string | number>;
  completedStepIds: string[];
}

export interface ReplayBusinessOutcomeResult {
  status: "business_outcome";
  code: string;
  message?: string;
  stepId: string;
  completedStepIds: string[];
}

export interface ReplayEscalatedResult {
  status: "escalated";
  interventionRequest: InterventionRequest;
  completedStepIds: string[];
}

export interface ReplayRejectedResult {
  status: "rejected";
  stepId: string;
  completedStepIds: string[];
}

export interface ReplayFailureResult {
  status: "failure";
  errorCode: ExecutionErrorCode;
  /** Absent only for INVALID_INPUT, which is detected before any step runs. */
  failedStepId?: string;
  expected: string;
  observed: string;
  detail?: string;
  completedStepIds: string[];
}

export type ReplayResult =
  | ReplaySuccessResult
  | ReplayBusinessOutcomeResult
  | ReplayEscalatedResult
  | ReplayRejectedResult
  | ReplayFailureResult;

export interface ReplayOptions {
  /** Identifies this run — carried onto any InterventionRequest it raises. */
  runId: string;
  /** Step ids explicitly approved (by an operator) for this run. */
  approvedStepIds?: string[];
  /** Skip steps up to and including this id — they already completed in a prior partial run. */
  resumeAfterStepId?: string;
}
