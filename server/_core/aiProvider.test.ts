import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OpenAiProvider,
  getAiProvider,
  resetAiProviderFactory,
  setAiProviderFactory,
} from "./aiProvider";
import {
  OpenAiConfigurationError,
  createOpenAiClient,
} from "./openaiClient";

describe("openai provider foundation", () => {
  afterEach(() => {
    resetAiProviderFactory();
  });

  it("allows provider mocking without OPENAI_API_KEY", async () => {
    const mockProvider = {
      createTextResponse: vi.fn().mockResolvedValue({
        id: "mock-response",
        outputText: "{\"ok\":true}",
        raw: { mocked: true },
      }),
    };

    setAiProviderFactory(() => mockProvider);

    const result = await getAiProvider().createTextResponse({
      model: "gpt-4.1-mini",
      input: "hello",
    });

    expect(result.outputText).toBe("{\"ok\":true}");
    expect(mockProvider.createTextResponse).toHaveBeenCalledWith({
      model: "gpt-4.1-mini",
      input: "hello",
    });
  });

  it("fails with a clear error only when the real client is created without OPENAI_API_KEY", () => {
    expect(() =>
      createOpenAiClient({
        apiKey: "",
        createClient: vi.fn() as never,
      }),
    ).toThrowError(OpenAiConfigurationError);
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
          },
          strict: true,
        },
      },
      stream: false,
    });
    expect(result).toEqual({
      id: "resp_123",
      outputText: "{\"mealLabel\":\"Almoco\"}",
      raw: {
        id: "resp_123",
        output_text: "{\"mealLabel\":\"Almoco\"}",
      },
    });
  });
});
