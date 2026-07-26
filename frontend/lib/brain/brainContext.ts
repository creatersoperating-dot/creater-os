import { Brand } from "@/types/brand";

export function buildBrainContext(
  brand: Brand
): string {

  console.log("===== BRAND =====");
  console.log(JSON.stringify(brand, null, 2));
  console.log("=================");

  return `
Brand Name:
${brand.name}

Mission:
${brand.mission}

Vision:
${brand.vision}

Primary Platform:
${brand.primaryPlatform}

Primary Niche:
${brand.primaryNiche}

Target Audience:
${brand.targetAudience}

Tone:
${brand.tone}

Writing Style:
${brand.writingStyle}

Unique Value Proposition:
${brand.uniqueValueProposition}

Things To Avoid:
${(brand.thingsToAvoid ?? []).join(", ")}

Brand Rules:
${(brand.brandRules ?? []).join(", ")}
`;
}