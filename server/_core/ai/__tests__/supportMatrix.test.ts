import { describe, expect, it } from "vitest";
import {
  findUnsupportedOperations,
  getSupportedOperations,
  isKnownProvider,
  supportsOperation,
} from "../supportMatrix";

describe("adapter support matrix", () => {
  it("declares openai support without inferring from model name", () => {
    expect(supportsOperation("openai", "structured_output")).toBe(true);
    expect(supportsOperation("openai", "embeddings")).toBe(true);
    expect(supportsOperation("openai", "transcription")).toBe(true);
  });

  it("declares gemini support explicitly, without audio/image", () => {
    expect(supportsOperation("gemini", "text")).toBe(true);
    expect(supportsOperation("gemini", "vision")).toBe(true);
    expect(supportsOperation("gemini", "structured_output")).toBe(true);
    expect(supportsOperation("gemini", "transcription")).toBe(false);
    expect(supportsOperation("gemini", "image_generation")).toBe(false);
  });

  it("treats an openai-compatible endpoint as unsupported for everything by default", () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(getSupportedOperations("openai-compatible", env)).toEqual([]);
    expect(supportsOperation("openai-compatible", "structured_output", env)).toBe(false);
    expect(supportsOperation("openai-compatible", "embeddings", env)).toBe(false);
  });

  it("only enables openai-compatible operations that were explicitly validated via env", () => {
    const env = { AI_OPENAI_COMPATIBLE_OPERATIONS: "text, structured_output" } as unknown as NodeJS.ProcessEnv;
    expect(supportsOperation("openai-compatible", "text", env)).toBe(true);
    expect(supportsOperation("openai-compatible", "structured_output", env)).toBe(true);
    expect(supportsOperation("openai-compatible", "embeddings", env)).toBe(false);
  });

  it("ignores unknown identifiers in the explicit validated-operations list", () => {
    const env = { AI_OPENAI_COMPATIBLE_OPERATIONS: "text, bogus_operation" } as unknown as NodeJS.ProcessEnv;
    expect(getSupportedOperations("openai-compatible", env)).toEqual(["text"]);
  });

  it("finds unsupported operations for a required set", () => {
    const unsupported = findUnsupportedOperations("gemini", ["text", "transcription", "image_generation"]);
    expect(unsupported).toEqual(["transcription", "image_generation"]);
  });

  it("recognizes known providers only", () => {
    expect(isKnownProvider("openai")).toBe(true);
    expect(isKnownProvider("gemini")).toBe(true);
    expect(isKnownProvider("anthropic")).toBe(false);
  });
});
