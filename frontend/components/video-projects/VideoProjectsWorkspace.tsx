"use client";

import {
  ArrowLeft,
  ArrowRight,
  FolderKanban,
  Plus,
} from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  CLOUD_VIDEO_PROJECTS_CHANGED_EVENT,
  createCloudVideoProject,
  getCloudVideoProjectsByBrand,
} from "@/services/cloudVideoProjectService";
import type {
  CreatorVideoProject,
  VideoProjectStatus,
} from "@/types/videoProject";

interface VideoProjectsWorkspaceProps {
  brandId: string;
  brandName: string;
}

interface Feedback {
  type: "success" | "error";
  message: string;
}

const STATUS_CLASS_NAMES: Record<VideoProjectStatus, string> = {
  idea: "border-sky-200 bg-sky-50 text-sky-700",
  script: "border-violet-200 bg-violet-50 text-violet-700",
  voice: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
  video: "border-amber-200 bg-amber-50 text-amber-700",
  ready: "border-emerald-200 bg-emerald-50 text-emerald-700",
  published: "border-slate-300 bg-slate-100 text-slate-700",
};

function formatStatus(status: VideoProjectStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatUpdatedAt(updatedAt: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(updatedAt));
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

export default function VideoProjectsWorkspace(
  props: VideoProjectsWorkspaceProps,
) {
  return (
    <VideoProjectsWorkspaceContent
      key={props.brandId}
      {...props}
    />
  );
}

function VideoProjectsWorkspaceContent({
  brandId,
  brandName,
}: VideoProjectsWorkspaceProps) {
  const [projects, setProjects] = useState<CreatorVideoProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [initialLoadError, setInitialLoadError] =
    useState<string | null>(null);
  const mountedRef = useRef(false);
  const currentBrandIdRef = useRef(brandId);
  const requestIdRef = useRef(0);
  const isCreatingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    async function loadProjects(
      failureMessage: string,
      isInitialLoad: boolean,
    ) {
      const requestId = ++requestIdRef.current;

      try {
        const cloudProjects =
          await getCloudVideoProjectsByBrand(brandId);

        if (
          !isActive ||
          requestId !== requestIdRef.current
        ) {
          return;
        }

        setProjects(cloudProjects);
        setInitialLoadError(null);
        setFeedback((current) =>
          current?.type === "error" ? null : current,
        );
      } catch (error) {
        if (
          isActive &&
          requestId === requestIdRef.current
        ) {
          const message = getErrorMessage(error, failureMessage);

          if (isInitialLoad) {
            setInitialLoadError(message);
          } else {
            setFeedback({
              type: "error",
              message,
            });
          }
        }
      } finally {
        if (
          isActive &&
          requestId === requestIdRef.current
        ) {
          setIsLoading(false);
        }
      }
    }

    function handleProjectsChanged() {
      if (isCreatingRef.current) {
        return;
      }

      void loadProjects(
        "Unable to refresh video projects. Please try again.",
        false,
      );
    }

    void loadProjects(
      "Unable to load video projects. Please try again.",
      true,
    );
    window.addEventListener(
      CLOUD_VIDEO_PROJECTS_CHANGED_EVENT,
      handleProjectsChanged,
    );

    return () => {
      isActive = false;
      requestIdRef.current += 1;
      window.removeEventListener(
        CLOUD_VIDEO_PROJECTS_CHANGED_EVENT,
        handleProjectsChanged,
      );
    };
  }, [brandId]);

  function canUpdate(expectedBrandId: string): boolean {
    return (
      mountedRef.current &&
      currentBrandIdRef.current === expectedBrandId
    );
  }

  async function handleCreateProject(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (isCreatingRef.current) {
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

    const expectedBrandId = brandId;
    let projectWasCreated = false;
    isCreatingRef.current = true;
    setIsCreating(true);
    setFeedback(null);

    try {
      await createCloudVideoProject({
        brandId: expectedBrandId,
        scriptId: null,
        title: normalizedTitle,
        topic: normalizedTopic,
        status: "idea",
      });
      projectWasCreated = true;

      if (canUpdate(expectedBrandId)) {
        setTitle("");
        setTopic("");
      }

      const requestId = ++requestIdRef.current;
      const refreshedProjects =
        await getCloudVideoProjectsByBrand(expectedBrandId);

      if (
        canUpdate(expectedBrandId) &&
        requestId === requestIdRef.current
      ) {
        setProjects(refreshedProjects);
        setInitialLoadError(null);
        setIsLoading(false);
        setFeedback({
          type: "success",
          message: "Video project created.",
        });
      }
    } catch (error) {
      if (canUpdate(expectedBrandId)) {
        setFeedback({
          type: "error",
          message: projectWasCreated
            ? "The project was created, but the list could not be refreshed. Please reload the page."
            : getErrorMessage(
                error,
                "Unable to create this video project.",
              ),
        });
      }
    } finally {
      isCreatingRef.current = false;

      if (canUpdate(expectedBrandId)) {
        setIsCreating(false);
      }
    }
  }

  return (
    <div className="-m-8 min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1500px] space-y-8">
        <header className="overflow-hidden rounded-[28px] bg-[linear-gradient(115deg,#0f172a_0%,#1e1b4b_100%)] px-5 py-7 text-white shadow-[0_24px_70px_-28px_rgba(15,23,42,0.85)] sm:px-8 sm:py-9 lg:px-10">
          <div className="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <Link
                href={`/brands/${brandId}`}
                className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-200 transition hover:text-white"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back to Script Writer
              </Link>

              <div className="mt-6 flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500 text-white shadow-lg shadow-indigo-950/30">
                  <FolderKanban
                    className="h-5 w-5"
                    aria-hidden="true"
                  />
                </span>
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-indigo-200">
                  Production workspace
                </p>
              </div>

              <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
                Video Projects
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base sm:leading-7">
                Organize each video from its first idea through
                production and publishing.
              </p>
            </div>

            <span className="max-w-full truncate rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold text-white backdrop-blur-sm">
              {brandName}
            </span>
          </div>
        </header>

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[360px_minmax(0,1fr)] xl:gap-8">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_20px_50px_-24px_rgba(15,23,42,0.35)] sm:p-6 lg:sticky lg:top-6">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-600">
              New project
            </p>
            <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-950">
              Start with an idea
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Create the project now and continue into its dedicated
              production workspace.
            </p>

            <form
              onSubmit={handleCreateProject}
              className="mt-6 space-y-5"
            >
              <label className="block">
                <span className="text-sm font-semibold text-slate-800">
                  Project title{" "}
                  <span className="text-indigo-600">*</span>
                </span>
                <input
                  value={title}
                  disabled={isCreating}
                  maxLength={300}
                  required
                  placeholder="Launch video, tutorial, campaign..."
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setFeedback(null);
                  }}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-3 text-sm text-slate-950 shadow-inner shadow-slate-100 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-slate-800">
                  Topic
                </span>
                <textarea
                  value={topic}
                  disabled={isCreating}
                  maxLength={1000}
                  rows={4}
                  placeholder="What should this video cover?"
                  onChange={(event) => {
                    setTopic(event.target.value);
                    setFeedback(null);
                  }}
                  className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-3 text-sm leading-6 text-slate-950 shadow-inner shadow-slate-100 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>

              <button
                type="submit"
                disabled={isCreating}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {isCreating ? "Creating..." : "Create Project"}
              </button>
            </form>
          </section>

          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-950/5">
            <header className="flex flex-col gap-3 border-b border-slate-200 bg-gradient-to-r from-violet-50 via-white to-fuchsia-50 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">
                  Current pipeline
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
                  Your projects
                </h2>
              </div>
              <div className="w-fit rounded-full border border-violet-200 bg-white/80 px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm">
                {projects.length}{" "}
                {projects.length === 1 ? "project" : "projects"}
              </div>
            </header>

            <div className="p-5 sm:p-7">
              <div
                className="mb-5 min-h-6 text-sm"
                aria-live="polite"
              >
                {feedback && (
                  <p
                    role={
                      feedback.type === "error"
                        ? "alert"
                        : "status"
                    }
                    className={
                      feedback.type === "success"
                        ? "font-medium text-emerald-600"
                        : "font-medium text-rose-600"
                    }
                  >
                    {feedback.message}
                  </p>
                )}
              </div>

              {isLoading ? (
                <div className="flex min-h-80 items-center justify-center text-sm text-slate-500">
                  Loading video projects...
                </div>
              ) : initialLoadError ? (
                <div className="flex min-h-80 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50/70 px-6 py-14 text-center">
                  <p
                    role="alert"
                    className="max-w-md text-sm font-medium leading-6 text-rose-700"
                  >
                    {initialLoadError}
                  </p>
                </div>
              ) : projects.length === 0 ? (
                <div className="flex min-h-80 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-6 py-14 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 text-violet-600">
                    <FolderKanban
                      className="h-7 w-7"
                      aria-hidden="true"
                    />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-slate-900">
                    No video projects yet
                  </h3>
                  <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                    Start with a title and topic. Every new project
                    begins in the Idea stage.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 xl:grid-cols-2">
                  {projects.map((project) => (
                    <Link
                      key={project.id}
                      href={`/brands/${brandId}/projects/${project.id}`}
                      className="group flex min-h-48 flex-col rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-950/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-100"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-bold ${STATUS_CLASS_NAMES[project.status]}`}
                        >
                          {formatStatus(project.status)}
                        </span>
                        <ArrowRight
                          className="h-5 w-5 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-indigo-600"
                          aria-hidden="true"
                        />
                      </div>

                      <h3 className="mt-4 text-lg font-bold tracking-tight text-slate-950">
                        {project.title}
                      </h3>

                      {project.topic && (
                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">
                          {project.topic}
                        </p>
                      )}

                      <p className="mt-auto pt-5 text-xs font-medium text-slate-400">
                        Updated {formatUpdatedAt(project.updatedAt)}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
