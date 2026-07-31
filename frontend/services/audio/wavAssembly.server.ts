import "server-only";

import { AudioProductionError } from "@/types/audioProduction";

export const PCM_SAMPLE_RATE = 24_000;
export const PCM_CHANNEL_COUNT = 1;
export const PCM_BITS_PER_SAMPLE = 16;

const BYTES_PER_SAMPLE = PCM_BITS_PER_SAMPLE / 8;
const WAV_HEADER_BYTES = 44;
const MAX_RIFF_SIZE = 0xffff_ffff;
const MAX_PCM_DATA_BYTES = MAX_RIFF_SIZE - (WAV_HEADER_BYTES - 8);

export interface WavAssemblyResult {
  readonly wavBytes: Uint8Array;
  readonly mimeType: "audio/wav";
  readonly extension: "wav";
  readonly fileSizeBytes: number;
  readonly durationMs: number;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export function assemblePcmChunksToWav(
  pcmChunks: readonly Uint8Array[],
): WavAssemblyResult {
  if (pcmChunks.length === 0) {
    throw new AudioProductionError(
      "invalid_pcm",
      "No PCM audio was generated.",
    );
  }

  let pcmByteLength = 0;

  for (const chunk of pcmChunks) {
    if (chunk.byteLength === 0 || chunk.byteLength % BYTES_PER_SAMPLE !== 0) {
      throw new AudioProductionError(
        "invalid_pcm",
        "Generated PCM audio is empty or misaligned.",
      );
    }

    pcmByteLength += chunk.byteLength;

    if (
      !Number.isSafeInteger(pcmByteLength) ||
      pcmByteLength > MAX_PCM_DATA_BYTES
    ) {
      throw new AudioProductionError(
        "audio_too_large",
        "Generated audio exceeds the WAV size limit.",
      );
    }
  }

  const fileSizeBytes = WAV_HEADER_BYTES + pcmByteLength;
  let wavBytes: Uint8Array;

  try {
    wavBytes = new Uint8Array(fileSizeBytes);
  } catch {
    throw new AudioProductionError(
      "audio_too_large",
      "Generated audio is too large to assemble safely.",
    );
  }

  const view = new DataView(wavBytes.buffer);
  const byteRate = PCM_SAMPLE_RATE * PCM_CHANNEL_COUNT * BYTES_PER_SAMPLE;
  const blockAlign = PCM_CHANNEL_COUNT * BYTES_PER_SAMPLE;

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, fileSizeBytes - 8, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, PCM_CHANNEL_COUNT, true);
  view.setUint32(24, PCM_SAMPLE_RATE, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, PCM_BITS_PER_SAMPLE, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcmByteLength, true);

  let offset = WAV_HEADER_BYTES;
  for (const chunk of pcmChunks) {
    wavBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    wavBytes,
    mimeType: "audio/wav",
    extension: "wav",
    fileSizeBytes,
    durationMs: Math.round((pcmByteLength / byteRate) * 1_000),
  };
}
