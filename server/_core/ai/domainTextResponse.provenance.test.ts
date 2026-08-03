import { describe, expect, it, vi } from "vitest";
import type { AiProvider, AiProviderTextRequest } from "../aiProvider";
import { createDomainTextResponse } from "./domainTextResponse";

const request = {
  model: "gpt-4.1-mini",
  input: "produto embalado",
  tools: [{ type: "web_search" }],
  format: {
    type: "json_schema",
    name: "nutrition",
    schema: { type: "object", properties: {}, additionalProperties: true },
  },
} satisfies AiProviderTextRequest;

describe("nutrition provenance boundary", () => {
  it("does not issue a hidden recovery call when the first response lacks nutrition evidence", async () => {
    const outputText = JSON.stringify({
      found: true,
      sourceUrl: "https://nutrition.test/product",
      evidence: "produto identificado",
      gramsPerServing: 26,
      calories: 147,
      protein: 2.3,
      carbs: 12,
      fat: 10,
    });
    const createTextResponse = vi.fn().mockResolvedValue({
      id: "primary",
      outputText,
      raw: {},
      webSearch: {
        executed: true,
        searchCount: 1,
        sources: [{
          url: "https://nutrition.test/product",
          supportingText: ["Produto Trento Speciale Branco identificado na página oficial."],
        }],
      },
    });

    const result = await createDomainTextResponse(
      { createTextResponse } as unknown as AiProvider,
      request,
    );

    expect(createTextResponse).toHaveBeenCalledTimes(1);
    expect(result.webSearch?.searchCount).toBe(1);
    expect(result.webSearch?.sources[0]?.supportingText).toEqual([
      "Produto Trento Speciale Branco identificado na página oficial.",
    ]);
  });
});
