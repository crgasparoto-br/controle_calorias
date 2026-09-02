import { describe, expect, it, vi } from "vitest";
import { OpenAiProvider } from "./aiProvider";
import {
  OpenAiConfigurationError,
  createOpenAiClient,
} from "./openaiClient";

describe("openai provider foundation", () => {
  it("only throws a clear error when the lazy real provider is actually used without OPENAI_API_KEY", async () => {
    const provider = new OpenAiProvider(() =>
      createOpenAiClient({
        apiKey: "",
        createClient: vi.fn() as never,
      }),
    );

    await expect(
      provider.createTextResponse({
        model: "gpt-4.1-mini",
        input: "hello",
      }),
    ).rejects.toThrowError(OpenAiConfigurationError);
  });

  it("reuses the same lazy config guard for audio transcription", async () => {
    const provider = new OpenAiProvider(() =>
      createOpenAiClient({
        apiKey: "",
        createClient: vi.fn() as never,
      }),
    );

    await expect(
      provider.createAudioTranscription({
        model: "whisper-1",
        file: new File(["audio"], "meal.ogg", { type: "audio/ogg" }),
      }),
    ).rejects.toThrowError(OpenAiConfigurationError);
  });

  it("maps internal requests to the OpenAI responses client", async () => {
    const responsesCreateMock = vi.fn().mockResolvedValue({
      id: "resp_123",
      output_text: "{\"mealLabel\":\"Almoco\"}",
    });

    const provider = new OpenAiProvider({
      responses: {
        create: responsesCreateMock,
      },
    } as never);

    const result = await provider.createTextResponse({
      model: "gpt-4.1-mini",
      instructions: "Return valid JSON",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "arroz e frango",
            },
          ],
        },
      ],
      format: {
        type: "json_schema",
        name: "meal_extraction",
        schema: {
          type: "object",
          additionalProperties: false,
          required: [],
          properties: {},
        },
      },
    });

    expect(responsesCreateMock).toHaveBeenCalledWith({
      model: "gpt-4.1-mini",
      instructions: "Return valid JSON",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "arroz e frango",
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "meal_extraction",
          schema: {
            type: "object",
            additionalProperties: false,
            required: [],
            properties: {},
          },
          strict: true,
        },
      },
      stream: false,
    }, undefined);
    expect(result).toEqual({
      id: "resp_123",
      outputText: "{\"mealLabel\":\"Almoco\"}",
      raw: {
        id: "resp_123",
        output_text: "{\"mealLabel\":\"Almoco\"}",
      },
    });
  });

  it("maps internal transcription requests to the OpenAI audio client", async () => {
    const transcriptionsCreateMock = vi.fn().mockResolvedValue({
      language: "pt",
      duration: 2.4,
      text: "arroz e feijao",
      segments: [],
    });

    const provider = new OpenAiProvider({
      audio: {
        transcriptions: {
          create: transcriptionsCreateMock,
        },
      },
    } as never);

    const file = new File(["audio"], "meal.ogg", { type: "audio/ogg" });
    const result = await provider.createAudioTranscription({
      model: "whisper-1",
      file,
      language: "pt",
      prompt: "Transcreva em portugues.",
    });

    expect(transcriptionsCreateMock).toHaveBeenCalledWith({
      file,
      model: "whisper-1",
      response_format: "verbose_json",
      language: "pt",
      prompt: "Transcreva em portugues.",
    }, undefined);
    expect(result).toEqual({
      task: "transcribe",
      language: "pt",
      duration: 2.4,
      text: "arroz e feijao",
      segments: [],
      raw: {
        language: "pt",
        duration: 2.4,
        text: "arroz e feijao",
        segments: [],
      },
    });
  });
});
