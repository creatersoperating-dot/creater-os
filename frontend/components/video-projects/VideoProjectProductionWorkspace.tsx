"use client";

import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  FileText,
  Mic,
  Save,
  Send,
} from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { getCloudScriptsByBrand } from "@/services/cloudScriptService";
import { updateCloudVideoProject } from "@/services/cloudVideoProjectService";
import type { CreatorScript } from "@/types/script";
import {
  VIDEO_PROJECT_STATUSES,
  type CreatorVideoProject,
  type VideoProjectStatus,
} from "@/types/videoProject";

import VideoProjectStageRail from "./VideoProjectStageRail";

interface VideoProjectProductionWorkspaceProps {
  brandId: string;
  brandName: string;
  initialProject: CreatorVideoProject;
}

interface Feedback {
  type: "success" | "error";
  message: string;
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
      key={`${props.brandId}:${props.initialProject.id}`}
      {...props}
    />
  );
}

function VideoProjectProductionWorkspaceContent({
  brandId,
  brandName,
  initialProject,
}: VideoProjectProductionWorkspaceProps) {
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
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
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

        setScripts(brandScripts);
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
  const attachedScript =
    scripts.find((script) => script.id === project.scriptId) ?? null;
  const selectedScript =
    scripts.find((script) => script.id === selectedScriptId) ?? null;
  const previewScript = selectedScript ?? attachedScript;
  const isAttachDisabled =
    !selectedScript ||
    selectedScript.id === project.scriptId ||
    isLoadingScripts ||
    isSavingScript;
  const isDetachDisabled =
    project.scriptId === null ||
    isLoadingScripts ||
    isSavingScript;
  const isMutating =
    isSavingDetails || isChangingStatus || isSavingScript;

  function applyUpdatedProject(
    updatedProject: CreatorVideoProject,
    syncScriptSelection = false,
  ) {
    setProject(updatedProject);

    if (syncScriptSelection) {
      setSelectedScriptId(updatedProject.scriptId ?? "");
    }
  }

  async function handleSaveDetails(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (isMutating) {
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

    setIsSavingDetails(true);
    setFeedback(null);

    try {
      const updatedProject = await updateCloudVideoProject(
        project.id,
        {
          title: normalizedTitle,
          topic: normalizedTopic,
        },
      );

      if (!updatedProject) {
        throw new Error("This video project could not be found.");
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
    if (isMutating) {
      return;
    }

    const targetIndex =
      VIDEO_PROJECT_STATUSES.indexOf(targetStatus);
    const currentIndex = VIDEO_PROJECT_STATUSES.indexOf(
      project.status,
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
      const updatedProject = await updateCloudVideoProject(
        project.id,
        {
          status: targetStatus,
        },
      );

      if (!updatedProject) {
        throw new Error("This video project could not be found.");
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
    if (isAttachDisabled) {
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

    setIsSavingScript(true);
    setFeedback(null);

    try {
      const updatedProject = await updateCloudVideoProject(
        project.id,
        {
          scriptId: selectedScriptId,
        },
      );

      if (!updatedProject) {
        throw new Error("This video project could not be found.");
      }

      if (!mountedRef.current) {
        return;
      }

      applyUpdatedProject(updatedProject, true);
      setFeedback({
        type: "success",
        message: "Script attached to this project.",
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
    if (isDetachDisabled) {
      return;
    }

    setIsSavingScript(true);
    setFeedback(null);

    try {
      const updatedProject = await updateCloudVideoProject(
        project.id,
        {
          scriptId: null,
        },
      );

      if (!updatedProject) {
        throw new Error("This video project could not be found.");
      }

      if (!mountedRef.current) {
        return;
      }

      applyUpdatedProject(updatedProject, true);
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
              href={`/brands/${brandId}`}
              className="transition hover:text-white"
            >
              {brandName}
            </Link>
            <ChevronRight
              className="h-4 w-4 opacity-60"
              aria-hidden="true"
            />
            <Link
              href={`/brands/${brandId}/projects`}
              className="transition hover:text-white"
            >
              Video Projects
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

            <span className="w-fit rounded-full border border-indigo-300/30 bg-indigo-400/15 px-4 py-2 text-xs font-bold text-indigo-100">
              Current stage: {formatStatus(project.status)}
            </span>
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
              disabled={!nextStatus || isMutating}
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
                  Attached script
                </h2>
              </div>
            </div>
          </header>

          <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(16rem,0.75fr)_minmax(0,1.4fr)]">
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
                  {scripts.map((script) => (
                    <option key={script.id} value={script.id}>
                      {script.title}
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
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-950/5">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-fuchsia-100 text-fuchsia-700">
              <Mic className="h-5 w-5" aria-hidden="true" />
            </span>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-600">
              Voice / Audio
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
              Narration workspace
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              Voice and audio generation will be added in a future
              milestone. No audio is generated or stored here yet.
            </p>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-950/5">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <Clapperboard
                className="h-5 w-5"
                aria-hidden="true"
              />
            </span>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">
              Video
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
              Video production
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              Video generation will be added in a future milestone.
              This panel is a production-stage placeholder only.
            </p>
          </section>

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

        <Link
          href={`/brands/${brandId}/projects`}
          className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-700 transition hover:text-indigo-500"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to all video projects
        </Link>
      </div>
    </div>
  );
}
