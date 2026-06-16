import { describe, expect, it } from "vitest";
import type { WhatsappRegressionCase } from "./regressionDataset";
import {
  buildExpectedWhatsappRegressionActual,
  runWhatsappRegressionCase,
  validateWhatsappRegressionDataset,
  whatsappRegressionCases,
} from "./regressionDataset";

function getCase(id: string) {
  const testCase = whatsappRegressionCases.find(item => item.id === id);
  if (!testCase) throw new Error(`Caso de regressao nao encontrado: ${id}`);
  return testCase;
}

describe("whatsapp regression dataset", () => {
  it("carrega fixtures iniciais validas e cobre categorias minimas", () => {
    expect(validateWhatsappRegressionDataset()).toEqual([]);

    const categories = new Set(whatsappRegressionCases.map(testCase => testCase.category));

    expect(categories).toEqual(new Set([
      "simple_food_record",
      "branded_product",
      "low_calorie_drink",
      "quantity_portion",
      "math_with_unit",
      "isolated_number",
      "record_adjustment",
      "summary_report",
      "food_or_health_question",
      "ambiguous_or_insufficient",
      "expected_fallback",
    ]));
    expect(whatsappRegressionCases.every(testCase => testCase.input.anonymized)).toBe(true);
  });

  it("aceita saida estruturada compativel com a fixture", () => {
    const testCase = getCase("food-simple-rice-100g");
    const actual = buildExpectedWhatsappRegressionActual(testCase);

    expect(runWhatsappRegressionCase(testCase, actual)).toEqual([]);
  });

  it("sinaliza regressao quando a intencao esperada muda", () => {
    const testCase = getCase("food-simple-rice-100g");
    const actual = buildExpectedWhatsappRegressionActual(testCase);
    actual.intent.intent = "unknown";

    expect(runWhatsappRegressionCase(testCase, actual)).toContainEqual(expect.objectContaining({
      field: "intent.intent",
      severity: "blocking",
      expected: "add_foods_to_meal",
      actual: "unknown",
    }));
  });

  it("bloqueia persistencia indevida em caso de nao acao", () => {
    const testCase = getCase("isolated-number-without-context");
    const actual = buildExpectedWhatsappRegressionActual(testCase);
    actual.persistence = "save";
    actual.action = "llm_intent_add_foods_to_meal";

    const issues = runWhatsappRegressionCase(testCase, actual);

    expect(issues).toContainEqual(expect.objectContaining({
      field: "persistence.no_action_guard",
      severity: "blocking",
      actual: "save",
    }));
  });

  it("compara entidades extraidas relevantes", () => {
    const testCase = getCase("brand-product-yogurt-zero");
    const actual = buildExpectedWhatsappRegressionActual(testCase);
    actual.intent.items = [{
      foodName: "iogurte natural zero",
      quantity: null,
      unit: null,
      brand: null,
      preparation: null,
    }];

    expect(runWhatsappRegressionCase(testCase, actual)).toContainEqual(expect.objectContaining({
      field: "entities.brands",
      severity: "blocking",
      expected: ["marca exemplo"],
      actual: [],
    }));
  });

  it("exige compatibilidade explicita de versao de schema", () => {
    const testCase = getCase("summary-report-request");
    const actual = buildExpectedWhatsappRegressionActual(testCase);
    actual.schemaVersion = "whatsapp-intent-output/v2";

    expect(runWhatsappRegressionCase(testCase, actual)).toContainEqual(expect.objectContaining({
      field: "schemaVersion",
      severity: "blocking",
      expected: "whatsapp-intent-output/v1",
      actual: "whatsapp-intent-output/v2",
    }));
  });

  it("rejeita fixture real anonimizada com identificador direto", () => {
    const unsafeRealCase: WhatsappRegressionCase = {
      ...getCase("food-simple-rice-100g"),
      id: "unsafe-real-message",
      origin: "anonymized_real",
      input: {
        text: "sou ana@example.com e almocei arroz",
        inputType: "text",
        anonymized: true,
      },
    };

    expect(validateWhatsappRegressionDataset([unsafeRealCase])).toContainEqual(expect.objectContaining({
      field: "input.text",
      severity: "blocking",
    }));
  });
});
