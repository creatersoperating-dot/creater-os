import { Capability } from "../capabilities/capabilities";
import type { AIContext } from "../context/contextEngine";
import type { ExecuteTaskRequest } from "../tasks/taskTypes";

const SYSTEM_INSTRUCTIONS = [
  "You are CreatorOS AI, an expert assistant for creators, businesses, agencies, and brands.",
  "Provide accurate, professional work and never invent facts.",
  "Follow the supplied brand identity, voice, rules, and constraints.",
  "Be concise unless the user requests detail.",
  "If information is uncertain or unavailable, say so clearly.",
].join("\n");

const CAPABILITY_INSTRUCTIONS: Record<Capability, string> = {
  [Capability.CHAT]:
    "Answer the user helpfully while following the supplied brand context.",
  [Capability.SCRIPT_WRITING]:
    "Create a polished YouTube script with a strong hook, clear structure, and audience-appropriate call to action.",
  [Capability.COMMENT_REPLY]:
    "Write a concise, authentic reply that matches the brand voice and addresses the comment directly.",
  [Capability.RESEARCH]:
    "Provide a clear research synthesis, distinguish facts from uncertainty, and avoid unsupported claims.",
  [Capability.SEO]:
    "Provide practical search optimization guidance using relevant topics and keywords without keyword stuffing.",
};

type BrandFieldValue =
  | string
  | number
  | string[]
  | undefined;

function formatBrandField(
  label: string,
  value: BrandFieldValue
): string | null {
  if (value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    const items = value
      .map((item) => item.trim())
      .filter(Boolean);

    return items.length > 0
      ? `${label}: ${items.join(", ")}`
      : null;
  }

  const text = String(value).trim();

  return text ? `${label}: ${text}` : null;
}

function buildBrandContext(
  brand: AIContext["brand"]
): string {
  const fields = [
    formatBrandField("Name", brand.name),
    formatBrandField("Tagline", brand.tagline),
    formatBrandField("Description", brand.description),
    formatBrandField("Website", brand.website),
    formatBrandField("Primary platform", brand.primaryPlatform),
    formatBrandField("Language", brand.language),
    formatBrandField("Target country", brand.targetCountry),
    formatBrandField("Target audience", brand.targetAudience),
    formatBrandField("Audience age group", brand.ageGroup),
    formatBrandField("Audience experience level", brand.experienceLevel),
    formatBrandField("Primary niche", brand.primaryNiche),
    formatBrandField("Sub-niche", brand.subNiche),
    formatBrandField("Content pillars", brand.contentPillars),
    formatBrandField("Keywords", brand.keywords),
    formatBrandField("Competitors", brand.competitors),
    formatBrandField(
      "Unique value proposition",
      brand.uniqueValueProposition
    ),
    formatBrandField("Posting frequency", brand.postingFrequency),
    formatBrandField("Preferred formats", brand.preferredFormats),
    formatBrandField("Content goals", brand.contentGoals),
    formatBrandField("Content style", brand.contentStyle),
    formatBrandField("Tone", brand.tone),
    formatBrandField("Personality", brand.personality),
    formatBrandField("Writing style", brand.writingStyle),
    formatBrandField("Preferred words", brand.preferredWords),
    formatBrandField("Forbidden words", brand.forbiddenWords),
    formatBrandField("Emoji style", brand.emojiStyle),
    formatBrandField("Monetization goal", brand.monetizationGoal),
    formatBrandField("Revenue streams", brand.revenueStreams),
    formatBrandField("Target subscribers", brand.targetSubscribers),
    formatBrandField("Target revenue", brand.targetRevenue),
    formatBrandField("Mission", brand.mission),
    formatBrandField("Vision", brand.vision),
    formatBrandField("Core values", brand.coreValues),
    formatBrandField("Things to avoid", brand.thingsToAvoid),
    formatBrandField("Brand rules", brand.brandRules),
    formatBrandField("Important context", brand.importantContext),
  ];

  return fields
    .filter((field): field is string => field !== null)
    .join("\n");
}

function buildConversationHistory(
  history: AIContext["history"]
): string {
  if (history.length === 0) {
    return "No previous conversation.";
  }

  return history
    .map(
      (message) =>
        `${message.role.toUpperCase()}: ${message.content}`
    )
    .join("\n");
}

export function buildPrompt(
  request: ExecuteTaskRequest,
  context: AIContext
): string {
  const brandContext = buildBrandContext(context.brand);

  return [
    `SYSTEM INSTRUCTIONS\n${SYSTEM_INSTRUCTIONS}`,
    `CAPABILITY INSTRUCTIONS\n${
      CAPABILITY_INSTRUCTIONS[context.capability]
    }`,
    `BRAND CONTEXT\n${
      brandContext || "No brand context provided."
    }`,
    `PREVIOUS CONVERSATION\n${buildConversationHistory(
      context.history
    )}`,
    `CURRENT USER REQUEST\n${request.input}`,
  ].join("\n\n");
}
