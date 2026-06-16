import { beforeEach, describe, expect, it } from "vitest";
import type { WhatsappInterpretedIntent } from "./intentSchema";
import {
  __resetWhatsappFeedbackForTests,
  recordWhatsappUserFeedback,
} from "./feedbackLoop";
import {
  __resetWhatsappMessageHistoryForTests,
  recordWhatsappMessageHistory,
} from "./messageHistory";
import {
  __resetWhatsappReviewQueueForTests,
  convertApprovedWhatsappReviewQueueItem,
  enqueueWhatsappReviewFromFeedback,
  enqueueWhatsappReviewFromHistory,
  listWhatsappReviewQueue,
  recordNutritionReviewQueueItem,
  recordWhatsappReviewQueueItem,
  transitionWhatsappReviewQueueItem,
} from "./reviewQueue";

function buildIntent(overrides: Partial<WhatsappInterpretedIntent> = {}): WhatsappInterpretedIntent {
  return {
    intent: "unknown",
    confidence: 0.3,
    items: [],
    requiresConfirmation: true,
    possibleIntents: ["add_foods_to_meal"],
    ...overrides,
  };
}

describe("whatsapp review queue", () => {
  beforeEach(() => {
    __resetWhatsappReviewQueueForTests();
    __resetWhatsappMessageHistoryForTests();
    __resetWhatsappFeedbackForTests();
  });

  it("cria item por mensagem ambigua ou baixa confianca", () => {
    const history = recordWhatsappMessageHistory({
      userId: 42,
      messageText: "banana talvez",
      createdAt: new Date("2026-06-16T12:00:00.000Z"),
      intent: buildIntent({ intent: "ambiguous", confidence: 0.32 }),
      validationStatus: "valid",
      action: "ask_clarification",
      replyKind: "clarification",
      fallbackReason: "low_confidence",
    });

    const item = enqueueWhatsappReviewFromHistory(history);

    expect(item).toEqual(expect.objectContaining({
      type: "ambiguous_message",
      origin: "message_history",
      status: "open",
      priority: "high",
      confidence: 0.32,
      userId: 42,
      intent: "ambiguous",
      occurrences: 1,
    }));
    expect(item?.links.historyId).toBe(history.id);
  });

  it("cria item por alimento ou fonte nutricional nao resolvida", () => {
    const history = recordWhatsappMessageHistory({
      userId: 42,
      messageText: "comi cereal marca rara",
      intent: buildIntent({
        intent: "add_foods_to_meal",
        confidence: 0.87,
        requiresConfirmation: false,
        possibleIntents: [],
        items: [{ foodName: "cereal", quantity: null, unit: null, brand: "marca rara", preparation: null }],
      }),
      validationStatus: "valid",
      action: "llm_intent_add_foods_to_meal",
      replyKind: "executed",
      nutritionSource: { sourceId: null, sourceType: null, confidence: 0.41, estimated: true },
    });

    const item = enqueueWhatsappReviewFromHistory(history);

    expect(item).toEqual(expect.objectContaining({
      type: "nutrition_source_issue",
      origin: "nutrition_source",
      impact: "high",
      confidence: 0.41,
    }));
    expect(item?.links).toEqual(expect.objectContaining({
      foodName: "cereal",
      brand: "marca rara",
      historyId: history.id,
    }));
  });

  it("cria item por correcao posterior ou feedback negativo", () => {
    const target = recordWhatsappMessageHistory({
      userId: 42,
      messageText: "almocei arroz",
      intent: buildIntent({ intent: "add_foods_to_meal", confidence: 0.9, requiresConfirmation: false, possibleIntents: [] }),
      validationStatus: "valid",
      action: "llm_intent_add_foods_to_meal",
      replyKind: "executed",
      persisted: { happened: true, kind: "meal", ids: [10] },
    });
    const correction = recordWhatsappUserFeedback({ userId: 42, targetHistoryId: target.id, text: "nao era arroz, era batata" });
    const negative = recordWhatsappUserFeedback({ userId: 42, targetHistoryId: target.id, text: "isso ficou errado" });

    const correctionItem = enqueueWhatsappReviewFromFeedback(correction);
    const negativeItem = enqueueWhatsappReviewFromFeedback(negative);

    expect(correctionItem).toEqual(expect.objectContaining({
      type: "correction_signal",
      origin: "feedback",
      priority: "high",
      intent: "add_foods_to_meal",
    }));
    expect(negativeItem).toEqual(expect.objectContaining({
      type: "negative_feedback",
      origin: "feedback",
      priority: "medium",
    }));
  });

  it("filtra por tipo, status, confianca, data e prioridade", () => {
    recordWhatsappReviewQueueItem({
      type: "low_confidence_decision",
      origin: "message_history",
      title: "baixa confianca",
      reason: "teste",
      confidence: 0.2,
      priority: "critical",
      intent: "add_foods_to_meal",
      createdAt: new Date("2026-06-16T10:00:00.000Z"),
    });
    recordNutritionReviewQueueItem({
      foodName: "produto raro",
      confidence: 0.7,
      reason: "marca sem fonte",
      createdAt: new Date("2026-06-16T12:00:00.000Z"),
    });

    expect(listWhatsappReviewQueue({ type: "low_confidence_decision" })).toHaveLength(1);
    expect(listWhatsappReviewQueue({ priority: "critical" })).toHaveLength(1);
    expect(listWhatsappReviewQueue({ maxConfidence: 0.3 })).toHaveLength(1);
    expect(listWhatsappReviewQueue({ from: "2026-06-16T11:00:00.000Z" })).toHaveLength(1);
    expect(listWhatsappReviewQueue({ intent: "add_foods_to_meal" })).toHaveLength(1);
  });

  it("registra transicao de estado com decisao, justificativa e responsavel", () => {
    const item = recordWhatsappReviewQueueItem({
      type: "classification_pending",
      origin: "classification",
      title: "classificacao pendente",
      reason: "sem grupo alimentar confiavel",
    });

    const inReview = transitionWhatsappReviewQueueItem({
      itemId: item.id,
      status: "in_review",
      reviewer: "curadoria",
      mechanism: "curator",
      justification: "em analise",
      decidedAt: new Date("2026-06-16T12:10:00.000Z"),
    });

    expect(inReview).toEqual(expect.objectContaining({ status: "in_review" }));
    expect(inReview?.review).toEqual(expect.objectContaining({
      reviewer: "curadoria",
      mechanism: "curator",
      justification: "em analise",
      decidedAt: "2026-06-16T12:10:00.000Z",
    }));
  });

  it("converte revisao aprovada em saida candidata sem promocao global direta", () => {
    const item = recordNutritionReviewQueueItem({
      foodName: "iogurte marca exemplo",
      brand: "marca exemplo",
      confidence: 0.3,
      reason: "fonte precisa curadoria",
    });

    transitionWhatsappReviewQueueItem({
      itemId: item.id,
      status: "approved",
      reviewer: "nutricionista",
      mechanism: "nutritionist",
      decision: "curated_nutrition_source",
      justification: "fonte confirmada manualmente",
      decidedAt: new Date("2026-06-16T12:20:00.000Z"),
    });
    const converted = convertApprovedWhatsappReviewQueueItem({
      itemId: item.id,
      outputType: "curated_nutrition_source",
      payload: { sourceId: "curated-source-1", foodName: "iogurte marca exemplo" },
      convertedAt: new Date("2026-06-16T12:30:00.000Z"),
    });

    expect(converted).toEqual(expect.objectContaining({ status: "converted" }));
    expect(converted?.conversion).toEqual(expect.objectContaining({
      convertedAt: "2026-06-16T12:30:00.000Z",
      outputType: "curated_nutrition_source",
      globalPromotion: {
        allowed: false,
        requiresVersioning: true,
        reason: "Revisao aprovada gera saida candidata, mas promocao global exige versionamento, gates e fluxo de promocao.",
      },
    }));
    expect(converted?.conversion.payload).toEqual(expect.objectContaining({
      sourceReviewQueueItemId: item.id,
      sourceFingerprint: item.fingerprint,
    }));
  });

  it("agrupa itens repetidos por fingerprint sem duplicacao excessiva", () => {
    const first = recordWhatsappReviewQueueItem({
      type: "regression_candidate",
      origin: "offline_replay",
      title: "caso para regressao",
      reason: "erro repetido",
      sampleText: "banana tem muita caloria?",
      confidence: 0.4,
    });
    const second = recordWhatsappReviewQueueItem({
      type: "regression_candidate",
      origin: "offline_replay",
      title: "caso para regressao",
      reason: "erro repetido",
      sampleText: "banana tem muita caloria?",
      confidence: 0.4,
    });

    expect(second.id).toBe(first.id);
    expect(second.occurrences).toBe(2);
    expect(listWhatsappReviewQueue()).toHaveLength(1);
  });
});
