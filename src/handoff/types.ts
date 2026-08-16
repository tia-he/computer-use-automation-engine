export type ControlState = "AUTOMATION_CONTROL" | "HUMAN_CONTROL" | "COMPLETED" | "FAILED";

export interface InterventionRequest {
  id: string;
  reason: "APPROVAL_REQUIRED" | "STUCK";
  runId: string;
  capabilityId: string;
  stepId: string;
  explanation: string;
  url: string;
  /** Relative path under evidence/, if a screenshot could be captured. */
  screenshotRef?: string;
  createdAt: string;
}

export interface HumanActionEvent {
  type: "click" | "input" | "change" | "navigation";
  /** Best-effort description of the interacted element (tag/attribute), not a full LogicalLocator. */
  targetDescription?: string;
  /** Already passed through the redaction layer before this object exists. */
  value?: string;
  url: string;
  timestamp: string;
}
