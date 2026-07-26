export const AI_CONFIG = {
  defaultProvider: "openai",

  providers: {
    openai: {
      enabled: true,
      model: "gpt-5",
    },

    gemini: {
      enabled: true,
      model: "gemini-2.5-pro",
    },

    anthropic: {
      enabled: true,
      model: "claude-sonnet-4",
    },
  },
};