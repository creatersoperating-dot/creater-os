import "server-only";

const MAX_DEFERRED_MEDIA_CLEANUPS = 64;
const activeCleanups = new Set<Promise<void>>();

export function registerDeferredMediaCleanup(
  closed: Promise<void>,
  cleanup: () => Promise<void>,
  onFailure: () => void,
): Promise<void> | null {
  if (activeCleanups.size >= MAX_DEFERRED_MEDIA_CLEANUPS) return null;
  const task = closed.then(cleanup).catch(() => { onFailure(); }).finally(() => { activeCleanups.delete(task); });
  activeCleanups.add(task);
  return task;
}

export function deferredMediaCleanupCountForTests(): number {
  return activeCleanups.size;
}
