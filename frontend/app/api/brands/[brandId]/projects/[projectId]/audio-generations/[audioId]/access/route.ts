import {
  createAuthenticatedAudioGenerationRepository,
} from "@/services/audio/audioGenerationRepository.server";
import {
  AUDIO_ACCESS_PURPOSES,
  AudioProductionError,
  type AudioAccessPurpose,
} from "@/types/audioProduction";

export const runtime = "nodejs";

const ACCESS_LIFETIME_SECONDS = 5 * 60;

interface NarrationAccessRouteContext {
  params: Promise<{
    brandId: string;
    projectId: string;
    audioId: string;
  }>;
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

function isAudioAccessPurpose(
  value: string,
): value is AudioAccessPurpose {
  return (AUDIO_ACCESS_PURPOSES as readonly string[]).includes(value);
}

export async function GET(
  request: Request,
  { params }: NarrationAccessRouteContext,
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

  const requestedPurpose =
    new URL(request.url).searchParams.get("purpose")?.trim() ||
    "playback";

  if (!isAudioAccessPurpose(requestedPurpose)) {
    return errorResponse(
      "invalid_purpose",
      "purpose must be playback or download.",
      400,
    );
  }

  try {
    const access = await repository.createReadyGenerationAccess(
      brandId,
      projectId,
      audioId,
      requestedPurpose,
      ACCESS_LIFETIME_SECONDS,
    );

    if (!access) {
      return errorResponse(
        "narration_not_found",
        "The ready narration was not found.",
        404,
      );
    }

    return Response.json(access);
  } catch (error: unknown) {
    if (
      error instanceof AudioProductionError &&
      error.code === "authentication_required"
    ) {
      return errorResponse(error.code, error.message, 401);
    }

    return errorResponse(
      "access_failed",
      "Secure narration access could not be created.",
      500,
    );
  }
}
