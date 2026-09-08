import { describe, expect, it, vi } from "vitest";

vi.mock("./catalogSemanticSearch", () => ({
  findCatalogFoodSemantic: vi.fn(async () => ({
    slug: "panco-reference",
    name: "Pão de forma Panco",
    aliases: [],
    brandName: "Panco",
    isBrandedProduct: true,
    servingLabel: "2 fatias (50 g)",
    gramsPerServing: 50,
    calories: 125,
    protein: 4,
    carbs: 24,
    fat: 2,
    researchIdentityKey: "verified-panco-reference",
    sourceUrls: ["https://example.com/panco"],
    sourceEvidence: "50 g = 2 fatias",
    sourceVerifiedAt: new Date("2026-09-08"),
  })),
}));

const { prepareCountableFoodRegistrationResolved } = await import(
  "./countableFoodQuantity"
);

describe("issue #1051 — identidade de marca no fluxo contável", () => {
  it("preserva a marca e a evidência com o resolvedor real após a validação canônica", async () => {
    const prepared = await prepareCountableFoodRegistrationResolved(
      42,
      "2 fatias de pão de forma Panco"
    );
    expect(prepared).toMatchObject({
      pendingItems: [],
      registrationText: "50 g de pão de forma Panco",
      resolutions: [
        {
          request: { brand: "Panco", count: 2, requestedUnit: "fatia" },
          resolution: {
            kind: "researched_exact",
            grams: 50,
            sourceUrls: ["https://example.com/panco"],
          },
        },
      ],
    });
  });
});
