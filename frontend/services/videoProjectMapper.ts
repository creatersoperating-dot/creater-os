import type {
  CreatorVideoProject,
  VideoProjectStatus,
} from "@/types/videoProject";

export interface VideoProjectRow {
  user_id: string;
  id: string;
  brand_id: string;
  script_id: string | null;
  title: string;
  topic: string;
  status: VideoProjectStatus;
  created_at: string;
  updated_at: string;
}

export function mapVideoProjectRowToProject(
  row: VideoProjectRow,
): CreatorVideoProject {
  return {
    id: row.id,
    brandId: row.brand_id,
    scriptId: row.script_id,
    title: row.title,
    topic: row.topic,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapVideoProjectToRow(
  project: CreatorVideoProject,
  userId: string,
): VideoProjectRow {
  return {
    user_id: userId,
    id: project.id,
    brand_id: project.brandId,
    script_id: project.scriptId,
    title: project.title,
    topic: project.topic,
    status: project.status,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
  };
}