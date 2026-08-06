import "server-only";

import { VideoProviderError } from "@/services/providers/video/videoProviderTypes";

export function assertAuthoritativeNarrationSize(bytes: Uint8Array, fileSizeBytes: number | null): void {
  if (!Number.isSafeInteger(fileSizeBytes) || Number(fileSizeBytes) < 1 || bytes.byteLength !== fileSizeBytes) {
    throw new VideoProviderError("invalid_audio", "The attached narration failed integrity validation.", false);
  }
}
