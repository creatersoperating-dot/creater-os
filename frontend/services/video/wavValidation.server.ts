import "server-only";

import {
  PCM_BITS_PER_SAMPLE,
  PCM_CHANNEL_COUNT,
  PCM_SAMPLE_RATE,
} from "@/services/audio/wavAssembly.server";
import { VideoProviderError } from "@/services/providers/video/videoProviderTypes";

const PCM_FORMAT = 1;
const EXPECTED_BLOCK_ALIGN = PCM_CHANNEL_COUNT * (PCM_BITS_PER_SAMPLE / 8);
const EXPECTED_BYTE_RATE = PCM_SAMPLE_RATE * EXPECTED_BLOCK_ALIGN;

// The writer rounds PCM duration to whole milliseconds; 2 ms covers rounding at both persistence boundaries.
export const WAV_DURATION_TOLERANCE_MS = 2;

export interface ValidatedCreatorOsWav {
  durationMs: number;
  durationCeilingMs: number;
  sampleFrameCount: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataSizeBytes: number;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function invalidAudio(): never {
  throw new VideoProviderError("invalid_audio", "The attached narration is not a valid CreatorOS WAV file.", false);
}

export function validateCreatorOsWav(
  bytes: Uint8Array,
  declaredDurationMs?: number,
): ValidatedCreatorOsWav {
  if (bytes.byteLength < 44 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") {
    return invalidAudio();
  }

  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (data.getUint32(4, true) + 8 !== bytes.byteLength) return invalidAudio();

  let offset = 12;
  let formatSeen = false;
  let dataSeen = false;
  let dataBytes = 0;

  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < 8) return invalidAudio();
    const type = ascii(bytes, offset, 4);
    const chunkBytes = data.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkBytes;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > bytes.byteLength) return invalidAudio();

    if (type === "fmt ") {
      if (formatSeen || chunkBytes !== 16) return invalidAudio();
      formatSeen = true;
      if (data.getUint16(chunkStart, true) !== PCM_FORMAT
        || data.getUint16(chunkStart + 2, true) !== PCM_CHANNEL_COUNT
        || data.getUint32(chunkStart + 4, true) !== PCM_SAMPLE_RATE
        || data.getUint32(chunkStart + 8, true) !== EXPECTED_BYTE_RATE
        || data.getUint16(chunkStart + 12, true) !== EXPECTED_BLOCK_ALIGN
        || data.getUint16(chunkStart + 14, true) !== PCM_BITS_PER_SAMPLE) {
        return invalidAudio();
      }
    } else if (type === "data") {
      if (dataSeen || chunkBytes === 0 || chunkBytes % EXPECTED_BLOCK_ALIGN !== 0) return invalidAudio();
      dataSeen = true;
      dataBytes = chunkBytes;
    }

    offset = chunkEnd + (chunkBytes % 2);
    if (offset > bytes.byteLength) return invalidAudio();
  }

  if (offset !== bytes.byteLength || !formatSeen || !dataSeen) return invalidAudio();
  const durationMs = Math.round((dataBytes / EXPECTED_BYTE_RATE) * 1_000);
  const sampleFrameCount = dataBytes / EXPECTED_BLOCK_ALIGN;
  const durationCeilingMs = Math.ceil((sampleFrameCount * 1_000) / PCM_SAMPLE_RATE);
  if (!Number.isSafeInteger(sampleFrameCount) || sampleFrameCount < 1
    || !Number.isSafeInteger(durationMs) || durationMs < 1
    || !Number.isSafeInteger(durationCeilingMs) || durationCeilingMs < durationMs) return invalidAudio();
  if (declaredDurationMs !== undefined
    && (!Number.isSafeInteger(declaredDurationMs) || declaredDurationMs < 1
      || Math.abs(durationMs - declaredDurationMs) > WAV_DURATION_TOLERANCE_MS)) {
    return invalidAudio();
  }
  return {
    durationMs,
    durationCeilingMs,
    sampleFrameCount,
    sampleRate: PCM_SAMPLE_RATE,
    channels: PCM_CHANNEL_COUNT,
    bitsPerSample: PCM_BITS_PER_SAMPLE,
    dataSizeBytes: dataBytes,
  };
}
