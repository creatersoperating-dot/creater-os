export type Platform =
  | "YouTube"
  | "Instagram"
  | "TikTok"
  | "LinkedIn"
  | "X"
  | "Facebook";

export type BrandStatus =
  | "Draft"
  | "Active"
  | "Archived";

export interface Brand {
  // Identity
  id: string;
  name: string;
  tagline: string;
  description: string;
  logo?: string;
  website?: string;

  // Audience
  primaryPlatform: Platform;
  language: string;
  targetCountry: string;
  targetAudience: string;
  ageGroup: string;
  experienceLevel: string;

  // Strategy
  primaryNiche: string;
  subNiche: string;
  contentPillars: string[];
  keywords: string[];
  competitors: string[];
  uniqueValueProposition: string;

  // Content
  postingFrequency: string;
  preferredFormats: string[];
  contentGoals: string[];
  contentStyle: string;

  // Brand Voice
  tone: string;
  personality: string;
  writingStyle: string;
  preferredWords: string[];
  forbiddenWords: string[];
  emojiStyle: string;

  // Business
  monetizationGoal: string;
  revenueStreams: string[];
  targetSubscribers: number;
  targetRevenue: number;

  // AI Knowledge
  mission: string;
  vision: string;
  coreValues: string[];
  thingsToAvoid: string[];
  brandRules: string[];
  importantContext: string;

  // Metadata
  status: BrandStatus;
  createdAt: string;
  updatedAt: string;
}