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

describe("nutrition provenance recovery", () => {
  it("probes when a cited product description lacks the structured nutrition values", async () => {
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
    const createTextResponse = vi.fn()
      .mockResolvedValueOnce({
        id: "primary",
        outputText,
        raw: {},
        webSearch: {
          executed: true,
          sources: [{
            url: "https://nutrition.test/product",
            supportingText: ["Produto Trento Speciale Branco identificado na página oficial."],
          }],
        },
      })
      .mockResolvedValueOnce({
        id: "probe",
        outputText: "Porção 26 g, 147 kcal, proteínas 2,3 g, carboidratos 12 g e gorduras 10 g.",
        raw: {},
        webSearch: {
          executed: true,
          sources: [{
            url: "https://nutrition.test/product",
            supportingText: ["Porção 26 g, 147 kcal, proteínas 2,3 g, carboidratos 12 g e gorduras 10 g."],
          }],
        },
      });

    const result = await createDomainTextResponse({ createTextResponse } as unknown as AiProvider, request);

    expect(createTextResponse).toHaveBeenCalledTimes(2);
    expect(result.webSearch?.sources[0]?.supportingText).toContain(
      "Porção 26 g, 147 kcal, proteínas 2,3 g, carboidratos 12 g e gorduras 10 g.",
    );
  });
});
