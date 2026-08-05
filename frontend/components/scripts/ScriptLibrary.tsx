"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  CLOUD_SCRIPT_LIBRARY_CHANGED_EVENT,
  deleteCloudScript,
  getCloudScriptsByBrand,
  updateCloudScript,
} from "@/services/cloudScriptService";
import type { CreatorScript } from "../../types/script";

import {
  getLocalScriptCount,
  importLocalScriptsToBrand,
} from "@/services/localScriptImportService";

interface ScriptLibraryProps {
  brandId: string;
}

type Feedback =
  | {
      type: "success" | "error";
      message: string;
    }
  | null;

function formatUpdatedAt(updatedAt: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(updatedAt));
}

export default function ScriptLibrary({ brandId }: ScriptLibraryProps) {
  const [scripts, setScripts] = useState<CreatorScript[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [localScriptCount, setLocalScriptCount] = useState(0);
  const [isImporting, setIsImporting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [content, setContent] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const draftScriptIdRef = useRef<string | null>(null);

  const selectedScript = useMemo(
    () => scripts.find((script) => script.id === selectedId) ?? null,
    [scripts, selectedId],
  );

  useEffect(() => {
    let isActive = true;

    queueMicrotask(() => {
      if (isActive) {
        setLocalScriptCount(getLocalScriptCount());
      }
    });

    return () => {
      isActive = false;
    };
  }, [brandId]);

  useEffect(() => {
    let isActive = true;

    queueMicrotask(() => {
      if (!isActive) {
        return;
      }

      setFeedback(null);
      setIsLoading(true);
      draftScriptIdRef.current = null;
      setScripts([]);
      setSelectedId(null);
    });

    void getCloudScriptsByBrand(brandId)
      .then((brandScripts) => {
        if (!isActive) {
          return;
        }
        setScripts(brandScripts);
        setSelectedId(brandScripts[0]?.id ?? null);
      })
      .catch(() => {
        if (isActive) {
          setFeedback({
            type: "error",
            message: "Unable to load scripts. Please try again.",
          });
        }
      })
      .finally(() => {
        if (isActive) {
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [brandId]);

  useEffect(() => {
    let isActive = true;

    queueMicrotask(() => {
      if (!isActive) {
        return;
      }

      if (!selectedScript) {
        draftScriptIdRef.current = null;
        setTitle("");
        setTopic("");
        setContent("");
        return;
      }

      if (draftScriptIdRef.current === selectedScript.id) {
        return;
      }

      draftScriptIdRef.current = selectedScript.id;
      setTitle(selectedScript.title);
      setTopic(selectedScript.topic);
      setContent(selectedScript.content);
    });

    return () => {
      isActive = false;
    };
  }, [selectedScript]);

  const hasUnsavedChanges =
    selectedScript !== null &&
    (title !== selectedScript.title ||
      topic !== selectedScript.topic ||
      content !== selectedScript.content);

  useEffect(() => {
    let isActive = true;

    async function refreshLibrary() {
      try {
        const refreshedScripts = await getCloudScriptsByBrand(brandId);

        if (!isActive) {
          return;
        }
      const selectedStillExists = refreshedScripts.some(
        (script) => script.id === selectedId,
      );

      if (hasUnsavedChanges && selectedScript && !selectedStillExists) {
        setScripts([selectedScript, ...refreshedScripts]);
        return;
      }

      if (selectedStillExists) {
        if (!hasUnsavedChanges) {
          draftScriptIdRef.current = null;
        }
        setScripts(refreshedScripts);
        return;
      }

      draftScriptIdRef.current = null;
      setScripts(refreshedScripts);
      setSelectedId(refreshedScripts[0]?.id ?? null);
      } catch {
        if (isActive) {
          setFeedback({
            type: "error",
            message: "Unable to refresh scripts. Please try again.",
          });
        }
      }
    }

    window.addEventListener(
      CLOUD_SCRIPT_LIBRARY_CHANGED_EVENT,
      refreshLibrary,
    );
    return () => {
      isActive = false;
      window.removeEventListener(
        CLOUD_SCRIPT_LIBRARY_CHANGED_EVENT,
        refreshLibrary,
      );
    };
  }, [brandId, hasUnsavedChanges, selectedId, selectedScript]);

  function selectScript(id: string) {
    if (id === selectedId) {
      return;
    }

    if (
      hasUnsavedChanges &&
      !window.confirm(
        "Discard your unsaved changes and open another script?",
      )
    ) {
      return;
    }

    setSelectedId(id);
    setFeedback(null);
  }

  function updateDraft(
    setter: (value: string) => void,
    value: string,
  ): void {
    setter(value);
    setFeedback(null);
  }

  async function handleImportLocalScripts() {
    if (isImporting || isSaving || isDeleting) {
      return;
    }

    const confirmed = window.confirm(
      "Local scripts will be copied into the currently open cloud brand. The local copies will remain unchanged. Continue?",
    );

    if (!confirmed) {
      return;
    }

    setIsImporting(true);
    setFeedback(null);

    try {
      const result = await importLocalScriptsToBrand(brandId);
      const refreshedScripts = await getCloudScriptsByBrand(brandId);
      const scriptsWithDraft =
        hasUnsavedChanges && selectedScript
          ? refreshedScripts.some(
              (script) => script.id === selectedScript.id,
            )
            ? refreshedScripts.map((script) =>
                script.id === selectedScript.id
                  ? selectedScript
                  : script,
              )
            : [selectedScript, ...refreshedScripts]
          : refreshedScripts;

      setScripts(scriptsWithDraft);
      setSelectedId((currentSelectedId) =>
        currentSelectedId &&
        scriptsWithDraft.some(
          (script) => script.id === currentSelectedId,
        )
          ? currentSelectedId
          : scriptsWithDraft[0]?.id ?? null,
      );

      const duplicateLabel =
        result.skipped === 1 ? "duplicate" : "duplicates";

      setFeedback({
        type: "success",
        message:
          result.imported > 0
            ? `Imported ${result.imported} local ${
                result.imported === 1 ? "script" : "scripts"
              }. ${result.skipped} ${duplicateLabel} skipped.`
            : `No new scripts were imported. ${result.skipped} ${duplicateLabel} skipped.`,
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to import local scripts.",
      });
    } finally {
      setIsImporting(false);
    }
  }

  async function handleSave() {
    if (!selectedScript) {
      return;
    }

    if (!title.trim() || !topic.trim() || !content.trim()) {
      setFeedback({
        type: "error",
        message: "Title, topic, and content are required.",
      });
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      const updatedScript = await updateCloudScript(selectedScript.id, {
        title,
        topic,
        content,
      });

      if (!updatedScript) {
        throw new Error("This script could not be found.");
      }

      const refreshedScripts = await getCloudScriptsByBrand(brandId);
      setScripts(refreshedScripts);
      setSelectedId(updatedScript.id);
      setTitle(updatedScript.title);
      setTopic(updatedScript.topic);
      setContent(updatedScript.content);
      setFeedback({
        type: "success",
        message: "Changes saved.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to save this script.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedScript) {
      return;
    }

    const shouldDelete = window.confirm(
      `Delete “${selectedScript.title}”? This cannot be undone.`,
    );
    if (!shouldDelete) {
      return;
    }

    setIsDeleting(true);
    setFeedback(null);

    try {
      const deletedIndex = scripts.findIndex(
        (script) => script.id === selectedScript.id,
      );
      const didDelete = await deleteCloudScript(selectedScript.id);
      if (!didDelete) {
        throw new Error("This script could not be deleted.");
      }

      const refreshedScripts = await getCloudScriptsByBrand(brandId);
      const nextIndex = Math.min(
        Math.max(deletedIndex, 0),
        refreshedScripts.length - 1,
      );
      setScripts(refreshedScripts);
      setSelectedId(refreshedScripts[nextIndex]?.id ?? null);
      setFeedback(null);
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to delete this script.",
      });
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-950/5 dark:border-white/10 dark:bg-slate-950">
      <header className="flex flex-col gap-3 border-b border-slate-200 bg-gradient-to-r from-violet-50 via-white to-fuchsia-50 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7 dark:border-white/10 dark:from-violet-950/40 dark:via-slate-950 dark:to-fuchsia-950/30">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">
            Saved work
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
            Script Library
          </h2>
          {localScriptCount > 0 && (
            <button
              type="button"
              onClick={() => void handleImportLocalScripts()}
              disabled={isImporting || isSaving || isDeleting}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isImporting
                ? "Importing..."
                : `Import ${localScriptCount} Local ${
                    localScriptCount === 1 ? "Script" : "Scripts"
                  }`}
            </button>
          )}
        </div>
        <div className="w-fit rounded-full border border-violet-200 bg-white/80 px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm dark:border-violet-400/20 dark:bg-white/5 dark:text-slate-200">
          {scripts.length} saved {scripts.length === 1 ? "script" : "scripts"}
        </div>
      </header>

      {isLoading ? (
        <div className="flex min-h-48 items-center justify-center text-sm text-slate-500">
          Loading scripts...
        </div>
      ) : scripts.length === 0 ? (
        <div className="flex min-h-80 flex-col items-center justify-center px-6 py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 text-violet-600 dark:bg-violet-400/10 dark:text-violet-300">
            <svg
              aria-hidden="true"
              className="h-7 w-7"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="1.75"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5A3.375 3.375 0 0 0 10.125 2.25H8.25m0 12.75h7.5m-7.5 3h4.5m-1.5-15.75H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V10.5a8.25 8.25 0 0 0-8.25-8.25Z"
              />
            </svg>
          </div>
          <h3 className="mt-5 text-lg font-semibold text-slate-900 dark:text-white">
            No saved scripts yet
          </h3>
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">
            Scripts saved for this brand will appear here, ready to review and
            refine.
          </p>
        </div>
      ) : (
        <div className="grid min-h-[34rem] grid-cols-1 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.7fr)]">
          <aside className="border-b border-slate-200 bg-slate-50/70 p-3 lg:border-b-0 lg:border-r dark:border-white/10 dark:bg-white/[0.02]">
            <div className="max-h-[30rem] space-y-2 overflow-y-auto lg:max-h-[38rem]">
              {scripts.map((script) => {
                const isSelected = script.id === selectedId;

                return (
                  <button
                    key={script.id}
                    type="button"
                    onClick={() => selectScript(script.id)}
                    className={`w-full rounded-2xl border px-4 py-3.5 text-left transition ${
                      isSelected
                        ? "border-violet-300 bg-white shadow-md shadow-violet-950/10 ring-1 ring-violet-200 dark:border-violet-400/40 dark:bg-violet-400/10 dark:ring-violet-400/20"
                        : "border-transparent hover:border-slate-200 hover:bg-white dark:hover:border-white/10 dark:hover:bg-white/5"
                    }`}
                  >
                    <span className="block truncate text-sm font-semibold text-slate-900 dark:text-white">
                      {script.title}
                    </span>
                    <span className="mt-1 block truncate text-sm text-slate-500 dark:text-slate-400">
                      {script.topic}
                    </span>
                    <span className="mt-2 block text-xs font-medium text-slate-400 dark:text-slate-500">
                      Updated {formatUpdatedAt(script.updatedAt)}
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="flex min-w-0 flex-col p-5 sm:p-7">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Title
                </span>
                <input
                  value={title}
                  onChange={(event) =>
                    updateDraft(setTitle, event.target.value)
                  }
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-4 focus:ring-violet-100 dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus:border-violet-400 dark:focus:ring-violet-400/10"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Topic
                </span>
                <input
                  value={topic}
                  onChange={(event) =>
                    updateDraft(setTopic, event.target.value)
                  }
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-4 focus:ring-violet-100 dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus:border-violet-400 dark:focus:ring-violet-400/10"
                />
              </label>
            </div>

            <label className="mt-5 flex min-h-0 flex-1 flex-col gap-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Content
              </span>
              <textarea
                value={content}
                onChange={(event) =>
                  updateDraft(setContent, event.target.value)
                }
                className="min-h-72 w-full flex-1 resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-sm leading-7 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-4 focus:ring-violet-100 dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus:border-violet-400 dark:focus:ring-violet-400/10"
              />
            </label>

            <div className="mt-5 flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between dark:border-white/10">
              <div className="min-h-6 text-sm" aria-live="polite">
                {feedback ? (
                  <span
                    className={
                      feedback.type === "success"
                        ? "font-medium text-emerald-600 dark:text-emerald-400"
                        : "font-medium text-rose-600 dark:text-rose-400"
                    }
                  >
                    {feedback.message}
                  </span>
                ) : hasUnsavedChanges ? (
                  <span className="inline-flex items-center gap-2 font-medium text-amber-600 dark:text-amber-400">
                    <span className="h-2 w-2 rounded-full bg-current" />
                    Unsaved changes
                  </span>
                ) : (
                  <span className="text-slate-400 dark:text-slate-500">
                    All changes saved
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isDeleting || isSaving || isImporting}
                  className="rounded-xl border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-600 transition hover:border-rose-300 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-400/20 dark:text-rose-300 dark:hover:bg-rose-400/10"
                >
                  {isDeleting ? "Deleting…" : "Delete"}
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={
                    !hasUnsavedChanges ||
                    isSaving ||
                    isDeleting ||
                    isImporting
                  }
                  className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-600/20 transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
                >
                  {isSaving ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
