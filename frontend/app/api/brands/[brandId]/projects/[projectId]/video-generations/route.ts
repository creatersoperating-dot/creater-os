import { NextResponse } from "next/server";
import { VideoProductionService } from "@/services/video/videoProductionService.server";
import { assertRequestKeys, optionalRequestString, readVideoRequestBody, videoApiError } from "@/services/video/videoApiResponse.server";

export const runtime = "nodejs";
export const maxDuration = 300;
type Context = { params: Promise<{ brandId: string; projectId: string }> };

export async function POST(request: Request, context: Context) {
  try { const service = await VideoProductionService.authenticated(); const { brandId, projectId } = await context.params;
    const body = await readVideoRequestBody(request);
    assertRequestKeys(body, ["operationId", "retryGenerationId"]);
    const { getConfiguredVideoProvider } = await import("@/services/providers/video/videoProviderRegistry.server");
    const renderer = await getConfiguredVideoProvider();
    return NextResponse.json(await service.generate(brandId, projectId, optionalRequestString(body, "operationId") ?? "", renderer, optionalRequestString(body, "retryGenerationId"), request.signal)); }
  catch (error) { return videoApiError(error); }
}
