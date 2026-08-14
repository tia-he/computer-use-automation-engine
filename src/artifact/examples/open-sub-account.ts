import { Capability } from "../capability";

/**
 * Hand-authored for Phase 3 (schema design), ahead of the discovery agent
 * (a later phase) that will eventually produce artifacts like this one from
 * a live run. Every LogicalLocator here is written the same way Phase 2's
 * PlaywrightBrowserSurface.describe() would generate it, and is verified
 * against the running mock-bank app in open-sub-account.live.test.ts.
 */
export const openSubAccountCapability: Capability = {
  id: "open-sub-account",
  schemaVersion: 1,
  capabilityVersion: "1.0.0",
  description:
    "Search for a member, open a new sub-account, and reach the confirmation screen with the new account number and confirmation ID.",
  targetProfileId: "mock-bank",
  provenance: {
    discoveryRunId: "manual-phase-3-authoring",
    recordedAt: "2026-08-14T00:00:00.000Z",
    model: "hand-authored (pre-discovery)",
  },
  approval: "draft",
  inputs: {
    member_id: {
      type: "string",
      required: true,
      description: "Member ID to search for.",
      minLength: 1,
    },
    account_type: {
      type: "enum",
      required: true,
      description: "Type of sub-account to open.",
      values: ["savings", "checking"],
    },
    initial_deposit: {
      type: "number",
      required: true,
      description: "Initial deposit amount in USD.",
      // Deliberately no `min` here: the $25 minimum is the target app's own
      // business rule, already modeled as the VALIDATION_ERROR business
      // outcome below. Duplicating it as an input constraint would make
      // that outcome unreachable (engine-level INVALID_INPUT would always
      // fire first) and would mean the same rule living, and potentially
      // drifting, in two places.
    },
  },
  outputs: {
    new_account_number: {
      type: "string",
      sourceStepId: "extract-account-number",
      description: "The newly created account's number.",
    },
    confirmation_id: {
      type: "string",
      sourceStepId: "extract-confirmation-id",
      description: "Confirmation identifier for the transaction.",
    },
  },
  steps: [
    {
      id: "navigate-to-search",
      risk: "safe",
      action: { kind: "navigate", url: { kind: "literal", value: "http://localhost:4100/" } },
    },
    {
      id: "fill-member-id",
      risk: "safe",
      action: {
        kind: "fill",
        // The search field is a bare <input> with no aria-label and no
        // <label>, so the only reliable strategy is its `name` attribute.
        target: { strategies: [{ kind: "attribute", attribute: "name", value: "memberId" }] },
        value: { kind: "input_ref", name: "member_id" },
      },
    },
    {
      id: "click-search",
      risk: "safe",
      action: {
        kind: "click",
        target: { strategies: [{ kind: "role", role: "button", name: "Search" }] },
      },
    },
    {
      id: "checkpoint-member-detail-loaded",
      risk: "safe",
      description: "Confirms the search redirected to a canonical member page (not a POST re-render).",
      action: {
        kind: "checkpoint",
        condition: { kind: "url_matches", pattern: "^https?://[^/]+/members/[^/?]+$" },
      },
    },
    {
      id: "click-open-sub-account",
      risk: "safe",
      action: {
        kind: "click",
        target: { strategies: [{ kind: "role", role: "link", name: "Open Sub-Account" }] },
      },
    },
    {
      id: "select-account-type",
      risk: "safe",
      action: {
        kind: "select",
        target: { strategies: [{ kind: "attribute", attribute: "name", value: "accountType" }] },
        value: { kind: "input_ref", name: "account_type" },
      },
    },
    {
      id: "fill-initial-deposit",
      risk: "safe",
      action: {
        kind: "fill",
        target: { strategies: [{ kind: "attribute", attribute: "name", value: "initialDeposit" }] },
        value: { kind: "input_ref", name: "initial_deposit" },
      },
    },
    {
      id: "click-continue",
      risk: "safe",
      action: {
        kind: "click",
        target: { strategies: [{ kind: "role", role: "button", name: "Continue" }] },
      },
    },
    {
      id: "click-confirm",
      risk: "irreversible",
      description: "Mutates mock-bank state: actually creates the new account. Requires approval to replay unattended.",
      action: {
        kind: "click",
        target: { strategies: [{ kind: "role", role: "button", name: "Confirm & Open Account" }] },
      },
    },
    {
      id: "extract-account-number",
      risk: "safe",
      action: {
        kind: "extract",
        // The value cell has no attribute of its own; scope on its static
        // label cell and take the next sibling <td> (standard CSS combinator,
        // not a Playwright-specific pseudo-class).
        target: {
          strategies: [
            {
              kind: "css",
              selector: "+ td",
              scope: { kind: "text", text: "New Account Number", exact: true },
            },
          ],
        },
      },
    },
    {
      id: "extract-confirmation-id",
      risk: "safe",
      action: {
        kind: "extract",
        target: {
          strategies: [
            {
              kind: "css",
              selector: "+ td",
              scope: { kind: "text", text: "Confirmation ID", exact: true },
            },
          ],
        },
      },
    },
  ],
  businessOutcomes: [
    {
      code: "MEMBER_NOT_FOUND",
      classification: "business_outcome",
      // Substring match on the static portion of the message; the full text
      // includes the searched member id, which this detector can't know in
      // advance.
      detector: {
        kind: "element_visible",
        target: { strategies: [{ kind: "text", text: "No member found for ID", exact: false }] },
      },
      message: {
        target: { strategies: [{ kind: "text", text: "No member found for ID", exact: false }] },
      },
    },
    {
      code: "ACCOUNT_NOT_ELIGIBLE",
      classification: "business_outcome",
      detector: {
        kind: "element_visible",
        target: {
          strategies: [{ kind: "text", text: "is not eligible to open new accounts", exact: false }],
        },
      },
      message: {
        target: {
          strategies: [{ kind: "text", text: "is not eligible to open new accounts", exact: false }],
        },
      },
    },
    {
      code: "VALIDATION_ERROR",
      classification: "business_outcome",
      detector: {
        kind: "element_visible",
        target: {
          strategies: [
            { kind: "text", text: "Initial deposit must be a number of at least", exact: false },
          ],
        },
      },
      message: {
        target: {
          strategies: [
            { kind: "text", text: "Initial deposit must be a number of at least", exact: false },
          ],
        },
      },
    },
  ],
  successCheckpoint: {
    kind: "element_visible",
    target: { strategies: [{ kind: "role", role: "heading", name: "Account Opened" }] },
  },
};
