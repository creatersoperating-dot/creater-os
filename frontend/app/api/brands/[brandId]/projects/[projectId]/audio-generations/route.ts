import { createClient } from "@/lib/supabase/server";
import {
  createAuthenticatedAudioGenerationRepository,
} from "@/services/audio/audioGenerationRepository.server";
import { generateProjectNarration } from "@/services/audio/audioGenerationService.server";
import {
  mapAudioGenerationLifecycleToPublic,
  mapAudioGenerationToSummary,
} from "@/services/audioProductionMapper";
import { listConfiguredVoices } from "@/services/providers/providerRegistry.server";
import { getSpeechRequestTimeoutMs } from "@/services/providers/providerConfig.server";
import { SpeechProviderError } from "@/services/providers/providerTypes";
import {
  AudioProductionError,
  type AudioGenerationLifecycleResult,
} from "@/types/audioProduction";

export const runtime = "nodejs";
export const maxDuration = 300;

const OPERATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AudioGenerationRouteContext {
  params: Promise<{
    brandId: string;
    projectId: string;
  }>;
}

interface BoundedRequestSignal {
  readonly signal: AbortSignal;
  dispose(): void;
}

function createBoundedRequestSignal(
  incomingSignal: AbortSignal,
  timeoutMs: number,
): BoundedRequestSignal {
  const controller = new AbortController();
  const forwardIncomingAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort(incomingSignal.reason);
    }
  };

  if (incomingSignal.aborted) {
    forwardIncomingAbort();
  } else {
    incomingSignal.addEventListener("abort", forwardIncomingAbort, {
      once: true,
    });
  }

  const timeout = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(
        new DOMException(
          "The speech provider request deadline expired.",
          "TimeoutError",
        ),
      );
    }
  }, timeoutMs);

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout);
      incomingSignal.removeEventListener("abort", forwardIncomingAbort);
    },
  };
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
  retryable = false,
): Response {
  return Response.json(
    { error: { code, message, retryable } },
    { status },
  );
}

function normalizeRouteId(value: string): string | null {
  const normalizedValue = value.trim();
  return normalizedValue || null;
}

async function isAuthenticated(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  return !error && user !== null;
}

function getFailedLifecycleStatus(code: string): number {
  if (code === "authentication_required") {
    return 401;
  }

  if (code === "project_not_found") {
    return 404;
  }

  if (
    code === "invalid_request" ||
    code === "invalid_operation_id" ||
    code === "unsupported_voice"
  ) {
    return 400;
  }

  if (
    code === "script_required" ||
    code === "narration_empty" ||
    code === "narration_too_long" ||
    code === "indivisible_token" ||
    code === "invalid_segments" ||
    code === "audio_too_large"
  ) {
    return 422;
  }

  if (
    code === "cancelled" ||
    code === "aborted" ||
    code === "generation_conflict" ||
    code === "operation_conflict" ||
    code === "attachment_conflict"
  ) {
    return 409;
  }

  if (code === "rate_limited") {
    return 429;
  }

  if (code === "provider_unavailable") {
    return 503;
  }

  if (code === "provider_timeout") {
    return 504;
  }

  return 500;
}

function safeServerError(error: unknown): Response {
  if (error instanceof AudioProductionError) {
    if (error.code === "authentication_required") {
      return errorResponse(error.code, error.message, 401);
    }

    return errorResponse(
      error.code,
      error.message,
      error.code === "attachment_conflict" ? 409 : 500,
      error.retryable,
    );
  }

  if (error instanceof SpeechProviderError) {
    return errorResponse(
      "voice_configuration_error",
      "Narration generation is not configured on the server.",
      500,
      error.retryable,
    );
  }

  return errorResponse(
    "audio_request_failed",
    "The narration request could not be completed.",
    500,
    true,
  );
}

export async function GET(
  _request: Request,
  { params }: AudioGenerationRouteContext,
): Promise<Response> {
  if (!(await isAuthenticated())) {
    return errorResponse(
      "authentication_required",
      "Authentication required.",
      401,
    );
  }

  const routeParams = await params;
  const brandId = normalizeRouteId(routeParams.brandId);
  const projectId = normalizeRouteId(routeParams.projectId);

  if (!brandId || !projectId) {
    return errorResponse(
      "invalid_route",
      "A valid brand and project are required.",
      400,
    );
  }

  try {
    const repository =
      await createAuthenticatedAudioGenerationRepository();
    const history = await repository.listProjectGenerations(
      brandId,
      projectId,
      20,
    );

    if (!history) {
      return errorResponse(
        "project_not_found",
        "The video project was not found.",
        404,
      );
    }

    return Response.json({
      project: history.project,
      attachedAudioGenerationId:
        history.project.audioGenerationId,
      generations: history.generations.map(
        mapAudioGenerationToSummary,
      ),
    });
  } catch (error: unknown) {
    return safeServerError(error);
  }
}

export async function POST(
  request: Request,
  { params }: AudioGenerationRouteContext,
): Promise<Response> {
  if (!(await isAuthenticated())) {
    return errorResponse(
      "authentication_required",
      "Authentication required.",
      401,
    );
  }

  const routeParams = await params;
  const brandId = normalizeRouteId(routeParams.brandId);
  const projectId = normalizeRouteId(routeParams.projectId);

  if (!brandId || !projectId) {
    return errorResponse(
      "invalid_route",
      "A valid brand and project are required.",
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

  if (!isObject(body)) {
    return errorResponse(
      "invalid_request",
      "Request body must be a JSON object.",
      400,
    );
  }

  const operationId =
    typeof body.operationId === "string"
      ? body.operationId.trim().toLowerCase()
      : "";
  const voiceId =
    typeof body.voiceId === "string" ? body.voiceId.trim() : "";

  if (!OPERATION_ID_PATTERN.test(operationId)) {
    return errorResponse(
      "invalid_operation_id",
      "operationId must be a valid UUID.",
      400,
    );
  }

  if (!voiceId) {
    return errorResponse(
      "invalid_voice",
      "A CreatorOS voice is required.",
      400,
    );
  }

  try {
    const repository =
      await createAuthenticatedAudioGenerationRepository();
    const history = await repository.listProjectGenerations(
      brandId,
      projectId,
      20,
    );

    if (!history) {
      return errorResponse(
        "project_not_found",
        "The video project was not found.",
        404,
      );
    }

    const activeGeneration = history.generations.find(
      (generation) =>
        generation.status === "queued" ||
        generation.status === "generating" ||
        generation.status === "uploading",
    );

    if (
      activeGeneration &&
      activeGeneration.operationId !== operationId
    ) {
      return Response.json(
        {
          kind: "processing",
          generation: mapAudioGenerationToSummary(activeGeneration),
        },
        { status: 202 },
      );
    }

    const voices = await listConfiguredVoices();

    if (!voices.some((voice) => voice.voiceId === voiceId)) {
      return errorResponse(
        "unsupported_voice",
        "The selected CreatorOS voice is unavailable.",
        400,
      );
    }

    const existingGeneration =
      await repository.getGenerationByOperation(
        brandId,
        projectId,
        operationId,
      );
    const boundedRequest = createBoundedRequestSignal(
      request.signal,
      getSpeechRequestTimeoutMs(),
    );
    let lifecycleResult: AudioGenerationLifecycleResult;

    try {
      lifecycleResult = await generateProjectNarration({
        brandId,
        projectId,
        operationId,
        voiceId,
        signal: boundedRequest.signal,
      });
    } finally {
      boundedRequest.dispose();
    }
    const publicResult =
      mapAudioGenerationLifecycleToPublic(lifecycleResult);

    if (publicResult.kind === "processing") {
      return Response.json(publicResult, { status: 202 });
    }

    if (publicResult.kind === "conflict") {
      return Response.json(publicResult, { status: 409 });
    }

    if (publicResult.kind === "failed") {
      return Response.json(publicResult, {
        status: getFailedLifecycleStatus(publicResult.failure.code),
      });
    }

    return Response.json(publicResult, {
      status: existingGeneration ? 200 : 201,
    });
  } catch (error: unknown) {
    return safeServerError(error);
  }
}
