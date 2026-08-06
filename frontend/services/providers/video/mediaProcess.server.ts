import "server-only";

import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import path from "node:path";

import { VideoProviderError } from "./videoProviderTypes";

const DEFAULT_MAX_CAPTURE_BYTES = 128 * 1024;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 1_000;
const DEFAULT_TERMINATION_GRACE_MS = 1_000;
const DEFAULT_FORCE_CLOSE_DEADLINE_MS = 2_000;
const WINDOWS_TREE_KILL_TIMEOUT_MS = 2_000;

export interface MediaProcessRequest {
  executablePath: string;
  args: readonly string[];
  cwd?: string;
  signal?: AbortSignal;
  timeoutMs: number;
  heartbeat?: () => Promise<void>;
  captureStdout?: boolean;
  captureStderr?: boolean;
  maxCaptureBytes?: number;
  heartbeatIntervalMs?: number;
  terminationGraceMs?: number;
  forceCloseDeadlineMs?: number;
  unavailableCode?: string;
  unavailableMessage?: string;
  failureCode?: string;
  failureMessage?: string;
  failureRetryable?: boolean;
  platform?: NodeJS.Platform;
  terminateProcessTree?: (pid: number) => Promise<void>;
}

export interface MediaProcessResult {
  stdout: Uint8Array;
  stderr: Uint8Array;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export type SpawnMediaProcess = (
  executablePath: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;
export type MediaProcessRunner = (request: MediaProcessRequest) => Promise<MediaProcessResult>;

export class ProcessTerminationUnconfirmedError extends VideoProviderError {
  constructor(
    readonly terminationReason: VideoProviderError,
    readonly closed: Promise<void>,
  ) {
    super(
      "process_termination_unconfirmed",
      "The media process did not confirm termination before the safety deadline.",
      true,
    );
    this.name = "ProcessTerminationUnconfirmedError";
  }
}

function cancellationError(signal?: AbortSignal): VideoProviderError {
  if (signal?.reason instanceof VideoProviderError) return signal.reason;
  return new VideoProviderError("cancelled", "Video rendering was cancelled.", true);
}

function emptyResult(): MediaProcessResult {
  return { stdout: new Uint8Array(), stderr: new Uint8Array(), stdoutTruncated: false, stderrTruncated: false };
}

export function resolveTrustedWindowsTaskkillPath(configuredWindowsDirectory: string | undefined): string | null {
  if (typeof configuredWindowsDirectory !== "string" || configuredWindowsDirectory.length === 0
    || configuredWindowsDirectory.includes("\0") || !path.win32.isAbsolute(configuredWindowsDirectory)) return null;

  const windowsDirectory = path.win32.normalize(configuredWindowsDirectory);
  const taskkillPath = path.win32.join(windowsDirectory, "System32", "taskkill.exe");
  const expectedRelativePath = path.win32.join("System32", "taskkill.exe");
  if (taskkillPath.includes("\0") || !path.win32.isAbsolute(taskkillPath)
    || path.win32.relative(windowsDirectory, taskkillPath).toLowerCase() !== expectedRelativePath.toLowerCase()
    || path.win32.basename(taskkillPath).toLowerCase() !== "taskkill.exe"
    || path.win32.basename(path.win32.dirname(taskkillPath)).toLowerCase() !== "system32") return null;
  return taskkillPath;
}

function trustedWindowsTaskkillPath(): string | null {
  return resolveTrustedWindowsTaskkillPath(process.env.SystemRoot !== undefined
    ? process.env.SystemRoot
    : process.env.WINDIR);
}

export function terminateWindowsProcessTree(
  pid: number,
  spawnProcess: SpawnMediaProcess = (executablePath, args, options) => spawn(executablePath, [...args], options),
): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid < 1) return Promise.resolve();
  const taskkillPath = trustedWindowsTaskkillPath();
  if (!taskkillPath) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve();
    };
    let helper: ChildProcess;
    try {
      helper = spawnProcess(taskkillPath, ["/PID", String(pid), "/T", "/F"], {
        shell: false,
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {
      finish();
      return;
    }
    helper.once("error", finish);
    helper.once("close", finish);
    timer = setTimeout(() => {
      try { helper.kill("SIGKILL"); } catch { /* Best-effort helper termination. */ }
      finish();
    }, WINDOWS_TREE_KILL_TIMEOUT_MS);
  });
}

export function runMediaProcess(
  request: MediaProcessRequest,
  spawnProcess: SpawnMediaProcess = (executablePath, args, options) => spawn(executablePath, [...args], options),
): Promise<MediaProcessResult> {
  if (request.signal?.aborted) return Promise.reject(cancellationError(request.signal));
  const maxCaptureBytes = request.maxCaptureBytes ?? DEFAULT_MAX_CAPTURE_BYTES;
  if (!Number.isSafeInteger(maxCaptureBytes) || maxCaptureBytes < 1) {
    return Promise.reject(new VideoProviderError("configuration_invalid", "The media-process output limit is invalid.", false));
  }

  return new Promise((resolve, reject) => {
    let mainSettled = false;
    let closeObserved = false;
    let spawned = false;
    let terminating = false;
    let terminationReason: VideoProviderError | null = null;
    let startFailure: VideoProviderError | null = null;
    let heartbeatInFlight = false;
    let forceTimer: ReturnType<typeof setTimeout> | null = null;
    let forceCloseDeadlineTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let resolveClosed!: () => void;
    const closed = new Promise<void>((closedResolve) => { resolveClosed = closedResolve; });

    let child: ChildProcess;
    try {
      child = spawnProcess(request.executablePath, request.args, {
        cwd: request.cwd,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      reject(new VideoProviderError(
        request.unavailableCode ?? "media_process_unavailable",
        request.unavailableMessage ?? "The configured media executable could not be started.",
        false,
      ));
      return;
    }

    const append = (chunk: Buffer, target: "stdout" | "stderr"): void => {
      const chunks = target === "stdout" ? stdoutChunks : stderrChunks;
      const byteCount = target === "stdout" ? stdoutBytes : stderrBytes;
      const remaining = Math.max(0, maxCaptureBytes - byteCount);
      if (remaining > 0) chunks.push(new Uint8Array(chunk.subarray(0, remaining)));
      const nextBytes = byteCount + Math.min(chunk.byteLength, remaining);
      if (target === "stdout") {
        stdoutBytes = nextBytes;
        if (chunk.byteLength > remaining) stdoutTruncated = true;
      } else {
        stderrBytes = nextBytes;
        if (chunk.byteLength > remaining) stderrTruncated = true;
      }
    };
    const onStdoutData = (chunk: Buffer): void => append(chunk, "stdout");
    const onStderrData = (chunk: Buffer): void => append(chunk, "stderr");
    if (request.captureStdout) child.stdout?.on("data", onStdoutData);
    else child.stdout?.resume();
    if (request.captureStderr) child.stderr?.on("data", onStderrData);
    else child.stderr?.resume();

    const cleanupMain = (): void => {
      request.signal?.removeEventListener("abort", onAbort);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (forceTimer) clearTimeout(forceTimer);
      if (forceCloseDeadlineTimer) clearTimeout(forceCloseDeadlineTimer);
      timeoutTimer = null;
      heartbeatTimer = null;
      forceTimer = null;
      forceCloseDeadlineTimer = null;
    };
    const stopCapturing = (): void => {
      child.stdout?.removeListener("data", onStdoutData);
      child.stderr?.removeListener("data", onStderrData);
    };
    const settleFromClose = (code: number | null): void => {
      if (mainSettled) return;
      mainSettled = true;
      cleanupMain();
      if (terminationReason) {
        reject(terminationReason);
        return;
      }
      if (startFailure) {
        reject(startFailure);
        return;
      }
      if (code !== 0) {
        reject(new VideoProviderError(
          request.failureCode ?? "media_process_failed",
          request.failureMessage ?? "The media process failed.",
          request.failureRetryable ?? false,
        ));
        return;
      }
      const result = emptyResult();
      result.stdout = Buffer.concat(stdoutChunks.map((chunk) => Buffer.from(chunk)), stdoutBytes);
      result.stderr = Buffer.concat(stderrChunks.map((chunk) => Buffer.from(chunk)), stderrBytes);
      result.stdoutTruncated = stdoutTruncated;
      result.stderrTruncated = stderrTruncated;
      resolve(result);
    };
    const onSpawn = (): void => { spawned = true; };
    const onError = (): void => {
      if (terminating || mainSettled) return;
      const failure = new VideoProviderError(
        request.unavailableCode ?? "media_process_unavailable",
        request.unavailableMessage ?? "The configured media executable could not be started.",
        false,
      );
      if (!spawned) {
        mainSettled = true;
        cleanupMain();
        stopCapturing();
        child.removeListener("close", onClose);
        resolveClosed();
        reject(failure);
        return;
      }
      startFailure = failure;
      terminate(failure);
    };
    const onClose = (code: number | null): void => {
      if (closeObserved) return;
      closeObserved = true;
      resolveClosed();
      cleanupMain();
      stopCapturing();
      child.removeListener("error", onError);
      child.removeListener("spawn", onSpawn);
      settleFromClose(code);
    };
    const requestKill = (signal: NodeJS.Signals): boolean => {
      try { return child.kill(signal); }
      catch { return false; }
    };
    const terminalUnconfirmed = (): void => {
      if (mainSettled || closeObserved) return;
      mainSettled = true;
      cleanupMain();
      stopCapturing();
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
      reject(new ProcessTerminationUnconfirmedError(
        terminationReason ?? new VideoProviderError("media_process_failed", "The media process failed.", true),
        closed,
      ));
    };
    const forceKill = (): void => {
      if (mainSettled || closeObserved) return;
      const platform = request.platform ?? process.platform;
      if (platform === "win32" && Number.isSafeInteger(child.pid) && Number(child.pid) > 0) {
        const terminateTree = request.terminateProcessTree ?? terminateWindowsProcessTree;
        void terminateTree(child.pid as number).catch(() => undefined);
      }
      requestKill("SIGKILL");
      forceCloseDeadlineTimer = setTimeout(
        terminalUnconfirmed,
        request.forceCloseDeadlineMs ?? DEFAULT_FORCE_CLOSE_DEADLINE_MS,
      );
    };
    const terminate = (reason: VideoProviderError): void => {
      if (mainSettled || terminating || closeObserved) return;
      terminating = true;
      terminationReason = reason;
      const accepted = requestKill("SIGTERM");
      if (!accepted) {
        forceKill();
        return;
      }
      forceTimer = setTimeout(forceKill, request.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS);
    };
    function onAbort(): void { terminate(cancellationError(request.signal)); }

    child.once("spawn", onSpawn);
    child.on("error", onError);
    child.once("close", onClose);
    request.signal?.addEventListener("abort", onAbort, { once: true });
    timeoutTimer = setTimeout(
      () => terminate(new VideoProviderError("timeout", "Video generation timed out.", true)),
      request.timeoutMs,
    );
    heartbeatTimer = setInterval(() => {
      if (!request.heartbeat || heartbeatInFlight || mainSettled || terminating) return;
      heartbeatInFlight = true;
      void request.heartbeat().catch((error: unknown) => {
        terminate(error instanceof VideoProviderError
          ? error
          : new VideoProviderError("heartbeat_failed", "The video rendering heartbeat failed.", true));
      }).finally(() => { heartbeatInFlight = false; });
    }, request.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);
    if (request.signal?.aborted) onAbort();
  });
}
