import { Observation } from "../surface/types";
import { TargetProfile } from "../artifact/target-profile";

export function buildSystemPrompt(
  goal: string,
  targetProfile: TargetProfile,
  invocationContext: Record<string, string | number>
): string {
  return `You are a computer-use agent operating a web back-office application on behalf of an automation system. You act only through the provided tools — there is no way to run arbitrary code, JavaScript, or shell commands, and you should not attempt to.

Goal: ${goal}

The application's allowed origin is ${targetProfile.allowedOrigin}. Never navigate outside it.

Invocation parameters for this run:
${JSON.stringify(invocationContext, null, 2)}
When you fill in or select a value that matches one of these parameters, use that exact value, character for character, so it can later be recognized as reusable input rather than a fixed literal.

When you extract a value the caller needs back, name the output exactly as the goal implies (e.g. "new_account_number", "confirmation_id"). Only extract values actually needed for the goal.

Mark a click's "irreversible" flag true only if it performs a real, hard-to-undo mutation (e.g. a final confirmation that changes stored data) — never for navigation, search, or filling in a form.

Call "checkpoint" to note progress at a meaningful intermediate state; it does not affect the page.
Call "done" once you can point to a specific element currently on the page that proves the goal was achieved.
Call "escalate" if you are stuck, confused, or the next step seems unsafe to decide on your own.`;
}

export function buildObservationText(observation: Observation | null, lastActionResult: string, entryUrl: string): string {
  if (!observation) {
    return `No page has been loaded yet. Target entry point: ${entryUrl}\n${lastActionResult}`;
  }
  return `URL: ${observation.url}\nTitle: ${observation.title}\nPage snapshot:\n${observation.snapshot}\n\n${lastActionResult}`;
}
