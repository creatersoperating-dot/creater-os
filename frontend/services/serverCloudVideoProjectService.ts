import { createClient } from "@/lib/supabase/server";
import type { CreatorVideoProject } from "@/types/videoProject";
import {
  type VideoProjectRow,
  mapVideoProjectRowToProject,
} from "./videoProjectMapper";

export async function getServerCloudVideoProjectById(
  brandId: string,
  projectId: string,
): Promise<CreatorVideoProject | null> {
  const normalizedBrandId = brandId.trim();
  const normalizedProjectId = projectId.trim();

  if (!normalizedBrandId || !normalizedProjectId) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("video_projects")
    .select("*")
    .eq("brand_id", normalizedBrandId)
    .eq("id", normalizedProjectId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data
    ? mapVideoProjectRowToProject(data as VideoProjectRow)
    : null;
}
