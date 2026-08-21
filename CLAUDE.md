# Computer-Use Automation Engine

## Project Thesis

Discovery is probabilistic; execution is deterministic.

An LLM-driven agent discovers how to complete a task through a real UI once. That successful run compiles into a typed, versioned Capability artifact. The artifact replays deterministically — no model in the decision loop — against new inputs, returning structured success, business-outcome, or failure results.

See `README.md` for the pitch and `docs/architecture.md` for the design write-up (schema rationale, determinism, safety model, what was deliberately cut).

## Architecture Principles

- **`Surface` is the only thing that touches the automation technology.** Playwright lives entirely behind `src/surface/`. Nothing else imports it.
- **`LlmProvider` is the only thing that touches a model.** Anthropic lives entirely behind `src/discovery/anthropic-provider.ts`. `ReplayEngine` has no provider dependency — structurally, not just by convention: its constructor is `(surface, policy)`, with no parameter to pass one into.
- **The artifact schema (`src/artifact/`) depends on nothing else.** Not replay, not discovery, not guardrails. It's the stable contract both sides are built against.
- **Discovery and replay share safety machinery, not a safety story.** `GuardrailPolicy`, `ControlStateMachine`, and `InterventionRequest` are the same objects used by both `DiscoveryAgent` and `ReplayEngine`/`HandoffSession` — not two parallel implementations of "be careful."

## Implementation Boundaries

- Keep discovery (probabilistic, LLM-in-the-loop) and replay (deterministic, no LLM) structurally separate. If a change to replay would require importing anything from `src/discovery/`, stop — that's the wrong direction.
- Preserve deterministic execution as a hard property of replay, not just a goal: same artifact, same inputs, same steps, same outputs. Anything that would make replay depend on live model output breaks the thesis.
- Keep providers isolated behind `LlmProvider`. A new provider should never require changes to `DiscoveryAgent`, `GuardrailPolicy`, or anything downstream of discovery.
- Avoid adding infrastructure (queues, workers, multi-tenant plumbing, a second target app, CI/deployment tooling) without a concrete, present need. Design so the system *could* extend that way; don't build the extension speculatively.
- Prefer a small, correct, defensible system over a broad one. Cut features, not quality. Three similar lines beat a premature abstraction.

## Collaboration Instructions

Before a significant implementation change:
1. Explain the proposed design and the alternatives considered.
2. Explain the trade-offs, briefly.
3. Prefer the simplest design that satisfies the actual requirement.

Build incrementally. Keep each component understandable enough to explain and defend on its own in a technical conversation. When a design decision isn't obvious from the code, say why — in a comment, or in `docs/architecture.md` — not only in chat, which won't survive.
