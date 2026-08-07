import "server-only";

import { getVideoProviderConfiguration } from "./videoProviderConfig.server";
import { VideoProviderError, type ConfiguredVideoRenderer } from "./videoProviderTypes";

export async function getConfiguredVideoRenderer(): Promise<ConfiguredVideoRenderer> {
  const config = getVideoProviderConfiguration();
  if (config.provider === "disabled") throw new VideoProviderError("provider_disabled", "Video rendering is not configured.");
  const adapter = config.provider === "mock"
    ? (await import("./mockVideoProvider.server")).mockVideoRenderer
    : (await import("./ffmpegVideoProvider.server")).createFfmpegVideoProvider({
      executablePath: config.ffmpegPath as string,
      ffprobePath: config.ffprobePath as string,
      timeoutMs: config.timeoutMs,
    });
  return { adapter, model: config.model, timeoutMs: config.timeoutMs,
    activeLeaseMs: config.activeLeaseMs, heartbeatMs: config.heartbeatMs };
}
