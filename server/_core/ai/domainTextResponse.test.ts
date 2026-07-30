import { describe, expect, it, vi } from "vitest";
import type { AiProvider } from "../aiProvider";
import { createDomainTextResponse } from "./domainTextResponse";

describe("domain text response boundary", () => {
  it("removes SDK raw payloads from the response exposed to domain services", async () => {
    const provider = {
      createTextResponse: vi.fn(async () => ({
        id: "response-1",
        outputText: "{\"ok\":true}",
        usage: {
          inputTokens: 12,
          outputTokens: 4,
          totalTokens: 16,
          raw: { providerSpecific: "secret-metadata" },
        },
        raw: { sdk: "full-response" },
      })),
    } as unknown as AiProvider;

    const result = await createDomainTextResponse(provider, {
      model: "model-a",
      input: "hello",
    });

    expect(result).toEqual({
      id: "response-1",
      outputText: "{\"ok\":true}",
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
    });
    expect(JSON.stringify(result)).not.toContain("raw");
    expect(JSON.stringify(result)).not.toContain("providerSpecific");
    expect(JSON.stringify(result)).not.toContain("full-response");
  });
});
