import "server-only";

import { VideoProductionError } from "@/types/videoProduction";

type RemoveResult = { error: unknown | null };

export async function removePrivateStorageObject(
  remove: () => PromiseLike<RemoveResult>,
  objectStillExists: () => Promise<boolean>,
): Promise<void> {
  let result: RemoveResult;
  try { result = await remove(); }
  catch { throw new VideoProductionError("cleanup_failed", "Project media cleanup was incomplete. Retry deletion.", true, 500); }
  if (result.error) throw new VideoProductionError("cleanup_failed", "Project media cleanup was incomplete. Retry deletion.", true, 500);

  let remains: boolean;
  try { remains = await objectStillExists(); }
  catch { throw new VideoProductionError("cleanup_failed", "Project media cleanup could not be verified. Retry deletion.", true, 500); }
  if (remains) throw new VideoProductionError("cleanup_failed", "Project media cleanup could not be verified. Retry deletion.", true, 500);
}
