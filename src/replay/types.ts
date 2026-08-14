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
  | "ACTION_FAILED";

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

export interface ReplayBlockedResult {
  status: "blocked";
  reason: "irreversible_not_allowed";
  stepId: string;
  completedStepIds: string[];
}

export type ReplayResult =
  | ReplaySuccessResult
  | ReplayBusinessOutcomeResult
  | ReplayFailureResult
  | ReplayBlockedResult;

export interface ReplayOptions {
  /**
   * Full guardrail/approval workflow is a later phase. This is the entire
   * Phase 4 seam: irreversible steps never run unless this is explicitly
   * true. Defaults to false — replay never silently mutates state.
   */
  allowIrreversible?: boolean;
}
