import { Brand } from "@/types/brand";

export const defaultBrand: Brand = {
  // Identity
  id: "",
  name: "",
  tagline: "",
  description: "",
  logo: "",
  website: "",

  // Audience
  primaryPlatform: "YouTube",
  language: "English",
  targetCountry: "Global",
  targetAudience: "",
  ageGroup: "",
  experienceLevel: "",

  // Strategy
  primaryNiche: "",
  subNiche: "",
  contentPillars: [],
  keywords: [],
  competitors: [],
  uniqueValueProposition: "",

  // Content
  postingFrequency: "",
  preferredFormats: [],
  contentGoals: [],
  contentStyle: "",

  // Brand Voice
  tone: "",
  personality: "",
  writingStyle: "",
  preferredWords: [],
  forbiddenWords: [],
  emojiStyle: "",

  // Business
  monetizationGoal: "",
  revenueStreams: [],
  targetSubscribers: 0,
  targetRevenue: 0,

  // AI Knowledge
  mission: "",
  vision: "",
  coreValues: [],
  thingsToAvoid: [],
  brandRules: [],
  importantContext: "",

  // Metadata
  status: "Draft",
  createdAt: "",
  updatedAt: "",
};