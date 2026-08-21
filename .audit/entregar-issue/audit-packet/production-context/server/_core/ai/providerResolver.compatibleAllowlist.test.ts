import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../env", () => ({
  ENV: {
    openaiBaseUrl: "https://compatible.example/v1",
    geminiApiKey: "",
  },
}));

import { getAiProviderById } from "./providerResolver";

describe("providerResolver compatible adapter allowlist", () => {
  afterEach(() => {
    delete process.env.OPENAI_BASE_URL;
    delete process.env.AI_OPENAI_COMPATIBLE_OPERATIONS;
  });

  it("blocks a method not present in the configured operation allowlist before client creation", async () => {
    process.env.OPENAI_BASE_URL = "https://compatible.example/v1";
    process.env.AI_OPENAI_COMPATIBLE_OPERATIONS = "text";

    const provider = getAiProviderById("openai-compatible");

    await expect(provider.createEmbeddings({
      model: "vendor/embedding-model",
      input: "banana",
    })).rejects.toMatchObject({ code: "incompatible_operation" });
  });
});
