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
  [Capability.SCRIPT_WRITING]: [
    "Create a consistent YouTube script in Markdown using the structure below.",
    "Return only the finished Markdown content with no commentary before or after it.",
    "",
    "# Video Title Suggestions",
    "Provide 3 title options.",
    "",
    "## Target Audience and Angle",
    "Include:",
    "- Target audience",
    "- Core angle",
    "- Intended viewer outcome",
    "",
    "## Hook",
    "Write a strong opening hook.",
    "",
    "## Introduction",
    "Introduce the topic and establish why the viewer should continue watching.",
    "",
    "## Script",
    "Organize the script into clearly titled sections.",
    "Each section must include natural narration.",
    "Visual directions may be included where helpful, but must not overwhelm the narration.",
    "",
    "## Call to Action",
    "Provide a natural call to action appropriate to the brand and video.",
    "",
    "## Thumbnail Concepts",
    "Provide 3 concepts, each with:",
    "- A visual idea",
    "- Short thumbnail text",
    "",
    "## Production Notes",
    "Include this section only when the current user request asks for production notes. Otherwise omit the heading and section.",
    "",
    "Follow the existing brand context, tone, language, preferred words, forbidden words, brand rules, and things to avoid.",
    "Use any requested duration, audience, angle, key points, call to action, and constraints when supplied.",
    "Do not invent statistics, quotations, sources, or factual claims.",
    "Do not add unsupported research.",
  ].join("\n"),
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
