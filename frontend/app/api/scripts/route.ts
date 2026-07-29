import { generateScript } from "@/services/ai/agents/scriptAgent";
import type { Brand } from "@/types/brand";

const MAX_TOPIC_LENGTH = 300;
const MAX_SESSION_ID_LENGTH = 200;

const OPTIONAL_STRING_LIMITS = {
  goal: 500,
  audience: 500,
  duration: 100,
  keyPoints: 3000,
  callToAction: 500,
  constraints: 3000,
} as const;

type OptionalStringField =
  keyof typeof OPTIONAL_STRING_LIMITS;

function isObject(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isBrandObject(value: unknown): value is Brand {
  return isObject(value);
}

function errorResponse(
  error: string,
  status: number
): Response {
  return Response.json(
    {
      error,
    },
    {
      status,
    }
  );
}

export async function POST(req: Request) {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return errorResponse(
      "Request body must be valid JSON.",
      400
    );
  }

  if (!isObject(body)) {
    return errorResponse(
      "Request body must be a JSON object.",
      400
    );
  }

  if (typeof body.topic !== "string") {
    return errorResponse(
      "Topic must be a non-empty string.",
      400
    );
  }

  const topic = body.topic.trim();

  if (!topic) {
    return errorResponse(
      "Topic must be a non-empty string.",
      400
    );
  }

  if (topic.length > MAX_TOPIC_LENGTH) {
    return errorResponse(
      `Topic must be ${MAX_TOPIC_LENGTH} characters or fewer.`,
      400
    );
  }

  if (typeof body.sessionId !== "string") {
    return errorResponse(
      "Session ID must be a non-empty string.",
      400
    );
  }

  const sessionId = body.sessionId.trim();

  if (!sessionId) {
    return errorResponse(
      "Session ID must be a non-empty string.",
      400
    );
  }

  if (sessionId.length > MAX_SESSION_ID_LENGTH) {
    return errorResponse(
      `Session ID must be ${MAX_SESSION_ID_LENGTH} characters or fewer.`,
      400
    );
  }

  const brand = body.brand;

  if (!isBrandObject(brand)) {
    return errorResponse(
      "Brand must be a non-null object.",
      400
    );
  }

  if (
    body.includeProductionNotes !== undefined &&
    typeof body.includeProductionNotes !== "boolean"
  ) {
    return errorResponse(
      "includeProductionNotes must be a boolean.",
      400
    );
  }

  const normalizedFields: Partial<
    Record<OptionalStringField, string>
  > = {};

  for (
    const field of Object.keys(
      OPTIONAL_STRING_LIMITS
    ) as OptionalStringField[]
  ) {
    const value = body[field];

    if (value === undefined) {
      continue;
    }

    if (typeof value !== "string") {
      return errorResponse(
        `${field} must be a string when supplied.`,
        400
      );
    }

    const normalizedValue = value.trim();

    if (!normalizedValue) {
      continue;
    }

    const maximumLength =
      OPTIONAL_STRING_LIMITS[field];

    if (normalizedValue.length > maximumLength) {
      return errorResponse(
        `${field} must be ${maximumLength} characters or fewer.`,
        400
      );
    }

    normalizedFields[field] = normalizedValue;
  }

  const requestParts = [`Topic: ${topic}`];

  if (normalizedFields.goal) {
    requestParts.push(
      `Video goal or angle: ${normalizedFields.goal}`
    );
  }

  if (normalizedFields.audience) {
    requestParts.push(
      `Target audience override: ${normalizedFields.audience}`
    );
  }

  if (normalizedFields.duration) {
    requestParts.push(
      `Requested duration: ${normalizedFields.duration}`
    );
  }

  if (normalizedFields.keyPoints) {
    requestParts.push(
      `Key points to cover: ${normalizedFields.keyPoints}`
    );
  }

  if (normalizedFields.callToAction) {
    requestParts.push(
      `Requested call to action: ${normalizedFields.callToAction}`
    );
  }

  if (normalizedFields.constraints) {
    requestParts.push(
      `Additional constraints: ${normalizedFields.constraints}`
    );
  }

  if (body.includeProductionNotes === true) {
    requestParts.push(
      "Include a Production Notes section."
    );
  }

  const normalizedRequest = requestParts.join("\n");

  try {
    const result = await generateScript(
      brand,
      normalizedRequest,
      sessionId
    );

    return result.toTextStreamResponse();
  } catch (error) {
    console.error("SCRIPT API ERROR:", error);

    return errorResponse(
      "Script generation failed.",
      500
    );
  }
}
