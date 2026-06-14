import { describe, expect, it } from "vitest";
import type { WhatsappAutonomyDecision } from "./autonomyPolicy";
import type { WhatsappInterpretedIntent } from "./intentSchema";
import { validateWhatsappRuntimeIntentForPersistence } from "./intentValidation";

const executableAutonomy: WhatsappAutonomyDecision = {
  intentName: "add_foods_to_meal",
  level: "automatico",
  outcome: "execute",
  canExecute: true,
  needsConfirmation: false,
  minimumConfidence: 0.74,
  reason: "Teste.",
};

const blockedAutonomy: WhatsappAutonomyDecision = {
  ...executableAutonomy,
  level: "requer_confirmacao",
  outcome: "clarify",
  canExecute: false,
  needsConfirmation: true,
};

function addFoodIntent(overrides: Partial<WhatsappInterpretedIntent> = {}): WhatsappInterpretedIntent {
  return {
    intent: "add_foods_to_meal",
    confidence: 0.9,
    date: null,
    meal: { label: "Almoço", createIfMissing: true },
    items: [{ foodName: "arroz", quantity: 100, unit: "g" }],
    sourceFood: null,
    targetFood: null,
    quantity: null,
    requiresConfirmation: false,
    clarificationQuestion: null,
    possibleIntents: [],
    reason: null,
    ...overrides,
  };
}

describe("validateWhatsappRuntimeIntentForPersistence", () => {
  it("aceita registro alimentar com schema, autonomia, refeicao, alimento, quantidade e unidade", () => {
    const result = validateWhatsappRuntimeIntentForPersistence({
      intent: addFoodIntent(),
      autonomyDecision: executableAutonomy,
      validationStatus: "valid",
    });

    expect(result).toEqual({ valid: true, status: "valid", issues: [] });
  });

  it("bloqueia payload fora do schema estruturado", () => {
    const result = validateWhatsappRuntimeIntentForPersistence({
      intent: { ...addFoodIntent(), confidence: 2 } as unknown as WhatsappInterpretedIntent,
      autonomyDecision: executableAutonomy,
      validationStatus: "valid",
    });

    expect(result).toEqual(expect.objectContaining({
      valid: false,
      status: "invalid_payload",
      errorCode: "invalid_schema",
      fallbackReason: "backend_validation_failed",
    }));
  });

  it("bloqueia registro alimentar sem quantidade ou unidade clara", () => {
    const result = validateWhatsappRuntimeIntentForPersistence({
      intent: addFoodIntent({ items: [{ foodName: "pao", quantity: null, unit: null }] }),
      autonomyDecision: executableAutonomy,
      validationStatus: "valid",
    });

    expect(result.valid).toBe(false);
    expect(result.status).toBe("invalid_payload");
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(["invalid_quantity", "invalid_unit"]));
  });

  it("bloqueia intencao somente leitura tentando passar como persistencia", () => {
    const result = validateWhatsappRuntimeIntentForPersistence({
      intent: addFoodIntent({ intent: "list_meal_records", items: [], meal: null }),
      autonomyDecision: executableAutonomy,
      validationStatus: "valid",
    });

    expect(result).toEqual(expect.objectContaining({
      valid: false,
      status: "invalid_payload",
      errorCode: "unsupported_persistent_intent",
    }));
  });

  it("bloqueia autonomia que exige confirmacao ou revisao", () => {
    const result = validateWhatsappRuntimeIntentForPersistence({
      intent: addFoodIntent(),
      autonomyDecision: blockedAutonomy,
      validationStatus: "valid",
    });

    expect(result).toEqual(expect.objectContaining({
      valid: false,
      status: "blocked",
      errorCode: "autonomy_not_executable",
    }));
  });

  it("bloqueia interpretacao que nao foi validada como payload confiavel", () => {
    const result = validateWhatsappRuntimeIntentForPersistence({
      intent: addFoodIntent(),
      autonomyDecision: executableAutonomy,
      validationStatus: "skipped",
    });

    expect(result).toEqual(expect.objectContaining({
      valid: false,
      status: "invalid_payload",
      errorCode: "invalid_schema",
    }));
  });
});
