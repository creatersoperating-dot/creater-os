import "server-only";

import { getVideoProviderConfiguration } from "./videoProviderConfig.server";
import { VideoProviderError, type ConfiguredVideoRenderer } from "./videoProviderTypes";

export async function getConfiguredVideoProvider(): Promise<ConfiguredVideoRenderer> {
  const config = getVideoProviderConfiguration();
  if (config.provider === "disabled") throw new VideoProviderError("provider_disabled", "Video rendering is not configured.");
  const { mockVideoProvider } = await import("./mockVideoProvider.server");
  return { adapter: mockVideoProvider, model: config.model, timeoutMs: config.timeoutMs,
    activeLeaseMs: config.activeLeaseMs, heartbeatMs: config.heartbeatMs };
}
