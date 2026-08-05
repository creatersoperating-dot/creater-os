import { NextResponse } from "next/server";
import { VideoProductionService } from "@/services/video/videoProductionService.server";
import { assertRequestKeys, optionalRequestString, parseVideoScenes, readVideoRequestBody, videoApiError } from "@/services/video/videoApiResponse.server";

export const runtime = "nodejs";
type Context = { params: Promise<{ brandId: string; projectId: string }> };

export async function GET(_request: Request, context: Context) {
  try { const service = await VideoProductionService.authenticated(); const { brandId, projectId } = await context.params; return NextResponse.json((await service.history(brandId, projectId)).scenePlan); }
  catch (error) { return videoApiError(error); }
}
export async function POST(_request: Request, context: Context) {
  try { const service = await VideoProductionService.authenticated(); const { brandId, projectId } = await context.params; return NextResponse.json(await service.savePlan(brandId, projectId), { status: 201 }); }
  catch (error) { return videoApiError(error); }
}
export async function PUT(request: Request, context: Context) {
  try {
    const service = await VideoProductionService.authenticated();
    const { brandId, projectId } = await context.params;
    const body = await readVideoRequestBody(request);
    assertRequestKeys(body, ["scenes", "expectedUpdatedAt"]);
    const scenes = parseVideoScenes(body);
    return NextResponse.json(await service.savePlan(brandId, projectId, scenes, optionalRequestString(body, "expectedUpdatedAt") ?? null));
  } catch (error) { return videoApiError(error); }
}
