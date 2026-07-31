"use client";

import { createClient } from "@/lib/supabase/client";
import type {
  CreatorScript,
  CreateScriptInput,
  UpdateScriptInput,
} from "@/types/script";
import {
  type ScriptRow,
  mapScriptRowToScript,
  mapScriptToRow,
} from "./scriptMapper";

export const CLOUD_SCRIPT_LIBRARY_CHANGED_EVENT =
  "creatoros:cloud-script-library-changed";

type SupabaseBrowserClient = ReturnType<typeof createClient>;

interface ScriptUpdateRow {
  title?: string;
  topic?: string;
  content?: string;
  updated_at: string;
}

function dispatchLibraryChanged(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.dispatchEvent(
      new Event(CLOUD_SCRIPT_LIBRARY_CHANGED_EVENT),
    );
  } catch {
    // Event delivery is best-effort.
  }
}

async function requireAuthenticatedUser(
  supabase: SupabaseBrowserClient,
) {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error("Authentication required.");
  }

  return user;
}

function normalizeRequiredText(
  value: unknown,
  fieldName: string,
): string {
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

export async function getCloudScriptsByBrand(
  brandId: string,
): Promise<CreatorScript[]> {
  const normalizedBrandId = brandId.trim();

  if (!normalizedBrandId) {
    return [];
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("scripts")
    .select("*")
    .eq("brand_id", normalizedBrandId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw error;
  }

  return ((data ?? []) as ScriptRow[]).map(mapScriptRowToScript);
}

export async function createCloudScript(
  input: CreateScriptInput,
): Promise<CreatorScript> {
  const supabase = createClient();
  const user = await requireAuthenticatedUser(supabase);
  const timestamp = new Date().toISOString();
  const script: CreatorScript = {
    id: crypto.randomUUID(),
    brandId: normalizeRequiredText(input.brandId, "brandId"),
    title: normalizeRequiredText(input.title, "title"),
    topic: normalizeRequiredText(input.topic, "topic"),
    content: normalizeContent(input.content),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const row = mapScriptToRow(script, user.id);
  const { data, error } = await supabase
    .from("scripts")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  dispatchLibraryChanged();
  return mapScriptRowToScript(data as ScriptRow);
}

export async function updateCloudScript(
  id: string,
  updates: UpdateScriptInput,
): Promise<CreatorScript | null> {
  const supabase = createClient();
  const user = await requireAuthenticatedUser(supabase);
  const normalizedId = normalizeRequiredText(id, "id");
  const updateRow: ScriptUpdateRow = {
    updated_at: new Date().toISOString(),
  };

  if (updates.title !== undefined) {
    updateRow.title = normalizeRequiredText(updates.title, "title");
  }

  if (updates.topic !== undefined) {
    updateRow.topic = normalizeRequiredText(updates.topic, "topic");
  }

  if (updates.content !== undefined) {
    updateRow.content = normalizeContent(updates.content);
  }

  const { data, error } = await supabase
    .from("scripts")
    .update(updateRow)
    .eq("user_id", user.id)
    .eq("id", normalizedId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  dispatchLibraryChanged();
  return mapScriptRowToScript(data as ScriptRow);
}

export async function deleteCloudScript(id: string): Promise<boolean> {
  const supabase = createClient();
  const user = await requireAuthenticatedUser(supabase);
  const normalizedId = normalizeRequiredText(id, "id");
  const { data, error } = await supabase
    .from("scripts")
    .delete()
    .eq("user_id", user.id)
    .eq("id", normalizedId)
    .select("id");

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    return false;
  }

  dispatchLibraryChanged();
  return true;
}
