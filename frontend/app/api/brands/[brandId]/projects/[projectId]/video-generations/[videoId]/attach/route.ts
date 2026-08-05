import { NextResponse } from "next/server";
import { VideoProductionService } from "@/services/video/videoProductionService.server";
import { optionalRequestString, readVideoRequestBody, videoApiError } from "@/services/video/videoApiResponse.server";

type Context = { params: Promise<{ brandId: string; projectId: string; videoId: string }> };
export async function POST(request: Request, context: Context) {
  try { const service = await VideoProductionService.authenticated(); const { brandId, projectId, videoId } = await context.params;
    const body = await readVideoRequestBody(request);
    const project = await service.attach(brandId, projectId, videoId, optionalRequestString(body, "expectedProjectUpdatedAt") ?? "");
    if (!project) return NextResponse.json({ error: { code: "attachment_conflict", message: "The project changed. Refresh and try again.", retryable: true } }, { status: 409 });
    return NextResponse.json(project);
  } catch (error) { return videoApiError(error); }
}
