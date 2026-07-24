import { describe, expect, it } from "vitest";

import type { WhatsAppPendingOperationRecord } from "../../repositories/whatsappPendingOperationRepository";
import { describeWhatsappRegisteredInteraction } from "./interactionRegistry";
import {
  classifyMealIntentDecisionText,
  completeWhatsappMealIntentDecisionCallback,
  createWhatsappMealIntentDecisionInteraction,
  MEAL_INTENT_DECISION_ACTIONS,
  MEAL_INTENT_DECISION_INTERACTION_ID,
  MEAL_INTENT_DECISION_PROMPT,
  PENDING_MEAL_INTENT_DECISION_ORIGIN,
  PENDING_MEAL_INTENT_DECISION_TYPE,
  type PendingMealIntentDecision,
} from "./mealIntentDecisionInteraction";
import { resolveWhatsAppPrecedenceGate } from "./messageRouter";

function buildTarget(originalText = "jantar com arroz, feijão e frango"): PendingMealIntentDecision {
  return {
    contractVersion: 1,
    interactionId: MEAL_INTENT_DECISION_INTERACTION_ID,
    kind: "meal_intent_decision",
    originalText,
    normalizedText: "jantar com arroz feijao e frango",
    inboundMessageId: "wamid.issue-899",
    interpretedIntent: {
      intent: "ambiguous",
      possibleIntents: ["add_foods_to_meal", "meal_suggestion"],
      confidence: 0.62,
      mealLabel: "Jantar",
    },
    actions: [...MEAL_INTENT_DECISION_ACTIONS],
  };
}

function buildPending(target = buildTarget()): WhatsAppPendingOperationRecord {
  const now = new Date("2026-07-23T22:00:00.000Z");
  return {
    id: 899,
    userId: 899,
    type: PENDING_MEAL_INTENT_DECISION_TYPE,
    target,
    origin: PENDING_MEAL_INTENT_DECISION_ORIGIN,
    state: "active",
    version: 1,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
    updatedAt: now,
    consumedAt: null,
  } as WhatsAppPendingOperationRecord;
}

describe("mealIntentDecisionInteraction", () => {
  it("persiste o contexto antes de apresentar uma decisão fechada com três botões", async () => {
    const result = await createWhatsappMealIntentDecisionInteraction({
      userId: 899001,
      originalText: "Jantar com arroz, feijão e frango",
      messageId: "wamid.issue-899-create",
      receivedAt: new Date("2026-07-23T22:00:00.000Z"),
    });

    expect(result.reply).toBe(MEAL_INTENT_DECISION_PROMPT);
    expect(result.data).toEqual(expect.objectContaining({
      originalTextPreserved: true,
      inboundMessageCorrelated: true,
      interactionId: MEAL_INTENT_DECISION_INTERACTION_ID,
      interactionClassification: "closed",
      interactionComponent: "buttons",
      interactionActionCount: 3,
    }));
    expect(result.interactiveReply?.messages).toEqual([
      expect.objectContaining({
        type: "buttons",
        bodyText: MEAL_INTENT_DECISION_PROMPT,
        buttons: [
          expect.objectContaining({ title: "Registrar" }),
          expect.objectContaining({ title: "Receber sugestão" }),
          expect.objectContaining({ title: "Cancelar" }),
        ],
      }),
    ]);
  });

  it("está descrita no registro central como interação fechada e reconstruível", () => {
    const description = describeWhatsappRegisteredInteraction(buildPending());

    expect(description).toEqual(expect.objectContaining({
      component: "buttons",
      interaction: expect.objectContaining({
        id: MEAL_INTENT_DECISION_INTERACTION_ID,
        pendingType: PENDING_MEAL_INTENT_DECISION_TYPE,
        classification: "closed",
        reconstruction: "pending_target",
      }),
    }));
    expect(description?.actions.map(action => action.label)).toEqual([
      "Registrar",
      "Receber sugestão",
      "Cancelar",
    ]);
  });

  it("aceita fallback textual e rejeita resposta incompatível sem consumir a escolha", () => {
    const target = buildTarget();

    expect(classifyMealIntentDecisionText(target, "Registrar")).toBe("resolve");
    expect(classifyMealIntentDecisionText(target, "2")).toBe("resolve");
    expect(classifyMealIntentDecisionText(target, "talvez")).toBe("invalid");
  });

  it("usa o texto original para sugestão e deixa explícito que nada foi registrado", async () => {
    const result = await completeWhatsappMealIntentDecisionCallback({
      userId: 899002,
      pendingOperation: buildPending(),
      action: "suggest",
      receivedAt: new Date("2026-07-23T22:01:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result.action).toBe("meal_intent_decision_suggestion");
    expect(result.reply).toContain("Sugestão alimentar");
    expect(result.reply).toContain("Nada foi registrado como consumo");
    expect(result.data).toEqual(expect.objectContaining({
      originalTextPreserved: true,
      originalTextResumed: true,
      consumptionPersisted: false,
    }));
  });

  it("cancela sem efeito de domínio", async () => {
    const result = await completeWhatsappMealIntentDecisionCallback({
      userId: 899003,
      pendingOperation: buildPending(),
      action: "cancel",
    });

    expect(result.action).toBe("meal_intent_decision_cancelled");
    expect(result.reply).toContain("Nada foi registrado");
  });

  it("consome callback uma única vez e bloqueia repetição", async () => {
    const receivedAt = new Date("2026-07-23T22:02:00.000Z");
    const created = await createWhatsappMealIntentDecisionInteraction({
      userId: 899004,
      originalText: "jantar com arroz, feijão e frango",
      messageId: "wamid.issue-899-once",
      receivedAt,
    });
    const primary = created.interactiveReply?.messages[0];
    if (!primary || primary.type !== "buttons") {
      throw new Error("Interação de botões não criada.");
    }
    const suggestionCallbackId = primary.buttons[1]?.id;
    if (!suggestionCallbackId) {
      throw new Error("Callback de sugestão não criado.");
    }

    const first = await resolveWhatsAppPrecedenceGate({
      userId: 899004,
      interactiveReplyId: suggestionCallbackId,
      receivedAt: new Date(receivedAt.getTime() + 1000),
      userTimezone: "America/Sao_Paulo",
    });
    const repeated = await resolveWhatsAppPrecedenceGate({
      userId: 899004,
      interactiveReplyId: suggestionCallbackId,
      receivedAt: new Date(receivedAt.getTime() + 2000),
      userTimezone: "America/Sao_Paulo",
    });

    expect(first.step).toBe("interactive_callback");
    expect(first.step === "interactive_callback" ? first.result.action : null).toBe(
      "meal_intent_decision_suggestion"
    );
    expect(repeated.step).toBe("interactive_callback");
    expect(
      repeated.step === "interactive_callback" ? repeated.result.eventType : null
    ).toBe("whatsapp.interactive_callback.unavailable");
  });
});
