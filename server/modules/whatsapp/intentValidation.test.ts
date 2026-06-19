import { describe, expect, it } from "vitest";
import type { WhatsappInterpretedIntent } from "./intentSchema";
import { validateWhatsappRuntimeIntentForPersistence } from "./intentValidation";

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
      validationStatus: "valid",
    });

    expect(result).toEqual(expect.objectContaining({
      valid: true,
      status: "valid",
      issues: [],
    }));
    expect(result).not.toHaveProperty("fallbackReason");
    expect(result).not.toHaveProperty("errorCode");
    expect(result.autonomyDecision).toEqual(expect.objectContaining({
      outcome: "execute",
      intent: "adicionar_alimento",
    }));
  });

  it("bloqueia payload fora do schema estruturado", () => {
    const result = validateWhatsappRuntimeIntentForPersistence({
      intent: { ...addFoodIntent(), confidence: 2 } as unknown as WhatsappInterpretedIntent,
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
      validationStatus: "valid",
    });

    expect(result.valid).toBe(false);
    expect(result.status).toBe("invalid_payload");
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(["invalid_quantity", "invalid_unit"]));
  });

  it("bloqueia intencao somente leitura tentando passar como persistencia", () => {
    const result = validateWhatsappRuntimeIntentForPersistence({
      intent: addFoodIntent({ intent: "list_meal_records", items: [], meal: null }),
      validationStatus: "valid",
    });

    expect(result).toEqual(expect.objectContaining({
      valid: false,
      errorCode: "unsupported_persistent_intent",
      fallbackReason: "backend_validation_failed",
    }));
  });

  it("bloqueia sugestao de refeicao tentando passar como persistencia", () => {
    const result = validateWhatsappRuntimeIntentForPersistence({
      intent: addFoodIntent({
        intent: "meal_suggestion",
        confidence: 0.93,
        meal: { label: "jantar", createIfMissing: false },
        items: [{ foodName: "frango", quantity: null, unit: null }],
        requiresConfirmation: false,
        reason: "Pedido de sugestao nao representa consumo realizado.",
      }),
      validationStatus: "valid",
    });

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("unsupported_persistent_intent");
    expect(result.issues.map(issue => issue.code)).toContain("unsupported_persistent_intent");
  });

  it("bloqueia confirmacao profissional tentando passar como persistencia alimentar", () => {
    const result = validateWhatsappRuntimeIntentForPersistence({
      intent: addFoodIntent({
        intent: "paciente_aceita_sugestao",
        confidence: 0.93,
        meal: null,
        items: [],
        requiresConfirmation: true,
        reason: "Aceite depende de pendencia profissional ativa.",
      }),
      validationStatus: "valid",
    });

    expect(result).toEqual(expect.objectContaining({
      valid: false,
      status: "blocked",
      errorCode: "unsupported_persistent_intent",
      fallbackReason: "backend_validation_failed",
    }));
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      "unsupported_persistent_intent",
      "autonomy_not_executable",
    ]));
    expect(result.autonomyDecision).toEqual(expect.objectContaining({
      intent: "paciente_aceita_sugestao",
      outcome: "confirm",
    }));
  });

  it("bloqueia interpretacao que nao foi validada como payload confiavel", () => {
    const result = validateWhatsappRuntimeIntentForPersistence({
      intent: addFoodIntent(),
      validationStatus: "skipped",
    });

    expect(result).toEqual(expect.objectContaining({
      valid: false,
      errorCode: "invalid_schema",
      fallbackReason: "backend_validation_failed",
    }));
  });

  it("bloqueia escrita abaixo da confianca minima da politica de autonomia", () => {
    const result = validateWhatsappRuntimeIntentForPersistence({
      intent: addFoodIntent({ confidence: 0.82 }),
      validationStatus: "valid",
    });

    expect(result).toEqual(expect.objectContaining({
      valid: false,
      status: "blocked",
      errorCode: "autonomy_not_executable",
    }));
    expect(result.autonomyDecision).toEqual(expect.objectContaining({
      outcome: "confirm",
    }));
  });

  it("bloqueia troca de alimento sem aceite explicito", () => {
    const result = validateWhatsappRuntimeIntentForPersistence({
      intent: addFoodIntent({
        intent: "replace_food_in_meal",
        sourceFood: "arroz",
        targetFood: "batata",
        items: [],
        meal: null,
        confidence: 0.9,
      }),
      validationStatus: "valid",
    });

    expect(result).toEqual(expect.objectContaining({
      valid: false,
      status: "blocked",
      errorCode: "autonomy_not_executable",
    }));
    expect(result.autonomyDecision).toEqual(expect.objectContaining({
      intent: "trocar_alimento",
      outcome: "confirm",
    }));
  });
});
