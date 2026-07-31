"use client";

import { createClient } from "@/lib/supabase/client";
import type {
  CreatorVideoProject,
  CreateVideoProjectInput,
  UpdateVideoProjectInput,
  VideoProjectStatus,
} from "@/types/videoProject";
import {
  type VideoProjectRow,
  mapVideoProjectRowToProject,
  mapVideoProjectToRow,
} from "./videoProjectMapper";

export const CLOUD_VIDEO_PROJECTS_CHANGED_EVENT =
  "creatoros:cloud-video-projects-changed";

type SupabaseBrowserClient = ReturnType<typeof createClient>;

interface VideoProjectUpdateRow {
  script_id?: string | null;
  title?: string;
  topic?: string;
  status?: VideoProjectStatus;
  updated_at: string;
}

function dispatchProjectsChanged(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.dispatchEvent(
      new Event(CLOUD_VIDEO_PROJECTS_CHANGED_EVENT),
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

function normalizeOptionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalId(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue || null;
}

function buildVideoProjectUpdateRow(
  updates: UpdateVideoProjectInput,
): VideoProjectUpdateRow {
  const updateRow: VideoProjectUpdateRow = {
    updated_at: new Date().toISOString(),
  };

  if (updates.scriptId !== undefined) {
    updateRow.script_id = normalizeOptionalId(updates.scriptId);
  }

  if (updates.title !== undefined) {
    updateRow.title = normalizeRequiredText(
      updates.title,
      "title",
    );
  }

  if (updates.topic !== undefined) {
    updateRow.topic = normalizeOptionalText(updates.topic);
  }

  if (updates.status !== undefined) {
    updateRow.status = updates.status;
  }

  return updateRow;
}

export async function getCloudVideoProjectsByBrand(
  brandId: string,
): Promise<CreatorVideoProject[]> {
  const normalizedBrandId = brandId.trim();

  if (!normalizedBrandId) {
    return [];
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("video_projects")
    .select("*")
    .eq("brand_id", normalizedBrandId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw error;
  }

  return ((data ?? []) as VideoProjectRow[]).map(
    mapVideoProjectRowToProject,
  );
}

export async function getCloudVideoProjectById(
  id: string,
): Promise<CreatorVideoProject | null> {
  const normalizedId = id.trim();

  if (!normalizedId) {
    return null;
  }

  const supabase = createClient();
  const user = await requireAuthenticatedUser(supabase);
  const { data, error } = await supabase
    .from("video_projects")
    .select("*")
    .eq("user_id", user.id)
    .eq("id", normalizedId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data
    ? mapVideoProjectRowToProject(data as VideoProjectRow)
    : null;
}

export async function createCloudVideoProject(
  input: CreateVideoProjectInput,
): Promise<CreatorVideoProject> {
  const supabase = createClient();
  const user = await requireAuthenticatedUser(supabase);
  const timestamp = new Date().toISOString();

  const project: CreatorVideoProject = {
    id: crypto.randomUUID(),
    brandId: normalizeRequiredText(input.brandId, "brandId"),
    scriptId: normalizeOptionalId(input.scriptId),
    audioGenerationId: null,
    title: normalizeRequiredText(input.title, "title"),
    topic: normalizeOptionalText(input.topic),
    status: input.status ?? "idea",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const row = mapVideoProjectToRow(project, user.id);
  const { data, error } = await supabase
    .from("video_projects")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  dispatchProjectsChanged();
  return mapVideoProjectRowToProject(data as VideoProjectRow);
}

export async function updateCloudVideoProject(
  id: string,
  updates: UpdateVideoProjectInput,
): Promise<CreatorVideoProject | null> {
  const supabase = createClient();
  const user = await requireAuthenticatedUser(supabase);
  const normalizedId = normalizeRequiredText(id, "id");
  const updateRow = buildVideoProjectUpdateRow(updates);

  const { data, error } = await supabase
    .from("video_projects")
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

  dispatchProjectsChanged();
  return mapVideoProjectRowToProject(data as VideoProjectRow);
}

export async function updateCloudVideoProjectIfUnchanged(
  id: string,
  brandId: string,
  expectedUpdatedAt: string,
  updates: UpdateVideoProjectInput,
): Promise<CreatorVideoProject | null> {
  const supabase = createClient();
  await requireAuthenticatedUser(supabase);
  const normalizedId = normalizeRequiredText(id, "id");
  const normalizedBrandId = normalizeRequiredText(
    brandId,
    "brandId",
  );
  const normalizedExpectedUpdatedAt = normalizeRequiredText(
    expectedUpdatedAt,
    "expectedUpdatedAt",
  );
  const updateRow = buildVideoProjectUpdateRow(updates);

  const { data, error } = await supabase
    .from("video_projects")
    .update(updateRow)
    .eq("id", normalizedId)
    .eq("brand_id", normalizedBrandId)
    .eq("updated_at", normalizedExpectedUpdatedAt)
    .select("*")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  dispatchProjectsChanged();
  return mapVideoProjectRowToProject(data as VideoProjectRow);
}

export async function deleteCloudVideoProject(
  id: string,
): Promise<boolean> {
  const supabase = createClient();
  const user = await requireAuthenticatedUser(supabase);
  const normalizedId = normalizeRequiredText(id, "id");

  const { data, error } = await supabase
    .from("video_projects")
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

  dispatchProjectsChanged();
  return true;
}
