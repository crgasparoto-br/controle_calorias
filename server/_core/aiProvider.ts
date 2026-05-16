import type OpenAI from "openai";
import { createOpenAiClient } from "./openaiClient";

export type AiProviderResponseFormat =
  | { type: "text" }
  | {
      type: "json_schema";
      name: string;
      schema: Record<string, unknown>;
      strict?: boolean;
    };

export type AiProviderTextRequest = {
  model: string;
  instructions?: string;
  input: string | Array<Record<string, unknown>>;
  format?: AiProviderResponseFormat;
};

export type AiProviderTextResponse = {
  id: string;
  outputText: string;
  raw: unknown;
};

export interface AiProvider {
  createTextResponse(
    request: AiProviderTextRequest,
  ): Promise<AiProviderTextResponse>;
}

type OpenAiResponsesCreatePayload = {
  model: string;
  input: AiProviderTextRequest["input"];
  instructions?: string;
  text?: NonNullable<ReturnType<typeof buildTextConfig>>;
  stream: false;
};

type OpenAiResponsesCreateResult = {
  id: string;
  output_text?: string | null;
};

function buildTextConfig(format: AiProviderResponseFormat | undefined) {
  if (!format || format.type === "text") {
    return undefined;
  }

  return {
    format: {
      type: "json_schema",
      name: format.name,
      schema: format.schema,
      strict: format.strict ?? true,
    },
  };
}

export class OpenAiProvider implements AiProvider {
  constructor(private readonly client: OpenAI) {}

  async createTextResponse(
    request: AiProviderTextRequest,
  ): Promise<AiProviderTextResponse> {
    const payload: OpenAiResponsesCreatePayload = {
      model: request.model,
      input: request.input,
      stream: false,
    };

    if (request.instructions) {
      payload.instructions = request.instructions;
    }

    const text = buildTextConfig(request.format);
    if (text) {
      payload.text = text;
    }

    const createResponse = this.client.responses.create as (
      payload: OpenAiResponsesCreatePayload,
    ) => Promise<OpenAiResponsesCreateResult & Record<string, unknown>>;

    const response = await createResponse(payload);

    return {
      id: response.id,
      outputText: response.output_text ?? "",
      raw: response,
    };
  }
}

export type AiProviderFactory = () => AiProvider;

const defaultAiProviderFactory: AiProviderFactory = () =>
  new OpenAiProvider(createOpenAiClient());

let aiProviderFactory: AiProviderFactory = defaultAiProviderFactory;

export function createAiProvider(): AiProvider {
  return defaultAiProviderFactory();
}

export function getAiProvider(): AiProvider {
  return aiProviderFactory();
}

export function setAiProviderFactory(factory: AiProviderFactory) {
  aiProviderFactory = factory;
}

export function resetAiProviderFactory() {
  aiProviderFactory = defaultAiProviderFactory;
}
