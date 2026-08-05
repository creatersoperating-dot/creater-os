import { NextResponse } from "next/server";

import { VideoProductionService } from "@/services/video/videoProductionService.server";
import { videoApiError } from "@/services/video/videoApiResponse.server";

export const runtime = "nodejs";
type Context = { params: Promise<{ brandId: string; projectId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const service = await VideoProductionService.authenticated();
    const { brandId, projectId } = await context.params;
    return NextResponse.json(await service.history(brandId, projectId, request.signal));
  } catch (error) {
    return videoApiError(error);
  }
}
