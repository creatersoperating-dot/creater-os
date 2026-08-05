import { NextResponse } from "next/server";
import { VideoProductionService } from "@/services/video/videoProductionService.server";
import { readVideoRequestBody, requestChoice, videoApiError } from "@/services/video/videoApiResponse.server";

type Context = { params: Promise<{ brandId: string; projectId: string; videoId: string }> };
export async function POST(request: Request, context: Context) {
  try { const service = await VideoProductionService.authenticated(); const { brandId, projectId, videoId } = await context.params;
    const body = await readVideoRequestBody(request); const purpose = requestChoice(body, "purpose", ["playback", "download"] as const, "playback");
    return NextResponse.json(await service.access(brandId, projectId, videoId, purpose === "download" ? "download" : "playback")); }
  catch (error) { return videoApiError(error); }
}
