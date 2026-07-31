import { createClient } from "@/lib/supabase/server";
import { listConfiguredVoices } from "@/services/providers/providerRegistry.server";
import { SpeechProviderError } from "@/services/providers/providerTypes";
import type { CreatorVoiceDescriptor } from "@/types/audioProduction";

export const runtime = "nodejs";

function errorResponse(
  code: string,
  message: string,
  status: number,
): Response {
  return Response.json({ error: { code, message } }, { status });
}

export async function GET(): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return errorResponse(
      "authentication_required",
      "Authentication required.",
      401,
    );
  }

  try {
    const configuredVoices = await listConfiguredVoices();
    const voices: CreatorVoiceDescriptor[] = configuredVoices.map(
      (voice) => ({
        voiceId: voice.voiceId,
        displayName: voice.displayName,
        description: voice.description ?? null,
        supportedLanguageCodes: [...voice.supportedLanguageCodes],
        style: [...(voice.style ?? [])],
      }),
    );

    return Response.json({ voices });
  } catch (providerError: unknown) {
    if (providerError instanceof SpeechProviderError) {
      return errorResponse(
        "voice_configuration_error",
        "Narration voices are not configured on the server.",
        500,
      );
    }

    return errorResponse(
      "voice_configuration_error",
      "Narration voices are temporarily unavailable.",
      500,
    );
  }
}
