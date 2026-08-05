"use client";

import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Save,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { getCloudScriptsByBrand } from "@/services/cloudScriptService";
import ScriptWriter, {
  type ScriptWriterPhase,
} from "@/components/scripts/ScriptWriter";
import {
  deleteCloudVideoProject,
  getCloudVideoProjectById,
  updateCloudVideoProjectIfUnchanged,
} from "@/services/cloudVideoProjectService";
import type { Brand } from "@/types/brand";
import type { CreatorScript } from "@/types/script";
import {
  VIDEO_PROJECT_STATUSES,
  type CreatorVideoProject,
  type UpdateVideoProjectInput,
  type VideoProjectStatus,
} from "@/types/videoProject";

import VideoProjectStageRail from "./VideoProjectStageRail";
import VoiceProductionPanel from "./VoiceProductionPanel";
import VideoProductionPanel from "./VideoProductionPanel";

interface VideoProjectProductionWorkspaceProps {
  brand: Brand;
  initialProject: CreatorVideoProject;
}

interface Feedback {
  type: "success" | "error";
  message: string;
}

type ScriptStageMode = "choose" | "ai" | "existing";

interface AiGenerationOperation {
  token: number;
  projectId: string;
  brandId: string;
  expectedUpdatedAt: string;
  status: VideoProjectStatus;
}

function formatStatus(status: VideoProjectStatus): string {
  if (status === "voice") {
    return "Voice / Audio";
  }

  return status.charAt(0).toUpperCase() + status.slice(1);
}

function getErrorMessage(
  error: unknown,
  fallbackMessage: string,
): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }

  return fallbackMessage;
}

function createContentPreview(content: string): string {
  const normalizedContent = content.trim();

  if (normalizedContent.length <= 900) {
    return normalizedContent;
  }

  return `${normalizedContent.slice(0, 900).trimEnd()}…`;
}

export default function VideoProjectProductionWorkspace(
  props: VideoProjectProductionWorkspaceProps,
) {
  return (
    <VideoProjectProductionWorkspaceContent
      key={`${props.brand.id}:${props.initialProject.id}`}
      {...props}
    />
  );
}

function VideoProjectProductionWorkspaceContent({
  brand,
  initialProject,
}: VideoProjectProductionWorkspaceProps) {
  const router = useRouter();
  const brandId = brand.id;
  const brandName = brand.name;
  const [project, setProject] =
    useState<CreatorVideoProject>(initialProject);
  const [title, setTitle] = useState(initialProject.title);
  const [topic, setTopic] = useState(initialProject.topic);
  const [scripts, setScripts] = useState<CreatorScript[]>([]);
  const [selectedScriptId, setSelectedScriptId] = useState(
    initialProject.scriptId ?? "",
  );
  const [isLoadingScripts, setIsLoadingScripts] = useState(true);
  const [scriptLoadError, setScriptLoadError] =
    useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [isSavingScript, setIsSavingScript] = useState(false);
  const [scriptStageMode, setScriptStageMode] =
    useState<ScriptStageMode>("choose");
  const [hasOpenedAiWriter, setHasOpenedAiWriter] =
    useState(false);
  const [scriptWriterPhase, setScriptWriterPhase] =
    useState<ScriptWriterPhase>("idle");
  const [isAttachingGeneratedScript, setIsAttachingGeneratedScript] =
    useState(false);
  const [isAudioBusy, setIsAudioBusy] = useState(false);
  const [isVideoBusy, setIsVideoBusy] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const mountedRef = useRef(false);
  const projectRef = useRef(initialProject);
  const aiOperationCounterRef = useRef(0);
  const aiOperationRef = useRef<AiGenerationOperation | null>(null);
  const aiBusyRef = useRef(false);
  const generatedAttachmentLatchRef = useRef(false);
  const generatedAttachmentTokenRef = useRef<number | null>(null);
  const deleteLatchRef = useRef(false);
  const confirmedReplacementScriptIdRef = useRef<string | null>(null);
  const generatedScriptsRef = useRef<CreatorScript[]>([]);
  const scriptWriterPhaseRef =
    useRef<ScriptWriterPhase>("idle");

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      aiOperationCounterRef.current += 1;
      aiOperationRef.current = null;
      aiBusyRef.current = false;
      generatedAttachmentLatchRef.current = false;
      generatedAttachmentTokenRef.current = null;
      deleteLatchRef.current = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    async function loadScripts() {
      try {
        const brandScripts =
          await getCloudScriptsByBrand(brandId);

        if (!isActive) {
          return;
        }

        setScripts([
          ...generatedScriptsRef.current,
          ...brandScripts.filter(
            (brandScript) =>
              !generatedScriptsRef.current.some(
                (generatedScript) =>
                  generatedScript.id === brandScript.id,
              ),
          ),
        ]);
        setScriptLoadError(null);
      } catch (error) {
        if (isActive) {
          setScriptLoadError(
            getErrorMessage(
              error,
              "Unable to load saved scripts.",
            ),
          );
        }
      } finally {
        if (isActive) {
          setIsLoadingScripts(false);
        }
      }
    }

    void loadScripts();

    return () => {
      isActive = false;
    };
  }, [brandId]);

  const hasProjectTopic = project.topic.trim().length > 0;
  const aiInitialTopic =
    hasProjectTopic && project.topic.length <= 300
      ? project.topic
      : project.title;
  const aiInitialKeyPoints =
    hasProjectTopic && project.topic.length > 300
      ? project.topic
      : undefined;
  const hasDetailChanges =
    title !== project.title || topic !== project.topic;
  const currentStatusIndex = VIDEO_PROJECT_STATUSES.indexOf(
    project.status,
  );
  const previousStatus =
    currentStatusIndex > 0
      ? VIDEO_PROJECT_STATUSES[currentStatusIndex - 1]
      : null;
  const nextStatus =
    currentStatusIndex < VIDEO_PROJECT_STATUSES.length - 1
      ? VIDEO_PROJECT_STATUSES[currentStatusIndex + 1]
      : null;
  const isVideoPrerequisiteMissing =
    project.videoGenerationId === null &&
    (nextStatus === "video" || nextStatus === "ready");
  const attachedScript =
    scripts.find((script) => script.id === project.scriptId) ?? null;
  const selectedScript =
    scripts.find((script) => script.id === selectedScriptId) ?? null;
  const previewScript = selectedScript ?? attachedScript;
  const isAiBusy =
    scriptWriterPhase !== "idle" || isAttachingGeneratedScript;
  const isNonAudioMutationBusy =
    isSavingDetails ||
    isChangingStatus ||
    isSavingScript ||
    isAiBusy;
  const isMutating =
    isNonAudioMutationBusy || isAudioBusy || isVideoBusy || isDeleting;
  const isAttachDisabled =
    !selectedScript ||
    selectedScript.id === project.scriptId ||
    isLoadingScripts ||
    isMutating;
  const isDetachDisabled =
    project.scriptId === null ||
    isLoadingScripts ||
    isMutating;

  function applyUpdatedProject(
    updatedProject: CreatorVideoProject,
    syncScriptSelection = false,
  ) {
    projectRef.current = updatedProject;
    setProject(updatedProject);

    if (syncScriptSelection) {
      setSelectedScriptId(updatedProject.scriptId ?? "");
    }
  }

  function upsertScript(savedScript: CreatorScript) {
    generatedScriptsRef.current = [
      savedScript,
      ...generatedScriptsRef.current.filter(
        (scriptItem) => scriptItem.id !== savedScript.id,
      ),
    ];
    setScripts((currentScripts) => [
      savedScript,
      ...currentScripts.filter(
        (scriptItem) => scriptItem.id !== savedScript.id,
      ),
    ]);
  }

  async function updateProjectWithConflictRecovery(
    capturedProject: CreatorVideoProject,
    updates: UpdateVideoProjectInput,
    attemptedAction: string,
  ): Promise<CreatorVideoProject | null> {
    const updatedProject =
      await updateCloudVideoProjectIfUnchanged(
        capturedProject.id,
        brandId,
        capturedProject.updatedAt,
        updates,
      );

    if (!mountedRef.current) {
      return null;
    }

    if (updatedProject) {
      return updatedProject;
    }

    try {
      const latestProject = await getCloudVideoProjectById(
        capturedProject.id,
      );

      if (!mountedRef.current) {
        return null;
      }

      if (
        latestProject &&
        latestProject.id === capturedProject.id &&
        latestProject.brandId === brandId
      ) {
        applyUpdatedProject(latestProject, true);
        setTitle(latestProject.title);
        setTopic(latestProject.topic);
        confirmedReplacementScriptIdRef.current = null;
        setFeedback({
          type: "error",
          message: `The project changed elsewhere. ${attemptedAction} was not applied, and the latest project has been loaded.`,
        });
      } else {
        setFeedback({
          type: "error",
          message: `The project changed elsewhere or is no longer available. ${attemptedAction} was not applied.`,
        });
      }
    } catch {
      if (mountedRef.current) {
        setFeedback({
          type: "error",
          message: `The project changed elsewhere. ${attemptedAction} was not applied, and the latest project could not be loaded. Refresh before trying again.`,
        });
      }
    }

    return null;
  }

  async function handleDeleteProject() {
    if (isMutating || deleteLatchRef.current) return;
    if (!window.confirm("Permanently delete this project and its private narration, videos, scene assets, and production history? This cannot be undone.")) return;
    deleteLatchRef.current = true;
    setIsDeleting(true);
    setFeedback(null);
    let navigating = false;
    try {
      const deleted = await deleteCloudVideoProject(brandId, project.id, project.updatedAt);
      if (!deleted) throw new Error("The project could not be found or changed before deletion started.");
      if (!mountedRef.current) return;
      navigating = true;
      router.replace(`/brands/${brandId}/projects`);
      router.refresh();
    } catch (error) {
      if (mountedRef.current) {
        setFeedback({ type: "error", message: getErrorMessage(error, "Unable to delete the project and its media. Retry deletion to continue cleanup.") });
      }
    } finally {
      if (!navigating) {
        deleteLatchRef.current = false;
        if (mountedRef.current) setIsDeleting(false);
      }
    }
  }

  function handleChooseAiScript() {
    if (isMutating || aiBusyRef.current) {
      return;
    }

    const attachedScriptId = projectRef.current.scriptId;

    if (
      attachedScriptId &&
      confirmedReplacementScriptIdRef.current !== attachedScriptId
    ) {
      const confirmed = window.confirm(
        "This project already has an attached script. Creating a new AI script may replace that attachment after saving. The current script will remain in the Script Library. Continue?",
      );

      if (!confirmed) {
        return;
      }

      confirmedReplacementScriptIdRef.current = attachedScriptId;
    }

    setHasOpenedAiWriter(true);
    setScriptStageMode("ai");
    setFeedback(null);
  }

  function handleScriptWriterPhaseChange(
    phase: ScriptWriterPhase,
  ) {
    if (!mountedRef.current) {
      return;
    }

    scriptWriterPhaseRef.current = phase;
    setScriptWriterPhase(phase);

    if (phase === "generating") {
      const currentProject = projectRef.current;
      const token = ++aiOperationCounterRef.current;

      aiOperationRef.current = {
        token,
        projectId: currentProject.id,
        brandId,
        expectedUpdatedAt: currentProject.updatedAt,
        status: currentProject.status,
      };
      aiBusyRef.current = true;
      setFeedback(null);
      return;
    }

    if (phase === "saving") {
      aiBusyRef.current = true;
      return;
    }

    if (!generatedAttachmentLatchRef.current) {
      aiBusyRef.current = false;
    }
  }

  function isCurrentAiOperation(
    operation: AiGenerationOperation,
  ): boolean {
    return (
      mountedRef.current &&
      aiOperationRef.current?.token === operation.token &&
      operation.projectId === projectRef.current.id &&
      operation.brandId === brandId
    );
  }

  async function handleAiScriptSaved(
    savedScript: CreatorScript,
  ) {
    if (!mountedRef.current) {
      return;
    }

    if (savedScript.brandId !== brandId) {
      aiOperationRef.current = null;
      confirmedReplacementScriptIdRef.current = null;
      setScriptStageMode("existing");
      setFeedback({
        type: "error",
        message:
          "The generated script was saved, but it does not belong to this brand and was not attached.",
      });
      return;
    }

    upsertScript(savedScript);
    setSelectedScriptId(savedScript.id);

    if (projectRef.current.scriptId === savedScript.id) {
      aiOperationRef.current = null;
      setFeedback({
        type: "success",
        message:
          "Script changes saved to the Script Library and remain attached to this project.",
      });
      return;
    }

    const operation = aiOperationRef.current;

    if (!operation || !isCurrentAiOperation(operation)) {
      aiOperationRef.current = null;
      confirmedReplacementScriptIdRef.current = null;
      setScriptStageMode("existing");
      setFeedback({
        type: "error",
        message:
          "The script was saved to the Script Library but was not attached because the generation context changed. You can attach it manually.",
      });
      return;
    }

    if (generatedAttachmentLatchRef.current) {
      return;
    }

    const updates: UpdateVideoProjectInput = {
      scriptId: savedScript.id,
    };

    if (operation.status === "idea") {
      updates.status = "script";
    }

    generatedAttachmentLatchRef.current = true;
    generatedAttachmentTokenRef.current = operation.token;
    aiBusyRef.current = true;
    setIsAttachingGeneratedScript(true);

    try {
      const updatedProject =
        await updateCloudVideoProjectIfUnchanged(
          operation.projectId,
          operation.brandId,
          operation.expectedUpdatedAt,
          updates,
        );

      if (!isCurrentAiOperation(operation)) {
        return;
      }

      if (updatedProject) {
        applyUpdatedProject(updatedProject, true);
        aiOperationRef.current = null;
        confirmedReplacementScriptIdRef.current = null;
        setScriptStageMode("choose");
        setFeedback({
          type: "success",
          message:
            operation.status === "idea"
              ? "Script saved, attached, and project advanced to Script."
              : "Script saved to the library and attached to this project.",
        });
        return;
      }

      const latestProject = await getCloudVideoProjectById(
        operation.projectId,
      );

      if (!isCurrentAiOperation(operation)) {
        return;
      }

      if (
        latestProject &&
        latestProject.id === operation.projectId &&
        latestProject.brandId === operation.brandId
      ) {
        applyUpdatedProject(latestProject);
        setTitle(latestProject.title);
        setTopic(latestProject.topic);
      }

      aiOperationRef.current = null;
      confirmedReplacementScriptIdRef.current = null;
      setSelectedScriptId(savedScript.id);
      setScriptStageMode("existing");
      setFeedback({
        type: "error",
        message:
          "The script was saved to the Script Library but was not attached because the project changed. You can attach it manually.",
      });
    } catch (error) {
      if (isCurrentAiOperation(operation)) {
        aiOperationRef.current = null;
        confirmedReplacementScriptIdRef.current = null;
        setSelectedScriptId(savedScript.id);
        setScriptStageMode("existing");
        setFeedback({
          type: "error",
          message: `The script was saved to the Script Library but could not be attached. ${getErrorMessage(
            error,
            "Please attach it manually.",
          )}`,
        });
      }
    } finally {
      if (
        generatedAttachmentTokenRef.current === operation.token
      ) {
        generatedAttachmentLatchRef.current = false;
        generatedAttachmentTokenRef.current = null;

        if (mountedRef.current) {
          setIsAttachingGeneratedScript(false);

          if (scriptWriterPhaseRef.current === "idle") {
            aiBusyRef.current = false;
          }
        }
      }
    }
  }

  async function handleSaveDetails(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (isMutating || aiBusyRef.current) {
      return;
    }

    const normalizedTitle = title.trim();
    const normalizedTopic = topic.trim();

    if (!normalizedTitle) {
      setFeedback({
        type: "error",
        message: "Project title is required.",
      });
      return;
    }

    const currentProject = projectRef.current;

    setIsSavingDetails(true);
    setFeedback(null);

    try {
      const updatedProject = await updateProjectWithConflictRecovery(
        currentProject,
        {
          title: normalizedTitle,
          topic: normalizedTopic,
        },
        "Your project detail changes",
      );

      if (!updatedProject) {
        return;
      }

      if (!mountedRef.current) {
        return;
      }

      applyUpdatedProject(updatedProject);
      setTitle(updatedProject.title);
      setTopic(updatedProject.topic);
      setFeedback({
        type: "success",
        message: "Project details saved.",
      });
    } catch (error) {
      if (mountedRef.current) {
        setFeedback({
          type: "error",
          message: getErrorMessage(
            error,
            "Unable to save project details.",
          ),
        });
      }
    } finally {
      if (mountedRef.current) {
        setIsSavingDetails(false);
      }
    }
  }

  async function handleStatusChange(
    targetStatus: VideoProjectStatus,
  ) {
    if (isMutating || aiBusyRef.current) {
      return;
    }

    const currentProject = projectRef.current;
    const targetIndex =
      VIDEO_PROJECT_STATUSES.indexOf(targetStatus);
    const currentIndex = VIDEO_PROJECT_STATUSES.indexOf(
      currentProject.status,
    );

    if (Math.abs(targetIndex - currentIndex) !== 1) {
      setFeedback({
        type: "error",
        message:
          "Project status can only move one stage at a time.",
      });
      return;
    }

    setIsChangingStatus(true);
    setFeedback(null);

    try {
      const updatedProject = await updateProjectWithConflictRecovery(
        currentProject,
        {
          status: targetStatus,
        },
        "Your status change",
      );

      if (!updatedProject) {
        return;
      }

      if (!mountedRef.current) {
        return;
      }

      applyUpdatedProject(updatedProject);
      setFeedback({
        type: "success",
        message: `Project moved to ${formatStatus(
          updatedProject.status,
        )}.`,
      });
    } catch (error) {
      if (mountedRef.current) {
        setFeedback({
          type: "error",
          message: getErrorMessage(
            error,
            "Unable to change the project status.",
          ),
        });
      }
    } finally {
      if (mountedRef.current) {
        setIsChangingStatus(false);
      }
    }
  }

  async function handleAttachScript() {
    if (isAttachDisabled || aiBusyRef.current) {
      return;
    }

    if (!scripts.some((script) => script.id === selectedScriptId)) {
      setFeedback({
        type: "error",
        message:
          "Select a script saved to the current brand.",
      });
      return;
    }

    const currentProject = projectRef.current;

    if (
      currentProject.scriptId &&
      currentProject.scriptId !== selectedScriptId
    ) {
      const confirmed = window.confirm(
        "Replace the currently attached script? The existing script will remain in the Script Library.",
      );

      if (!confirmed) {
        return;
      }
    }

    const updates: UpdateVideoProjectInput = {
      scriptId: selectedScriptId,
    };

    if (currentProject.status === "idea") {
      updates.status = "script";
    }

    setIsSavingScript(true);
    setFeedback(null);

    try {
      const updatedProject = await updateProjectWithConflictRecovery(
        currentProject,
        updates,
        "Your script attachment",
      );

      if (!updatedProject) {
        return;
      }

      if (!mountedRef.current) {
        return;
      }

      applyUpdatedProject(updatedProject, true);
      confirmedReplacementScriptIdRef.current = null;
      setScriptStageMode("choose");
      setFeedback({
        type: "success",
        message:
          currentProject.status === "idea"
            ? "Script attached and project advanced to Script."
            : "Script attached to this project.",
      });
    } catch (error) {
      if (mountedRef.current) {
        setFeedback({
          type: "error",
          message: getErrorMessage(
            error,
            "Unable to update the attached script.",
          ),
        });
      }
    } finally {
      if (mountedRef.current) {
        setIsSavingScript(false);
      }
    }
  }

  async function handleDetachScript() {
    if (isDetachDisabled || aiBusyRef.current) {
      return;
    }

    const currentProject = projectRef.current;

    setIsSavingScript(true);
    setFeedback(null);

    try {
      const updatedProject = await updateProjectWithConflictRecovery(
        currentProject,
        {
          scriptId: null,
        },
        "Your script detachment",
      );

      if (!updatedProject) {
        return;
      }

      if (!mountedRef.current) {
        return;
      }

      applyUpdatedProject(updatedProject, true);
      confirmedReplacementScriptIdRef.current = null;
      setFeedback({
        type: "success",
        message: "Script detached from this project.",
      });
    } catch (error) {
      if (mountedRef.current) {
        setFeedback({
          type: "error",
          message: getErrorMessage(
            error,
            "Unable to detach the script.",
          ),
        });
      }
    } finally {
      if (mountedRef.current) {
        setIsSavingScript(false);
      }
    }
  }

  return (
    <div className="-m-8 min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1500px] space-y-8">
        <header className="overflow-hidden rounded-[28px] bg-[linear-gradient(115deg,#0f172a_0%,#1e1b4b_100%)] px-5 py-7 text-white shadow-[0_24px_70px_-28px_rgba(15,23,42,0.85)] sm:px-8 sm:py-9 lg:px-10">
          <nav
            aria-label="Breadcrumb"
            className="flex flex-wrap items-center gap-2 text-sm font-semibold text-indigo-200"
          >
            <Link
              href="/brands"
              className="transition hover:text-white"
            >
              Brands
            </Link>
            <ChevronRight
              className="h-4 w-4 opacity-60"
              aria-hidden="true"
            />
            <Link
              href={`/brands/${brandId}/projects`}
              className="transition hover:text-white"
            >
              {brandName} / Video Projects
            </Link>
            <ChevronRight
              className="h-4 w-4 opacity-60"
              aria-hidden="true"
            />
            <span className="max-w-64 truncate text-white">
              {project.title}
            </span>
          </nav>

          <div className="mt-7 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-indigo-200">
                Production workspace
              </p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
                {project.title}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                Move this project through each production stage
                while keeping its script and details connected.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={`/brands/${brandId}/scripts`}
                className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-violet-950/30 transition hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-300/40"
              >
                <FileText className="h-4 w-4" aria-hidden="true" />
                Script Library
              </Link>
              <span className="w-fit rounded-full border border-indigo-300/30 bg-indigo-400/15 px-4 py-2 text-xs font-bold text-indigo-100">
                Current stage: {formatStatus(project.status)}
              </span>
            </div>
          </div>
        </header>

        <div
          className="min-h-6 text-sm"
          aria-live="polite"
        >
          {feedback && (
            <p
              role={
                feedback.type === "error" ? "alert" : "status"
              }
              className={
                feedback.type === "success"
                  ? "rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 font-medium text-emerald-700"
                  : "rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 font-medium text-rose-700"
              }
            >
              {feedback.message}
            </p>
          )}
        </div>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-950/5 sm:p-7">
          <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
                Workflow
              </p>
              <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
                Production stages
              </h2>
            </div>
            <p className="text-sm text-slate-500">
              Move one adjacent stage at a time.
            </p>
          </div>

          <div className="mt-6">
            <VideoProjectStageRail
              currentStatus={project.status}
            />
          </div>

          <div className="mt-6 flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              disabled={!previousStatus || isMutating}
              onClick={() => {
                if (previousStatus) {
                  void handleStatusChange(previousStatus);
                }
              }}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft
                className="h-4 w-4"
                aria-hidden="true"
              />
              {previousStatus
                ? `Back to ${formatStatus(previousStatus)}`
                : "First stage"}
            </button>

            <button
              type="button"
              disabled={
                !nextStatus || isMutating || isVideoPrerequisiteMissing
              }
              onClick={() => {
                if (nextStatus) {
                  void handleStatusChange(nextStatus);
                }
              }}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
            >
              {isChangingStatus
                ? "Updating stage..."
                : nextStatus
                  ? `Advance to ${formatStatus(nextStatus)}`
                  : "Workflow complete"}
              <ChevronRight
                className="h-4 w-4"
                aria-hidden="true"
              />
            </button>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-950/5 sm:p-7">
          <div className="border-b border-slate-200 pb-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
              Project details
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
              Creative brief
            </h2>
          </div>

          <form
            onSubmit={handleSaveDetails}
            className="mt-6 space-y-5"
          >
            <label className="block">
              <span className="text-sm font-semibold text-slate-800">
                Project title{" "}
                <span className="text-indigo-600">*</span>
              </span>
              <input
                value={title}
                disabled={isMutating}
                maxLength={300}
                required
                onChange={(event) => {
                  setTitle(event.target.value);
                  setFeedback(null);
                }}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-3 text-sm text-slate-950 outline-none transition focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-slate-800">
                Topic
              </span>
              <textarea
                value={topic}
                disabled={isMutating}
                maxLength={1000}
                rows={4}
                onChange={(event) => {
                  setTopic(event.target.value);
                  setFeedback(null);
                }}
                className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-3 text-sm leading-6 text-slate-950 outline-none transition focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!hasDetailChanges || isMutating}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                {isSavingDetails
                  ? "Saving details..."
                  : "Save Details"}
              </button>
            </div>
          </form>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-950/5">
          <header className="flex flex-col gap-4 border-b border-slate-200 bg-gradient-to-r from-violet-50 via-white to-fuchsia-50 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white">
                <FileText className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">
                  Script stage
                </p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
                  Create or attach a script
                </h2>
              </div>
            </div>

            {isAiBusy && (
              <span
                role="status"
                className="w-fit rounded-full border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 shadow-sm"
              >
                {isAttachingGeneratedScript
                  ? "Attaching generated script..."
                  : scriptWriterPhase === "saving"
                    ? "Saving generated script..."
                    : "Generating script..."}
              </span>
            )}
          </header>

          <div className="space-y-6 p-5 sm:p-7">
            {project.scriptId ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">
                      Attached to this project
                    </p>
                    {attachedScript ? (
                      <>
                        <h3 className="mt-2 text-lg font-bold text-slate-950">
                          {attachedScript.title}
                        </h3>
                        <p className="mt-1 text-sm text-emerald-800">
                          {attachedScript.topic}
                        </p>
                        <div className="mt-4 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl border border-emerald-200 bg-white/90 p-4 text-sm leading-7 text-slate-700">
                          {attachedScript.content}
                        </div>
                      </>
                    ) : (
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        The attached script is not available in this
                        brand&apos;s current Script Library.
                      </p>
                    )}
                  </div>
                  <span className="w-fit rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">
                    Attached
                  </span>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-violet-200 bg-violet-50/50 px-5 py-4 text-sm leading-6 text-slate-600">
                No script is attached yet. Create one with AI or
                choose an existing script from this brand.
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <button
                type="button"
                aria-pressed={scriptStageMode === "ai"}
                disabled={isMutating}
                onClick={handleChooseAiScript}
                className="flex min-h-32 items-start gap-4 rounded-2xl border border-violet-200 bg-violet-50/70 p-5 text-left transition hover:border-violet-400 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white">
                  <Sparkles className="h-5 w-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-base font-bold text-slate-950">
                    Create Script with AI
                  </span>
                  <span className="mt-1 block text-sm leading-6 text-slate-600">
                    Generate with this project and brand context,
                    then save it to the Script Library.
                  </span>
                </span>
              </button>

              <button
                type="button"
                aria-pressed={scriptStageMode === "existing"}
                disabled={isMutating}
                onClick={() => {
                  setScriptStageMode("existing");
                  setFeedback(null);
                }}
                className="flex min-h-32 items-start gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-5 text-left transition hover:border-violet-300 hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
                  <FileText className="h-5 w-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-base font-bold text-slate-950">
                    Attach Existing Script
                  </span>
                  <span className="mt-1 block text-sm leading-6 text-slate-600">
                    Select a saved script belonging to this brand and
                    attach it to the project.
                  </span>
                </span>
              </button>
            </div>

            {scriptStageMode === "choose" && (
              <p className="text-center text-sm text-slate-500">
                Choose how you want to complete the Script stage.
              </p>
            )}

            {hasOpenedAiWriter && (
              <div
                className={
                  scriptStageMode === "ai"
                    ? "border-t border-slate-200 pt-6"
                    : "hidden"
                }
              >
                <ScriptWriter
                  brand={brand}
                  embedded
                  autoSaveAfterGeneration
                  sessionScope={`video-project:${project.id}`}
                  initialTopic={aiInitialTopic}
                  initialKeyPoints={aiInitialKeyPoints}
                  onScriptSaved={handleAiScriptSaved}
                  onPhaseChange={handleScriptWriterPhaseChange}
                />
              </div>
            )}

            <div
              className={
                scriptStageMode === "existing"
                  ? "grid gap-6 border-t border-slate-200 pt-6 lg:grid-cols-[minmax(16rem,0.75fr)_minmax(0,1.4fr)]"
                  : "hidden"
              }
            >
              <div>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-800">
                    Saved script
                  </span>
                  <select
                    value={selectedScriptId}
                    disabled={isLoadingScripts || isMutating}
                    onChange={(event) => {
                      setSelectedScriptId(event.target.value);
                      setFeedback(null);
                    }}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="">Select a saved script</option>
                    {scripts.map((scriptItem) => (
                      <option key={scriptItem.id} value={scriptItem.id}>
                        {scriptItem.title}
                      </option>
                    ))}
                  </select>
                </label>

                {isLoadingScripts && (
                  <p className="mt-3 text-sm text-slate-500">
                    Loading saved scripts...
                  </p>
                )}

                {scriptLoadError && (
                  <p
                    role="alert"
                    className="mt-3 text-sm font-medium text-rose-600"
                  >
                    {scriptLoadError}
                  </p>
                )}

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    disabled={isAttachDisabled}
                    onClick={() => void handleAttachScript()}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-600/20 transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                  >
                    <Save className="h-4 w-4" aria-hidden="true" />
                    {isSavingScript ? "Saving..." : "Attach Script"}
                  </button>

                  <button
                    type="button"
                    disabled={isDetachDisabled}
                    onClick={() => void handleDetachScript()}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-violet-200 px-4 py-2.5 text-sm font-semibold text-violet-700 transition hover:border-violet-300 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSavingScript ? "Saving..." : "Detach Script"}
                  </button>
                </div>
              </div>

              <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
                {previewScript ? (
                  <>
                    <h3 className="text-lg font-bold text-slate-950">
                      {previewScript.title}
                    </h3>
                    <p className="mt-1 text-sm font-medium text-violet-600">
                      {previewScript.topic}
                    </p>
                    <div className="mt-4 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-4 text-sm leading-7 text-slate-700">
                      {createContentPreview(previewScript.content)}
                    </div>
                  </>
                ) : project.scriptId ? (
                  <div className="flex min-h-48 items-center justify-center text-center">
                    <p className="max-w-sm text-sm leading-6 text-slate-500">
                      The attached script is not available in this
                      brand&apos;s current Script Library.
                    </p>
                  </div>
                ) : (
                  <div className="flex min-h-48 items-center justify-center text-center">
                    <p className="max-w-sm text-sm leading-6 text-slate-500">
                      Attach a saved script from this brand to keep
                      production connected to the approved draft.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <VoiceProductionPanel
          brandId={brandId}
          project={project}
          attachedScript={attachedScript}
          isScriptLoading={isLoadingScripts}
          disabled={isNonAudioMutationBusy || isVideoBusy}
          onProjectUpdated={(updatedProject) => {
            applyUpdatedProject(updatedProject);
          }}
          onBusyChange={setIsAudioBusy}
        />

        <VideoProductionPanel
          brandId={brandId}
          project={project}
          attachedScript={attachedScript}
          disabled={isNonAudioMutationBusy || isAudioBusy}
          onProjectUpdated={(updatedProject) => {
            applyUpdatedProject(updatedProject);
          }}
          onBusyChange={setIsVideoBusy}
        />

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-950/5">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
              <CheckCircle2
                className="h-5 w-5"
                aria-hidden="true"
              />
            </span>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">
              Ready
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
              Final review
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              Use the Ready stage when the script and future
              production assets have completed review.
            </p>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-950/5">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-200 text-slate-700">
              <Send className="h-5 w-5" aria-hidden="true" />
            </span>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
              Published
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
              Release complete
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              Mark the project Published after its release. Publishing
              automation is outside this milestone.
            </p>
          </section>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href={`/brands/${brandId}/projects`}
            className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-700 transition hover:text-indigo-500"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to all video projects
          </Link>
          <button
            type="button"
            disabled={isMutating}
            onClick={() => void handleDeleteProject()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {isDeleting ? "Deleting project and media..." : "Delete project"}
          </button>
        </div>
      </div>
    </div>
  );
}
