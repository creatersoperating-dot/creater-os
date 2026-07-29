"use client";

import {
  Check,
  Copy,
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import type { Brand } from "@/types/brand";

interface ScriptWriterProps {
  brand: Brand;
}

interface ScriptFormValues {
  topic: string;
  goal: string;
  audience: string;
  duration: string;
  keyPoints: string;
  callToAction: string;
  constraints: string;
  includeProductionNotes: boolean;
}

const INITIAL_VALUES: ScriptFormValues = {
  topic: "",
  goal: "",
  audience: "",
  duration: "",
  keyPoints: "",
  callToAction: "",
  constraints: "",
  includeProductionNotes: false,
};

const inputClassName =
  "w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-3 text-sm text-slate-950 shadow-inner shadow-slate-100 outline-none transition placeholder:text-slate-400 hover:border-slate-300 hover:bg-white focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100";

function getScriptLineClassName(line: string): string {
  const trimmedLine = line.trimStart();

  if (trimmedLine.startsWith("# ")) {
    return "mb-5 mt-2 font-sans text-3xl font-bold leading-tight tracking-tight text-slate-950";
  }

  if (trimmedLine.startsWith("## ")) {
    return "mb-3 mt-8 font-sans text-xl font-bold leading-tight text-slate-900";
  }

  if (trimmedLine.startsWith("### ")) {
    return "mb-2 mt-6 font-sans text-base font-bold uppercase tracking-wide text-indigo-700";
  }

  if (
    trimmedLine.startsWith("- ") ||
    trimmedLine.startsWith("* ") ||
    /^\d+\.\s/.test(trimmedLine)
  ) {
    return "min-h-8 pl-4 text-slate-800";
  }

  return line ? "min-h-8 text-slate-800" : "h-4";
}

function createSessionId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `script-writer-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function getSessionStorageKey(brand: Brand): string {
  const brandScope =
    brand.id.trim() ||
    brand.name.trim() ||
    "unnamed-brand";

  return `creatoros-script-writer-session:${encodeURIComponent(
    brandScope.slice(0, 120)
  )}`;
}

async function getResponseError(
  response: Response
): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: unknown;
    };

    if (typeof payload.error === "string") {
      return payload.error;
    }
  } catch {
    // Use the status-based fallback below.
  }

  return `Script generation failed with status ${response.status}.`;
}

export default function ScriptWriter({
  brand,
}: ScriptWriterProps) {
  const [formValues, setFormValues] =
    useState<ScriptFormValues>(INITIAL_VALUES);
  const [lastSubmittedValues, setLastSubmittedValues] =
    useState<ScriptFormValues | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [script, setScript] = useState("");
  const [error, setError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyFeedbackTimer = useRef<number | null>(null);

  const sessionStorageKey = getSessionStorageKey(brand);

  useEffect(() => {
    try {
      const existingSession =
        localStorage.getItem(sessionStorageKey)?.trim();

      if (
        existingSession &&
        existingSession.length <= 200
      ) {
        setSessionId(existingSession);
        return;
      }

      const newSessionId = createSessionId();

      localStorage.setItem(
        sessionStorageKey,
        newSessionId
      );
      setSessionId(newSessionId);
    } catch {
      setSessionId(createSessionId());
    }
  }, [sessionStorageKey]);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimer.current !== null) {
        window.clearTimeout(copyFeedbackTimer.current);
      }
    };
  }, []);

  function updateField(
    field: keyof ScriptFormValues,
    value: string | boolean
  ) {
    setFormValues((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function generateScript(
    values: ScriptFormValues
  ) {
    if (
      isGenerating ||
      !sessionId ||
      !values.topic.trim()
    ) {
      return;
    }

    const submittedValues = {
      ...values,
    };

    setIsGenerating(true);
    setError("");
    setCopied(false);
    setScript("");

    try {
      const response = await fetch("/api/scripts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topic: submittedValues.topic,
          brand,
          sessionId,
          goal: submittedValues.goal,
          audience: submittedValues.audience,
          duration: submittedValues.duration,
          keyPoints: submittedValues.keyPoints,
          callToAction: submittedValues.callToAction,
          constraints: submittedValues.constraints,
          includeProductionNotes:
            submittedValues.includeProductionNotes,
        }),
      });

      if (!response.ok) {
        throw new Error(await getResponseError(response));
      }

      if (!response.body) {
        throw new Error(
          "The script response did not include a readable stream."
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let generatedScript = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        generatedScript += decoder.decode(value, {
          stream: true,
        });
        setScript(generatedScript);
      }

      generatedScript += decoder.decode();

      if (!generatedScript.trim()) {
        throw new Error(
          "No script content was returned. Please try again."
        );
      }

      setScript(generatedScript);
      setLastSubmittedValues(submittedValues);
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : "Script generation failed. Please try again."
      );
    } finally {
      setIsGenerating(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void generateScript(formValues);
  }

  function handleRegenerate() {
    if (lastSubmittedValues) {
      void generateScript(lastSubmittedValues);
    }
  }

  async function handleCopy() {
    if (!script) {
      return;
    }

    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);

      if (copyFeedbackTimer.current !== null) {
        window.clearTimeout(copyFeedbackTimer.current);
      }

      copyFeedbackTimer.current = window.setTimeout(
        () => setCopied(false),
        2000
      );
    } catch {
      setError(
        "The script could not be copied. Please copy it manually."
      );
    }
  }

  const submitDisabled =
    !formValues.topic.trim() ||
    !sessionId ||
    isGenerating;

  function handleFormKeyDown(
    event: KeyboardEvent<HTMLFormElement>
  ) {
    if (
      event.key !== "Enter" ||
      (!event.ctrlKey && !event.metaKey) ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();

    if (!submitDisabled) {
      void generateScript(formValues);
    }
  }

  return (
    <section className="space-y-6">
      <header className="overflow-hidden rounded-[28px] bg-[linear-gradient(115deg,#0f172a_0%,#1e1b4b_100%)] px-5 py-7 text-white shadow-[0_24px_70px_-28px_rgba(15,23,42,0.85)] sm:px-8 sm:py-9 lg:px-10">
        <div className="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500 text-white shadow-lg shadow-indigo-950/30">
                <WandSparkles
                  className="h-5 w-5"
                  aria-hidden="true"
                />
              </span>
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-indigo-200">
                Creator Studio
              </p>
            </div>
            <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
              AI Script Writer
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base sm:leading-7">
              Shape an idea into a polished, brand-aware YouTube
              script with a focused creative brief.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="max-w-full truncate rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold text-white backdrop-blur-sm">
              {brand.name}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-indigo-300/30 bg-indigo-400/15 px-4 py-2 text-xs font-semibold text-indigo-100 backdrop-blur-sm">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Brand-aware
            </span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[400px_minmax(0,1fr)] xl:gap-8">
        <form
          onSubmit={handleSubmit}
          onKeyDown={handleFormKeyDown}
          className="space-y-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_20px_50px_-24px_rgba(15,23,42,0.35)] sm:p-6 lg:sticky lg:top-6"
          aria-busy={isGenerating}
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-5">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-600">
                Step 01 · Creative brief
              </p>
              <h2 className="mt-1.5 text-xl font-bold tracking-tight text-slate-950">
                Script brief
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Give the writer clear direction, then refine the
                draft in the editor.
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Brief
            </span>
          </div>

          <div className="rounded-2xl border-2 border-indigo-200 bg-indigo-50/70 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <label
                htmlFor="script-topic"
                className="text-sm font-bold text-slate-950"
              >
                What is the video about?{" "}
                <span className="text-indigo-600">*</span>
              </label>
              <span className="text-[11px] tabular-nums text-slate-500">
                {formValues.topic.length}/300
              </span>
            </div>
            <input
              id="script-topic"
              className={`${inputClassName} mt-3 border-indigo-200 bg-white py-3.5 text-base font-medium shadow-sm`}
              value={formValues.topic}
              maxLength={300}
              required
              placeholder="Enter your core video idea"
              onChange={(event) =>
                updateField("topic", event.target.value)
              }
            />
            <p className="mt-2 text-xs leading-5 text-indigo-800/70">
              Keep it focused. Brand context is applied
              automatically.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-2">
            <div className="min-w-0">
              <label
                htmlFor="script-audience"
                className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-600"
              >
                Audience
              </label>
              <input
                id="script-audience"
                className={inputClassName}
                value={formValues.audience}
                maxLength={500}
                placeholder={
                  brand.targetAudience || "Brand audience"
                }
                onChange={(event) =>
                  updateField("audience", event.target.value)
                }
              />
            </div>

            <div className="min-w-0">
              <label
                htmlFor="script-duration"
                className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-600"
              >
                Duration
              </label>
              <input
                id="script-duration"
                className={inputClassName}
                value={formValues.duration}
                maxLength={100}
                placeholder="8–10 min"
                onChange={(event) =>
                  updateField("duration", event.target.value)
                }
              />
            </div>
          </div>

          <fieldset className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <legend className="px-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
              Goal &amp; conversion
            </legend>
            <div>
              <label
                htmlFor="script-goal"
                className="mb-2 block text-sm font-semibold text-slate-800"
              >
                Video goal or angle
              </label>
              <input
                id="script-goal"
                className={inputClassName}
                value={formValues.goal}
                maxLength={500}
                placeholder="Teach beginners with practical examples"
                onChange={(event) =>
                  updateField("goal", event.target.value)
                }
              />
            </div>

            <div>
              <label
                htmlFor="script-cta"
                className="mb-2 block text-sm font-semibold text-slate-800"
              >
                Call to action
              </label>
              <input
                id="script-cta"
                className={inputClassName}
                value={formValues.callToAction}
                maxLength={500}
                placeholder="Subscribe for weekly creator workflows"
                onChange={(event) =>
                  updateField("callToAction", event.target.value)
                }
              />
            </div>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="mb-3 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
              Creative direction
            </legend>

            <div>
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="script-key-points"
                  className="text-sm font-semibold text-slate-800"
                >
                  Key points
                </label>
                <span className="text-[11px] tabular-nums text-slate-400">
                  {formValues.keyPoints.length}/3000
                </span>
              </div>
              <textarea
                id="script-key-points"
                className={`${inputClassName} mt-2 min-h-32 resize-y leading-6`}
                value={formValues.keyPoints}
                maxLength={3000}
                placeholder="List examples, steps, insights, or takeaways to cover."
                onChange={(event) =>
                  updateField("keyPoints", event.target.value)
                }
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="script-constraints"
                  className="text-sm font-semibold text-slate-800"
                >
                  Constraints
                </label>
                <span className="text-[11px] tabular-nums text-slate-400">
                  {formValues.constraints.length}/3000
                </span>
              </div>
              <textarea
                id="script-constraints"
                className={`${inputClassName} mt-2 min-h-28 resize-y leading-6`}
                value={formValues.constraints}
                maxLength={3000}
                placeholder="Add must-include details, pacing notes, or things to avoid."
                onChange={(event) =>
                  updateField("constraints", event.target.value)
                }
              />
            </div>
          </fieldset>

          <label className="group flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-indigo-300 hover:bg-indigo-50/50">
            <span>
              <span className="block text-sm font-bold text-slate-900">
                Production Notes
              </span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">
                Include visuals, pacing, and filming guidance.
              </span>
            </span>
            <input
              type="checkbox"
              className="peer sr-only"
              checked={formValues.includeProductionNotes}
              onChange={(event) =>
                updateField(
                  "includeProductionNotes",
                  event.target.checked
                )
              }
            />
            <span
              className="relative h-7 w-12 shrink-0 rounded-full bg-slate-300 transition peer-checked:bg-indigo-600 peer-focus-visible:ring-4 peer-focus-visible:ring-indigo-200 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5"
              aria-hidden="true"
            />
          </label>

          <div className="border-t border-slate-100 pt-1">
            <button
              type="submit"
              disabled={submitDisabled}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-4 text-sm font-bold text-white shadow-lg shadow-indigo-600/25 transition hover:from-indigo-700 hover:to-violet-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-200 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none"
            >
              {isGenerating ? (
                <Loader2
                  className="h-5 w-5 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <WandSparkles
                  className="h-5 w-5"
                  aria-hidden="true"
                />
              )}
              {isGenerating
                ? "Creating your script…"
                : "Generate Script"}
            </button>
            <div className="mt-3 flex items-center justify-center gap-2 text-xs text-slate-500">
              <span>Quick generate</span>
              <kbd className="rounded-md border border-slate-200 bg-slate-100 px-2 py-1 font-sans text-[10px] font-bold text-slate-600 shadow-sm">
                Ctrl/Cmd + Enter
              </kbd>
            </div>
          </div>
        </form>

        <div className="min-w-0 overflow-hidden rounded-3xl border border-slate-300 bg-slate-200/70 shadow-[0_24px_70px_-28px_rgba(15,23,42,0.45)]">
          <div className="sticky top-0 z-10 flex flex-col gap-4 bg-slate-900 px-4 py-4 text-white sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-indigo-200">
                <FileText className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-bold">
                  Script Draft
                </h2>
                <p
                  className="mt-0.5 flex items-center gap-2 text-xs text-slate-400"
                  role="status"
                  aria-live="polite"
                >
                  {isGenerating ? (
                    <>
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin text-indigo-300"
                        aria-hidden="true"
                      />
                      Generating
                    </>
                  ) : script ? (
                    <>
                      <span
                        className="h-2 w-2 rounded-full bg-emerald-400"
                        aria-hidden="true"
                      />
                      Ready
                    </>
                  ) : (
                    <>
                      <span
                        className="h-2 w-2 rounded-full bg-slate-500"
                        aria-hidden="true"
                      />
                      Awaiting brief
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleRegenerate}
                disabled={
                  !lastSubmittedValues ||
                  !sessionId ||
                  isGenerating
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RefreshCw
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                />
                Regenerate
              </button>

              <button
                type="button"
                onClick={() => void handleCopy()}
                disabled={!script || isGenerating}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-bold text-slate-900 shadow-sm transition hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {copied ? (
                  <Check
                    className="h-3.5 w-3.5 text-emerald-600"
                    aria-hidden="true"
                  />
                ) : (
                  <Copy
                    className="h-3.5 w-3.5"
                    aria-hidden="true"
                  />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          {error && (
            <div
              className="m-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              role="alert"
            >
              {error}
            </div>
          )}

          <div
            className="max-h-[1080px] min-h-[720px] overflow-y-auto p-3 sm:p-5 lg:p-7"
            aria-live="polite"
            aria-busy={isGenerating}
          >
            {script ? (
              <article className="mx-auto min-h-[760px] max-w-[880px] rounded-sm border border-slate-200 bg-white px-6 py-10 shadow-[0_12px_40px_-22px_rgba(15,23,42,0.45)] sm:px-10 sm:py-12 lg:px-14">
                <div className="select-text whitespace-pre-wrap break-words font-serif text-[15px] leading-8">
                  {script.split("\n").map((line, index) => (
                    <div
                      key={index}
                      className={getScriptLineClassName(line)}
                    >
                      {line || "\u00A0"}
                    </div>
                  ))}
                </div>
                {isGenerating && (
                  <span className="mt-5 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700">
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin"
                      aria-hidden="true"
                    />
                    Continuing the draft…
                  </span>
                )}
              </article>
            ) : isGenerating ? (
              <div className="flex min-h-[680px] items-center justify-center rounded-2xl border border-white/80 bg-white/70 px-6 text-center">
                <div className="max-w-sm">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/25">
                    <Loader2
                      className="h-7 w-7 animate-spin"
                      aria-hidden="true"
                    />
                  </div>
                  <h3 className="mt-5 text-xl font-bold text-slate-950">
                    Creating your first draft
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    CreatorOS is shaping the structure, narration,
                    and voice around your brand.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[680px] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/70 px-6">
                <div className="w-full max-w-md text-center">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl border border-indigo-100 bg-indigo-50 text-indigo-600 shadow-sm">
                    <FileText
                      className="h-9 w-9"
                      aria-hidden="true"
                    />
                  </div>
                  <h3 className="mt-6 text-2xl font-bold tracking-tight text-slate-950">
                    Your script starts here
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Build a clear brief on the left and CreatorOS
                    will turn it into a structured draft.
                  </p>
                  <ol className="mx-auto mt-7 grid max-w-sm gap-3 text-left">
                    {[
                      "Add your topic",
                      "Customize the brief",
                      "Generate the script",
                    ].map((step, index) => (
                      <li
                        key={step}
                        className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm"
                      >
                        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                          {index + 1}
                        </span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
