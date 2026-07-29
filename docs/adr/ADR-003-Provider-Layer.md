# ADR-003 — AI Provider Layer

## Status

Accepted

---

## Date

2026-07-27

---

## Decision

CreatorOS communicates with AI models through a common `runAI()` router. Application context, memory, and prompt construction remain above this boundary.

Model adapters receive only the final prompt and must not access brand data, session data, conversation memory, agents, or prompt builders.

---

## Current Implementation

The current provider layer includes:

- A common `runAI()` router that accepts a provider identifier and final prompt
- A prompt-only Gemini model adapter
- OpenAI and Anthropic placeholder model files that are not implemented

`executeBrain()` currently selects Gemini as the default provider when it calls `runAI()`. The router throws an explicit not-implemented error if OpenAI or Anthropic is selected.

The application cannot currently switch to OpenAI or Anthropic without implementing the corresponding adapters and provider configuration.

---

## Current Architecture

API Route

↓

`executeTask()`

↓

`executeBrain()`

↓

Context Engine

↓

Prompt Builder

↓

`runAI()` Router

↓

Gemini Model Adapter

---

## Motivation

Keeping model-specific SDK calls behind a common router:

- Prevents model adapters from accumulating business logic
- Gives the application a stable prompt-only model boundary
- Creates a clear location for future provider implementations
- Makes model integrations easier to test independently

---

## Consequences

Current benefits:

- Gemini SDK usage is isolated in its model adapter
- Brand context and conversation memory remain outside the model layer
- The router exposes a small provider-and-prompt request shape

Current limitations:

- Gemini is the only implemented provider
- Provider selection is hardcoded in `executeBrain()`
- Switching providers requires additional implementation

---

## Future Extensions

The Provider Layer may later support:

- Dynamic provider selection
- Automatic routing
- Provider fallbacks
- Cost optimization
- Model benchmarking
- Streaming optimization
- Rate-limit management
- Local inference models
