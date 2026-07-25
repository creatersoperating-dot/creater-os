import { Brand } from "@/types/brand";

export const brands: Brand[] = [
  {
    id: "1",
    name: "AI Explained",
    description: "AI tutorials and news",

    primaryPlatform: "YouTube",

    language: "English",
    targetCountry: "United States",

    niche: "Artificial Intelligence",
    subNiche: "AI Tools",

    contentPillars: [
      "AI News",
      "Tutorials",
      "Reviews"
    ],

    targetAudience: "Developers",
    tone: "Educational",

    monetizationGoal: "Ads",

    status: "Active",

    createdAt: "2026-07-25"
  },

  {
    id: "2",
    name: "Finance Daily",
    description: "Personal finance and investing",

    primaryPlatform: "YouTube",

    language: "English",
    targetCountry: "India",

    niche: "Finance",
    subNiche: "Investing",

    contentPillars: [
      "Stocks",
      "Mutual Funds",
      "Credit Cards"
    ],

    targetAudience: "Young Professionals",
    tone: "Professional",

    monetizationGoal: "Affiliate",

    status: "Draft",

    createdAt: "2026-07-25"
  }
];