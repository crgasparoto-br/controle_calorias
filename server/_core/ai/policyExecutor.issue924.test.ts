import { describe, expect, it } from "vitest";
import { AiNonRetryableError, classifyAiError } from "./policyExecutor";

describe("issue #924 provider error classification", () => {
  it("classifies a provider model_not_found code before generic 4xx handling", () => {
    const upstream = Object.assign(new Error("Request rejected"), {
      status: 403,
      code: "model_not_found",
    });

    const classified = classifyAiError(upstream);

    expect(classified).toBeInstanceOf(AiNonRetryableError);
    expect(classified.code).toBe("model_not_found");
    expect(classified.cause).toBe(upstream);
  });
});
