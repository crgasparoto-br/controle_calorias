import { describe, expect, it } from "vitest";
import { parseMixedMealItemIncrementCommand } from "./mixedIncrementParser";

describe("issue #997 mixed increment parser", () => {
  it("extrai massa e fatias coordenadas sem descartar a elipse", () => {
    const parsed = parseMixedMealItemIncrementCommand(
      "Adicionar 48g ao requeijão, 1 fatia ao presunto e uma na mussarela"
    );
    expect(parsed?.unparsedSegments).toEqual([]);
    expect(parsed?.operations).toEqual([
      expect.objectContaining({
        quantity: 48,
        unit: "g",
        targetFood: "requeijao",
        inheritedUnit: false,
      }),
      expect.objectContaining({
        quantity: 1,
        unit: "fatia",
        targetFood: "presunto",
        inheritedUnit: false,
      }),
      expect.objectContaining({
        quantity: 1,
        unit: "fatia",
        targetFood: "mussarela",
        inheritedUnit: true,
      }),
    ]);
  });

  it("não inventa unidade quando a elipse não tem antecedente inequívoco", () => {
    const parsed = parseMixedMealItemIncrementCommand(
      "Adicionar uma na mussarela"
    );
    expect(parsed?.operations).toEqual([
      expect.objectContaining({
        quantity: 1,
        unit: null,
        targetFood: "mussarela",
        inheritedUnit: false,
      }),
    ]);
  });

  it("herda a unidade contável somente para o próximo segmento", () => {
    const parsed = parseMixedMealItemIncrementCommand(
      "Adicionar 1 fatia ao presunto e uma na mussarela e uma no queijo"
    );
    expect(parsed?.operations).toEqual([
      expect.objectContaining({
        targetFood: "presunto",
        unit: "fatia",
        inheritedUnit: false,
      }),
      expect.objectContaining({
        targetFood: "mussarela",
        unit: "fatia",
        inheritedUnit: true,
      }),
      expect.objectContaining({
        targetFood: "queijo",
        unit: null,
        inheritedUnit: false,
      }),
    ]);
  });

  it("não captura adições canônicas quando nenhuma operação de ajuste suportada foi extraída", () => {
    expect(
      parseMixedMealItemIncrementCommand(
        "Adicionar 3 xícaras de café sem açúcar no café da manhã"
      )
    ).toBeNull();
    expect(
      parseMixedMealItemIncrementCommand(
        "Adicionar 1 copo de leite no café da manhã"
      )
    ).toBeNull();
  });

  it("mantém bloqueio de sucesso parcial quando existe operação suportada junto de segmento desconhecido", () => {
    const parsed = parseMixedMealItemIncrementCommand(
      "Adicionar 48g ao requeijão, 1 xícara de café e 1 fatia ao presunto"
    );

    expect(parsed?.operations).toHaveLength(2);
    expect(parsed?.operations).toEqual([
      expect.objectContaining({
        quantity: 48,
        unit: "g",
        targetFood: "requeijao",
      }),
      expect.objectContaining({
        quantity: 1,
        unit: "fatia",
        targetFood: "presunto",
      }),
    ]);
    expect(parsed?.unparsedSegments).toEqual(["1 xicara de cafe"]);
  });

  it("consome coordenação após vírgula e reconhece unidade compacta depois de e", () => {
    const commaAnd = parseMixedMealItemIncrementCommand(
      "Adicionar 1 fatia ao presunto, e 1 unidade ao ovo"
    );
    const compactMl = parseMixedMealItemIncrementCommand(
      "Adicionar 1 fatia ao presunto e 1ml ao leite"
    );

    expect(commaAnd?.unparsedSegments).toEqual([]);
    expect(commaAnd?.operations).toEqual([
      expect.objectContaining({
        quantity: 1,
        unit: "fatia",
        targetFood: "presunto",
      }),
      expect.objectContaining({
        quantity: 1,
        unit: "unidade",
        targetFood: "ovo",
      }),
    ]);
    expect(compactMl?.unparsedSegments).toEqual([]);
    expect(compactMl?.operations).toEqual([
      expect.objectContaining({ unit: "fatia", targetFood: "presunto" }),
      expect.objectContaining({ quantity: 1, unit: "ml", targetFood: "leite" }),
    ]);
  });

  it("preserva vírgula decimal e usa o vocabulário canônico de números", () => {
    const decimalSlice = parseMixedMealItemIncrementCommand(
      "Adicionar 1,5 fatias ao presunto, 2 unidades ao ovo"
    );
    const decimalMl = parseMixedMealItemIncrementCommand(
      "Adicionar 1,5ml ao leite"
    );
    const words = parseMixedMealItemIncrementCommand(
      "Adicionar três fatias ao presunto e dez unidades ao ovo"
    );
    const aliases = parseMixedMealItemIncrementCommand(
      "Adicionar 12grs ao presunto e 2und ao ovo"
    );

    expect(decimalSlice?.unparsedSegments).toEqual([]);
    expect(
      decimalSlice?.operations.map(operation => operation.quantity)
    ).toEqual([1.5, 2]);
    expect(decimalMl?.operations).toEqual([
      expect.objectContaining({
        quantity: 1.5,
        unit: "ml",
        targetFood: "leite",
      }),
    ]);
    expect(words?.unparsedSegments).toEqual([]);
    expect(words?.operations.map(operation => operation.quantity)).toEqual([
      3, 10,
    ]);
    expect(aliases?.unparsedSegments).toEqual([]);
    expect(aliases?.operations).toEqual([
      expect.objectContaining({
        quantity: 12,
        unit: "g",
        targetFood: "presunto",
      }),
      expect.objectContaining({
        quantity: 2,
        unit: "unidade",
        targetFood: "ovo",
      }),
    ]);
  });

  it.each([
    "Adicionar 1 fatia ao presunto, texto estranho",
    "Adicionar 1 fatia ao presunto e",
    "Adicionar 1 fatia ao presunto, e",
    "Adicionar 1 fatia ao presunto e 1 unidade",
    "Adicionar 1 fatia ao presunto e texto estranho e uma na mussarela",
  ])("mantém texto residual ou alvo ausente fora das operações: %s", text => {
    const parsed = parseMixedMealItemIncrementCommand(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.unparsedSegments.length).toBeGreaterThan(0);
  });

  it("não retorna null para uma operação suportada sem alimento-alvo", () => {
    const parsed = parseMixedMealItemIncrementCommand("Adicionar 1 fatia");
    expect(parsed?.operations).toEqual([]);
    expect(parsed?.unparsedSegments).toEqual(["1 fatia"]);
  });
});
