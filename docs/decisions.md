# CreatorOS Engineering Decisions

This document records important architectural decisions made during development.

---

# Decision 001

Date
July 2026

Title

Provider Independent AI Architecture

Reason

CreatorOS should never depend on a single AI provider.

Decision

All AI requests go through

Chat
↓

Router

↓

Provider

instead of directly calling Gemini.

Benefits

- Easy provider switching
- Better testing
- Future OpenAI support
- Future Claude support
- Local model support

Status

Accepted

---

# Decision 002

Title

Brand-first Architecture

Decision

Every feature belongs to a Brand.

Examples

Brand
↓

Ideas

Scripts

Knowledge

Analytics

AI Memory

Reason

The brand is the central object of CreatorOS.

Status

Accepted

---

# Decision 003

Title

Services contain business logic

Decision

UI components never call Gemini directly.

Flow

UI

↓

API

↓

Services

↓

Providers

Reason

Keeps the UI simple.

Allows testing.

Makes future expansion easier.

Status

Accepted

---

# Decision 004

Title

Documentation First

Decision

Every completed milestone must update

README

Architecture

Roadmap

Changelog

Engineering Decisions

Reason

Documentation should evolve together with the software instead of being written at the end.

Status

Accepted