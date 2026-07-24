import { describe, expect, it } from "vitest";

import type { WhatsAppPendingOperationRecord } from "../../repositories/whatsappPendingOperationRepository";
import { executeWhatsappTextIntent } from "./intentActions";
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

function getButtonTitles(interactiveReply: unknown) {
  const primary = (interactiveReply as {
    messages?: Array<{
      type: string;
      buttons?: Array<{ title: string }>;
    }>;
  } | null)?.messages?.[0];
  return primary?.type === "buttons"
    ? primary.buttons?.map(button => button.title) ?? []
    : [];
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

  it.each([
    {
      label: "webhook textual",
      userId: 899101,
      text: "1 xícara de café com açúcar",
      messageId: "wamid.issue-899-text",
      entrypoint: undefined,
    },
    {
      label: "áudio transcrito",
      userId: 899102,
      text: "200 ml café com açúcar",
      messageId: "wamid.issue-899-audio",
      entrypoint: "audioTranscription" as const,
    },
    {
      label: "simulador",
      userId: 899103,
      text: "jantar leve com ovo",
      messageId: undefined,
      entrypoint: undefined,
    },
  ])("roteia $label pelo construtor persistente antes da LLM", async scenario => {
    const result = await executeWhatsappTextIntent(scenario.userId, {
      text: scenario.text,
      messageId: scenario.messageId,
      entrypoint: scenario.entrypoint,
      receivedAt: new Date("2026-07-23T22:00:30.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result).toEqual(expect.objectContaining({
      action: "clarification_needed",
      eventType: "whatsapp.meal_intent_decision.requested",
      reply: MEAL_INTENT_DECISION_PROMPT,
      data: expect.objectContaining({
        interactionId: MEAL_INTENT_DECISION_INTERACTION_ID,
        originalTextPreserved: true,
      }),
    }));
    expect(getButtonTitles(result?.interactiveReply)).toEqual([
      "Registrar",
      "Receber sugestão",
      "Cancelar",
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
    expect(classifyMealIntentDecisionText(target, "Registrar alimento")).toBe(
      "resolve"
    );
    expect(classifyMealIntentDecisionText(target, "2")).toBe("resolve");
    expect(classifyMealIntentDecisionText(target, "talvez")).toBe("invalid");
  });

  it("retoma o texto original ao registrar sem abrir a clarificação genérica", async () => {
    const result = await completeWhatsappMealIntentDecisionCallback({
      userId: 899005,
      pendingOperation: buildPending(
        buildTarget("200 ml café com açúcar")
      ),
      action: "register",
      receivedAt: new Date("2026-07-23T22:03:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result.reply).not.toContain(
      "registrar um alimento, corrigir uma refeição ou consultar"
    );
    expect(result.eventType).not.toBe("whatsapp.intent_clarification.requested");
    expect(result.data).toEqual(expect.objectContaining({
      originalTextPreserved: true,
      originalTextResumed: true,
      ambiguityReclassified: false,
    }));
  });

  it("resolve Registrar alimento pela pendência específica e não pelo menu genérico", async () => {
    const receivedAt = new Date("2026-07-23T22:04:00.000Z");
    await createWhatsappMealIntentDecisionInteraction({
      userId: 899006,
      originalText: "1 xícara de café com açúcar",
      messageId: "wamid.issue-899-register-text",
      receivedAt,
    });

    const result = await resolveWhatsAppPrecedenceGate({
      userId: 899006,
      text: "Registrar alimento",
      receivedAt: new Date(receivedAt.getTime() + 1000),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result.step).toBe("pending_interaction");
    if (result.step !== "pending_interaction") throw new Error("unreachable");
    expect(result.result.reply).not.toContain(
      "registrar um alimento, corrigir uma refeição ou consultar"
    );
    expect(result.result.eventType).not.toBe(
      "whatsapp.intent_clarification.requested"
    );
    expect(result.result.data).toEqual(expect.objectContaining({
      originalTextPreserved: true,
      originalTextResumed: true,
    }));
  });

  it("reapresenta as mesmas ações após resposta incompatível sem duplicar a pendência", async () => {
    const receivedAt = new Date("2026-07-23T22:05:00.000Z");
    await createWhatsappMealIntentDecisionInteraction({
      userId: 899007,
      originalText: "jantar com arroz, feijão e frango",
      messageId: "wamid.issue-899-invalid",
      receivedAt,
    });

    const invalid = await resolveWhatsAppPrecedenceGate({
      userId: 899007,
      text: "talvez",
      receivedAt: new Date(receivedAt.getTime() + 1000),
      userTimezone: "America/Sao_Paulo",
    });

    expect(invalid.step).toBe("pending_interaction");
    if (invalid.step !== "pending_interaction") throw new Error("unreachable");
    expect(getButtonTitles(invalid.result.interactiveReply)).toEqual([
      "Registrar",
      "Receber sugestão",
      "Cancelar",
    ]);
    expect(invalid.result.data).toEqual(expect.objectContaining({
      interactionId: MEAL_INTENT_DECISION_INTERACTION_ID,
      interactionLifecycle: "represented",
    }));

    const valid = await resolveWhatsAppPrecedenceGate({
      userId: 899007,
      text: "Cancelar",
      receivedAt: new Date(receivedAt.getTime() + 2000),
      userTimezone: "America/Sao_Paulo",
    });
    expect(valid.step).toBe("pending_interaction");
    if (valid.step !== "pending_interaction") throw new Error("unreachable");
    expect(valid.result.eventType).toBe(
      "whatsapp.meal_intent_decision.cancelled"
    );
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

describe("mealIntentDecisionInteraction isolation", () => {
  it("mantém decisões iguais isoladas por usuário", async () => {
    const receivedAt = new Date("2026-07-24T22:10:00.000Z");
    await createWhatsappMealIntentDecisionInteraction({
      userId: 899301,
      originalText: "jantar com arroz e feijão",
      receivedAt,
    });
    await createWhatsappMealIntentDecisionInteraction({
      userId: 899302,
      originalText: "jantar com arroz e feijão",
      receivedAt,
    });

    const first = await resolveWhatsAppPrecedenceGate({
      userId: 899301,
      text: "Cancelar",
      receivedAt: new Date(receivedAt.getTime() + 1000),
      userTimezone: "America/Sao_Paulo",
    });
    const second = await resolveWhatsAppPrecedenceGate({
      userId: 899302,
      text: "talvez",
      receivedAt: new Date(receivedAt.getTime() + 1000),
      userTimezone: "America/Sao_Paulo",
    });

    expect(first.step).toBe("pending_interaction");
    expect(second.step).toBe("pending_interaction");
    if (second.step !== "pending_interaction") throw new Error("unreachable");
    expect(second.result.eventType).toBe("whatsapp.interaction.pending_represented");
  });
});
