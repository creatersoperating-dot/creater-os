import "server-only";

import type { VideoVisualAssetResult } from "@/services/providers/video/videoProviderTypes";

export interface PendingVisualAssetUpload {
  id: string;
  path: string;
}

export async function reuseOrGenerateVisualAssets(
  loadReusable: () => Promise<readonly VideoVisualAssetResult[] | null>,
  generate: () => Promise<readonly VideoVisualAssetResult[]>,
): Promise<readonly VideoVisualAssetResult[]> {
  const reusable = await loadReusable();
  return reusable ?? generate();
}

export async function cleanupPartialVisualAssetUploads(
  pending: readonly PendingVisualAssetUpload[],
  remove: (path: string) => Promise<void>,
  markFailed: (id: string, cleanupPending: boolean) => Promise<void>,
): Promise<void> {
  for (const asset of pending) {
    let cleanupPending = false;
    try { await remove(asset.path); }
    catch { cleanupPending = true; }
    await markFailed(asset.id, cleanupPending);
  }
}
