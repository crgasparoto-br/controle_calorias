import OpenAI from "openai";
import { ENV } from "./env";

export class OpenAiConfigurationError extends Error {
  constructor(
    message = "OPENAI_API_KEY is not configured. Configure it only in the backend environment before using the real OpenAI provider.",
  ) {
    super(message);
    this.name = "OpenAiConfigurationError";
  }
}

export type OpenAiClientFactory = (
  options: ConstructorParameters<typeof OpenAI>[0],
) => OpenAI;

export type CreateOpenAiClientOptions = {
  apiKey?: string;
  createClient?: OpenAiClientFactory;
};

function resolveApiKey(apiKey?: string) {
  const resolvedApiKey = (apiKey ?? ENV.openaiApiKey).trim();

  if (!resolvedApiKey) {
    throw new OpenAiConfigurationError();
  }

  return resolvedApiKey;
}

export function isOpenAiConfigured(apiKey = ENV.openaiApiKey) {
  return apiKey.trim().length > 0;
}

export function createOpenAiClient(
  options: CreateOpenAiClientOptions = {},
): OpenAI {
  const createClient =
    options.createClient ??
    ((clientOptions: ConstructorParameters<typeof OpenAI>[0]) =>
      new OpenAI(clientOptions));

  return createClient({
    apiKey: resolveApiKey(options.apiKey),
  });
}
