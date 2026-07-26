# CreatorOS Architecture

Version: v0.1

---

# High Level Overview

CreatorOS is an AI Operating System built using Next.js.

The application is divided into four major layers.

```
UI
↓

API

↓

Services

↓

AI Providers
```

---

# Folder Structure

```
frontend/

app/
components/
services/
docs/
public/
```

---

# UI Layer

Responsible for everything the user sees.

Current components

```
ChatWindow
ChatInput
ChatMessage
TypingIndicator
```

Responsibilities

- Render chat messages
- Accept user input
- Show typing state
- Display AI responses

---

# API Layer

Current endpoint

```
POST /api/chat
```

Responsibilities

- Receive chat requests
- Validate input
- Call AI services
- Return streamed responses

---

# Service Layer

Current files

```
chatService.ts

router.ts

providers/
    gemini.ts
```

Responsibilities

- Keep AI logic outside UI
- Support multiple AI providers
- Centralize AI routing

---

# AI Provider Layer

Current provider

```
Google Gemini
```

Future providers

```
OpenAI

Anthropic

xAI

Local Models
```

---

# Current Request Flow

```
User

↓

ChatWindow

↓

POST /api/chat

↓

chatService

↓

AI Router

↓

Gemini Provider

↓

Google API

↓

Response

↓

Browser
```

---

# Design Principles

- Modular
- Provider Independent
- Easily Extendable
- Type Safe
- Server-first AI Architecture

---

# Planned Expansion

Upcoming modules

- Brand Context
- Conversation Memory
- AI Agents
- Knowledge Base
- Prompt Library
- Content Studio
- Image Generation
- Analytics
- Scheduling
- Team Collaboration