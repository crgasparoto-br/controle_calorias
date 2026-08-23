import { describe, expect, it } from "vitest";
import { parseMixedMealItemIncrementCommand } from "./mixedIncrementParser";

describe("issue #997 mixed increment parser", () => {
  it("extrai massa e fatias coordenadas sem descartar a elipse", () => {
    const parsed = parseMixedMealItemIncrementCommand(
      "Adicionar 48g ao requeijão, 1 fatia ao presunto e uma na mussarela",
    );
    expect(parsed?.unparsedSegments).toEqual([]);
    expect(parsed?.operations).toEqual([
      expect.objectContaining({ quantity: 48, unit: "g", targetFood: "requeijao", inheritedUnit: false }),
      expect.objectContaining({ quantity: 1, unit: "fatia", targetFood: "presunto", inheritedUnit: false }),
      expect.objectContaining({ quantity: 1, unit: "fatia", targetFood: "mussarela", inheritedUnit: true }),
    ]);
  });

  it("não inventa unidade quando a elipse não tem antecedente inequívoco", () => {
    const parsed = parseMixedMealItemIncrementCommand("Adicionar uma na mussarela");
    expect(parsed?.operations).toEqual([
      expect.objectContaining({ quantity: 1, unit: null, targetFood: "mussarela", inheritedUnit: false }),
    ]);
  });

  it("herda a unidade contável somente para o próximo segmento", () => {
    const parsed = parseMixedMealItemIncrementCommand(
      "Adicionar 1 fatia ao presunto e uma na mussarela e uma no queijo",
    );
    expect(parsed?.operations).toEqual([
      expect.objectContaining({ targetFood: "presunto", unit: "fatia", inheritedUnit: false }),
      expect.objectContaining({ targetFood: "mussarela", unit: "fatia", inheritedUnit: true }),
      expect.objectContaining({ targetFood: "queijo", unit: null, inheritedUnit: false }),
    ]);
  });

  it("não captura adições canônicas quando nenhuma operação de ajuste suportada foi extraída", () => {
    expect(
      parseMixedMealItemIncrementCommand(
        "Adicionar 3 xícaras de café sem açúcar no café da manhã",
      ),
    ).toBeNull();
    expect(
      parseMixedMealItemIncrementCommand(
        "Adicionar 1 copo de leite no café da manhã",
      ),
    ).toBeNull();
  });

  it("mantém bloqueio de sucesso parcial quando existe operação suportada junto de segmento desconhecido", () => {
    const parsed = parseMixedMealItemIncrementCommand(
      "Adicionar 48g ao requeijão, 1 xícara de café e 1 fatia ao presunto",
    );

    expect(parsed?.operations).toHaveLength(2);
    expect(parsed?.operations).toEqual([
      expect.objectContaining({ quantity: 48, unit: "g", targetFood: "requeijao" }),
      expect.objectContaining({ quantity: 1, unit: "fatia", targetFood: "presunto" }),
    ]);
    expect(parsed?.unparsedSegments).toEqual(["1 xicara de cafe"]);
  });
});
