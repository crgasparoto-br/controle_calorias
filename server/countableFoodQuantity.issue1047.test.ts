import { describe, expect, it } from "vitest";
import {
  parseCountableFoodQuantitySegment,
  prepareCountableFoodRegistrationResolved,
} from "./countableFoodQuantity";

describe("issue #1047 — quantidade implícita no registro alimentar", () => {
  it.each([
    ["duas bananas", 2, "bananas"],
    ["três ovos cozidos", 3, "ovos cozidos"],
    ["dez bananas", 10, "bananas"],
  ])("usa o vocabulário canônico em %s", (text, count, foodName) => {
    expect(parseCountableFoodQuantitySegment(text)).toEqual(expect.objectContaining({
      count,
      foodName,
      brand: null,
      requestedUnit: "un",
    }));
  });

  it("preserva a marca explícita no contrato de quantidade contável", () => {
    expect(parseCountableFoodQuantitySegment("2 fatias de pão de forma Panco")).toEqual(expect.objectContaining({
      count: 2,
      foodName: "pão de forma Panco",
      brand: "Panco",
      requestedUnit: "fatia",
    }));
  });

  it.each(["1 banana nanica", "uma banana nanica"])
    ("resolve %s pela porção canônica sem verbo operacional", async text => {
      const prepared = await prepareCountableFoodRegistrationResolved(42, text);

      expect(prepared.pendingItems).toEqual([]);
      expect(prepared.registrationText).toBe("80 g de banana nanica");
      expect(prepared.resolutions).toEqual([expect.objectContaining({
        request: expect.objectContaining({
          foodName: "banana nanica",
          count: 1,
          requestedUnit: "un",
        }),
        resolution: expect.objectContaining({
          kind: "canonical_portion",
          grams: 80,
        }),
      })]);
    });
});
