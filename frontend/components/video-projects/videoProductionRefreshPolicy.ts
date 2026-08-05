export type HistoryLoadMode = "scope" | "manual" | "poll" | "mutation";

export interface DraftRefreshState<T> {
  draft: T;
  isDirty: boolean;
}

export interface VideoPollIdentity {
  scope: number;
  generationId: string;
  attempts: number;
  startedAt: number;
}

export function installsAuthoritativeDraft(mode: HistoryLoadMode): boolean {
  return mode !== "poll";
}

export function resolveDraftRefresh<T>(
  current: DraftRefreshState<T>,
  mode: HistoryLoadMode,
  authoritativeDraft?: T,
): DraftRefreshState<T> {
  if (authoritativeDraft === undefined || !installsAuthoritativeDraft(mode)) return current;
  return { draft: authoritativeDraft, isDirty: false };
}

export function shouldContinueVideoPolling(
  attempts: number,
  elapsedMs: number,
  serverStatusIsActive: boolean,
  maximumAttempts: number,
  maximumElapsedMs: number,
): boolean {
  return serverStatusIsActive && attempts < maximumAttempts && elapsedMs < maximumElapsedMs;
}

export function resolveVideoPollIdentity(
  current: VideoPollIdentity | null,
  scope: number,
  generationId: string,
): VideoPollIdentity {
  if (current?.scope === scope && current.generationId === generationId) return current;
  return { scope, generationId, attempts: 0, startedAt: 0 };
}
