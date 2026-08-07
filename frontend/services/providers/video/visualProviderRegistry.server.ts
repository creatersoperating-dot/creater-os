import "server-only";

import { getVisualProviderConfiguration } from "./visualProviderConfig.server";
import { VideoProviderError, type ConfiguredVisualAssetProvider } from "./videoProviderTypes";

export async function getConfiguredVisualAssetProvider(): Promise<ConfiguredVisualAssetProvider> {
  const config = getVisualProviderConfiguration();
  if (config.provider === "disabled") {
    throw new VideoProviderError("provider_disabled", "Visual generation is not configured.");
  }
  const adapter = config.provider === "mock"
    ? (await import("./mockVideoProvider.server")).mockVisualAssetProvider
    : (await import("./geminiVisualProvider.server")).createGeminiVisualProvider({
      apiKey: config.apiKey as string,
      timeoutMs: config.timeoutMs,
      maxConcurrency: config.maxConcurrency,
    });
  return { adapter, model: config.model, timeoutMs: config.timeoutMs, maxConcurrency: config.maxConcurrency };
}
