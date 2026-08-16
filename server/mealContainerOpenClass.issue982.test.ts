import { describe, expect, it } from "vitest";
import { cleanMealItems } from "./mealItemCleanup";
import type { MealDraftItem } from "./nutritionEngineTypes";

function item(foodName: string): MealDraftItem {
  return {
    foodName,
    canonicalName: foodName,
    brand: null,
    quantity: 1,
    unit: "porção",
    portionText: "1 porção",
    servings: 1,
    estimatedGrams: 100,
    calories: 150,
    protein: 6,
    carbs: 15,
    fat: 5,
    confidence: 0.8,
    source: "heuristic",
  };
}

describe("open container-content classes issue #982", () => {
  it("rejeita negativos withheld sem copiar os substantivos para o discriminador", () => {
    const withheldNegatives = [
      "Pote de caderno escolar",
      "Copo de sapato esportivo",
      "Tigela com livro didático",
      "Travessa de violão elétrico",
      "Marmita de revista acadêmica",
      "Panela com controle remoto",
    ];

    expect(withheldNegatives.every(foodName => cleanMealItems([item(foodName)]).length === 0)).toBe(true);
  });

  it("preserva positivos culinários withheld fora do catálogo e da lista de produção", () => {
    const withheldPositives = [
      "Copo de kvass",
      "Prato de injera",
      "Pote de mochi",
      "Tigela de okonomiyaki caseiro",
      "Bandeja de arepa venezuelana",
      "Pote de kimchi industrializado",
      "Copo de bubble tea",
    ];

    expect(withheldPositives.every(foodName => cleanMealItems([item(foodName)]).length === 1)).toBe(true);
  });

  it("fecha a regressão de generalização encontrada na auditoria independente", () => {
    const independentNegatives = [
      "Pote de óculos de grau",
      "Copo de caneta azul",
      "Tigela com roteador wifi",
    ];
    const independentPositives = [
      "Prato de bibimbap",
      "Tigela de ramen caseiro",
      "Travessa de paella vegetariana",
      "Bandeja de croissant recheado",
    ];

    expect(independentNegatives.every(foodName => cleanMealItems([item(foodName)]).length === 0)).toBe(true);
    expect(independentPositives.every(foodName => cleanMealItems([item(foodName)]).length === 1)).toBe(true);
  });

  it("exercita famílias irmãs sem depender dos substantivos do finding", () => {
    const siblingNegatives = [
      "Pote de scanner portátil",
      "Copo de capacete vermelho",
      "Tigela com manual técnico",
      "Travessa de documento oficial",
      "Marmita de brinquedo digital",
    ];
    const siblingPositives = [
      "Copo de skyr artesanal",
      "Prato de börek recheado",
      "Pote de dosa masala",
      "Tigela de harira marroquina",
      "Travessa de khachapuri assado",
      "Copo de curry vermelho",
    ];

    expect(siblingNegatives.every(foodName => cleanMealItems([item(foodName)]).length === 0)).toBe(true);
    expect(siblingPositives.every(foodName => cleanMealItems([item(foodName)]).length === 1)).toBe(true);
  });

  it("rejeita objetos com cabeçalhos externos inéditos sem enumerar o substantivo", () => {
    const unseenObjectHeads = [
      "Caneca descartável",
      "Garrafa vazia",
      "Pires quebrado",
      "Espátula de silicone",
      "Jarra reutilizável",
      "Ralador metálico",
      "Duas canecas descartáveis",
      "3 garrafas vazias",
    ];

    expect(unseenObjectHeads.every(foodName => cleanMealItems([item(foodName)]).length === 0)).toBe(true);
  });

  it("preserva conteúdo culinário quando o cabeçalho externo também é inédito", () => {
    const unseenServingHeads = [
      "Caneca de café",
      "Garrafa de kombucha artesanal",
      "Jarra de lassi salgado",
      "Frasco de kefir",
      "Börek vermelho",
      "Duas garrafas de kombucha artesanal",
    ];

    expect(unseenServingHeads.every(foodName => cleanMealItems([item(foodName)]).length === 1)).toBe(true);
  });

});
