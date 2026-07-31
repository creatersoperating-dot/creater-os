import "server-only";

import { AudioProductionError } from "@/types/audioProduction";

export const MAX_SPEECH_SEGMENT_CHARACTERS = 3_800;

export function normalizeNarrationForComparison(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function requireValidSegmentLimit(maximumSegmentCharacters: number): void {
  if (
    !Number.isSafeInteger(maximumSegmentCharacters) ||
    maximumSegmentCharacters < 1 ||
    maximumSegmentCharacters > MAX_SPEECH_SEGMENT_CHARACTERS
  ) {
    throw new AudioProductionError(
      "invalid_segment_limit",
      "The speech segment limit is invalid.",
    );
  }
}

function findParagraphBoundary(value: string, maximum: number): number {
  const candidate = value.slice(0, maximum + 1);
  const matches = [...candidate.matchAll(/\n\s*\n/g)];
  const match = matches.at(-1);
  return match ? match.index : -1;
}

function findSentenceBoundary(value: string, maximum: number): number {
  const candidate = value.slice(0, maximum + 1);
  let boundary = -1;

  for (const match of candidate.matchAll(/[.!?]["')\]]?(?=\s)/g)) {
    boundary = (match.index ?? 0) + match[0].length;
  }

  return boundary;
}

function findWhitespaceBoundary(value: string, maximum: number): number {
  const candidate = value.slice(0, maximum + 1);
  let boundary = -1;

  for (const match of candidate.matchAll(/\s+/g)) {
    boundary = match.index ?? boundary;
  }

  return boundary;
}

function findBoundary(value: string, maximum: number): number {
  const paragraphBoundary = findParagraphBoundary(value, maximum);
  if (paragraphBoundary > 0) {
    return paragraphBoundary;
  }

  const sentenceBoundary = findSentenceBoundary(value, maximum);
  if (sentenceBoundary > 0) {
    return sentenceBoundary;
  }

  return findWhitespaceBoundary(value, maximum);
}

export function validateNarrationSegments(
  narration: string,
  segments: readonly string[],
  maximumSegmentCharacters = MAX_SPEECH_SEGMENT_CHARACTERS,
): void {
  requireValidSegmentLimit(maximumSegmentCharacters);

  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        !segment.trim() || segment.length > maximumSegmentCharacters,
    )
  ) {
    throw new AudioProductionError(
      "invalid_segments",
      "Narration could not be divided into valid speech segments.",
    );
  }

  if (
    normalizeNarrationForComparison(segments.join(" ")) !==
    normalizeNarrationForComparison(narration)
  ) {
    throw new AudioProductionError(
      "invalid_segments",
      "Speech segments do not preserve the original narration.",
    );
  }
}

export function splitNarrationIntoSegments(
  narration: string,
  maximumSegmentCharacters = MAX_SPEECH_SEGMENT_CHARACTERS,
): readonly string[] {
  requireValidSegmentLimit(maximumSegmentCharacters);

  let remaining = narration.trim();

  if (!remaining) {
    throw new AudioProductionError(
      "narration_empty",
      "The attached script does not contain narration.",
    );
  }

  const segments: string[] = [];

  while (remaining.length > maximumSegmentCharacters) {
    const boundary = findBoundary(remaining, maximumSegmentCharacters);

    if (boundary <= 0) {
      throw new AudioProductionError(
        "indivisible_token",
        "Narration contains a token that is too long for speech generation.",
      );
    }

    const segment = remaining.slice(0, boundary).trim();

    if (!segment) {
      throw new AudioProductionError(
        "invalid_segments",
        "Narration could not be divided into valid speech segments.",
      );
    }

    segments.push(segment);
    remaining = remaining.slice(boundary).trimStart();
  }

  if (remaining) {
    segments.push(remaining);
  }

  validateNarrationSegments(
    narration,
    segments,
    maximumSegmentCharacters,
  );
  return segments;
}
