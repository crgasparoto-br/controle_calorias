import { describe, expect, it, vi } from "vitest";
import { AiNonRetryableError } from "./policyExecutor";

vi.mock("../env", () => ({
  ENV: {
    openaiBaseUrl: "",
    geminiApiKey: "",
  },
}));

import { getAiProviderById } from "./providerResolver";

describe("providerResolver compatible endpoint guard", () => {
  it("refuses to create an OpenAI-compatible adapter without OPENAI_BASE_URL", () => {
    expect(() => getAiProviderById("openai-compatible")).toThrowError(AiNonRetryableError);
    expect(() => getAiProviderById("openai-compatible")).toThrow(/OPENAI_BASE_URL/);
  });
});
