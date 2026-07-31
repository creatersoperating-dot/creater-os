"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Download,
  LoaderCircle,
  Mic,
  Play,
  RefreshCw,
  RotateCcw,
  Volume2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  CloudAudioProductionError,
  attachReadyNarration,
  generateProjectNarration,
  getConfiguredVoices,
  getNarrationAccess,
  getProjectAudioGenerations,
} from "@/services/cloudAudioProductionService";
import type {
  CreatorAudioGenerationSummary,
  CreatorVoiceDescriptor,
  PublicAudioGenerationLifecycleResult,
} from "@/types/audioProduction";
import type { CreatorScript } from "@/types/script";
import type { CreatorVideoProject } from "@/types/videoProject";

interface VoiceProductionPanelProps {
  brandId: string;
  project: CreatorVideoProject;
  attachedScript: CreatorScript | null;
  isScriptLoading?: boolean;
  disabled?: boolean;
  onProjectUpdated(project: CreatorVideoProject): void;
  onBusyChange(isBusy: boolean): void;
}

interface Feedback {
  type: "success" | "error" | "info";
  message: string;
}

interface PlaybackState {
  audioGenerationId: string;
  accessUrl: string;
  expiresAt: string;
}

interface PendingRetry {
  operationId: string;
  voiceId: string;
}

const ACTIVE_GENERATION_STATUSES = new Set([
  "queued",
  "generating",
  "uploading",
]);

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function formatStatus(status: string): string {
  if (status === "generating") {
    return "Generating";
  }

  if (status === "uploading") {
    return "Uploading";
  }

  if (status === "ready") {
    return "Ready";
  }

  if (status === "failed") {
    return "Failed";
  }

  if (status === "cancelled") {
    return "Cancelled";
  }

  return "Queued";
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Not completed";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) {
    return "Duration unavailable";
  }

  const totalSeconds = Math.max(0, Math.round(durationMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function upsertGeneration(
  generations: readonly CreatorAudioGenerationSummary[],
  generation: CreatorAudioGenerationSummary,
): CreatorAudioGenerationSummary[] {
  return [
    generation,
    ...generations.filter((item) => item.id !== generation.id),
  ].sort(
    (left, right) =>
      Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
}

export default function VoiceProductionPanel({
  brandId,
  project,
  attachedScript,
  isScriptLoading = false,
  disabled = false,
  onProjectUpdated,
  onBusyChange,
}: VoiceProductionPanelProps) {
  const [voices, setVoices] = useState<readonly CreatorVoiceDescriptor[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState("");
  const [generations, setGenerations] = useState<
    readonly CreatorAudioGenerationSummary[]
  >([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requiresAuthoritativeRefresh, setRequiresAuthoritativeRefresh] =
    useState(false);
  const [attachingGenerationId, setAttachingGenerationId] =
    useState<string | null>(null);
  const [loadingPlaybackId, setLoadingPlaybackId] =
    useState<string | null>(null);
  const [downloadingGenerationId, setDownloadingGenerationId] =
    useState<string | null>(null);
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [playbackRefreshAttemptedId, setPlaybackRefreshAttemptedId] =
    useState<string | null>(null);
  const [pendingRetry, setPendingRetry] =
    useState<PendingRetry | null>(null);
  const mountedRef = useRef(false);
  const projectRef = useRef(project);
  const onProjectUpdatedRef = useRef(onProjectUpdated);
  const onBusyChangeRef = useRef(onBusyChange);
  const requestTokenRef = useRef(0);
  const historyTokenRef = useRef(0);
  const playbackTokenRef = useRef(0);
  const mutationLatchRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    onProjectUpdatedRef.current = onProjectUpdated;
  }, [onProjectUpdated]);

  useEffect(() => {
    onBusyChangeRef.current = onBusyChange;
  }, [onBusyChange]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      requestTokenRef.current += 1;
      historyTokenRef.current += 1;
      playbackTokenRef.current += 1;
      mutationLatchRef.current = false;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      onBusyChangeRef.current(false);
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    async function loadVoices() {
      setIsLoadingVoices(true);

      try {
        const configuredVoices = await getConfiguredVoices();

        if (!isActive) {
          return;
        }

        setVoices(configuredVoices);
        setSelectedVoiceId((currentVoiceId) =>
          configuredVoices.some(
            (voice) => voice.voiceId === currentVoiceId,
          )
            ? currentVoiceId
            : (configuredVoices[0]?.voiceId ?? ""),
        );
        setVoiceError(
          configuredVoices.length === 0
            ? "No CreatorOS narration voices are configured."
            : null,
        );
      } catch (error: unknown) {
        if (isActive) {
          setVoiceError(
            getErrorMessage(
              error,
              "Unable to load narration voices.",
            ),
          );
        }
      } finally {
        if (isActive) {
          setIsLoadingVoices(false);
        }
      }
    }

    void loadVoices();

    return () => {
      isActive = false;
    };
  }, []);

  const loadHistory = useCallback(
    async () => {
      const token = ++historyTokenRef.current;

      try {
        const history = await getProjectAudioGenerations(
          brandId,
          project.id,
        );

        if (!mountedRef.current || historyTokenRef.current !== token) {
          return null;
        }

        setGenerations(history.generations);
        setHistoryError(null);
        setRequiresAuthoritativeRefresh(false);
        setPendingRetry((currentRetry) =>
          currentRetry &&
          history.generations.some(
            (generation) =>
              generation.operationId === currentRetry.operationId,
          )
            ? null
            : currentRetry,
        );

        if (
          history.project.updatedAt !== projectRef.current.updatedAt ||
          history.project.audioGenerationId !==
            projectRef.current.audioGenerationId ||
          history.project.status !== projectRef.current.status
        ) {
          projectRef.current = history.project;
          onProjectUpdatedRef.current(history.project);
        }

        return history;
      } catch (error: unknown) {
        if (mountedRef.current && historyTokenRef.current === token) {
          setHistoryError(
            getErrorMessage(
              error,
              "Unable to load narration history.",
            ),
          );
        }

        return null;
      } finally {
        if (
          mountedRef.current &&
          historyTokenRef.current === token
        ) {
          setIsLoadingHistory(false);
        }
      }
    },
    [brandId, project.id],
  );

  useEffect(() => {
    const token = ++historyTokenRef.current;

    async function loadInitialHistory() {
      try {
        const history = await getProjectAudioGenerations(
          brandId,
          project.id,
        );

        if (!mountedRef.current || historyTokenRef.current !== token) {
          return;
        }

        setGenerations(history.generations);
        setHistoryError(null);
        setRequiresAuthoritativeRefresh(false);
        setPendingRetry((currentRetry) =>
          currentRetry &&
          history.generations.some(
            (generation) =>
              generation.operationId === currentRetry.operationId,
          )
            ? null
            : currentRetry,
        );

        if (
          history.project.updatedAt !== projectRef.current.updatedAt ||
          history.project.audioGenerationId !==
            projectRef.current.audioGenerationId ||
          history.project.status !== projectRef.current.status
        ) {
          projectRef.current = history.project;
          onProjectUpdatedRef.current(history.project);
        }
      } catch (error: unknown) {
        if (mountedRef.current && historyTokenRef.current === token) {
          setHistoryError(
            getErrorMessage(
              error,
              "Unable to load narration history.",
            ),
          );
        }
      } finally {
        if (mountedRef.current && historyTokenRef.current === token) {
          setIsLoadingHistory(false);
        }
      }
    }

    void loadInitialHistory();

    return () => {
      if (historyTokenRef.current === token) {
        historyTokenRef.current += 1;
      }
    };
  }, [brandId, project.id]);

  const hasActiveGeneration = generations.some((generation) =>
    ACTIVE_GENERATION_STATUSES.has(generation.status),
  );
  const isAttaching = attachingGenerationId !== null;
  const isAudioBusy =
    isSubmitting ||
    isAttaching ||
    hasActiveGeneration ||
    requiresAuthoritativeRefresh;
  const currentGeneration =
    generations.find(
      (generation) =>
        generation.id === project.audioGenerationId &&
        generation.status === "ready",
    ) ?? null;
  const hasInvalidatedNarration =
    project.audioGenerationId === null &&
    generations.some((generation) => generation.status === "ready");
  const selectedVoice =
    voices.find((voice) => voice.voiceId === selectedVoiceId) ?? null;
  const hasUsableAttachedScript =
    project.scriptId !== null &&
    attachedScript !== null &&
    attachedScript.id === project.scriptId;
  const generationDisabled =
    disabled ||
    isAudioBusy ||
    isLoadingVoices ||
    isLoadingHistory ||
    historyError !== null ||
    !selectedVoice ||
    !hasUsableAttachedScript;

  useEffect(() => {
    onBusyChangeRef.current(isAudioBusy);
  }, [isAudioBusy]);

  function applyLifecycleGeneration(
    result: PublicAudioGenerationLifecycleResult,
  ) {
    if (result.generation) {
      setGenerations((currentGenerations) =>
        upsertGeneration(currentGenerations, result.generation!),
      );
    }
  }

  async function runGeneration(
    operationId: string,
    voiceId: string,
    action: "generate" | "regenerate" | "retry",
  ) {
    if (
      mutationLatchRef.current ||
      disabled ||
      hasActiveGeneration ||
      requiresAuthoritativeRefresh ||
      !hasUsableAttachedScript
    ) {
      return;
    }

    if (
      action === "regenerate" &&
      !window.confirm(
        "Generate a replacement narration? The current narration will remain attached until the replacement is ready and safely attached.",
      )
    ) {
      return;
    }

    const token = ++requestTokenRef.current;
    const controller = new AbortController();
    mutationLatchRef.current = true;
    abortControllerRef.current = controller;
    setIsSubmitting(true);
    setPendingRetry(null);
    setFeedback({
      type: "info",
      message:
        action === "retry"
          ? "Retrying narration generation..."
          : "Generating narration and saving it securely...",
    });

    try {
      const result = await generateProjectNarration({
        brandId,
        projectId: projectRef.current.id,
        operationId,
        voiceId,
        signal: controller.signal,
      });

      if (!mountedRef.current || requestTokenRef.current !== token) {
        return;
      }

      applyLifecycleGeneration(result);

      if (result.kind === "ready") {
        projectRef.current = result.project;
        onProjectUpdatedRef.current(result.project);
        setFeedback({
          type: "success",
          message:
            result.project.status === "voice"
              ? "Narration generated, attached, and the project advanced to Voice / Audio."
              : "Narration generated and attached to the project.",
        });
      } else if (result.kind === "conflict") {
        if (result.project) {
          projectRef.current = result.project;
          onProjectUpdatedRef.current(result.project);
        }

        setFeedback({
          type: "error",
          message:
            result.generation.status === "ready"
              ? "Narration was saved to history but was not attached because the project or script changed. Refresh and attach it manually if it is still valid."
              : "This operation no longer matches the current project or script. Its existing history was preserved; start a new generation when ready.",
        });
      } else if (result.kind === "processing") {
        setFeedback({
          type: "info",
          message:
            "Narration generation is already processing. Refresh its status before starting another operation.",
        });
      } else {
        if (result.failure.retryable && !result.generation) {
          setPendingRetry({ operationId, voiceId });
        }

        setFeedback({
          type: "error",
          message:
            result.failure.code === "cancelled" ||
            result.failure.code === "aborted"
              ? "Narration generation was cancelled. It was not restarted."
              : result.failure.message,
        });
      }

      await loadHistory();
    } catch (error: unknown) {
      if (!mountedRef.current || requestTokenRef.current !== token) {
        return;
      }

      const hasUnknownServerOutcome =
        !(error instanceof CloudAudioProductionError);

      if (hasUnknownServerOutcome) {
        setRequiresAuthoritativeRefresh(true);
      }

      setPendingRetry(null);

      setFeedback({
        type: "error",
        message:
          error instanceof DOMException && error.name === "AbortError"
            ? "The narration request was interrupted. Refresh history before retrying so completed work is not duplicated."
            : hasUnknownServerOutcome
              ? "The connection ended before the narration result was confirmed. Refresh history before trying again."
            : getErrorMessage(
                error,
                "Unable to generate narration.",
              ),
      });
      await loadHistory();
    } finally {
      if (requestTokenRef.current === token) {
        abortControllerRef.current = null;
        mutationLatchRef.current = false;

        if (mountedRef.current) {
          setIsSubmitting(false);
        }
      }
    }
  }

  async function handleNewGeneration() {
    if (generationDisabled || !selectedVoice) {
      return;
    }

    await runGeneration(
      crypto.randomUUID(),
      selectedVoice.voiceId,
      projectRef.current.audioGenerationId ? "regenerate" : "generate",
    );
  }

  async function handleRetry(
    generation: CreatorAudioGenerationSummary,
  ) {
    if (
      disabled ||
      isAudioBusy ||
      generation.status !== "failed" ||
      !generation.failureRetryable
    ) {
      return;
    }

    await runGeneration(
      generation.operationId,
      generation.voiceId,
      "retry",
    );
  }

  function canAttachGeneration(
    generation: CreatorAudioGenerationSummary,
  ): boolean {
    return (
      generation.status === "ready" &&
      generation.id !== project.audioGenerationId &&
      attachedScript !== null &&
      project.scriptId === attachedScript.id &&
      generation.sourceScriptId === attachedScript.id &&
      generation.sourceScriptUpdatedAt === attachedScript.updatedAt
    );
  }

  async function handleAttach(
    generation: CreatorAudioGenerationSummary,
  ) {
    if (
      mutationLatchRef.current ||
      disabled ||
      isAudioBusy ||
      !canAttachGeneration(generation)
    ) {
      return;
    }

    const token = ++requestTokenRef.current;
    const capturedProject = projectRef.current;
    mutationLatchRef.current = true;
    setAttachingGenerationId(generation.id);
    setFeedback({
      type: "info",
      message: "Attaching the ready narration...",
    });

    try {
      const result = await attachReadyNarration(
        brandId,
        capturedProject.id,
        generation.id,
        capturedProject.updatedAt,
      );

      if (!mountedRef.current || requestTokenRef.current !== token) {
        return;
      }

      projectRef.current = result.project;
      onProjectUpdatedRef.current(result.project);
      setGenerations((currentGenerations) =>
        upsertGeneration(currentGenerations, result.generation),
      );
      setFeedback({
        type: "success",
        message:
          result.project.status === "voice"
            ? "Ready narration attached and the project advanced to Voice / Audio."
            : "Ready narration attached to the project.",
      });
      await loadHistory();
    } catch (error: unknown) {
      if (!mountedRef.current || requestTokenRef.current !== token) {
        return;
      }

      if (!(error instanceof CloudAudioProductionError)) {
        setRequiresAuthoritativeRefresh(true);
      }

      await loadHistory();
      setFeedback({
        type: "error",
        message:
          error instanceof CloudAudioProductionError &&
          error.status === 409
            ? "The project or script changed before attachment. The latest project and history were refreshed."
            : !(error instanceof CloudAudioProductionError)
              ? "The connection ended before attachment was confirmed. Refresh history before trying again."
            : getErrorMessage(
                error,
                "Unable to attach the ready narration.",
              ),
      });
    } finally {
      if (requestTokenRef.current === token) {
        mutationLatchRef.current = false;

        if (mountedRef.current) {
          setAttachingGenerationId(null);
        }
      }
    }
  }

  async function loadPlayback(
    generationId: string,
    isExpiryRefresh: boolean,
  ) {
    const token = ++playbackTokenRef.current;
    setLoadingPlaybackId(generationId);

    if (!isExpiryRefresh) {
      setPlayback(null);
      setPlaybackRefreshAttemptedId(null);
    } else {
      setPlaybackRefreshAttemptedId(generationId);
    }

    try {
      const access = await getNarrationAccess(
        brandId,
        projectRef.current.id,
        generationId,
        "playback",
      );

      if (!mountedRef.current || playbackTokenRef.current !== token) {
        return;
      }

      setPlayback({
        audioGenerationId: access.audioGenerationId,
        accessUrl: access.accessUrl,
        expiresAt: access.expiresAt,
      });
    } catch (error: unknown) {
      if (mountedRef.current && playbackTokenRef.current === token) {
        setPlayback(null);
        setFeedback({
          type: "error",
          message: getErrorMessage(
            error,
            isExpiryRefresh
              ? "Playback could not be refreshed. Request a new player when ready."
              : "Unable to open secure narration playback.",
          ),
        });
      }
    } finally {
      if (mountedRef.current && playbackTokenRef.current === token) {
        setLoadingPlaybackId(null);
      }
    }
  }

  function handlePlaybackError() {
    if (!playback) {
      return;
    }

    if (playbackRefreshAttemptedId !== playback.audioGenerationId) {
      void loadPlayback(playback.audioGenerationId, true);
      return;
    }

    setFeedback({
      type: "error",
      message:
        "Narration playback failed after refreshing secure access. Try loading the player again.",
    });
  }

  async function handleDownload(generationId: string) {
    if (downloadingGenerationId) {
      return;
    }

    setDownloadingGenerationId(generationId);

    try {
      const access = await getNarrationAccess(
        brandId,
        projectRef.current.id,
        generationId,
        "download",
      );

      if (!mountedRef.current) {
        return;
      }

      const link = document.createElement("a");
      link.href = access.accessUrl;
      link.download = access.filename;
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error: unknown) {
      if (mountedRef.current) {
        setFeedback({
          type: "error",
          message: getErrorMessage(
            error,
            "Unable to download the narration.",
          ),
        });
      }
    } finally {
      if (mountedRef.current) {
        setDownloadingGenerationId(null);
      }
    }
  }

  function renderPlayer(generationId: string) {
    if (playback?.audioGenerationId !== generationId) {
      return null;
    }

    return (
      <div className="mt-4 rounded-xl border border-fuchsia-200 bg-white p-3">
        <audio
          key={`${playback.audioGenerationId}:${playback.expiresAt}`}
          controls
          preload="metadata"
          src={playback.accessUrl}
          onError={handlePlaybackError}
          className="w-full"
        >
          Your browser does not support audio playback.
        </audio>
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-950/5">
      <header className="flex flex-col gap-4 border-b border-slate-200 bg-gradient-to-r from-fuchsia-50 via-white to-violet-50 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-fuchsia-600 text-white">
            <Mic className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-600">
              Voice / Audio
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
              Narration production
            </h2>
          </div>
        </div>

        <button
          type="button"
          disabled={isLoadingHistory || isSubmitting || isAttaching}
          onClick={() => {
            setIsLoadingHistory(true);
            void loadHistory();
          }}
          className="inline-flex w-fit items-center justify-center gap-2 rounded-xl border border-fuchsia-200 bg-white px-4 py-2.5 text-sm font-semibold text-fuchsia-700 transition hover:bg-fuchsia-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw
            className={`h-4 w-4 ${isLoadingHistory ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          Refresh
        </button>
      </header>

      <div className="space-y-6 p-5 sm:p-7">
        <div aria-live="polite" aria-atomic="true">
          {feedback && (
            <div
              role={feedback.type === "error" ? "alert" : "status"}
              className={`rounded-2xl border px-4 py-3 text-sm font-medium ${
                feedback.type === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : feedback.type === "error"
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : "border-sky-200 bg-sky-50 text-sky-800"
              }`}
            >
              {feedback.message}
            </div>
          )}
        </div>

        {pendingRetry && (
          <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-6 text-amber-900">
              The generation record could not be confirmed. Retry this same
              logical operation without creating a duplicate.
            </p>
            <button
              type="button"
              disabled={disabled || isAudioBusy}
              onClick={() =>
                void runGeneration(
                  pendingRetry.operationId,
                  pendingRetry.voiceId,
                  "retry",
                )
              }
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Retry Same Operation
            </button>
          </div>
        )}

        {isScriptLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600">
            Checking the attached cloud script...
          </div>
        ) : !hasUsableAttachedScript ? (
          <div
            role="status"
            className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-900"
          >
            <AlertTriangle
              className="mt-0.5 h-5 w-5 shrink-0"
              aria-hidden="true"
            />
            <p>
              Attach a saved cloud script in the Script stage before
              generating narration. Standalone or unsaved script content is
              never used here.
            </p>
          </div>
        ) : (
          <div className="flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm leading-6 text-emerald-900">
            <CheckCircle2
              className="mt-0.5 h-5 w-5 shrink-0"
              aria-hidden="true"
            />
            <p>
              Narration will use the attached cloud script
              <strong className="ml-1">{attachedScript.title}</strong>.
            </p>
          </div>
        )}

        <div>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-lg font-bold text-slate-950">
                Select a CreatorOS voice
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Voice choices stay provider-neutral throughout the workspace.
              </p>
            </div>
            {selectedVoice && (
              <span className="text-sm font-semibold text-fuchsia-700">
                Selected: {selectedVoice.displayName}
              </span>
            )}
          </div>

          {isLoadingVoices ? (
            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
              <LoaderCircle
                className="h-4 w-4 animate-spin"
                aria-hidden="true"
              />
              Loading narration voices...
            </div>
          ) : voiceError ? (
            <p
              role="alert"
              className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"
            >
              {voiceError}
            </p>
          ) : (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {voices.map((voice) => (
                <label
                  key={voice.voiceId}
                  className={`cursor-pointer rounded-2xl border p-4 transition focus-within:ring-4 focus-within:ring-fuchsia-100 ${
                    selectedVoiceId === voice.voiceId
                      ? "border-fuchsia-400 bg-fuchsia-50"
                      : "border-slate-200 bg-slate-50/70 hover:border-fuchsia-200 hover:bg-white"
                  } ${disabled || isAudioBusy ? "cursor-not-allowed opacity-60" : ""}`}
                >
                  <span className="flex items-start gap-3">
                    <input
                      type="radio"
                      name={`narration-voice-${project.id}`}
                      value={voice.voiceId}
                      checked={selectedVoiceId === voice.voiceId}
                      disabled={disabled || isAudioBusy}
                      onChange={(event) => {
                        setSelectedVoiceId(event.target.value);
                        setFeedback(null);
                      }}
                      className="mt-1 h-4 w-4 accent-fuchsia-600"
                    />
                    <span>
                      <span className="block font-bold text-slate-950">
                        {voice.displayName}
                      </span>
                      {voice.description && (
                        <span className="mt-1 block text-sm leading-6 text-slate-600">
                          {voice.description}
                        </span>
                      )}
                      <span className="mt-2 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                        Languages: {voice.supportedLanguageCodes.join(", ")}
                      </span>
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {!project.audioGenerationId && (
          <div className="flex flex-col gap-3 rounded-2xl border border-fuchsia-200 bg-fuchsia-50/60 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-bold text-slate-950">
              Create the first narration
            </h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              The finished narration will be saved privately and attached when
              the project is unchanged.
            </p>
          </div>
          <button
            type="button"
            disabled={generationDisabled}
            onClick={() => void handleNewGeneration()}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-fuchsia-600/20 transition hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
          >
            {isSubmitting ? (
              <LoaderCircle
                className="h-4 w-4 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Mic className="h-4 w-4" aria-hidden="true" />
            )}
            {isSubmitting
              ? "Generating..."
              : "Generate Narration"}
          </button>
          </div>
        )}

        {hasInvalidatedNarration && (
          <p
            role="status"
            className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800"
          >
            The project script changed. Generate or attach narration for the
            current script.
          </p>
        )}

        {currentGeneration && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">
                  Current attached narration
                </p>
                <h3 className="mt-2 text-xl font-bold text-slate-950">
                  {currentGeneration.voiceLabel}
                </h3>
                <p className="mt-1 text-sm text-emerald-800">
                  {formatDuration(currentGeneration.durationMs)} · Generated{" "}
                  {formatDate(
                    currentGeneration.completedAt ??
                      currentGeneration.createdAt,
                  )}
                </p>
              </div>
              <span className="w-fit rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">
                Attached
              </span>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={loadingPlaybackId === currentGeneration.id}
                onClick={() => void loadPlayback(currentGeneration.id, false)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                {loadingPlaybackId === currentGeneration.id
                  ? "Loading player..."
                  : "Play Narration"}
              </button>
              <button
                type="button"
                disabled={downloadingGenerationId !== null}
                onClick={() => void handleDownload(currentGeneration.id)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                {downloadingGenerationId === currentGeneration.id
                  ? "Preparing..."
                  : "Download"}
              </button>
              <button
                type="button"
                disabled={generationDisabled}
                onClick={() => void handleNewGeneration()}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isSubmitting ? (
                  <LoaderCircle
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                )}
                {isSubmitting ? "Generating..." : "Regenerate Narration"}
              </button>
            </div>
            {renderPlayer(currentGeneration.id)}
          </div>
        )}

        <div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-slate-950">
                Narration history
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Latest generations and attempts for this project.
              </p>
            </div>
            <Volume2 className="h-5 w-5 text-fuchsia-600" aria-hidden="true" />
          </div>

          {historyError && (
            <p
              role="alert"
              className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"
            >
              {historyError}
            </p>
          )}

          {isLoadingHistory ? (
            <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-10 text-sm text-slate-600">
              <LoaderCircle
                className="h-4 w-4 animate-spin"
                aria-hidden="true"
              />
              Loading narration history...
            </div>
          ) : generations.length === 0 ? (
            historyError ? null : (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
                No narration has been generated for this project yet.
              </div>
            )
          ) : (
            <div className="mt-4 max-h-[44rem] space-y-3 overflow-y-auto pr-1">
              {generations.map((generation) => {
                const isCurrent = generation.id === project.audioGenerationId;
                const canAttach = canAttachGeneration(generation);

                return (
                  <article
                    key={generation.id}
                    className={`rounded-2xl border p-4 ${
                      isCurrent
                        ? "border-emerald-300 bg-emerald-50/60"
                        : "border-slate-200 bg-slate-50/70"
                    }`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-bold text-slate-950">
                            {generation.voiceLabel}
                          </h4>
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">
                            {formatStatus(generation.status)}
                          </span>
                          {isCurrent && (
                            <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-white">
                              Current
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-sm text-slate-500">
                          Created {formatDate(generation.createdAt)} · Attempt{" "}
                          {generation.attemptCount}
                          {generation.status === "ready"
                            ? ` · ${formatDuration(generation.durationMs)}`
                            : ""}
                        </p>
                        {generation.failureMessage && (
                          <p className="mt-2 text-sm font-medium text-rose-700">
                            {generation.failureMessage}
                          </p>
                        )}
                        {generation.status === "failed" && (
                          <p className="mt-1 text-xs font-semibold text-slate-500">
                            {generation.failureRetryable
                              ? "This logical generation can be retried."
                              : "This failure requires a new generation or project correction."}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2 sm:justify-end">
                        {generation.status === "ready" && (
                          <>
                            <button
                              type="button"
                              disabled={loadingPlaybackId === generation.id}
                              onClick={() =>
                                void loadPlayback(generation.id, false)
                              }
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-fuchsia-200 hover:text-fuchsia-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Play className="h-3.5 w-3.5" aria-hidden="true" />
                              Play
                            </button>
                            <button
                              type="button"
                              disabled={downloadingGenerationId !== null}
                              onClick={() =>
                                void handleDownload(generation.id)
                              }
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-fuchsia-200 hover:text-fuchsia-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Download
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                              Download
                            </button>
                          </>
                        )}
                        {canAttach && (
                          <button
                            type="button"
                            disabled={disabled || isAudioBusy}
                            onClick={() => void handleAttach(generation)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-fuchsia-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                          >
                            {attachingGenerationId === generation.id ? (
                              <LoaderCircle
                                className="h-3.5 w-3.5 animate-spin"
                                aria-hidden="true"
                              />
                            ) : (
                              <CheckCircle2
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                            )}
                            Attach Ready Narration
                          </button>
                        )}
                        {generation.status === "failed" &&
                          generation.failureRetryable && (
                            <button
                              type="button"
                              disabled={disabled || isAudioBusy}
                              onClick={() => void handleRetry(generation)}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                            >
                              <RotateCcw
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                              Retry
                            </button>
                          )}
                      </div>
                    </div>
                    {!isCurrent && renderPlayer(generation.id)}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
