# ADR-001 — Context Engine

## Status

Accepted

---

## Date

2026-07-27

---

## Decision

CreatorOS uses a centralized Context Engine to assemble application context before a final prompt is sent through the AI router to a model adapter.

Model adapters must not directly access memory, brand data, session data, prompt builders, or other business logic. They receive only the final prompt produced above the model layer.

---

## Current Implementation

The current `buildContext()` implementation provides:

- Brand context from the task request
- The requested capability
- The session ID
- A snapshot of the existing conversation history for that session

`executeBrain()` builds this context before the current user message is added to memory. The Prompt Builder then combines the context, brand voice, previous conversation, capability instructions, and current request into one final prompt.

Conversation persistence is handled by `executeBrain()` above the router and model layer. It stores the current user message before calling `runAI()` and stores the completed assistant response when generation finishes.

---

## Motivation

Without a Context Engine:

- Model adapters become coupled to business logic.
- Each adapter may need its own memory and context handling.
- Prompt generation becomes duplicated.
- Adding context sources requires modifying multiple model integrations.

The Context Engine centralizes context assembly while keeping prompt construction and model execution in their dedicated layers.

---

## Consequences

Benefits:

- One typed boundary for currently available AI context
- Model adapters remain independent of brand and memory logic
- Prompt construction can use the same context across capabilities
- Context sources can be extended without changing model adapters

Trade-offs:

- Additional application-layer abstractions
- The current in-memory conversation store is process-local

---

## Future Extensions

The Context Engine may later include:

- Knowledge retrieval
- Active campaign context
- Analytics
- Uploaded assets
- Agent configuration
- User preferences
