import {
  createAuthenticatedAudioGenerationRepository,
} from "@/services/audio/audioGenerationRepository.server";
import { mapAudioGenerationToSummary } from "@/services/audioProductionMapper";
import { AudioProductionError } from "@/types/audioProduction";

export const runtime = "nodejs";

interface AttachNarrationRouteContext {
  params: Promise<{
    brandId: string;
    projectId: string;
    audioId: string;
  }>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function errorResponse(
  code: string,
  message: string,
  status: number,
): Response {
  return Response.json({ error: { code, message } }, { status });
}

function normalizeId(value: string): string | null {
  const normalizedValue = value.trim();
  return normalizedValue || null;
}

export async function POST(
  request: Request,
  { params }: AttachNarrationRouteContext,
): Promise<Response> {
  let repository;

  try {
    repository = await createAuthenticatedAudioGenerationRepository();
  } catch {
    return errorResponse(
      "authentication_required",
      "Authentication required.",
      401,
    );
  }

  const routeParams = await params;
  const brandId = normalizeId(routeParams.brandId);
  const projectId = normalizeId(routeParams.projectId);
  const audioId = normalizeId(routeParams.audioId);

  if (!brandId || !projectId || !audioId) {
    return errorResponse(
      "invalid_route",
      "A valid brand, project, and narration are required.",
      400,
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return errorResponse(
      "invalid_json",
      "Request body must be valid JSON.",
      400,
    );
  }

  if (!isObject(body) || typeof body.expectedUpdatedAt !== "string") {
    return errorResponse(
      "invalid_request",
      "expectedUpdatedAt is required.",
      400,
    );
  }

  const expectedUpdatedAt = body.expectedUpdatedAt.trim();

  if (
    !expectedUpdatedAt ||
    Number.isNaN(Date.parse(expectedUpdatedAt))
  ) {
    return errorResponse(
      "invalid_timestamp",
      "expectedUpdatedAt must be a valid timestamp.",
      400,
    );
  }

  try {
    const [context, generation] = await Promise.all([
      repository.loadOwnedProjectWithScript(brandId, projectId),
      repository.getGenerationForProject(
        brandId,
        projectId,
        audioId,
      ),
    ]);

    if (!context || !generation) {
      return errorResponse(
        "narration_not_found",
        "The ready narration was not found.",
        404,
      );
    }

    if (
      generation.status !== "ready" ||
      !context.script ||
      generation.sourceScriptId !== context.script.id ||
      generation.sourceScriptUpdatedAt !== context.script.updatedAt
    ) {
      return errorResponse(
        "narration_not_attachable",
        "The narration no longer matches the attached script.",
        409,
      );
    }

    const attachment = await repository.attachReadyGeneration(
      brandId,
      projectId,
      audioId,
      expectedUpdatedAt,
    );

    if (!attachment.project) {
      return errorResponse(
        "attachment_conflict",
        "The project changed before the narration could be attached.",
        409,
      );
    }

    return Response.json({
      project: attachment.project,
      generation: mapAudioGenerationToSummary(
        attachment.generation,
      ),
    });
  } catch (error: unknown) {
    if (
      error instanceof AudioProductionError &&
      error.code === "attachment_conflict"
    ) {
      return errorResponse(error.code, error.message, 409);
    }

    return errorResponse(
      "attachment_failed",
      "The narration could not be attached.",
      500,
    );
  }
}
