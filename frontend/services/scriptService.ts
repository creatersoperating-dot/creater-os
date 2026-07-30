import type {
  CreatorScript,
  CreateScriptInput,
  UpdateScriptInput,
} from "../types/script";

// V1 persistence is device-local and browser-only. A server repository can
// replace this service later without coupling script storage to the AI Core.
const STORAGE_KEY = "creatoros:scripts:v1";

let fallbackIdSequence = 0;

function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parseScript(value: unknown): CreatorScript | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    record.id.trim() === "" ||
    typeof record.brandId !== "string" ||
    record.brandId.trim() === "" ||
    typeof record.title !== "string" ||
    record.title.trim() === "" ||
    typeof record.topic !== "string" ||
    record.topic.trim() === "" ||
    typeof record.content !== "string" ||
    record.content.trim() === "" ||
    !isValidTimestamp(record.createdAt) ||
    !isValidTimestamp(record.updatedAt)
  ) {
    return null;
  }

  return {
    id: record.id,
    brandId: record.brandId.trim(),
    title: record.title.trim(),
    topic: record.topic.trim(),
    content: record.content,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function readScripts(): CreatorScript[] {
  const storage = getBrowserStorage();
  if (!storage) {
    return [];
  }

  try {
    const rawValue = storage.getItem(STORAGE_KEY);
    if (!rawValue) {
      return [];
    }

    const parsed: unknown = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.reduce<CreatorScript[]>((scripts, value) => {
      const script = parseScript(value);
      if (script) {
        scripts.push(script);
      }
      return scripts;
    }, []);
  } catch {
    return [];
  }
}

function writeScripts(scripts: CreatorScript[]): void {
  const storage = getBrowserStorage();
  if (!storage) {
    throw new Error("Script storage is unavailable.");
  }

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(scripts));
  } catch {
    throw new Error("Unable to save scripts on this device.");
  }
}

function normalizeRequiredText(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} is required.`);
  }

  return value.trim();
}

function normalizeContent(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("content is required.");
  }

  return value;
}

function createId(): string {
  try {
    if (
      typeof globalThis.crypto !== "undefined" &&
      typeof globalThis.crypto.randomUUID === "function"
    ) {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // Continue to the dependency-free fallback when browser crypto is blocked.
  }

  fallbackIdSequence = (fallbackIdSequence + 1) % Number.MAX_SAFE_INTEGER;
  const randomPart = Math.random().toString(36).slice(2);
  return `script-${Date.now().toString(36)}-${fallbackIdSequence.toString(36)}-${randomPart}`;
}

export function getScriptsByBrand(brandId: string): CreatorScript[] {
  const normalizedBrandId = brandId.trim();
  if (!normalizedBrandId) {
    return [];
  }

  return readScripts()
    .filter((script) => script.brandId === normalizedBrandId)
    .sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    );
}

export function getScriptById(id: string): CreatorScript | null {
  return readScripts().find((script) => script.id === id) ?? null;
}

export function createScript(input: CreateScriptInput): CreatorScript {
  const timestamp = new Date().toISOString();
  const script: CreatorScript = {
    id: createId(),
    brandId: normalizeRequiredText(input.brandId, "brandId"),
    title: normalizeRequiredText(input.title, "title"),
    topic: normalizeRequiredText(input.topic, "topic"),
    content: normalizeContent(input.content),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  writeScripts([...readScripts(), script]);
  return script;
}

export function updateScript(
  id: string,
  updates: UpdateScriptInput,
): CreatorScript | null {
  const scripts = readScripts();
  const index = scripts.findIndex((script) => script.id === id);
  if (index === -1) {
    return null;
  }

  const current = scripts[index];
  const updated: CreatorScript = {
    ...current,
    id: current.id,
    brandId: current.brandId,
    title:
      updates.title === undefined
        ? current.title
        : normalizeRequiredText(updates.title, "title"),
    topic:
      updates.topic === undefined
        ? current.topic
        : normalizeRequiredText(updates.topic, "topic"),
    content:
      updates.content === undefined
        ? current.content
        : normalizeContent(updates.content),
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  };

  scripts[index] = updated;
  writeScripts(scripts);
  return updated;
}

export function deleteScript(id: string): boolean {
  const scripts = readScripts();
  const remainingScripts = scripts.filter((script) => script.id !== id);
  if (remainingScripts.length === scripts.length) {
    return false;
  }

  writeScripts(remainingScripts);
  return true;
}
