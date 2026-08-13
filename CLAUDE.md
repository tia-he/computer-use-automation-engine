# Computer-Use Automation Engine

## Project Context

This project is a take-home engineering assignment for a Software Engineer role at interface.ai, but it should also be developed as a standalone portfolio-quality software engineering project.

The goal is to build a computer-use automation system that allows an LLM to discover how to complete a task through a real user interface, records the successful interaction as a reusable structured capability, and later replays that capability deterministically without an LLM in the decision loop.

The original assignment is available at:

`docs/assignment.pdf`

Treat the assignment as the source of truth for requirements.

## Core System Flow

The intended end-to-end flow is:

Natural-language goal
→ LLM-driven UI discovery
→ successful execution
→ structured capability artifact
→ deterministic replay with new input parameters
→ structured outputs or errors

The system must also support safety guardrails, observability, and human-in-the-loop escalation.

## Core Requirements

The implementation should cover:

1. Goal-driven LLM agent loop
2. Real UI interaction
3. Typed and versioned capability artifact
4. Deterministic replay without LLM decisions
5. Structured runtime error handling
6. Safety and policy guardrails
7. Evidence and observability
8. Human-in-the-loop escalation and session handoff

The architecture should also explain how the system could extend to heterogeneous surfaces and multi-tenant environments, although those do not need to be fully implemented.

## Engineering Priorities

Prioritize:

1. Clear system architecture
2. Strong artifact schema
3. Deterministic and debuggable replay
4. Explicit error taxonomy
5. Clean separation between discovery and execution
6. Real but minimal human handoff
7. Safety and sensitive-data handling
8. Readable, typed, testable code

Prefer a small, correct end-to-end system over a broad or over-engineered implementation.

## Portfolio Goal

Although this originated as a hiring assignment, the repository should look like a standalone engineering project.

Avoid unnecessarily branding implementation files, README content, package names, or architecture around interface.ai.

The project should demonstrate:

- backend/system design
- LLM agent engineering
- browser/computer-use automation
- deterministic workflow execution
- reliability and error handling
- human-in-the-loop system design
- production-oriented AI engineering

## Collaboration Instructions

Before implementing a major architectural decision:

1. Explain the proposed design.
2. Explain important alternatives.
3. Explain the trade-offs.
4. Prefer the simplest design that satisfies the assignment.
5. Avoid adding infrastructure or abstractions without a concrete reason.

Do not blindly generate large amounts of code.

Build the project incrementally and keep each component understandable enough that I can explain and defend it in a technical interview.

When making significant implementation decisions, update relevant documentation so the reasoning is preserved.