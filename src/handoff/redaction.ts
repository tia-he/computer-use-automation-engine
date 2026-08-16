const CREDIT_CARD_LIKE = /^\d{13,19}$/;
const SSN_LIKE = /^\d{3}-?\d{2}-?\d{4}$/;

/**
 * Mandatory pipeline step between capturing a human-entered value and
 * persisting it in a HumanActionEvent. mock-bank's current flow has no
 * password field or obvious PII input, so in practice this mostly passes
 * values through today — the point is that every captured value goes
 * through this function unconditionally, not that the heuristics are
 * exhaustive.
 */
export function redactValue(elementType: string, rawValue: string): string {
  if (elementType.toLowerCase() === "password") {
    return "[REDACTED]";
  }
  const stripped = rawValue.replace(/[\s-]/g, "");
  if (CREDIT_CARD_LIKE.test(stripped) || SSN_LIKE.test(rawValue)) {
    return "[REDACTED]";
  }
  return rawValue;
}
