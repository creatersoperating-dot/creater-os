export type Platform = "YouTube";

export type BrandStatus = "Draft" | "Active";

export interface Brand {
  id: string;

  // Identity
  name: string;
  description: string;

  // Publishing
  primaryPlatform: Platform;
  language: string;
  targetCountry: string;

  // Content
  niche: string;
  subNiche: string;
  contentPillars: string[];

  // Audience
  targetAudience: string;
  tone: string;

  // Business
  monetizationGoal: string;

  // Status
  status: BrandStatus;

  // Metadata
  createdAt: string;
}