# CreatorOS Database Design

---

# Database Philosophy

CreatorOS is built around a hierarchical data model.

Everything belongs to a Workspace.

Within a Workspace there can be multiple Brands.

Each Brand contains its own channels, content, AI agents, assets, workflows, and knowledge.

This structure allows CreatorOS to support individual creators, agencies, startups, and enterprise organizations using the same architecture.

---

# Entity Hierarchy

Workspace
│
├── Users
│
├── Brands
│   │
│   ├── Channels
│   ├── AI Agents
│   ├── Knowledge Base
│   ├── Content
│   ├── Assets
│   ├── Workflows
│   ├── Products
│   └── Analytics
│
└── Settings

---

# Workspace

Represents an organization.

Examples:

- Individual Creator
- Agency
- Startup
- Enterprise

Fields

- id
- name
- slug
- logo
- ownerId
- timezone
- currency
- subscriptionPlan
- createdAt
- updatedAt

---

# User

Represents a person with access to one or more Workspaces.

Fields

- id
- name
- email
- avatar
- role
- status
- createdAt

---

# Brand

Represents a digital business or identity.

Fields

Basic Information

- id
- workspaceId
- name
- description
- logo
- status

Identity

- mission
- vision
- tagline
- story

Audience

- primaryLanguage
- targetCountry
- targetAudience
- ageGroup

Voice

- tone
- personality
- writingStyle
- readingLevel
- preferredWords[]
- forbiddenWords[]

Content Strategy

- niches[]
- contentPillars[]
- keywords[]

Business

- website
- companyName
- email
- timezone
- currency

Goals

- monthlyContentGoal
- monthlyRevenueGoal

Metadata

- createdAt
- updatedAt

---

# Channel

Represents a publishing destination.

Examples

- YouTube
- LinkedIn
- Instagram
- TikTok
- Blog
- Newsletter
- Podcast

Fields

- id
- brandId
- platform
- channelName
- handle
- url
- status
- createdAt

---

# AI Agent

Represents one specialized AI worker.

Examples

- CEO AI
- Research AI
- Script AI
- SEO AI
- Thumbnail AI
- Video AI
- Publisher AI
- Analytics AI

Fields

- id
- brandId
- name
- role
- model
- prompt
- tools[]
- memoryEnabled
- status

---

# Knowledge Base

Stores information shared by AI agents.

Examples

- PDFs
- URLs
- Notes
- Research
- FAQs
- SOPs

Fields

- id
- brandId
- title
- type
- source
- tags[]
- embeddingStatus
- createdAt

---

# Asset

Stores reusable media.

Examples

- Logos
- Fonts
- Images
- Videos
- Music
- Templates
- Brand Colors

Fields

- id
- brandId
- type
- fileName
- url
- tags[]
- uploadedAt

---

# Content

Represents every piece of content.

Fields

- id
- brandId
- type
- title
- description
- script
- thumbnail
- status
- scheduledDate
- publishedDate
- createdAt

---

# Workflow

Represents automated processes.

Examples

- Weekly YouTube Pipeline
- Daily LinkedIn Posts
- Newsletter Automation

Fields

- id
- brandId
- name
- trigger
- steps[]
- enabled
- lastRun
- nextRun

---

# Analytics

Stores performance metrics.

Fields

- id
- brandId
- platform
- impressions
- views
- watchTime
- engagement
- subscribers
- revenue
- recordedAt

---

# Relationships

Workspace

↓

Many Brands

↓

Many Channels

↓

Many Content Items

↓

Many Assets

↓

Many AI Agents

↓

Many Workflows

↓

Many Analytics Records

---

# Design Principles

- Workspace is the top-level container.
- Every Brand is independent.
- AI agents never own data.
- Knowledge is shared across all AI agents within a Brand.
- Assets are reusable.
- Content belongs to exactly one Brand.
- Channels belong to one Brand.
- Workflows coordinate AI agents instead of replacing them.