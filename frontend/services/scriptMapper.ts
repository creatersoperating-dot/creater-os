import type { CreatorScript } from "@/types/script";

export interface ScriptRow {
  user_id: string;
  id: string;
  brand_id: string;
  title: string;
  topic: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export function mapScriptRowToScript(row: ScriptRow): CreatorScript {
  return {
    id: row.id,
    brandId: row.brand_id,
    title: row.title,
    topic: row.topic,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapScriptToRow(
  script: CreatorScript,
  userId: string,
): ScriptRow {
  return {
    user_id: userId,
    id: script.id,
    brand_id: script.brandId,
    title: script.title,
    topic: script.topic,
    content: script.content,
    created_at: script.createdAt,
    updated_at: script.updatedAt,
  };
}
