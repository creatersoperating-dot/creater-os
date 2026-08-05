import { NextResponse } from "next/server";

import { VideoProductionService } from "@/services/video/videoProductionService.server";
import { assertRequestKeys, optionalRequestString, readVideoRequestBody, videoApiError } from "@/services/video/videoApiResponse.server";

export const runtime = "nodejs";
type Context = { params: Promise<{ brandId: string; projectId: string }> };

export async function DELETE(request: Request, context: Context) {
  try {
    const service = await VideoProductionService.authenticated();
    const { brandId, projectId } = await context.params;
    const body = await readVideoRequestBody(request);
    assertRequestKeys(body, ["expectedUpdatedAt"]);
    const deleted = await service.deleteProject(brandId, projectId, optionalRequestString(body, "expectedUpdatedAt") ?? "");
    return NextResponse.json({ deleted });
  } catch (error) {
    return videoApiError(error);
  }
}
