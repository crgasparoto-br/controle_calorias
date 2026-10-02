import { describe, expect, it } from "vitest";
import { resolveStructuredCommercialIdentity } from "./commercialFoodIdentityPreflight";
import { processMealInput } from "./nutritionEngine";

const occurredAt = new Date("2026-10-02T01:01:00.000Z");
const timeZone = "America/Sao_Paulo";

describe("Cerveja Original — referência curada (#1291)", () => {
  it("não pede clarificação de identidade comercial para a cerveja original", () => {
    const identity = resolveStructuredCommercialIdentity({
      segment: "cerveja original",
      foodName: "cerveja original",
      brand: null,
    });

    expect(identity.identityClarification).toBeUndefined();
    expect(identity.brand).toBeNull();
  });

  it("registra 600 ml de cerveja original com a referência curada", async () => {
    const result = await processMealInput({
      userId: 1,
      text: "600ml cerveja original",
      occurredAt,
      timeZone,
    } as never);

    const item = result?.items?.[0];
    expect(item?.foodName).toBe("Cerveja Original Antarctica");
    expect(item?.brand).toBe("Antarctica");
    expect(item?.estimatedGrams).toBe(600);
    // 87 kcal por 200 ml ⇒ 261 kcal em 600 ml.
    expect(item?.calories).toBe(261);
    expect(item?.source).toBe("catalog");
  });
});