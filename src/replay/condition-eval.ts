import { Surface } from "../surface/types";
import { Condition } from "../artifact/condition";

export interface ConditionEvaluation {
  holds: boolean;
  observed: string;
}

/**
 * Shared by checkpoint steps, the top-level successCheckpoint, and business
 * outcome detectors — one evaluation path for "detect this state."
 */
export async function evaluateCondition(surface: Surface, condition: Condition): Promise<ConditionEvaluation> {
  if (condition.kind === "url_matches") {
    const observation = await surface.perceive();
    const holds = new RegExp(condition.pattern).test(observation.url);
    return { holds, observed: `url "${observation.url}"` };
  }

  const resolution = await surface.resolve(condition.target);
  if (resolution.status === "resolved") {
    return { holds: true, observed: "element resolved" };
  }
  const outcomes = resolution.attempts.map((a) => `${a.strategy.kind}:${a.outcome}`).join(", ") || "no strategies";
  return { holds: false, observed: `element not found (${outcomes})` };
}

export function describeCondition(condition: Condition): string {
  if (condition.kind === "url_matches") {
    return `url matches /${condition.pattern}/`;
  }
  return `element visible (${condition.target.description ?? JSON.stringify(condition.target.strategies[0])})`;
}
