# Architecture

This is the design write-up behind the README's pitch: why the pieces are shaped the way they are, and what was deliberately left out.

## 1. System overview

```
goal → DiscoveryAgent (LlmProvider + Surface + GuardrailPolicy) → Recorder
     → Capability artifact (Zod, versioned, on disk)
     → ReplayEngine (Surface + GuardrailPolicy, no LlmProvider) → structured result
```

Two engines sit on top of one `Surface` implementation (`PlaywrightBrowserSurface`) and share one guardrail/escalation layer, but never share a decision-making dependency: `DiscoveryAgent` calls an `LlmProvider` for every action; `ReplayEngine`'s constructor — `(surface, policy)` — has no parameter to accept one. That's the one property the whole system exists to guarantee, so it's enforced at the type level, not just by discipline. A test in `src/discovery/demo-flow.test.ts` also greps `src/replay/engine.ts` and `src/handoff/session.ts` for any provider reference as a second, independent check.

## 2. The Capability artifact

A `Capability` (`src/artifact/capability.ts`, Zod) is the contract between discovery and replay. It's intentionally a plain data schema with zero dependency on how it's produced or consumed:

- **`inputs`/`outputs`** — typed declarations (`string` / `number` / `enum`, with constraints), not inferred at replay time.
- **`steps`** — ordered actions (`navigate` / `click` / `fill` / `select` / `extract` / `checkpoint`), each carrying a `LogicalLocator` and a `risk` (`safe` / `risky` / `irreversible`).
- **Typed value references, not template strings.** A filled-in value is either `{kind:"literal", value}` or `{kind:"input_ref", name}` — never an interpolated string, never anything `eval`-adjacent. The `Recorder` decides between them by exact string match against the run's invocation context; no fuzzy or semantic inference.
- **`businessOutcomes`** — capability-specific, declarative detectors (e.g. `MEMBER_NOT_FOUND`) kept structurally separate from the engine's generic execution errors (`LOCATOR_NOT_FOUND`, `CHECKPOINT_FAILED`, `POLICY_DENIED`, …). Conflating "no such member" with a crash is the most common design mistake in this space, so the schema makes it impossible to accidentally declare a generic failure as a business outcome, or vice versa.
- **`successCheckpoint`** — the final condition that must hold before a run counts as successful.
- **`provenance`/`approval`** — where a run came from and whether it's been reviewed (`draft` → `approved`). Every discovered artifact starts `draft`.

### What's discovered vs. templated

`Recorder.compileCapability()` (`src/discovery/recorder.ts`) takes the live run's recorded actions and a template capability. Only `inputs`, `businessOutcomes`, `successCheckpoint`, and output *declarations* (name/type, not their `sourceStepId`) come from the template — they describe the target app's contract, not the path taken to exercise it, so reusing them across runs is correct rather than lazy. Every `step`, every `LogicalLocator`, and the remapped `sourceStepId` for each output come only from what the live run actually did.

## 3. Determinism and the error taxonomy

Replay is deterministic because every branch point is data, not inference: a fixed step order, a fixed-priority locator fallback chain, and a declarative `errorSignatures`-style table (business outcomes) evaluated in a fixed order after each step. Results are a discriminated union — `success` / `business_outcome` / `escalated` / `rejected` / `failure` — so a caller can never confuse "the business told me no" with "something broke."

Generic execution failures are deliberately *not* part of the artifact schema: `LOCATOR_NOT_FOUND`, `LOAD_TIMEOUT`, `CHECKPOINT_FAILED`, `INVALID_INPUT`, `ACTION_FAILED`, `POLICY_DENIED` are mechanical conditions any capability on any surface can hit, owned by `ReplayEngine` itself. One omission worth naming: there's no `LOCATOR_AMBIGUOUS` code, because the resolver never surfaces ambiguity as a distinct terminal status — it's folded into `not_found` (with per-strategy detail preserved), so a separate code would have no real trigger.

## 4. Locator strategy

A `LogicalLocator` is an ordered list of strategies — `role` (accessibility role + name) → `label` → `text` → `attribute` → scoped `css` — resolved by trying each in order until exactly one element matches. Ambiguous or absent matches fall through to the next strategy; if all fail, resolution returns a structured failure with the full attempt trail, never a guess.

`Surface.describe()` reverse-generates this same ranked chain from a live element, so a discovered artifact's locators look like what a careful human would have written by hand: role/name where available, an attribute fallback for a bare `<input>` with no accessible name, and — for a value next to a static label (e.g. a table cell showing a freshly-generated account number) — a scoped selector anchored on the label's own text (`+ td` off `"New Account Number"`), rather than a fragile absolute path. This exact scenario is why role/text-based locators were chosen over screenshot-and-coordinates: coordinates drift with viewport and DOM changes; a ranked semantic fallback chain degrades gracefully instead.

## 5. Safety and guardrails

`GuardrailPolicy` (`src/guardrails/policy.ts`) is checked before *every* action — discovery and replay alike — not only when an artifact is authored. It enforces an allowed-origin list, an allowed-action-kind list, and one risk rule: an `irreversible` step is denied outright unless it's been explicitly approved for that specific run. There is no generic "bypass" flag; approval is a first-class, auditable event (an `InterventionRequest`), not a boolean someone can flip.

Sensitive values are never assumed safe: anything a human types during a handoff passes through a redaction filter (password fields, and pattern-matched values that look like a card or SSN) before it's persisted anywhere.

## 6. Human handoff and control state

An explicit state machine — `AUTOMATION_CONTROL → HUMAN_CONTROL → (AUTOMATION_CONTROL | FAILED)`, with `COMPLETED`/`FAILED` terminal — tracks who owns the live session, with every transition validated (an invalid one throws rather than silently succeeding). When a step needs approval, the engine builds an `InterventionRequest` (reason, step, a screenshot, timestamp) *before* acting, hands control to `HUMAN_CONTROL`, and waits — the same mechanism whether the pause happens during discovery (`DiscoveryAgent.approveAndContinue`/`.reject`) or replay (`HandoffSession.approve`/`.reject`). On resume, the engine re-observes the live page rather than assuming it's unchanged, because every step already re-resolves its locator fresh — nothing about resuming required a special case.

While `HUMAN_CONTROL` owns the session, best-effort click/input/change/navigation events are captured directly from the live page (via injected listeners, not polling) into structured `HumanActionEvent` records, redacted the same way.

**What's mocked, deliberately:** a minimal HTTP control endpoint (`GET /pending`, `POST /approve|reject/:id`) over `HandoffSession` was prototyped as a stand-in for a real remote operator console, then removed — it had no caller anywhere in the shipped system and would have been unused code kept only for its own sake. The control-transfer *model* above is real and tested; a network transport for a genuinely remote operator is the natural next increment, not yet built.

## 7. Extending beyond one browser surface

The system is implemented against one concrete surface (a deliberately legacy-styled server-rendered web app: table layouts, no test IDs, no clean accessible names on several controls) but the seam for more is already where it needs to be: `Surface` defines *perceive/resolve/act*, and `PlaywrightBrowserSurface` is the only thing that knows those verbs mean Playwright calls. A desktop/native surface would implement the same interface against OS accessibility APIs; `LogicalLocator`'s `role`/`label`/`text` strategies map directly (a desktop surface would just return `count: 0` for the `css` strategy, letting the ranked fallback chain skip it naturally — no special-casing needed in the shared resolver).

Multi-tenant reuse — hundreds of institutions running the same vendor product, differently configured — wasn't built, but has a credible shape: `TargetProfile` already separates app-level shared behavior (allowed origin, timeouts, session/interstitial detectors) from any one capability, which is exactly the layer a per-tenant override would live at. A capability recorded on one tenant's instance would need its concrete routes/values canonicalized into parameters (`/member/12345` → `/member/:id`) to be reused elsewhere — not implemented, but it's a transform over the existing artifact shape, not a new one.

## 8. What was cut, and why

Deliberately not built, in each case because it would have added infrastructure or surface area without a concrete need this project actually has:

- **Retries / self-healing locators.** The fallback chain already absorbs the realistic failure mode (a control has no accessible name); auto-repairing a broken locator at replay time is a different, much larger problem.
- **Multi-tenant plumbing, a second target app, queues/workers, CI/deployment tooling.** The abstractions (`Surface`, `TargetProfile`) are shaped to support these; building the infrastructure itself wasn't needed to prove the thesis.
- **A full operator dashboard.** See §6 — the control-transfer model is real, the transport is intentionally a stub.
- **Confidence scoring / cross-tenant canonicalization / generated test code from an artifact.** Reasonable extensions, each a project of its own; left out to keep the shipped system small enough to defend in full, not partially.
