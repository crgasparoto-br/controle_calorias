import type OpenAI from "openai";
import type {
  Response as OpenAiResponse,
  ResponseCreateParamsNonStreaming,
} from "openai/resources/responses/responses";
import { AiNonRetryableError, AiOperationalError } from "./ai/policyExecutor";
import { assertOpenAiStructuredOutputSchema } from "./ai/openAiStructuredOutputSchema";
import { ENV } from "./env";
import { GeminiProvider } from "./geminiProvider";
import { createOpenAiClient } from "./openaiClient";

export type AiProviderResponseFormat =
  | { type: "text" }
  | {
      type: "json_schema";
      name: string;
      schema: Record<string, unknown>;
      strict?: boolean;
    };

export type AiProviderWebSearchTool = {
  type: "web_search";
};

export type AiProviderTextTool = AiProviderWebSearchTool;

export type AiProviderTextRequest = {
  model: string;
  instructions?: string;
  input: ResponseCreateParamsNonStreaming["input"];
  format?: AiProviderResponseFormat;
  tools?: AiProviderTextTool[];
};

export type AiProviderRequestOptions = {
  /** Propagated to the provider SDK/HTTP client; never treated as prompt data. */
  signal?: AbortSignal;
};

export type AiProviderUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  raw: unknown;
};

/**
 * Normalized, SDK-agnostic outcome of a web search / grounding tool made
 * available to a text response. `executed` reflects whether the model
 * actually invoked the tool, never whether it was merely offered — callers
 * must not attribute cost or a "researched" provenance to a call where the
 * tool was available but unused (auto mode).
 */
export type AiWebSearchSource = {
  url: string;
  title?: string;
  /** Provider-linked response segments supported by this source, when exposed. */
  supportingText?: string[];
};

export type AiWebSearchResult = {
  /** Whether the tool was actually invoked by the model in this response. */
  executed: boolean;
  /** Billable search invocation count, when the provider reports one. */
  searchCount?: number;
  /** Normalized citations/URLs backing the response. Empty when not executed. */
  sources: AiWebSearchSource[];
  /** Provider-reported search queries, when available (no user PII expected). */
  searchQueries?: string[];
};

export type AiProviderTextResponse = {
  id: string;
  outputText: string;
  usage?: AiProviderUsage;
  /** Present only when a web_search/grounding tool was offered on the request. */
  webSearch?: AiWebSearchResult;
  raw: unknown;
};

export type AiProviderEmbeddingInput = string | string[] | number[] | number[][];

export type AiProviderEmbeddingRequest = {
  model: string;
  input: AiProviderEmbeddingInput;
  dimensions?: number;
};

export type AiProviderEmbeddingResponse = {
  embeddings: number[][];
  usage?: AiProviderUsage;
  raw: unknown;
};

export type AiProviderAudioTranscriptionRequest = {
  file: File;
  model: string;
  language?: string;
  prompt?: string;
};

export type AiProviderAudioTranscriptionSegment = {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
};

export type AiProviderAudioTranscriptionResponse = {
  task: "transcribe";
  language: string;
  duration: number;
  text: string;
  segments: AiProviderAudioTranscriptionSegment[];
  raw: unknown;
};

export type AiProviderImageInput = {
  b64Json: string;
  mimeType?: string;
};

export type AiProviderImageGenerationRequest = {
  prompt: string;
  model: string;
  size?: "1024x1024" | "1024x1536" | "1536x1024";
  quality?: "low" | "medium" | "high";
  outputFormat?: "png" | "webp" | "jpeg";
  originalImages?: AiProviderImageInput[];
};

export type AiProviderImageGenerationResponse = {
  b64Json: string;
  mimeType: string;
  raw: unknown;
};

export interface AiProvider {
  createTextResponse(
    request: AiProviderTextRequest,
    options?: AiProviderRequestOptions,
  ): Promise<AiProviderTextResponse>;
  createEmbeddings(
    request: AiProviderEmbeddingRequest,
    options?: AiProviderRequestOptions,
  ): Promise<AiProviderEmbeddingResponse>;
  createAudioTranscription(
    request: AiProviderAudioTranscriptionRequest,
    options?: AiProviderRequestOptions,
  ): Promise<AiProviderAudioTranscriptionResponse>;
  createImageGeneration(
    request: AiProviderImageGenerationRequest,
    options?: AiProviderRequestOptions,
  ): Promise<AiProviderImageGenerationResponse>;
}

function buildTextConfig(
  format: AiProviderResponseFormat | undefined,
): ResponseCreateParamsNonStreaming["text"] | undefined {
  if (!format || format.type === "text") return undefined;
  assertOpenAiStructuredOutputSchema(format.schema);
  return {
    format: {
      type: "json_schema",
      name: format.name,
      schema: format.schema,
      strict: format.strict ?? true,
    },
  };
}

type OpenAiSdkTextTool = NonNullable<ResponseCreateParamsNonStreaming["tools"]>[number];

function translateOpenAiTextTool(tool: unknown): OpenAiSdkTextTool {
  if (typeof tool !== "object" || tool === null || !("type" in tool)) {
    throw new AiNonRetryableError(
      "OpenAiProvider: text tool must declare a supported type before network access.",
      undefined,
      "incompatible_operation",
    );
  }

  const type = (tool as { type?: unknown }).type;
  if (type === "web_search") {
    // openai@4.104 predates the stable `web_search` discriminant in some
    // generated type surfaces, but the Responses API contract is stable. Keep
    // the cast isolated inside the adapter instead of leaking SDK details into
    // the domain contract.
    return { type: "web_search" } as unknown as OpenAiSdkTextTool;
  }

  throw new AiNonRetryableError(
    `OpenAiProvider: text tool type ${String(type)} is not supported by the internal adapter contract.`,
    undefined,
    "incompatible_operation",
  );
}

function buildOpenAiTools(
  tools: readonly AiProviderTextTool[] | undefined,
): ResponseCreateParamsNonStreaming["tools"] | undefined {
  if (!tools?.length) return undefined;
  return tools.map(translateOpenAiTextTool);
}

type OpenAiClientFactory = () => OpenAI;

function isOpenAiClientFactory(
  client: OpenAI | OpenAiClientFactory,
): client is OpenAiClientFactory {
  return typeof client === "function";
}

function openAiRequestOptions(options?: AiProviderRequestOptions) {
  return options?.signal ? { signal: options.signal } : undefined;
}

function buildTranscriptionResponse(
  response: unknown,
): AiProviderAudioTranscriptionResponse {
  const data = response as Partial<AiProviderAudioTranscriptionResponse>;
  return {
    task: "transcribe",
    language: typeof data.language === "string" ? data.language : "",
    duration: typeof data.duration === "number" ? data.duration : 0,
    text: typeof data.text === "string" ? data.text : "",
    segments: Array.isArray(data.segments)
      ? (data.segments as AiProviderAudioTranscriptionSegment[])
      : [],
    raw: response,
  };
}

function mimeTypeFromOutputFormat(
  outputFormat: AiProviderImageGenerationRequest["outputFormat"] = "png",
) {
  if (outputFormat === "jpeg") return "image/jpeg";
  return `image/${outputFormat}`;
}

function imageFileNameFromMimeType(mimeType = "image/png") {
  if (mimeType.includes("jpeg")) return "meal-photo.jpg";
  if (mimeType.includes("webp")) return "meal-photo.webp";
  return "meal-photo.png";
}

function invalidImagePayload(path: string, reason: string): AiOperationalError {
  return new AiOperationalError(
    `OpenAiProvider: ${path} ${reason}.`,
    undefined,
    "invalid_payload",
  );
}

function normalizeImageBase64(value: string, path: string): string {
  const compact = value.replace(/\s+/g, "");
  if (!compact) {
    throw invalidImagePayload(path, "must contain non-empty base64 image data");
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw invalidImagePayload(path, "contains malformed base64 image data");
  }

  const paddingLength = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
  const dataLength = compact.length - paddingLength;
  const remainder = dataLength % 4;
  const expectedPadding = remainder === 0 ? 0 : 4 - remainder;
  if (
    remainder === 1 ||
    (paddingLength > 0 && (compact.length % 4 !== 0 || paddingLength !== expectedPadding))
  ) {
    throw invalidImagePayload(path, "contains malformed base64 image data");
  }

  const padded = compact.padEnd(Math.ceil(compact.length / 4) * 4, "=");
  const decoded = Buffer.from(padded, "base64");
  const canonical = decoded.toString("base64").replace(/=+$/u, "");
  if (!decoded.length || canonical !== compact.replace(/=+$/u, "")) {
    throw invalidImagePayload(path, "contains malformed base64 image data");
  }

  return compact;
}

function buildImageEditFile(image: AiProviderImageInput, index: number) {
  const mimeType = image.mimeType || "image/png";
  const b64Json = normalizeImageBase64(image.b64Json, `originalImages[${index}].b64Json`);
  return new File(
    [Buffer.from(b64Json, "base64")],
    imageFileNameFromMimeType(mimeType),
    { type: mimeType },
  );
}

function firstImageData(response: { data?: Array<{ b64_json?: string }> }) {
  return response.data?.[0]?.b64_json;
}

function normalizeOpenAiWebSearch(
  response: OpenAiResponse,
  requestedTool: boolean,
): AiWebSearchResult | undefined {
  if (!requestedTool) return undefined;

  const rawOutput: unknown = (response as unknown as { output?: unknown }).output;
  const output: Array<Record<string, unknown>> = Array.isArray(rawOutput)
    ? (rawOutput as Array<Record<string, unknown>>)
    : [];

  const webSearchCalls = output.filter(
    item => item.type === "web_search_call" && item.status === "completed",
  );
  const executed = webSearchCalls.length > 0;
  const sourceByUrl = new Map<string, AiWebSearchSource>();
  const searchQueries = new Set<string>();

  const addSource = (value: unknown, title?: unknown, supportingText?: unknown) => {
    if (typeof value !== "string" || !value.trim()) return;
    const url = value.trim();
    const normalizedTitle = typeof title === "string" && title.trim() ? title.trim() : undefined;
    const normalizedSupportingText = typeof supportingText === "string" && supportingText.trim()
      ? supportingText.trim()
      : undefined;
    const existing = sourceByUrl.get(url);
    const supportingTexts = new Set(existing?.supportingText ?? []);
    if (normalizedSupportingText) supportingTexts.add(normalizedSupportingText);
    sourceByUrl.set(url, {
      url,
      ...(existing?.title || normalizedTitle ? { title: existing?.title ?? normalizedTitle } : {}),
      ...(supportingTexts.size ? { supportingText: [...supportingTexts] } : {}),
    });
  };

  for (const item of webSearchCalls) {
    const action = typeof item.action === "object" && item.action !== null
      ? (item.action as Record<string, unknown>)
      : null;
    if (!action) continue;

    if (typeof action.query === "string" && action.query.trim()) {
      searchQueries.add(action.query.trim());
    }
    if (Array.isArray(action.queries)) {
      for (const query of action.queries) {
        if (typeof query === "string" && query.trim()) searchQueries.add(query.trim());
      }
    }
    if (Array.isArray(action.sources)) {
      for (const source of action.sources) {
        if (typeof source !== "object" || source === null) continue;
        const sourceRecord = source as Record<string, unknown>;
        addSource(sourceRecord.url, sourceRecord.title);
      }
    }
  }

  for (const item of output) {
    if (item.type !== "message") continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (typeof part !== "object" || part === null) continue;
      const partRecord = part as { text?: unknown; annotations?: unknown };
      const partText = typeof partRecord.text === "string" ? partRecord.text : "";
      const annotations = Array.isArray(partRecord.annotations)
        ? partRecord.annotations
        : [];
      for (const annotation of annotations) {
        if (
          typeof annotation === "object" &&
          annotation !== null &&
          (annotation as { type?: unknown }).type === "url_citation"
        ) {
          const citation = annotation as {
            url?: unknown;
            title?: unknown;
            start_index?: unknown;
            end_index?: unknown;
          };
          const start = typeof citation.start_index === "number" ? citation.start_index : null;
          const end = typeof citation.end_index === "number" ? citation.end_index : null;
          const supportingText = start !== null && end !== null && start >= 0 && end > start
            ? partText.slice(start, end)
            : undefined;
          addSource(citation.url, citation.title, supportingText);
        }
      }
    }
  }

  return {
    executed,
    searchCount: webSearchCalls.length,
    sources: [...sourceByUrl.values()],
    ...(searchQueries.size ? { searchQueries: [...searchQueries] } : {}),
  };
}

function normalizeOpenAiUsage(response: OpenAiResponse): AiProviderUsage | undefined {
  const usage = (response as unknown as {
    usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  }).usage;
  if (!usage) return undefined;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
    raw: usage,
  };
}

function normalizeOpenAiEmbeddingUsage(response: {
  usage?: { prompt_tokens?: number; total_tokens?: number };
}): AiProviderUsage | undefined {
  if (!response.usage) return undefined;
  return {
    inputTokens: response.usage.prompt_tokens,
    totalTokens: response.usage.total_tokens,
    raw: response.usage,
  };
}

export class OpenAiProvider implements AiProvider {
  private resolvedClient: OpenAI | null = null;

  constructor(private readonly client: OpenAI | OpenAiClientFactory) {}

  private getClient() {
    if (!this.resolvedClient) {
      this.resolvedClient = isOpenAiClientFactory(this.client)
        ? this.client()
        : this.client;
    }
    return this.resolvedClient;
  }

  async createTextResponse(
    request: AiProviderTextRequest,
    options?: AiProviderRequestOptions,
  ): Promise<AiProviderTextResponse> {
    const payload: ResponseCreateParamsNonStreaming = {
      model: request.model,
      input: request.input,
      stream: false,
    };
    if (request.instructions) payload.instructions = request.instructions;
    const tools = buildOpenAiTools(request.tools);
    if (tools) {
      payload.tools = tools;
      // Request the provider-native source list so the adapter can normalize
      // evidence even when a URL is not repeated as a message annotation.
      (payload as unknown as { include: string[] }).include = [
        "web_search_call.action.sources",
      ];
    }
    const text = buildTextConfig(request.format);
    if (text) payload.text = text;

    const response = (await this.getClient().responses.create(
      payload,
      openAiRequestOptions(options),
    )) as OpenAiResponse;
    const webSearch = normalizeOpenAiWebSearch(response, Boolean(tools?.length));
    return {
      id: response.id,
      outputText: response.output_text ?? "",
      usage: normalizeOpenAiUsage(response),
      ...(webSearch ? { webSearch } : {}),
      raw: response,
    };
  }

  async createEmbeddings(
    request: AiProviderEmbeddingRequest,
    options?: AiProviderRequestOptions,
  ): Promise<AiProviderEmbeddingResponse> {
    const response = await this.getClient().embeddings.create(
      {
        model: request.model,
        input: request.input,
        encoding_format: "float",
        ...(request.dimensions ? { dimensions: request.dimensions } : {}),
      },
      openAiRequestOptions(options),
    );
    return {
      embeddings: response.data.map(item => item.embedding),
      usage: normalizeOpenAiEmbeddingUsage(response),
      raw: response,
    };
  }

  async createAudioTranscription(
    request: AiProviderAudioTranscriptionRequest,
    options?: AiProviderRequestOptions,
  ): Promise<AiProviderAudioTranscriptionResponse> {
    const response = await this.getClient().audio.transcriptions.create(
      {
        file: request.file,
        model: request.model,
        response_format: "verbose_json",
        ...(request.language ? { language: request.language } : {}),
        ...(request.prompt ? { prompt: request.prompt } : {}),
      },
      openAiRequestOptions(options),
    );
    return buildTranscriptionResponse(response);
  }

  async createImageGeneration(
    request: AiProviderImageGenerationRequest,
    options?: AiProviderRequestOptions,
  ): Promise<AiProviderImageGenerationResponse> {
    const sourceImages = request.originalImages ?? [];
    const editFiles = sourceImages.map(buildImageEditFile);
    const client = this.getClient();
    const requestOptions = openAiRequestOptions(options);
    const response = editFiles.length > 0
      ? await client.images.edit(
          {
            model: request.model,
            image: editFiles,
            prompt: request.prompt,
            ...(request.size ? { size: request.size } : {}),
            ...(request.quality ? { quality: request.quality } : {}),
            ...(request.outputFormat ? { output_format: request.outputFormat } : {}),
          },
          requestOptions,
        )
      : await client.images.generate(
          {
            model: request.model,
            prompt: request.prompt,
            ...(request.size ? { size: request.size } : {}),
            ...(request.quality ? { quality: request.quality } : {}),
            ...(request.outputFormat ? { output_format: request.outputFormat } : {}),
          },
          requestOptions,
        );

    const imageData = firstImageData(response);
    if (!imageData) throw new Error("OpenAI image provider returned no image data.");
    return {
      b64Json: imageData,
      mimeType: mimeTypeFromOutputFormat(request.outputFormat),
      raw: response,
    };
  }
}

export type AiProviderFactory = () => AiProvider;

const openAiProviderFactory: AiProviderFactory = () =>
  new OpenAiProvider(() => createOpenAiClient());

const geminiProviderFactory: AiProviderFactory = () => {
  const apiKey = ENV.geminiApiKey;
  if (!apiKey) {
    throw new Error(
      "AI_VISION_PROVIDER is set to 'gemini' but GEMINI_API_KEY is not configured. " +
      "Set GEMINI_API_KEY to your Google AI Studio key to use Gemini.",
    );
  }
  return new GeminiProvider(apiKey);
};

const defaultAiProviderFactory: AiProviderFactory = () => {
  if (ENV.aiVisionProvider === "gemini") return geminiProviderFactory();
  return openAiProviderFactory();
};

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
