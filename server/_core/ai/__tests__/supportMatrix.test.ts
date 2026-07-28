import { describe, expect, it } from "vitest";
import {
  findUnsupportedOperations,
  getSupportedOperations,
  isKnownProvider,
  supportsOperation,
} from "../supportMatrix";

describe("adapter support matrix", () => {
  it("declares OpenAI support explicitly", () => {
    expect(supportsOperation("openai", "structured_output")).toBe(true);
    expect(supportsOperation("openai", "web_search")).toBe(true);
    expect(supportsOperation("openai", "embeddings")).toBe(true);
    expect(supportsOperation("openai", "transcription")).toBe(true);
  });

  it("declares only operations implemented by GeminiProvider", () => {
    expect(supportsOperation("gemini", "text")).toBe(true);
    expect(supportsOperation("gemini", "vision")).toBe(true);
    expect(supportsOperation("gemini", "structured_output")).toBe(true);
    expect(supportsOperation("gemini", "web_search")).toBe(false);
    expect(supportsOperation("gemini", "embeddings")).toBe(false);
    expect(supportsOperation("gemini", "transcription")).toBe(false);
    expect(supportsOperation("gemini", "image_generation")).toBe(false);
  });

  it("treats an OpenAI-compatible endpoint as unsupported by default", () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(getSupportedOperations("openai-compatible", env)).toEqual([]);
  });

  it("keeps compatible operations disabled when the allowlist exists without an endpoint", () => {
    const env = {
      AI_OPENAI_COMPATIBLE_OPERATIONS: "text, structured_output",
    } as NodeJS.ProcessEnv;
    expect(getSupportedOperations("openai-compatible", env)).toEqual([]);
  });

  it("enables only explicitly validated compatible operations without duplicates", () => {
    const env = {
      OPENAI_BASE_URL: "https://compatible.example/v1",
      AI_OPENAI_COMPATIBLE_OPERATIONS: "text, structured_output, text, bogus",
    } as NodeJS.ProcessEnv;
    expect(getSupportedOperations("openai-compatible", env)).toEqual([
      "text",
      "structured_output",
    ]);
  });

  it("finds every unsupported operation for a required set", () => {
    expect(findUnsupportedOperations("gemini", ["text", "web_search", "embeddings"])).toEqual([
      "web_search",
      "embeddings",
    ]);
  });

  it("recognizes only registered providers", () => {
    expect(isKnownProvider("openai")).toBe(true);
    expect(isKnownProvider("gemini")).toBe(true);
    expect(isKnownProvider("openai-compatible")).toBe(true);
    expect(isKnownProvider("anthropic")).toBe(false);
  });
});
