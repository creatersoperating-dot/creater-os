import type { Brand, BrandStatus, Platform } from "@/types/brand";

export interface BrandRow {
  user_id: string;
  id: string;
  name: string;
  tagline: string;
  description: string;
  logo: string | null;
  website: string | null;
  primary_platform: Platform;
  language: string;
  target_country: string;
  target_audience: string;
  age_group: string;
  experience_level: string;
  primary_niche: string;
  sub_niche: string;
  content_pillars: string[];
  keywords: string[];
  competitors: string[];
  unique_value_proposition: string;
  posting_frequency: string;
  preferred_formats: string[];
  content_goals: string[];
  content_style: string;
  tone: string;
  personality: string;
  writing_style: string;
  preferred_words: string[];
  forbidden_words: string[];
  emoji_style: string;
  monetization_goal: string;
  revenue_streams: string[];
  target_subscribers: number;
  target_revenue: number;
  mission: string;
  vision: string;
  core_values: string[];
  things_to_avoid: string[];
  brand_rules: string[];
  important_context: string;
  status: BrandStatus;
  created_at: string;
  updated_at: string;
}

export function mapBrandRowToBrand(row: BrandRow): Brand {
  return {
    id: row.id,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    logo: row.logo ?? "",
    website: row.website ?? "",
    primaryPlatform: row.primary_platform,
    language: row.language,
    targetCountry: row.target_country,
    targetAudience: row.target_audience,
    ageGroup: row.age_group,
    experienceLevel: row.experience_level,
    primaryNiche: row.primary_niche,
    subNiche: row.sub_niche,
    contentPillars: row.content_pillars,
    keywords: row.keywords,
    competitors: row.competitors,
    uniqueValueProposition: row.unique_value_proposition,
    postingFrequency: row.posting_frequency,
    preferredFormats: row.preferred_formats,
    contentGoals: row.content_goals,
    contentStyle: row.content_style,
    tone: row.tone,
    personality: row.personality,
    writingStyle: row.writing_style,
    preferredWords: row.preferred_words,
    forbiddenWords: row.forbidden_words,
    emojiStyle: row.emoji_style,
    monetizationGoal: row.monetization_goal,
    revenueStreams: row.revenue_streams,
    targetSubscribers: row.target_subscribers,
    targetRevenue: row.target_revenue,
    mission: row.mission,
    vision: row.vision,
    coreValues: row.core_values,
    thingsToAvoid: row.things_to_avoid,
    brandRules: row.brand_rules,
    importantContext: row.important_context,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapBrandToRow(brand: Brand, userId: string): BrandRow {
  return {
    user_id: userId,
    id: brand.id,
    name: brand.name,
    tagline: brand.tagline,
    description: brand.description,
    logo: brand.logo?.trim() ? brand.logo : null,
    website: brand.website?.trim() ? brand.website : null,
    primary_platform: brand.primaryPlatform,
    language: brand.language,
    target_country: brand.targetCountry,
    target_audience: brand.targetAudience,
    age_group: brand.ageGroup,
    experience_level: brand.experienceLevel,
    primary_niche: brand.primaryNiche,
    sub_niche: brand.subNiche,
    content_pillars: brand.contentPillars,
    keywords: brand.keywords,
    competitors: brand.competitors,
    unique_value_proposition: brand.uniqueValueProposition,
    posting_frequency: brand.postingFrequency,
    preferred_formats: brand.preferredFormats,
    content_goals: brand.contentGoals,
    content_style: brand.contentStyle,
    tone: brand.tone,
    personality: brand.personality,
    writing_style: brand.writingStyle,
    preferred_words: brand.preferredWords,
    forbidden_words: brand.forbiddenWords,
    emoji_style: brand.emojiStyle,
    monetization_goal: brand.monetizationGoal,
    revenue_streams: brand.revenueStreams,
    target_subscribers: brand.targetSubscribers,
    target_revenue: brand.targetRevenue,
    mission: brand.mission,
    vision: brand.vision,
    core_values: brand.coreValues,
    things_to_avoid: brand.thingsToAvoid,
    brand_rules: brand.brandRules,
    important_context: brand.importantContext,
    status: brand.status,
    created_at: brand.createdAt,
    updated_at: brand.updatedAt,
  };
}
