import { describe, expect, it, vi } from "vitest";
import {
  OpenAiConfigurationError,
  createOpenAiClient,
} from "./openaiClient";

describe("openAiClient", () => {
  it("throws a clear error when the real client is requested without OPENAI_API_KEY", () => {
    expect(() =>
      createOpenAiClient({
        apiKey: "",
        createClient: vi.fn() as never,
      }),
    ).toThrowError(OpenAiConfigurationError);
  });

  it("passes backend baseURL to the client factory when configured", () => {
    const createClient = vi.fn().mockReturnValue({ mocked: true });

    createOpenAiClient({
      apiKey: "test-key",
      baseURL: "https://example.test/v1",
      createClient: createClient as never,
    });

    expect(createClient).toHaveBeenCalledWith({
      apiKey: "test-key",
      baseURL: "https://example.test/v1",
    });
  });
});
