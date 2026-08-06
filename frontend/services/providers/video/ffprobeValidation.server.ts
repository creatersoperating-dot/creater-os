import "server-only";

import { validateVideoMuxDurations } from "@/services/video/videoMuxDurationPolicy";

import { runMediaProcess, type MediaProcessRunner } from "./mediaProcess.server";
import { VideoProviderError } from "./videoProviderTypes";

const MAX_PROBE_OUTPUT_BYTES = 128 * 1024;

type JsonObject = Record<string, unknown>;

export interface ProbedVideoMetadata {
  durationMs: number;
  width: number;
  height: number;
  hasAudio: true;
  audioSampleRate: number;
}

export interface ProbeRenderedVideoRequest {
  ffprobePath: string;
  cwd: string;
  fileName: string;
  narrationDurationCeilingMs: number;
  expectedDurationMs: number;
  expectedWidth: number;
  expectedHeight: number;
  expectedAudioSampleRate: number;
  timeoutMs: number;
  signal?: AbortSignal;
  heartbeat?: () => Promise<void>;
  runProcess?: MediaProcessRunner;
}

function jsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveNumber(value: unknown): number | null {
  if (typeof value === "string" && !/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && Number.isSafeInteger(Math.trunc(parsed)) && parsed > 0 ? parsed : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = positiveNumber(value);
  return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function invalidProbe(): never {
  throw new VideoProviderError("invalid_render", "FFmpeg returned invalid or inconsistent stream metadata.", false);
}

export async function probeRenderedVideo(request: ProbeRenderedVideoRequest): Promise<ProbedVideoMetadata> {
  const execute = request.runProcess ?? runMediaProcess;
  let processResult;
  try {
    processResult = await execute({
      executablePath: request.ffprobePath,
      cwd: request.cwd,
      args: [
        "-v", "error", "-count_frames",
        "-show_entries", "format=format_name,duration:stream=index,codec_type,codec_name,width,height,pix_fmt,duration,sample_rate,nb_frames,nb_read_frames",
        "-of", "json", request.fileName,
      ],
      signal: request.signal,
      timeoutMs: request.timeoutMs,
      heartbeat: request.heartbeat,
      captureStdout: true,
      captureStderr: true,
      maxCaptureBytes: MAX_PROBE_OUTPUT_BYTES,
      unavailableCode: "ffprobe_unavailable",
      unavailableMessage: "The configured ffprobe executable could not be started.",
      failureCode: "invalid_render",
      failureMessage: "ffprobe could not inspect the rendered video.",
      failureRetryable: false,
    });
  } catch (error) {
    if (error instanceof VideoProviderError) throw error;
    return invalidProbe();
  }
  if (processResult.stdoutTruncated || processResult.stderrTruncated) return invalidProbe();

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(processResult.stdout)) as unknown;
  } catch {
    return invalidProbe();
  }
  try {
    if (!jsonObject(parsed) || !Array.isArray(parsed.streams) || !parsed.streams.every(jsonObject)
      || !jsonObject(parsed.format)) return invalidProbe();
    const streams = parsed.streams;
    const format = parsed.format;
    const formatName = requiredString(format.format_name);
    if (!formatName || !formatName.split(",").map((entry) => entry.trim()).includes("mp4")) return invalidProbe();

    const videoStreams = streams.filter((stream) => stream.codec_type === "video");
    const audioStreams = streams.filter((stream) => stream.codec_type === "audio");
    if (videoStreams.length !== 1 || audioStreams.length !== 1) return invalidProbe();
    const video = videoStreams[0];
    const audio = audioStreams[0];
    const containerDurationMs = (positiveNumber(format.duration) ?? 0) * 1_000;
    const videoDurationMs = (positiveNumber(video.duration) ?? 0) * 1_000;
    const audioDurationMs = (positiveNumber(audio.duration) ?? 0) * 1_000;
    const width = positiveInteger(video.width);
    const height = positiveInteger(video.height);
    const videoSamples = positiveInteger(video.nb_read_frames) ?? positiveInteger(video.nb_frames);
    const audioSamples = positiveInteger(audio.nb_read_frames) ?? positiveInteger(audio.nb_frames);
    const audioSampleRate = positiveInteger(audio.sample_rate);
    if (requiredString(video.codec_name) !== "h264" || requiredString(audio.codec_name) !== "aac"
      || requiredString(video.pix_fmt) !== "yuv420p" || width !== request.expectedWidth || height !== request.expectedHeight
      || audioSampleRate !== request.expectedAudioSampleRate || !videoSamples || !audioSamples) return invalidProbe();

    validateVideoMuxDurations({
      narrationDurationCeilingMs: request.narrationDurationCeilingMs,
      effectiveTimelineDurationMs: request.expectedDurationMs,
      audioDurationMs,
      videoDurationMs,
      containerDurationMs,
      audioSampleRate,
    });
    return {
      durationMs: Math.round(containerDurationMs),
      width,
      height,
      hasAudio: true,
      audioSampleRate,
    };
  } catch (error) {
    if (error instanceof VideoProviderError) throw error;
    return invalidProbe();
  }
}
