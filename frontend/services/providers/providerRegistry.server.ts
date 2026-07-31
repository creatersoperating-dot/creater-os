import "server-only";

import {
  getSpeechProviderConfiguration,
  type SpeechProviderConfiguration,
} from "./providerConfig.server";
import {
  SpeechProviderError,
  type ProviderModelDescriptor,
  type SpeechProviderAdapter,
  type VoiceDescriptor,
} from "./providerTypes";
import { createOpenAiSpeechAdapter } from "./speech/openAiSpeechAdapter.server";
import { createMockSpeechAdapter } from "./speech/mockSpeechAdapter.server";

type OpenAiSpeechProviderConfiguration = Extract<
  SpeechProviderConfiguration,
  { readonly providerId: "openai" }
>;
type MockSpeechProviderConfiguration = Extract<
  SpeechProviderConfiguration,
  { readonly providerId: "mock" }
>;

interface SpeechProviderFactoryMap {
  readonly openai: (
    configuration: OpenAiSpeechProviderConfiguration,
  ) => SpeechProviderAdapter;
  readonly mock: (
    configuration: MockSpeechProviderConfiguration,
  ) => SpeechProviderAdapter;
}

const SPEECH_PROVIDER_FACTORIES: SpeechProviderFactoryMap = {
  openai: (configuration) =>
    createOpenAiSpeechAdapter(configuration.modelId),
  mock: (configuration) =>
    createMockSpeechAdapter(configuration.modelId),
};

function createConfiguredSpeechProvider(
  configuration: SpeechProviderConfiguration,
): SpeechProviderAdapter {
  if (configuration.providerId === "mock") {
    return SPEECH_PROVIDER_FACTORIES.mock(configuration);
  }

  return SPEECH_PROVIDER_FACTORIES.openai(configuration);
}

export function getSpeechProvider(): SpeechProviderAdapter {
  const configuration = getSpeechProviderConfiguration();
  const provider = createConfiguredSpeechProvider(configuration);

  if (!provider.metadata.operational) {
    throw new SpeechProviderError(
      "provider_unavailable",
      "The configured speech provider is not operational.",
      { providerId: configuration.providerId },
    );
  }

  return provider;
}

export async function listConfiguredVoices(): Promise<
  readonly VoiceDescriptor[]
> {
  return getSpeechProvider().listVoices();
}

export function getConfiguredSpeechProviderMetadata(): ProviderModelDescriptor {
  return getSpeechProvider().metadata;
}

export function listRegisteredSpeechProviderMetadata(): readonly ProviderModelDescriptor[] {
  return [getSpeechProvider().metadata];
}
