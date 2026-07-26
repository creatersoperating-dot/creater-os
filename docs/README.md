# CreatorOS

CreatorOS is an AI-powered operating system for content creators, businesses, and brands.

The platform allows users to create brands, manage channels, generate AI-powered content, automate workflows, and eventually coordinate multiple AI agents from a single dashboard.

---

# Current Features

- Brand Management
- AI Chat
- Gemini Integration
- AI Router
- Modular Provider Architecture
- Next.js 16
- TypeScript
- Tailwind CSS

---

# Tech Stack

Frontend
- Next.js 16
- React 19
- TypeScript
- Tailwind CSS

AI
- AI SDK
- Google Gemini

Backend
- Next.js Route Handlers

---

# Project Structure

frontend/
│
├── app/
├── components/
├── services/
├── docs/
├── public/
└── README.md

---

# AI Architecture

Chat UI
↓

/api/chat
↓

chatService

↓

AI Router

↓

AI Provider

↓

Gemini

---

# Environment Variables

Create a .env.local file.

GOOGLE_GENERATIVE_AI_API_KEY=YOUR_API_KEY

---

# Run

Install dependencies

npm install

Run development server

npm run dev

Open

http://localhost:3000

---

# Version

Current Version

v0.1

Status

Development