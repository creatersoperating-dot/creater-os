# ADR-002 — Agent Framework

## Status

Proposed

---

## Date

2026-07-27

---

## Decision

CreatorOS is intended to evolve toward specialized AI agents with clearly defined responsibilities, context requirements, tools, and goals.

This is a proposed future architecture. It is not the active execution flow in the current committed implementation.

---

## Current Implementation

`scriptAgent.ts` currently exists and translates a script request into an `executeTask()` call using the script-writing capability.

Other agent files are incomplete or placeholders. They do not currently provide specialized execution behavior.

Current requests flow directly:

`executeTask()` → `executeBrain()`

There is no agent dispatcher, agent selection layer, workflow orchestrator, or implemented multi-agent workflow in the current architecture.

---

## Proposed Architecture

Future agents may include:

- Script Agent
- Research Agent
- Community Agent
- Strategy Agent
- SEO Agent
- Analytics Agent

If implemented, agents should use the shared task, context, prompt, router, and model boundaries rather than bypassing the existing AI Core flow.

---

## Motivation

As AI responsibilities grow, specialized agents may provide:

- More focused capability behavior
- More predictable outputs
- Independent testing and evolution
- Clear ownership of tools and goals

These benefits depend on implementing explicit agent contracts and orchestration.

---

## Consequences

If adopted, the framework will introduce:

- More specialized modules to maintain
- Agent dispatch and orchestration requirements
- Additional testing for agent boundaries and workflows

These trade-offs should be evaluated as concrete agent capabilities are implemented.

---

## Future Work

- Define a common agent contract
- Add agent dispatch without bypassing `executeTask()` and `executeBrain()`
- Implement currently empty agent placeholders
- Add publishing, customer support, business analysis, and finance agents as needed
- Design and test multi-agent workflows
