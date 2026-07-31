export const VIDEO_PROJECT_STATUSES = [
  "idea",
  "script",
  "voice",
  "video",
  "ready",
  "published",
] as const;

export type VideoProjectStatus =
  (typeof VIDEO_PROJECT_STATUSES)[number];

export interface CreatorVideoProject {
  id: string;
  brandId: string;
  scriptId: string | null;
  audioGenerationId: string | null;
  title: string;
  topic: string;
  status: VideoProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateVideoProjectInput {
  brandId: string;
  scriptId?: string | null;
  title: string;
  topic?: string;
  status?: VideoProjectStatus;
}

export type UpdateVideoProjectInput = Partial<
  Pick<
    CreatorVideoProject,
    "scriptId" | "title" | "topic" | "status"
  >
>;
