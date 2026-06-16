import { describe, expect, it } from "vitest";
import {
  classifyWhatsappLabeledExampleDestination,
  validateWhatsappLabeledExample,
  WHATSAPP_LABELING_GUIDELINES,
  type WhatsappLabeledExample,
} from "./labelingProtocol";

function example(overrides: Partial<WhatsappLabeledExample> = {}): WhatsappLabeledExample {
  return {
    id: "label-1",
    sourceKind: "synthetic",
    originReference: "fixture:positive:add-food",
    input: "comi 1 banana no cafe da manha",
    inputType: "text",
    schemaVersion: "whatsapp-labeling-schema/v1",
    risk: "low",
    useScope: "golden_gate",
    expected: {
      intent: "add_foods_to_meal",
      action: "llm_intent_add_foods_to_meal",
      entities: { foods: ["banana"], meal: "breakfast" },
      quantity: { value: 1, unit: "unidade" },
      date: "2026-06-16",
      targetMeal: "breakfast",
      nutritionSource: "internal_food_catalog",
      autonomy: "persist_allowed",
      persistenceAllowed: true,
      decisionReason: "Entrada positiva com alimento, quantidade e refeicao alvo claros.",
      errorReason: null,
    },
    review: {
      primaryReviewer: "curator-1",
      reviewedAt: "2026-06-16T17:00:00.000Z",
      status: "approved",
      justification: "Entidade e acao esperada conferidas.",
    },
    anonymization: {
      applied: false,
      directIdentifierPresent: false,
      retentionScope: "dataset",
      notes: "Fixture sintetica sem dado pessoal.",
    },
    multiTurn: null,
    ...overrides,
  };
}

describe("whatsapp labeling protocol", () => {
  it("documenta guia de rotulagem, motivos padronizados e integracoes", () => {
    expect(WHATSAPP_LABELING_GUIDELINES).toEqual(expect.objectContaining({
      requiredExpectedFields: expect.arrayContaining(["intent", "action", "entities", "autonomy", "persistenceAllowed", "decisionReason"]),
      errorReasons: expect.arrayContaining(["intent_error", "legitimate_ambiguity", "insufficient_data", "malicious_or_suspicious"]),
      noActionRequiresNoPersistence: true,
      highImpactRequiresSecondReview: true,
      integrations: expect.objectContaining({
        regressionDataset: "#413",
        conversationRegression: "#428",
        negativeEvaluation: "#441",
        reviewQueue: "#414",
        feedbackLoop: "#430",
        privacy: "#432",
        governance: "#443",
        security: "#444",
      }),
    }));
  });

  it("valida exemplo positivo rotulado com intencao, entidade e acao esperada", () => {
    const result = validateWhatsappLabeledExample(example());

    expect(result).toEqual(expect.objectContaining({
      accepted: true,
      destination: "regression",
      canBeBlockingGolden: true,
      privacyAccepted: true,
      missingFields: [],
      policyVersion: "whatsapp-labeling-protocol/v1",
    }));
  });

  it("valida caso negativo sem persistencia permitida", () => {
    const negative = example({
      id: "label-negative-1",
      originReference: "fixture:negative:support",
      input: "como cancelo minha conta?",
      useScope: "metrics_only",
      expected: {
        ...example().expected,
        intent: "unknown",
        action: "none",
        entities: {},
        quantity: null,
        targetMeal: null,
        nutritionSource: null,
        autonomy: "no_action",
        persistenceAllowed: false,
        decisionReason: "Mensagem de suporte fora do escopo alimentar.",
        errorReason: "out_of_scope",
      },
    });

    const result = validateWhatsappLabeledExample(negative);

    expect(result.accepted).toBe(true);
    expect(result.destination).toBe("negative_evaluation");
    expect(classifyWhatsappLabeledExampleDestination(negative)).toBe("negative_evaluation");
  });

  it("valida conversa multi-turn com estado final esperado", () => {
    const multiTurn = example({
      id: "label-multiturn-1",
      originReference: "fixture:conversation:portion",
      input: "comi arroz",
      useScope: "golden_gate",
      multiTurn: {
        initialState: { pending: null },
        messages: [
          { input: "comi arroz", expectedAction: "ask_quantity", expectedPendingState: { awaiting: "quantity" } },
          { input: "2 colheres", expectedAction: "persist_food" },
        ],
        expectedFinalState: { pending: null, persistedFoods: ["arroz"] },
      },
      expected: {
        ...example().expected,
        intent: "add_foods_to_meal",
        action: "persist_food_after_clarification",
        entities: { foods: ["arroz"], quantity: "2 colheres" },
        autonomy: "ask_confirmation",
        persistenceAllowed: true,
        decisionReason: "Primeiro turno precisa esclarecer quantidade antes de persistir.",
      },
    });

    const result = validateWhatsappLabeledExample(multiTurn);

    expect(result.accepted).toBe(true);
    expect(result.destination).toBe("multi_turn_regression");
    expect(result.canBeBlockingGolden).toBe(true);
  });

  it("exige adjudicacao para exemplo ambiguo antes de virar bloqueante", () => {
    const ambiguous = example({
      id: "label-ambiguous-1",
      input: "pode ser aquele de ontem",
      risk: "medium",
      expected: {
        ...example().expected,
        intent: "ambiguous",
        action: "ask_clarification",
        entities: {},
        autonomy: "clarify",
        persistenceAllowed: false,
        decisionReason: "Referencia temporal e alimento insuficientes.",
        errorReason: "legitimate_ambiguity",
      },
      review: {
        primaryReviewer: "curator-1",
        reviewedAt: "2026-06-16T17:20:00.000Z",
        status: "needs_adjudication",
        justification: "Ha duvida se o historico resolveria o alimento.",
        disagreementReason: "Revisor inicial marcou como ambiguidade legitima.",
      },
    });

    const result = validateWhatsappLabeledExample(ambiguous);

    expect(result.accepted).toBe(false);
    expect(result.destination).toBe("adjudication");
    expect(result.requiresAdjudication).toBe(true);
    expect(result.canBeBlockingGolden).toBe(false);
  });

  it("aceita exemplo real anonimizado e rejeita exemplo com privacidade invalida", () => {
    const anonymized = example({
      id: "label-real-1",
      sourceKind: "anonymized_real",
      originReference: "review:123",
      input: "comi 1 banana",
      anonymization: {
        applied: true,
        directIdentifierPresent: false,
        retentionScope: "dataset",
        notes: "Nome e telefone removidos antes da rotulagem.",
      },
    });
    const rejected = example({
      id: "label-real-2",
      sourceKind: "anonymized_real",
      originReference: "review:124",
      input: "sou Maria, telefone 11999998888, comi 1 banana",
      anonymization: {
        applied: false,
        directIdentifierPresent: true,
        retentionScope: "audit_only",
        notes: "Mensagem contem identificador direto.",
      },
    });

    expect(validateWhatsappLabeledExample(anonymized)).toEqual(expect.objectContaining({
      accepted: true,
      privacyAccepted: true,
    }));
    expect(validateWhatsappLabeledExample(rejected)).toEqual(expect.objectContaining({
      accepted: false,
      destination: "privacy_rejected",
      privacyAccepted: false,
      reasons: expect.arrayContaining([expect.stringContaining("identificador direto")]),
    }));
  });

  it("classifica destino entre regressao, memoria individual, candidato global e curadoria", () => {
    const regression = example();
    const memory = example({ id: "label-memory", useScope: "individual" });
    const global = example({ id: "label-global", useScope: "global_candidate" });
    const curation = example({
      id: "label-curation",
      useScope: "global_candidate",
      expected: {
        ...example().expected,
        errorReason: "nutrition_source_error",
        decisionReason: "Fonte nutricional divergiu de curadoria aprovada.",
      },
    });

    expect(classifyWhatsappLabeledExampleDestination(regression)).toBe("regression");
    expect(classifyWhatsappLabeledExampleDestination(memory)).toBe("individual_memory");
    expect(classifyWhatsappLabeledExampleDestination(global)).toBe("global_candidate");
    expect(classifyWhatsappLabeledExampleDestination(curation)).toBe("nutrition_curation");
  });
});
