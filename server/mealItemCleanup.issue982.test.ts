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

describe("cleanMealItems issue #982", () => {
  it("preserva preparações válidas que contêm nome de recipiente", () => {
    const cleaned = cleanMealItems([
      item("Bolo de pote"),
      item("Bolo de pote ninho cremoso"),
      item("Copo de açaí"),
      item("Copo de smoothie de pitaya"),
      item("Tigela com bubble tea"),
      item("Bandeja de sushi vegano"),
      item("Travessa com lasanha caseira"),
      item("Copo açaí"),
      item("Pote iogurte"),
      item("Marmita frango arroz"),
    ]);

    expect(cleaned.map(entry => entry.foodName)).toEqual([
      "Bolo de pote",
      "Bolo de pote ninho cremoso",
      "Copo de açaí",
      "Copo de smoothie de pitaya",
      "Tigela com bubble tea",
      "Bandeja de sushi vegano",
      "Travessa com lasanha caseira",
      "Copo açaí",
      "Pote iogurte",
      "Marmita frango arroz",
    ]);
  });

  it.each([
    "Pote",
    "Pote vazio",
    "Copo descartável",
    "Tigela de plástico",
    "Copo com tampa",
    "Pote de vidro",
    "Bandeja de alumínio",
    "Panela de pressão",
    "Prato",
    "Marmita vazia",
    "Decoração",
    "Pote quebrado",
    "Copo azul",
    "Tigela nova",
    "Prato decorativo",
    "Copo de brinquedo",
    "Pote de tinta",
    "Bandeja de isopor",
    "Panela com cabo",
    "Tigela de parafuso",
    "Pote de cimento",
  ])("continua descartando objeto ou ruído não alimentar: %s", foodName => {
    expect(cleanMealItems([item(foodName)])).toEqual([]);
  });

  it("não depende de cadastrar previamente cada adjetivo de objeto", () => {
    const arbitraryObjectModifiers = [
      "Pote translúcido",
      "Copo rachado",
      "Tigela brilhante",
    ];

    expect(arbitraryObjectModifiers.every(foodName => cleanMealItems([item(foodName)]).length === 0)).toBe(true);
  });

  it("rejeita complemento unitário desconhecido após conectores sem enumeração finita", () => {
    const novelConnectorObjects = [
      "Copo de brinquedo",
      "Pote de tinta",
      "Bandeja de isopor",
      "Panela com cabo",
      "Tigela de parafuso",
      "Pote de cimento",
    ];

    expect(novelConnectorObjects.every(foodName => cleanMealItems([item(foodName)]).length === 0)).toBe(true);
  });

  it("rejeita objetos multi-token inéditos sem usar ausência em lista negativa como sinal de alimento", () => {
    const unseenMultiTokenObjects = [
      "Pote de shampoo anticaspa",
      "Copo de detergente clorado",
      "Tigela de maquiagem mineral",
      "Bandeja de equipamento eletrônico portátil",
      "Travessa de material sintético resistente",
    ];

    expect(unseenMultiTokenObjects.every(foodName => cleanMealItems([item(foodName)]).length === 0)).toBe(true);
  });

  it("mantém objetos multi-token conhecidos removidos independentemente da cardinalidade", () => {
    const nestedMultiTokenObjects = [
      "Pote de tinta acrílica fosca",
      "Copo de plástico transparente reciclável",
      "Bandeja de isopor branco expandido",
      "Panela com cabo longo removível",
      "Tigela de parafuso metálico sextavado",
      "Pote de cimento branco estrutural",
      "Copo de silicone flexível reutilizável",
      "Travessa de vidro temperado transparente",
    ];

    expect(nestedMultiTokenObjects.every(foodName => cleanMealItems([item(foodName)]).length === 0)).toBe(true);
  });

  it("preserva sinal alimentar conhecido mesmo sem de/com", () => {
    const implicitServingContent = [
      "Copo açaí",
      "Pote iogurte",
      "Marmita frango arroz",
    ];

    expect(implicitServingContent.every(foodName => cleanMealItems([item(foodName)]).length === 1)).toBe(true);
  });

  it("preserva preparações culinárias fora da TACO sem exigir allowlist positiva", () => {
    const uncataloguedPreparations = [
      "Pote de tiramisu artesanal",
      "Tigela de panna cotta de baunilha",
      "Travessa com baklava de pistache",
      "Marmita de pierogi tradicional",
      "Panela com shakshuka picante",
      "Copo de lassi salgado",
    ];

    expect(uncataloguedPreparations.every(foodName => cleanMealItems([item(foodName)]).length === 1)).toBe(true);
  });

  it("mantém os controles negativos cruzados ao abrir a classe positiva", () => {
    const clearlyNonFoodContents = [
      "Pote de shampoo anticaspa",
      "Copo de detergente clorado",
      "Tigela de maquiagem mineral",
      "Bandeja de equipamento eletrônico portátil",
      "Travessa de material sintético resistente",
      "Marmita com medicamento infantil",
      "Panela com dispositivo eletrônico",
    ];

    expect(clearlyNonFoodContents.every(foodName => cleanMealItems([item(foodName)]).length === 0)).toBe(true);
  });

  it("não deixa artigos, quantificadores ou plural contornarem a detecção de recipiente", () => {
    const inflectedObjects = [
      "Um pote vazio",
      "Uma tigela plástica",
      "Dois potes vazios",
      "Duas tigelas plásticas",
      "3 pratos decorativos",
      "10 copos rachados",
      "Potes de vidro",
      "Copos com tampa",
      "Panelas de pressão",
    ];

    expect(inflectedObjects.every(foodName => cleanMealItems([item(foodName)]).length === 0)).toBe(true);
  });

  it("rejeita negativos inéditos por famílias semânticas, sem cadastrar as frases de ataque", () => {
    const unseenSemanticNegatives = [
      "Pote de querosene aeronáutico",
      "Copo de solvente industrial",
      "Tigela de fluido automotivo",
      "Travessa com anticongelante concentrado",
      "Marmita de munição esportiva",
      "Pote de desinfetante hospitalar",
      "Copo de inseticida doméstico",
      "Bandeja de argamassa pronta",
      "Pote de carregador portátil",
      "Tigela de areia sanitária",
    ];

    expect(unseenSemanticNegatives.every(foodName => cleanMealItems([item(foodName)]).length === 0)).toBe(true);
  });

  it("não deixa um match alimentar genérico ocultar contexto inequivocamente não alimentar", () => {
    const nonFoodHomonyms = [
      "Copo de água sanitária",
      "Copo de água oxigenada",
      "Panela de óleo lubrificante",
      "Pote de óleo de motor",
      "Pote de pasta de dente",
      "Tigela de creme hidratante",
      "Pote de gel capilar",
      "Copo de líquido de freio",
    ];

    expect(nonFoodHomonyms.every(foodName => cleanMealItems([item(foodName)]).length === 0)).toBe(true);
  });

  it("preserva os homônimos quando o contexto continua nutricional", () => {
    const foodHomonyms = [
      "Copo de água mineral",
      "Pote de óleo de coco",
      "Pote de pasta de amendoim",
      "Tigela de creme de milho",
      "Pote de gel energético",
      "Copo de suplemento proteico",
      "Panela com caldo concentrado",
    ];

    expect(foodHomonyms.every(foodName => cleanMealItems([item(foodName)]).length === 1)).toBe(true);
  });

  it("preserva positivos inéditos de uma ou várias palavras fora do catálogo", () => {
    const openPositiveClass = [
      "Copo de kvass",
      "Prato de injera",
      "Pote de mochi",
      "Tigela de okonomiyaki caseiro",
      "Bandeja de arepa venezuelana",
      "Pote de kimchi industrializado",
    ];

    expect(openPositiveClass.every(foodName => cleanMealItems([item(foodName)]).length === 1)).toBe(true);
  });

  it("mantém alimento conhecido quando há utensílio ou embalagem como contexto secundário", () => {
    const foodsWithIncidentalObjects = [
      "Pote de bolo com tampa",
      "Copo de café com canudo",
      "Tigela de sopa com colher",
      "Prato de arroz com talher",
      "Pote de sorvete com embalagem",
    ];

    expect(foodsWithIncidentalObjects.every(foodName => cleanMealItems([item(foodName)]).length === 1)).toBe(true);
  });

});
