import { describe, expect, it } from "vitest";
import { resolveCapabilityConfig } from "../configResolver";

describe("QUESTION capability runtime contract", () => {
  it("keeps OpenAI eligible because the real consumer requires web search", () => {
    const resolved = resolveCapabilityConfig("QUESTION", {
      OPENAI_API_KEY: "sk-test",
      AI_QUESTION_PROVIDER: "openai",
      AI_QUESTION_MODEL: "gpt-4.1-mini",
    } as NodeJS.ProcessEnv);

    expect(resolved.state).toBe("ready");
    expect(resolved.primary).toEqual({ provider: "openai", model: "gpt-4.1-mini" });
  });

  it("rejects Gemini locally while Google Search translation is unavailable", () => {
    const resolved = resolveCapabilityConfig("QUESTION", {
      GEMINI_API_KEY: "gemini-test",
      AI_QUESTION_PROVIDER: "gemini",
      AI_QUESTION_MODEL: "gemini-2.5-flash",
    } as NodeJS.ProcessEnv);

    expect(resolved.state).toBe("invalid");
    expect(resolved.diagnostics).toEqual(expect.arrayContaining([
      expect.stringContaining("web_search"),
    ]));
  });
});
