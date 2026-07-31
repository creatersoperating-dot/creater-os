"use client";

import {
  createCloudScript,
  getCloudScriptsByBrand,
} from "@/services/cloudScriptService";
import { getAllScripts } from "@/services/scriptService";

export interface LocalScriptImportResult {
  found: number;
  imported: number;
  skipped: number;
}

function createDuplicateKey(
  title: string,
  topic: string,
  content: string,
): string {
  return JSON.stringify([
    title.trim(),
    topic.trim(),
    content.trim(),
  ]);
}

export function getLocalScriptCount(): number {
  return getAllScripts().length;
}

export async function importLocalScriptsToBrand(
  brandId: string,
): Promise<LocalScriptImportResult> {
  if (typeof brandId !== "string" || brandId.trim() === "") {
    throw new Error("brandId is required.");
  }

  const normalizedBrandId = brandId.trim();
  const localScripts = getAllScripts();
  const cloudScripts = await getCloudScriptsByBrand(normalizedBrandId);
  const knownScripts = new Set(
    cloudScripts.map((script) =>
      createDuplicateKey(script.title, script.topic, script.content),
    ),
  );
  let imported = 0;
  let skipped = 0;

  for (const script of localScripts) {
    const duplicateKey = createDuplicateKey(
      script.title,
      script.topic,
      script.content,
    );

    if (knownScripts.has(duplicateKey)) {
      skipped += 1;
      continue;
    }

    await createCloudScript({
      brandId: normalizedBrandId,
      title: script.title,
      topic: script.topic,
      content: script.content,
    });

    knownScripts.add(duplicateKey);
    imported += 1;
  }

  return {
    found: localScripts.length,
    imported,
    skipped,
  };
}
