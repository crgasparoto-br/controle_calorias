import { describe, expect, it } from "vitest";
import { joinUnitWords } from "./quantityUnitVocabulary";

describe("joinUnitWords", () => {
  it("reconstrói o padrão original do mealCommandParser.ts", () => {
    expect(joinUnitWords([
      "gramas",
      "quilos",
      "miligramas",
      "mililitros",
      "litros",
      "unidades",
      "fatias",
      "colheresSopa",
      "colheresCha",
      "xicarasAccented",
      "copos",
      "doses",
      "scoops",
      "longNeck",
      "latas",
      "garrafas",
      "porcoesAccented",
    ])).toBe(
      "g|gr|gramas?|kg|quilos?|mg|ml|mililitros?|l|litros?|un|unidades?|fatias?|colheres? de sopa|colheres? de ch[aá]|x[ií]caras?|copos?|doses?|scoops?|long\\s*neck|longneck|latas?|garrafas?|por[cç][oõ]es?|por[cç][aã]o",
    );
  });

  it("reconstrói o padrão original do whatsappIntentWebhook.ts", () => {
    expect(joinUnitWords([
      "gramas",
      "quilos",
      "miligramas",
      "mililitrosCompact",
      "litros",
      "unidades",
      "fatias",
      "pedacos",
      "xicarasPlain",
      "copos",
      "colheresGeneric",
      "doses",
      "scoops",
      "longNeck",
      "latas",
      "garrafas",
      "porcoesPlain",
    ])).toBe(
      "g|gr|gramas?|kg|quilos?|mg|ml|m\\s*l|mililitros?|l|litros?|un|unidades?|fatias?|pedacos?|xicaras?|copos?|colheres?|doses?|scoops?|long\\s*neck|longneck|latas?|garrafas?|porcoes?|porcao",
    );
  });

  it("reconstrói o padrão original de QUANTITY_WITH_UNIT/NUMERIC_ADJUSTMENT_WITH_UNIT do intentRouter.ts", () => {
    expect(joinUnitWords([
      "gramas",
      "quilosOnly",
      "miligramas",
      "mililitrosOnly",
      "litros",
      "unidades",
      "fatias",
      "xicarasPlain",
      "copos",
      "colheresGeneric",
      "porcoesPlain",
    ])).toBe("g|gr|gramas?|kg|mg|ml|l|litros?|un|unidades?|fatias?|xicaras?|copos?|colheres?|porcoes?|porcao");
  });

  it("reconstrói o padrão original de MATH_WITH_UNIT do intentRouter.ts", () => {
    expect(joinUnitWords(["gramas", "quilosOnly", "miligramas", "mililitrosOnly", "litros"]))
      .toBe("g|gr|gramas?|kg|mg|ml|l|litros?");
  });

  it("reconstrói o padrão original do parseQuantity do intentInterpreter.ts", () => {
    expect(joinUnitWords(["gramas", "quilosOnly", "mililitrosOnly", "litrosOnly", "fatias", "xicarasAccented", "copos", "unidades"]))
      .toBe("g|gr|gramas?|kg|ml|l|fatias?|x[ií]caras?|copos?|un|unidades?");
  });
});
