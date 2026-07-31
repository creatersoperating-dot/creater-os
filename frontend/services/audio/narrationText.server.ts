import "server-only";

import { createHash } from "node:crypto";

import { AudioProductionError } from "@/types/audioProduction";

export const MAX_NARRATION_CHARACTERS = 12_000;

export interface NarrationPreparationResult {
  readonly text: string;
  readonly inputCharacters: number;
  readonly sourceContentSha256: string;
}

const INCLUDED_SECTIONS = new Set([
  "hook",
  "introduction",
  "intro",
  "script",
  "main script",
  "main narration",
  "narration",
  "call to action",
  "cta",
  "outro",
]);

const EXCLUDED_SECTIONS = new Set([
  "video title suggestions",
  "title suggestions",
  "titles",
  "target audience and angle",
  "target audience",
  "thumbnail concepts",
  "thumbnail ideas",
  "keywords",
  "seo keywords",
  "production notes",
  "b roll",
  "b roll ideas",
  "scene directions",
]);

const PRODUCTION_PREFIX = /^(?:b[ -]?roll|visuals?|scene(?:\s+\d+)?|shot(?:\s+\d+)?|camera|on[ -]?screen(?: text)?|production notes?|filming notes?|music|sfx|sound effects?)\s*:/i;
const PRODUCTION_LABEL = /^(?:b[ -]?roll|visuals?|scene(?:\s+\d+)?|shot(?:\s+\d+)?|camera|on[ -]?screen(?: text)?|production notes?|filming notes?|music|sfx|sound effects?)$/i;
const NARRATION_PREFIX = /^(?:narration|narrator|voice[ -]?over|vo)\s*:\s*/i;
const INLINE_PRODUCTION_DIRECTION = /\s*(?:\[|\()(?:b[ -]?roll|visuals?|scene|shot|camera|on[ -]?screen(?: text)?|production notes?|filming notes?|music|sfx|sound effects?)\s*:[^\])]*(?:\]|\))/gi;

function normalizeHeading(value: string): string {
  return value
    .replace(/[*_~`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function getHeading(line: string): string | null {
  const match = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
  return match ? normalizeHeading(match[1]) : null;
}

function hasCreatorOsStructure(lines: readonly string[]): boolean {
  const headings = new Set(
    lines
      .map(getHeading)
      .filter((heading): heading is string => heading !== null),
  );
  const knownHeadings = [...headings].filter(
    (heading) =>
      INCLUDED_SECTIONS.has(heading) || EXCLUDED_SECTIONS.has(heading),
  );

  return (
    knownHeadings.length >= 3 &&
    headings.has("script") &&
    (["hook", "introduction", "call to action"] as const).some((heading) =>
      headings.has(heading),
    )
  );
}

function stripMarkdownLine(line: string): string {
  let text = line.trim();

  if (!text || /^(```|~~~)/.test(text) || /^([-*_])(?:\s*\1){2,}$/.test(text)) {
    return "";
  }

  text = text.replace(/^\s{0,3}#{1,6}\s+/, "");
  text = text.replace(/^\s{0,3}>\s?/, "");
  text = text.replace(/^\s*(?:[-+*]|\d+[.)])\s+/, "");
  text = text.replace(INLINE_PRODUCTION_DIRECTION, "");
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  text = text.replace(/<\/?[a-zA-Z][^>]*>/g, "");
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/__([^_]+)__/g, "$1");
  text = text.replace(/~~([^~]+)~~/g, "$1");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1");
  text = text.replace(/(?<!_)_([^_]+)_(?!_)/g, "$1");
  text = text.replace(/\\([\\`*_[\]{}()#+.!-])/g, "$1");

  return text.trim();
}

function prepareSpokenLine(line: string): string | null {
  const spokenLine = stripMarkdownLine(line);

  if (!spokenLine) {
    return "";
  }

  const classificationLine = spokenLine
    .replace(/^\[([^\]]+)]$/, "$1")
    .replace(/^\(([^)]+)\)$/, "$1")
    .trim();

  if (
    PRODUCTION_PREFIX.test(classificationLine) ||
    PRODUCTION_LABEL.test(classificationLine)
  ) {
    return null;
  }

  return spokenLine.replace(NARRATION_PREFIX, "").trim();
}

function finalizeNarration(lines: readonly string[]): string {
  const output: string[] = [];
  let previousWasBlank = true;

  for (const line of lines) {
    const spokenLine = prepareSpokenLine(line);

    if (spokenLine === null) {
      continue;
    }

    if (!spokenLine) {
      if (!previousWasBlank) {
        output.push("");
      }
      previousWasBlank = true;
      continue;
    }

    output.push(spokenLine);
    previousWasBlank = false;
  }

  while (output.at(-1) === "") {
    output.pop();
  }

  return output.join("\n").trim();
}

function extractStructuredNarration(lines: readonly string[]): string {
  const narrationLines: string[] = [];
  let includeCurrentSection = false;

  for (const line of lines) {
    const heading = getHeading(line);

    if (heading !== null) {
      if (INCLUDED_SECTIONS.has(heading)) {
        if (narrationLines.at(-1) !== "") {
          narrationLines.push("");
        }
        includeCurrentSection = true;
      } else if (EXCLUDED_SECTIONS.has(heading)) {
        includeCurrentSection = false;
      }

      continue;
    }

    if (includeCurrentSection) {
      narrationLines.push(line);
    }
  }

  return finalizeNarration(narrationLines);
}

export function prepareNarrationText(
  sourceScriptContent: string,
): NarrationPreparationResult {
  const sourceContentSha256 = createHash("sha256")
    .update(sourceScriptContent, "utf8")
    .digest("hex");

  if (!sourceScriptContent.trim()) {
    throw new AudioProductionError(
      "narration_empty",
      "The attached script does not contain narration.",
    );
  }

  const lines = sourceScriptContent.replace(/\r\n?/g, "\n").split("\n");
  const narration = hasCreatorOsStructure(lines)
    ? extractStructuredNarration(lines)
    : finalizeNarration(lines);

  if (!narration) {
    throw new AudioProductionError(
      "narration_empty",
      "The attached script does not contain narration.",
    );
  }

  if (narration.length > MAX_NARRATION_CHARACTERS) {
    throw new AudioProductionError(
      "narration_too_long",
      `Narration must be ${MAX_NARRATION_CHARACTERS.toLocaleString("en-US")} characters or fewer.`,
    );
  }

  return {
    text: narration,
    inputCharacters: narration.length,
    sourceContentSha256,
  };
}
