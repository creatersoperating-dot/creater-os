import { Brand } from "@/types/brand";

export const brands: Brand[] = [
  {
    id: "TEST",

    name: "THIS IS THE NEW BRAND",

    tagline: "Testing",

    description: "If you see this, the correct file is loading.",

    logo: "",
    website: "",

    primaryPlatform: "YouTube",
    language: "English",
    targetCountry: "Global",
    targetAudience: "Everyone",
    ageGroup: "",
    experienceLevel: "",

    primaryNiche: "Technology",
    subNiche: "AI",

    contentPillars: [],
    keywords: [],
    competitors: [],
    uniqueValueProposition: "Testing",

    postingFrequency: "",
    preferredFormats: [],
    contentGoals: [],
    contentStyle: "",

    tone: "Professional",
    personality: "",
    writingStyle: "Simple",

    preferredWords: [],
    forbiddenWords: [],
    emojiStyle: "",

    monetizationGoal: "",
    revenueStreams: [],
    targetSubscribers: 0,
    targetRevenue: 0,

    mission: "MISSION WORKS",
    vision: "VISION WORKS",

    coreValues: [],
    thingsToAvoid: ["Clickbait"],
    brandRules: ["Always be accurate"],
    importantContext: "",

    status: "Draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];