"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, Download, Film, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import {
  attachReadyProjectVideo,
  createVideoScenePlan,
  generateProjectVideo,
  getSecureVideoAccess,
  getVideoProductionHistory,
  normalizeSceneOrder,
  saveVideoScenePlan,
} from "@/services/cloudVideoProductionService";
import type { CreatorScript } from "@/types/script";
import type { CreatorVideoProject } from "@/types/videoProject";
import type { CreatorVideoGeneration, CreatorVideoScenePlan, VideoHistoryResponse } from "@/types/videoProduction";
import { installsAuthoritativeDraft, resolveVideoPollIdentity, shouldContinueVideoPolling, type HistoryLoadMode, type VideoPollIdentity } from "./videoProductionRefreshPolicy";

interface Props {
  brandId: string; project: CreatorVideoProject; attachedScript: CreatorScript | null;
  disabled: boolean; onProjectUpdated(project: CreatorVideoProject): void; onBusyChange(busy: boolean): void;
}
type Feedback = { type: "success" | "error" | "info"; message: string } | null;
type RequestContext = { kind: string; request: number; scope: number; controller: AbortController; unlink?: () => void };
const ACTIVE_STATUSES = new Set(["queued", "planning", "generating_assets", "rendering", "uploading"]);
const MAX_POLL_ATTEMPTS = 40;
const MAX_POLL_ELAPSED_MS = 90_000;

function message(error: unknown, fallback: string): string { return error instanceof Error ? error.message : fallback; }
function statusLabel(status: string): string { return status.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
function durationLabel(milliseconds: number): string { const seconds = Math.round(milliseconds / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }

export default function VideoProductionPanel({ brandId, project, attachedScript, disabled, onProjectUpdated, onBusyChange }: Props) {
  const [history, setHistory] = useState<VideoHistoryResponse | null>(null);
  const [draftPlan, setDraftPlan] = useState<CreatorVideoScenePlan | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [playback, setPlayback] = useState<{ generationId: string; url: string } | null>(null);
  const [pollWakeToken, setPollWakeToken] = useState(0);

  const mountedRef = useRef(true);
  const scopeRef = useRef(0);
  const requestCounterRef = useRef(0);
  const latestRequestRef = useRef(new Map<string, number>());
  const controllersRef = useRef(new Set<AbortController>());
  const operationLatchRef = useRef(false);
  const operationControllerRef = useRef<AbortController | null>(null);
  const pollIdentityRef = useRef<VideoPollIdentity | null>(null);
  const pollHistoryControllerRef = useRef<AbortController | null>(null);
  const dirtyRef = useRef(false);
  const historyRef = useRef<VideoHistoryResponse | null>(null);
  const onProjectUpdatedRef = useRef(onProjectUpdated);
  const sourceScope = `${brandId}:${project.id}:${project.scriptId ?? "none"}:${attachedScript?.updatedAt ?? "none"}:${project.audioGenerationId ?? "none"}:${project.videoGenerationId ?? "none"}`;

  useEffect(() => { onProjectUpdatedRef.current = onProjectUpdated; }, [onProjectUpdated]);
  useEffect(() => { dirtyRef.current = isDirty; }, [isDirty]);
  useEffect(() => { historyRef.current = history; }, [history]);
  useEffect(() => {
    mountedRef.current = true;
    const controllers = controllersRef.current;
    return () => {
      mountedRef.current = false;
      for (const controller of controllers) controller.abort();
      controllers.clear();
    };
  }, []);

  const request = useCallback((kind: string, externalSignal?: AbortSignal): RequestContext => {
    const controller = new AbortController();
    const abortFromExternal = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) abortFromExternal();
    else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
    const requestId = ++requestCounterRef.current;
    latestRequestRef.current.set(kind, requestId);
    controllersRef.current.add(controller);
    return { kind, request: requestId, scope: scopeRef.current, controller,
      unlink: externalSignal ? () => externalSignal.removeEventListener("abort", abortFromExternal) : undefined };
  }, []);
  const identityCurrent = useCallback((context: RequestContext): boolean => mountedRef.current
    && context.scope === scopeRef.current
    && latestRequestRef.current.get(context.kind) === context.request, []);
  const current = useCallback((context: RequestContext): boolean => identityCurrent(context)
    && !context.controller.signal.aborted, [identityCurrent]);
  const finishRequest = useCallback((context: RequestContext): void => { context.unlink?.(); controllersRef.current.delete(context.controller); }, []);

  const applyHistory = useCallback((next: VideoHistoryResponse, context: RequestContext, mode: HistoryLoadMode) => {
    if (!current(context)) return;
    setHistory(next);
    if (installsAuthoritativeDraft(mode)) { setDraftPlan(next.scenePlan); setIsDirty(false); }
    onProjectUpdatedRef.current(next.project);
    setPlayback((existing) => mode === "poll" && existing?.generationId === next.project.videoGenerationId ? existing : null);
  }, [current]);

  const loadHistory = useCallback(async (mode: HistoryLoadMode, externalSignal?: AbortSignal): Promise<VideoHistoryResponse | null> => {
    if (mode !== "poll") pollHistoryControllerRef.current?.abort();
    const context = request(mode === "poll" ? "history-poll" : "history-authoritative", externalSignal);
    if (mode === "poll") pollHistoryControllerRef.current = context.controller;
    const loading = mode === "scope";
    if (loading) { setIsLoading(true); setLoadError(null); }
    try {
      const next = await getVideoProductionHistory(brandId, project.id, context.controller.signal);
      applyHistory(next, context, mode);
      if (current(context)) setLoadError(null);
      return current(context) ? next : null;
    } catch (error) {
      if (!current(context)) return null;
      const safeMessage = message(error, "Unable to load video production.");
      if (historyRef.current === null || loading) setLoadError(safeMessage);
      else setFeedback({ type: "error", message: safeMessage });
      return null;
    } finally {
      if (current(context) && loading) setIsLoading(false);
      if (identityCurrent(context) && mode !== "poll") setPollWakeToken((token) => token + 1);
      if (pollHistoryControllerRef.current === context.controller) pollHistoryControllerRef.current = null;
      finishRequest(context);
    }
  }, [applyHistory, brandId, current, finishRequest, identityCurrent, project.id, request]);

  useEffect(() => {
    scopeRef.current += 1;
    const scope = scopeRef.current;
    for (const controller of controllersRef.current) controller.abort();
    controllersRef.current.clear(); latestRequestRef.current.clear(); operationLatchRef.current = false; operationControllerRef.current = null;
    const scopeControllers = controllersRef.current;
    queueMicrotask(() => {
      if (!mountedRef.current || scope !== scopeRef.current) return;
      if (dirtyRef.current) setFeedback({ type: "info", message: "Unsaved scene-plan edits were reset because the project sources changed." });
      else setFeedback(null);
      setHistory(null); setDraftPlan(null); setIsDirty(false); setPlayback(null); setOperation(null); setLoadError(null); setIsLoading(true);
      void loadHistory("scope");
    });
    return () => { for (const controller of scopeControllers) controller.abort(); };
  }, [loadHistory, sourceScope]);

  const activeGeneration = history?.generations.find((item) => ACTIVE_STATUSES.has(item.status)) ?? null;
  const activeGenerationId = activeGeneration?.id ?? null;
  const activeGenerationStatus = activeGeneration?.status ?? null;
  const busy = operation !== null || activeGeneration !== null;
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);

  useEffect(() => {
    if (!activeGenerationId || !activeGenerationStatus || operation !== null) {
      if (!activeGenerationId) pollIdentityRef.current = null;
      return;
    }
    const scope = scopeRef.current;
    pollIdentityRef.current = resolveVideoPollIdentity(pollIdentityRef.current, scope, activeGenerationId);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      const identity = pollIdentityRef.current;
      if (!mountedRef.current || controller.signal.aborted || !identity || identity.scope !== scope || identity.generationId !== activeGenerationId) return;
      if (identity.startedAt === 0) identity.startedAt = Date.now();
      identity.attempts += 1;
      const next = await loadHistory("poll", controller.signal);
      if (!next || controller.signal.aborted || scope !== scopeRef.current || pollIdentityRef.current !== identity) return;
      const authoritative = next.generations.find((item) => item.id === activeGenerationId);
      const withinBounds = shouldContinueVideoPolling(identity.attempts, Date.now() - identity.startedAt,
        Boolean(authoritative && ACTIVE_STATUSES.has(authoritative.status)), MAX_POLL_ATTEMPTS, MAX_POLL_ELAPSED_MS);
      if (authoritative && ACTIVE_STATUSES.has(authoritative.status) && withinBounds) timer = setTimeout(() => void poll(), 1500);
      else if (authoritative && ACTIVE_STATUSES.has(authoritative.status)) setFeedback({ type: "info", message: "Video generation is still active. Use Refresh to check its latest state." });
      else if (authoritative?.status === "ready") setFeedback({ type: "success", message: next.project.videoGenerationId === authoritative.id ? "Mock video rendered and attached." : "Video rendered and saved, but needs manual attachment after the project changed." });
      else if (authoritative?.status === "failed") setFeedback({ type: "error", message: authoritative.failureMessage ?? "Video generation failed." });
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [activeGenerationId, activeGenerationStatus, loadHistory, operation, pollWakeToken]);

  const totalDuration = useMemo(() => draftPlan?.scenes.reduce((sum, scene) => sum + scene.durationMs, 0) ?? 0, [draftPlan]);
  const attachedVideo = history?.generations.find((item) => item.id === project.videoGenerationId) ?? null;
  const prerequisitesReady = Boolean(project.scriptId && project.audioGenerationId && attachedScript);
  const markDirty = () => { setIsDirty(true); setPlayback(null); };
  const mutatePlan = (index: number, field: "title" | "visualPrompt" | "visualType" | "transition" | "durationMs", value: string | number) => {
    markDirty();
    setDraftPlan((plan) => plan ? { ...plan, scenes: plan.scenes.map((scene, sceneIndex) => sceneIndex === index ? { ...scene, [field]: value } : scene) } : plan);
  };
  const moveScene = (index: number, direction: -1 | 1) => {
    markDirty();
    setDraftPlan((plan) => {
      if (!plan || index + direction < 0 || index + direction >= plan.scenes.length) return plan;
      const scenes = [...plan.scenes]; [scenes[index], scenes[index + direction]] = [scenes[index + direction], scenes[index]];
      return { ...plan, scenes: normalizeSceneOrder(scenes) };
    });
  };
  const begin = (name: string): RequestContext | null => {
    if (operationLatchRef.current) return null;
    operationLatchRef.current = true; const context = request("operation"); operationControllerRef.current = context.controller;
    setOperation(name); setFeedback(null); return context;
  };
  const end = (context: RequestContext) => {
    finishRequest(context);
    if (!identityCurrent(context)) return;
    operationLatchRef.current = false; operationControllerRef.current = null; setOperation(null);
  };

  async function handleCreatePlan() {
    const context = begin("plan"); if (!context) return;
    try {
      const plan = await createVideoScenePlan(brandId, project.id, context.controller.signal);
      if (!current(context)) return;
      setDraftPlan(plan); setIsDirty(false); await loadHistory("mutation");
      if (current(context)) setFeedback({ type: "success", message: "Scene plan created. Review and save any changes before rendering." });
    } catch (error) { if (current(context)) setFeedback({ type: "error", message: message(error, "Unable to create scene plan.") }); }
    finally { end(context); }
  }
  async function handleSavePlan() {
    if (!draftPlan) return;
    const context = begin("save-plan"); if (!context) return;
    if (draftPlan.scenes.length < 1 || draftPlan.scenes.some((scene) => !scene.title.trim() || !scene.visualPrompt.trim() || scene.durationMs < 250)) {
      if (current(context)) setFeedback({ type: "error", message: "Every scene needs a title, visual prompt, and positive duration." }); end(context); return;
    }
    try {
      const plan = await saveVideoScenePlan(brandId, project.id, { ...draftPlan, scenes: normalizeSceneOrder(draftPlan.scenes) }, context.controller.signal);
      if (!current(context)) return;
      setDraftPlan(plan); setIsDirty(false); await loadHistory("poll");
      if (current(context)) setFeedback({ type: "success", message: "Scene plan saved. Any previously attached video was safely invalidated." });
    } catch (error) { if (current(context)) setFeedback({ type: "error", message: message(error, "Unable to save scene plan.") }); }
    finally { end(context); }
  }
  async function handleGenerate(retryGenerationId?: string) {
    if (isDirty) { setFeedback({ type: "info", message: "Save the scene plan before generating the video." }); return; }
    if (!retryGenerationId && history?.generations.some((item) => item.status === "ready") && !window.confirm("Render a new mock video? The current and previous ready videos will remain in history until the replacement is successfully attached.")) return;
    const context = begin(retryGenerationId ? "retry" : "render"); if (!context) return;
    try {
      const operationId = crypto.randomUUID();
      const result = await generateProjectVideo(brandId, project.id, operationId, retryGenerationId, context.controller.signal);
      if (!current(context)) return;
      setHistory(result); setDraftPlan(result.scenePlan); setIsDirty(false); onProjectUpdatedRef.current(result.project); setPlayback(null);
      if (result.recoveryMessage) setFeedback({ type: result.generation.status === "failed" ? "error" : "info", message: result.recoveryMessage });
      else if (ACTIVE_STATUSES.has(result.generation.status)) setFeedback({ type: "info", message: `${statusLabel(result.generation.status)}. Waiting for the authoritative result...` });
      else setFeedback(result.generation.status === "ready"
        ? { type: "success", message: result.project.videoGenerationId === result.generation.id ? "Mock video rendered and attached." : "Video rendered and saved, but needs manual attachment after the project changed." }
        : { type: "error", message: result.generation.failureMessage ?? "Video generation failed." });
    } catch (error) {
      if (identityCurrent(context)) setFeedback({ type: context.controller.signal.aborted ? "info" : "error", message: context.controller.signal.aborted ? "Video generation was cancelled safely." : message(error, "Unable to generate video.") });
    } finally { end(context); }
  }
  async function handleAttach(generation: CreatorVideoGeneration) {
    if (isDirty) { setFeedback({ type: "info", message: "Save the scene plan before attaching a video." }); return; }
    const context = begin("attach"); if (!context) return;
    try {
      const updated = await attachReadyProjectVideo(brandId, project.id, generation.id, project.updatedAt, context.controller.signal);
      if (!current(context)) return;
      onProjectUpdatedRef.current(updated); setPlayback(null); await loadHistory("mutation");
      if (current(context)) setFeedback({ type: "success", message: "Ready video attached to the project." });
    } catch (error) { if (current(context)) setFeedback({ type: "error", message: message(error, "Unable to attach video.") }); }
    finally { end(context); }
  }
  async function handleAccess(generation: CreatorVideoGeneration, purpose: "playback" | "download") {
    const context = request("access");
    try {
      const access = await getSecureVideoAccess(brandId, project.id, generation.id, purpose, context.controller.signal);
      if (!current(context) || project.videoGenerationId !== generation.id) return;
      if (purpose === "playback") setPlayback({ generationId: generation.id, url: access.accessUrl });
      else { const link = document.createElement("a"); link.href = access.accessUrl; link.download = access.filename; link.rel = "noopener"; link.click(); }
    } catch (error) { if (current(context)) setFeedback({ type: "error", message: message(error, "Unable to open secure video access.") }); }
    finally { finishRequest(context); }
  }
  async function handleRefresh() {
    if (isDirty && !window.confirm("Refresh and discard your unsaved scene-plan edits?")) return;
    await loadHistory("manual");
  }
  function addScene() {
    if (!draftPlan) return; markDirty();
    setDraftPlan({ ...draftPlan, scenes: normalizeSceneOrder([...draftPlan.scenes, { id: crypto.randomUUID(), sceneNumber: draftPlan.scenes.length + 1, title: "New scene", narrationText: "", visualPrompt: "Describe the visual for this scene", visualType: "text", startTimeMs: totalDuration, durationMs: 3000, transition: "fade", status: "planned" }]) });
  }
  function removeScene(index: number) { if (!draftPlan) return; markDirty(); setDraftPlan({ ...draftPlan, scenes: normalizeSceneOrder(draftPlan.scenes.filter((_, sceneIndex) => sceneIndex !== index)) }); }
  function cancelOperation() { operationControllerRef.current?.abort(); }

  return <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-950/5">
    <header className="flex flex-col gap-4 border-b border-slate-200 bg-gradient-to-r from-amber-50 via-white to-orange-50 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
      <div className="flex items-center gap-3"><span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-amber-600 text-white"><Clapperboard className="h-5 w-5" aria-hidden="true" /></span><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Video stage</p><h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Video production</h2></div></div>
      <div className="flex gap-2"><button type="button" disabled={operation !== null} onClick={() => void handleRefresh()} className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-amber-800 disabled:opacity-50"><RefreshCw className="h-4 w-4" />Refresh</button>{operation && <button type="button" onClick={cancelOperation} className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700"><X className="h-4 w-4" />Cancel</button>}</div>
    </header>
    <div className="space-y-6 p-5 sm:p-7">
      {feedback && <div role={feedback.type === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${feedback.type === "error" ? "border-rose-200 bg-rose-50 text-rose-700" : feedback.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-sky-200 bg-sky-50 text-sky-700"}`}>{feedback.message}</div>}
      {isDirty && <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">Save the scene plan before generating the video.</div>}
      {!prerequisitesReady && <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">Attach a current script and generate ready narration before creating a scene plan.</div>}
      {isLoading ? <p className="py-8 text-center text-sm text-slate-500">Loading video production...</p> : loadError && history === null ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-center"><p role="alert" className="text-sm text-rose-700">{loadError}</p><button type="button" onClick={() => void loadHistory("scope")} className="mt-4 rounded-xl border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700">Try again</button></div> : <>
        <div className="grid gap-4 sm:grid-cols-2"><div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Current script</p><p className="mt-2 font-semibold text-slate-900">{attachedScript?.title ?? "Not attached"}</p></div><div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Current narration</p><p className="mt-2 font-semibold text-slate-900">{project.audioGenerationId ? "Ready narration attached" : "Not attached"}</p></div></div>
        {!draftPlan ? <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center"><h3 className="font-bold text-slate-950">Create a structured scene plan</h3><p className="mt-2 text-sm text-slate-500">Scenes are derived deterministically from the current script and timed to its narration.</p><button type="button" disabled={!prerequisitesReady || disabled || busy} onClick={() => void handleCreatePlan()} className="mt-4 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white disabled:bg-slate-300">{operation === "plan" ? "Creating..." : "Create Scene Plan"}</button></div> : <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-lg font-bold text-slate-950">Scene plan · version {draftPlan.version}</h3><p className="text-sm text-slate-500">{draftPlan.scenes.length} scenes · {durationLabel(totalDuration)} total · narration {durationLabel(draftPlan.narrationDurationMs)}</p></div><div className="flex gap-2"><button type="button" disabled={disabled || busy || draftPlan.scenes.length >= 24} onClick={addScene} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold"><Plus className="h-4 w-4" />Add</button><button type="button" disabled={disabled || busy || !isDirty} onClick={() => void handleSavePlan()} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-300"><Save className="h-4 w-4" />{operation === "save-plan" ? "Saving..." : "Save plan"}</button></div></div>
          {draftPlan.scenes.map((scene, index) => <article key={scene.id} className="grid gap-4 rounded-2xl border border-slate-200 p-4 lg:grid-cols-[5rem_1fr_1fr]">
            <div><span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 font-bold text-amber-800">{index + 1}</span><div className="mt-3 flex gap-1"><button aria-label="Move scene up" disabled={index === 0 || busy} onClick={() => moveScene(index, -1)} className="rounded border px-2 disabled:opacity-30">↑</button><button aria-label="Move scene down" disabled={index === draftPlan.scenes.length - 1 || busy} onClick={() => moveScene(index, 1)} className="rounded border px-2 disabled:opacity-30">↓</button></div></div>
            <div className="space-y-3"><label className="block text-xs font-bold text-slate-600">Title<input value={scene.title} disabled={busy} maxLength={200} onChange={(event) => mutatePlan(index, "title", event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" /></label><label className="block text-xs font-bold text-slate-600">Narration excerpt<textarea value={scene.narrationText} readOnly aria-readonly="true" className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-600" /></label><p className="text-xs text-slate-500">Derived from the authoritative attached script and cannot be edited.</p></div>
            <div className="space-y-3"><label className="block text-xs font-bold text-slate-600">Visual prompt<textarea value={scene.visualPrompt} disabled={busy} maxLength={2000} onChange={(event) => mutatePlan(index, "visualPrompt", event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" /></label><div className="grid grid-cols-3 gap-2"><label className="text-xs font-semibold text-slate-600">Visual type<select aria-label="Scene visual type" value={scene.visualType} disabled={busy} onChange={(event) => mutatePlan(index, "visualType", event.target.value)} className="mt-1 w-full rounded-lg border px-2 py-2 text-xs font-normal"><option>title</option><option>image</option><option>text</option><option>quote</option><option>outro</option></select></label><label className="text-xs font-semibold text-slate-600">Transition<select aria-label="Scene transition" value={scene.transition} disabled={busy} onChange={(event) => mutatePlan(index, "transition", event.target.value)} className="mt-1 w-full rounded-lg border px-2 py-2 text-xs font-normal"><option>cut</option><option>fade</option><option>dissolve</option></select></label><label className="text-xs font-semibold text-slate-600">Duration<input aria-label="Scene duration milliseconds" type="number" min={250} max={120000} value={scene.durationMs} disabled={busy} onChange={(event) => mutatePlan(index, "durationMs", Number(event.target.value))} className="mt-1 w-full rounded-lg border px-2 py-2 text-xs font-normal" /></label></div><button type="button" disabled={busy || draftPlan.scenes.length === 1} onClick={() => removeScene(index)} className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" />Remove</button></div>
          </article>)}
          <div className="rounded-2xl bg-slate-950 p-5 text-white"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-bold">Render development video</h3><p className="mt-1 text-sm text-slate-300">Creates deterministic scene cards and a browser-playable MP4. This mock renderer does not synthesize footage or mux narration audio.</p></div><button type="button" disabled={disabled || busy || isDirty} onClick={() => void handleGenerate()} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-950 disabled:bg-slate-600"><Film className="h-4 w-4" />{operation === "render" ? "Rendering..." : activeGeneration ? statusLabel(activeGeneration.status) : history?.generations.length ? "Regenerate Video" : "Generate Video"}</button></div></div>
        </div>}
        {!project.videoGenerationId && history?.generations.some((item) => item.status === "ready") && <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">No video is currently attached. A previous ready render remains safely available in history; attach it only if it still matches the current sources.</div>}
        {attachedVideo && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><h3 className="font-bold text-emerald-950">Current attached video</h3><p className="mt-1 text-sm text-emerald-800">{attachedVideo.width}×{attachedVideo.height} · {durationLabel(attachedVideo.durationMs)} · {attachedVideo.hasAudio ? "includes narration" : "silent mock render"}</p>{playback?.generationId === attachedVideo.id && <video key={playback.url} controls className="mt-4 w-full rounded-xl bg-black" src={playback.url} />}<div className="mt-4 flex gap-2"><button type="button" onClick={() => void handleAccess(attachedVideo, "playback")} className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white">Secure playback</button><button type="button" onClick={() => void handleAccess(attachedVideo, "download")} className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 px-3 py-2 text-sm font-semibold text-emerald-800"><Download className="h-4 w-4" />Download</button></div></div>}
        {history && history.generations.length > 0 && <div><h3 className="font-bold text-slate-950">Video history</h3><div className="mt-3 space-y-2">{history.generations.map((generation) => <div key={generation.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-slate-900">{statusLabel(generation.status)} · attempt {generation.attemptCount}{generation.developmentMock ? " · development mock" : ""}</p><p className="text-xs text-slate-500">{new Date(generation.createdAt).toLocaleString()} {generation.failureMessage ? `· ${generation.failureMessage}` : ""}</p></div><div className="flex gap-2">{generation.status === "failed" && <button disabled={busy || isDirty} onClick={() => void handleGenerate(generation.id)} className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Retry</button>}{generation.status === "ready" && project.videoGenerationId !== generation.id && <button disabled={busy || isDirty} onClick={() => void handleAttach(generation)} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Attach ready video</button>}</div></div>)}</div></div>}
      </>}
    </div>
  </section>;
}
