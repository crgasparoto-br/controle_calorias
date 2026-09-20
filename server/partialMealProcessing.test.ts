import { beforeEach, describe, expect, it, vi } from "vitest";

const processMealInputMock = vi.hoisted(() => vi.fn());

vi.mock("./nutritionEngine", async () => {
  const actual =
    await vi.importActual<typeof import("./nutritionEngine")>(
      "./nutritionEngine"
    );
  return {
    ...actual,
    processMealInput: processMealInputMock,
  };
});

import { MealInferenceError } from "./nutritionEngine";
import { processMealInputWithPartialFailures } from "./partialMealProcessing";

function processed(segment: string, foodName = segment) {
  const item = {
    foodName,
    canonicalName: foodName,
    brand: null,
    quantity: 1,
    unit: "un",
    portionText: "1 unidade",
    servings: 1,
    estimatedGrams: 80,
    calories: 80,
    protein: 2,
    carbs: 12,
    fat: 1,
    confidence: 0.9,
    source: "catalog" as const,
  };
  return {
    detectedMealLabel: "Café da manhã",
    sourceText: segment,
    confidence: 0.9,
    needsConfirmation: true,
    reasoning: "Item resolvido no catálogo.",
    items: [item],
    totals: { calories: 80, protein: 2, carbs: 12, fat: 1 },
  };
}

describe("processMealInputWithPartialFailures", () => {
  beforeEach(() => {
    processMealInputMock.mockReset();
  });

  it("registra os demais alimentos e informa por que o café inconsistente ficou de fora", async () => {
    processMealInputMock.mockImplementation(
      async ({ text }: { text?: string }) => {
        const segment = text?.trim() ?? "";
        if (/café/u.test(segment)) {
          throw new MealInferenceError(
            "O preparo do café ficou ambíguo; não vou assumir calorias para o café genérico.",
            { code: "food_identity_clarification_required" }
          );
        }
        return processed(segment);
      }
    );

    const result = await processMealInputWithPartialFailures({
      text: "1 pão francês, 3 xícaras de café, 1 fatia de presunto",
    });

    expect(result.processed.items).toHaveLength(2);
    expect(result.processed.items.map(item => item.foodName)).toEqual([
      "1 pão francês",
      "1 fatia de presunto",
    ]);
    expect(result.skippedSegments).toEqual([
      {
        segmentIndex: 1,
        segment: "3 xícaras de café",
        reason:
          "O preparo do café ficou ambíguo; não vou assumir calorias para o café genérico.",
      },
    ]);
    expect(result.processed.totals).toEqual({
      calories: 160,
      protein: 4,
      carbs: 24,
      fat: 2,
    });
    expect(result.processed.semanticContract).toEqual(
      expect.objectContaining({
        originalText: "1 pão francês, 3 xícaras de café, 1 fatia de presunto",
        needsClarification: false,
        items: expect.arrayContaining([
          expect.objectContaining({ commercialName: "1 pão francês" }),
          expect.objectContaining({ commercialName: "1 fatia de presunto" }),
        ]),
      })
    );
    expect(result.processed.semanticContract?.items).toHaveLength(2);
    expect(processMealInputMock).toHaveBeenCalledTimes(4);
    expect(processMealInputMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        text: "1 pão francês, 3 xícaras de café, 1 fatia de presunto",
      })
    );
  });

  it("mantém o caminho normal de uma refeição válida em uma única chamada", async () => {
    const valid = processed("100 g de arroz");
    processMealInputMock.mockResolvedValue(valid);

    const result = await processMealInputWithPartialFailures({
      text: "100 g de arroz",
    });

    expect(result).toEqual({ processed: valid, skippedSegments: [] });
    expect(processMealInputMock).toHaveBeenCalledTimes(1);
    expect(processMealInputMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: "100 g de arroz" })
    );
  });

  it("mantém uma refeição composta totalmente válida em uma única chamada", async () => {
    const valid = processed("1 pão francês, 1 banana");
    processMealInputMock.mockResolvedValue(valid);

    const result = await processMealInputWithPartialFailures({
      text: "1 pão francês, 1 banana",
    });

    expect(result).toEqual({ processed: valid, skippedSegments: [] });
    expect(processMealInputMock).toHaveBeenCalledTimes(1);
  });

  it("descarta somente o componente com quantidade ambígua", async () => {
    processMealInputMock.mockImplementation(
      async ({ text }: { text?: string }) => {
        const segment = text?.trim() ?? "";
        if (/açúcar/u.test(segment)) {
          throw new MealInferenceError(
            "Informe a quantidade de açúcar para registrar este componente.",
            { code: "food_component_quantity_required" }
          );
        }
        return processed(segment);
      }
    );

    const result = await processMealInputWithPartialFailures({
      text: "1 pão francês, café com açúcar",
    });

    expect(result.processed.items).toHaveLength(1);
    expect(result.skippedSegments[0]).toEqual(
      expect.objectContaining({ segment: "café com açúcar" })
    );
    expect(processMealInputMock).toHaveBeenCalledTimes(3);
  });

  it("preserva um segmento já materializado e só processa os demais", async () => {
    processMealInputMock.mockImplementation(
      async ({ text }: { text?: string }) => processed(text?.trim() ?? "")
    );
    const resolved = processed("1 pão de forma", "Pão de Forma Panco Premium");

    const result = await processMealInputWithPartialFailures(
      { text: "1 pão de forma, 1 banana" },
      [{ segmentIndex: 0, processed: resolved }]
    );

    expect(result.skippedSegments).toEqual([]);
    expect(result.processed.items.map(item => item.foodName)).toEqual([
      "Pão de Forma Panco Premium",
      "1 banana",
    ]);
    expect(processMealInputMock).toHaveBeenCalledTimes(1);
    expect(processMealInputMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: "1 banana", transcript: undefined })
    );
  });

  it("não transforma uma falha sistêmica em descarte silencioso de alimento", async () => {
    processMealInputMock.mockRejectedValue(new Error("serviço indisponível"));

    await expect(
      processMealInputWithPartialFailures({
        text: "1 pão francês, 1 banana",
      })
    ).rejects.toThrow("serviço indisponível");
    expect(processMealInputMock).toHaveBeenCalledTimes(1);
  });

  it("propaga indisponibilidade do motor mesmo quando o texto tem irmãos válidos", async () => {
    processMealInputMock.mockRejectedValue(
      new MealInferenceError("motor indisponível", {
        code: "meal_inference_unavailable",
      })
    );

    await expect(
      processMealInputWithPartialFailures({
        text: "1 pão francês, 1 banana",
      })
    ).rejects.toThrow("motor indisponível");
    expect(processMealInputMock).toHaveBeenCalledTimes(1);
  });

  it("propaga erro não elegível que ocorre durante o processamento segmentado", async () => {
    processMealInputMock.mockImplementation(
      async ({ text }: { text?: string }) => {
        const segment = text?.trim() ?? "";
        if (segment.includes(",")) {
          throw new MealInferenceError("identidade ambígua", {
            code: "food_identity_clarification_required",
          });
        }
        if (/banana/u.test(segment)) {
          throw new MealInferenceError("motor indisponível no segmento", {
            code: "meal_inference_unavailable",
          });
        }
        return processed(segment);
      }
    );

    await expect(
      processMealInputWithPartialFailures({
        text: "1 pão francês, 1 banana",
      })
    ).rejects.toThrow("motor indisponível no segmento");
    expect(processMealInputMock).toHaveBeenCalledTimes(3);
  });

  it("preserva o processamento original quando há segmento resolvido, mas não há texto", async () => {
    const valid = processed("100 g de arroz");
    processMealInputMock.mockResolvedValue(valid);

    const result = await processMealInputWithPartialFailures(
      { text: "", transcript: "100 g de arroz" },
      [{ segmentIndex: 0, processed: valid }]
    );

    expect(result).toEqual({ processed: valid, skippedSegments: [] });
    expect(processMealInputMock).toHaveBeenCalledTimes(1);
    expect(processMealInputMock).toHaveBeenCalledWith({
      text: "",
      transcript: "100 g de arroz",
    });
  });

  it("não usa fallback parcial quando há mídia ou transcrição junto de segmentos resolvidos", async () => {
    const valid = processed("1 pão de forma, 1 banana");
    processMealInputMock.mockResolvedValue(valid);

    const result = await processMealInputWithPartialFailures(
      {
        text: "1 pão de forma, 1 banana",
        transcript: "1 pão de forma, 1 banana",
        imageUrl: "https://example.test/meal.jpg",
      },
      [{ segmentIndex: 0, processed: processed("1 pão de forma") }]
    );

    expect(result).toEqual({ processed: valid, skippedSegments: [] });
    expect(processMealInputMock).toHaveBeenCalledTimes(1);
    expect(processMealInputMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transcript: "1 pão de forma, 1 banana",
        imageUrl: "https://example.test/meal.jpg",
      })
    );
  });

  it("permanece fail-closed quando a mídia não foi armazenada", async () => {
    processMealInputMock.mockRejectedValue(
      new MealInferenceError("identidade ambígua", {
        code: "food_identity_clarification_required",
      })
    );

    await expect(
      processMealInputWithPartialFailures(
        { text: "1 pão francês, 1 banana" },
        [],
        { containsMedia: true, hasTranscriptionFailure: true }
      )
    ).rejects.toThrow("identidade ambígua");
    expect(processMealInputMock).toHaveBeenCalledTimes(1);
  });
});
