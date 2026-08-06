import "server-only";

import { VideoProviderError } from "@/services/providers/video/videoProviderTypes";

export interface ValidatedMp4Metadata {
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
  fastStart: boolean;
}

interface Box {
  type: string;
  start: number;
  dataStart: number;
  end: number;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function boxType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function boxes(bytes: Uint8Array, start: number, end: number): Box[] {
  const result: Box[] = [];
  const data = view(bytes);
  let offset = start;
  while (offset < end) {
    if (end - offset < 8) throw new VideoProviderError("invalid_render", "The video renderer returned a truncated MP4.");
    let size = Number(data.getUint32(offset));
    const type = boxType(bytes, offset + 4);
    let headerSize = 8;
    if (size === 1) {
      if (end - offset < 16) throw new VideoProviderError("invalid_render", "The video renderer returned a truncated MP4.");
      const extended = data.getBigUint64(offset + 8);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) throw new VideoProviderError("invalid_render", "The video renderer returned an unsupported MP4.");
      size = Number(extended);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) throw new VideoProviderError("invalid_render", "The video renderer returned malformed MP4 metadata.");
    result.push({ type, start: offset, dataStart: offset + headerSize, end: offset + size });
    offset += size;
  }
  return result;
}

function movieDuration(bytes: Uint8Array, mvhd: Box): number {
  const data = view(bytes);
  if (mvhd.end - mvhd.dataStart < 20) throw new VideoProviderError("invalid_render", "The video renderer returned incomplete movie timing metadata.");
  const version = data.getUint8(mvhd.dataStart);
  const timescaleOffset = mvhd.dataStart + (version === 1 ? 20 : 12);
  const durationOffset = timescaleOffset + 4;
  if ((version !== 0 && version !== 1) || durationOffset + (version === 1 ? 8 : 4) > mvhd.end) {
    throw new VideoProviderError("invalid_render", "The video renderer returned unsupported movie timing metadata.");
  }
  const timescale = data.getUint32(timescaleOffset);
  const duration = version === 1 ? data.getBigUint64(durationOffset) : BigInt(data.getUint32(durationOffset));
  if (timescale === 0 || duration === BigInt(0) || duration > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new VideoProviderError("invalid_render", "The video renderer returned an invalid video duration.");
  }
  const milliseconds = Number(duration) * 1000 / timescale;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) throw new VideoProviderError("invalid_render", "The video renderer returned an invalid video duration.");
  return Math.round(milliseconds);
}

function trackDimensions(bytes: Uint8Array, tkhd: Box): { width: number; height: number } {
  const data = view(bytes);
  if (tkhd.end - tkhd.dataStart < 84) throw new VideoProviderError("invalid_render", "The video renderer returned incomplete track metadata.");
  const version = data.getUint8(tkhd.dataStart);
  const widthOffset = tkhd.end - 8;
  const width = data.getUint32(widthOffset) / 65536;
  const height = data.getUint32(widthOffset + 4) / 65536;
  if ((version !== 0 && version !== 1) || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new VideoProviderError("invalid_render", "The video renderer returned invalid video dimensions.");
  }
  return { width, height };
}

function trackHandler(bytes: Uint8Array, trak: Box): string | null {
  const mdia = boxes(bytes, trak.dataStart, trak.end).find((box) => box.type === "mdia");
  if (!mdia) return null;
  const hdlr = boxes(bytes, mdia.dataStart, mdia.end).find((box) => box.type === "hdlr");
  return hdlr && hdlr.end - hdlr.dataStart >= 12 ? boxType(bytes, hdlr.dataStart + 8) : null;
}

function hasSampleEntry(bytes: Uint8Array, trak: Box, expectedType: "avc1" | "mp4a"): boolean {
  const mdia = boxes(bytes, trak.dataStart, trak.end).find((box) => box.type === "mdia");
  if (!mdia) return false;
  const minf = boxes(bytes, mdia.dataStart, mdia.end).find((box) => box.type === "minf");
  if (!minf) return false;
  const stbl = boxes(bytes, minf.dataStart, minf.end).find((box) => box.type === "stbl");
  if (!stbl) return false;
  const stsd = boxes(bytes, stbl.dataStart, stbl.end).find((box) => box.type === "stsd");
  if (!stsd || stsd.end - stsd.dataStart < 8) return false;
  const data = view(bytes);
  const entryCount = data.getUint32(stsd.dataStart + 4);
  let offset = stsd.dataStart + 8;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 8 > stsd.end) return false;
    const size = data.getUint32(offset);
    if (size < 8 || offset + size > stsd.end) return false;
    if (boxType(bytes, offset + 4) === expectedType) return true;
    offset += size;
  }
  return false;
}

function normalizeFullBoxTimestamps(bytes: Uint8Array, box: Box): void {
  const data = view(bytes);
  if (box.end - box.dataStart < 12) {
    throw new VideoProviderError("invalid_render", "The video renderer returned incomplete timestamp metadata.");
  }
  const version = data.getUint8(box.dataStart);
  if (version === 0) {
    data.setUint32(box.dataStart + 4, 0);
    data.setUint32(box.dataStart + 8, 0);
    return;
  }
  if (version === 1) {
    if (box.end - box.dataStart < 20) {
      throw new VideoProviderError("invalid_render", "The video renderer returned incomplete timestamp metadata.");
    }
    data.setBigUint64(box.dataStart + 4, BigInt(0));
    data.setBigUint64(box.dataStart + 12, BigInt(0));
    return;
  }
  throw new VideoProviderError("invalid_render", "The video renderer returned unsupported timestamp metadata.");
}

export function validateMp4(bytes: Uint8Array): ValidatedMp4Metadata {
  if (bytes.byteLength < 32) throw new VideoProviderError("invalid_render", "The video renderer returned an empty or truncated MP4.");
  const top = boxes(bytes, 0, bytes.byteLength);
  const ftyp = top.find((box) => box.type === "ftyp");
  const moov = top.find((box) => box.type === "moov");
  const mdat = top.find((box) => box.type === "mdat");
  if (!ftyp || !moov || !mdat || mdat.end <= mdat.dataStart) throw new VideoProviderError("invalid_render", "The video renderer returned an invalid MP4 container.");
  const ftypBytes = ftyp.end - ftyp.dataStart;
  if (ftypBytes < 8 || (ftypBytes - 8) % 4 !== 0) {
    throw new VideoProviderError("invalid_render", "The video renderer returned malformed MP4 file-type metadata.");
  }
  const brands = [boxType(bytes, ftyp.dataStart)];
  for (let offset = ftyp.dataStart + 8; offset < ftyp.end; offset += 4) brands.push(boxType(bytes, offset));
  if (!brands.some((brand) => ["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V "].includes(brand))) {
    throw new VideoProviderError("invalid_render", "The video renderer returned an unsupported MP4 file type.");
  }
  const movieBoxes = boxes(bytes, moov.dataStart, moov.end);
  const mvhd = movieBoxes.find((box) => box.type === "mvhd");
  if (!mvhd) throw new VideoProviderError("invalid_render", "The video renderer returned MP4 metadata without a movie header.");
  const tracks = movieBoxes.filter((box) => box.type === "trak");
  const videoTrack = tracks.find((track) => trackHandler(bytes, track) === "vide");
  if (!videoTrack || !hasSampleEntry(bytes, videoTrack, "avc1")) throw new VideoProviderError("invalid_render", "The video renderer returned an MP4 without an H.264 video track.");
  const audioTracks = tracks.filter((track) => trackHandler(bytes, track) === "soun");
  const hasAudio = audioTracks.some((track) => hasSampleEntry(bytes, track, "mp4a"));
  if (audioTracks.length > 0 && !hasAudio) throw new VideoProviderError("invalid_render", "The video renderer returned an MP4 with an unsupported audio track.");
  const tkhd = boxes(bytes, videoTrack.dataStart, videoTrack.end).find((box) => box.type === "tkhd");
  if (!tkhd) throw new VideoProviderError("invalid_render", "The video renderer returned MP4 metadata without video dimensions.");
  return { durationMs: movieDuration(bytes, mvhd), ...trackDimensions(bytes, tkhd), hasAudio, fastStart: moov.start < mdat.start };
}

export function normalizeMp4Timestamps(bytes: Uint8Array): Uint8Array {
  validateMp4(bytes);
  const normalized = bytes.slice();
  const top = boxes(normalized, 0, normalized.byteLength);
  const moov = top.find((box) => box.type === "moov");
  if (!moov) throw new VideoProviderError("invalid_render", "The video renderer returned an invalid MP4 container.");
  const movieBoxes = boxes(normalized, moov.dataStart, moov.end);
  const mvhd = movieBoxes.find((box) => box.type === "mvhd");
  if (!mvhd) throw new VideoProviderError("invalid_render", "The video renderer returned MP4 metadata without a movie header.");
  normalizeFullBoxTimestamps(normalized, mvhd);
  for (const trak of movieBoxes.filter((box) => box.type === "trak")) {
    const trackBoxes = boxes(normalized, trak.dataStart, trak.end);
    const tkhd = trackBoxes.find((box) => box.type === "tkhd");
    if (tkhd) normalizeFullBoxTimestamps(normalized, tkhd);
    const mdia = trackBoxes.find((box) => box.type === "mdia");
    if (!mdia) continue;
    const mdhd = boxes(normalized, mdia.dataStart, mdia.end).find((box) => box.type === "mdhd");
    if (mdhd) normalizeFullBoxTimestamps(normalized, mdhd);
  }
  validateMp4(normalized);
  return normalized;
}
