import { beforeEach, describe, expect, it } from "vitest";
import type { WhatsappInterpretedIntent } from "./intentSchema";
import {
  __resetWhatsappContextMemoryForTests,
  deactivateWhatsappContextMemory,
  listWhatsappContextMemories,
  listWhatsappMemoryUsage,
  recordWhatsappContextMemory,
  recordWhatsappMemoryFromFeedback,
  recordWhatsappMemoryUsage,
  retrieveWhatsappContextMemory,
} from "./contextMemory";
import {
  __resetWhatsappFeedbackForTests,
  recordWhatsappUserFeedback,
} from "./feedbackLoop";
import {
  __resetWhatsappMessageHistoryForTests,
  recordWhatsappMessageHistory,
} from "./messageHistory";

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

function recordMealHistory() {
  return recordWhatsappMessageHistory({
    userId: 42,
    messageText: "registre 100g de arroz",
    intent: buildIntent({
      intent: "add_foods_to_meal",
      confidence: 0.91,
      requiresConfirmation: false,
      possibleIntents: [],
      meal: { label: "almoco", createIfMissing: true },
      items: [{ foodName: "arroz", quantity: 100, unit: "g" }],
    }),
    validationStatus: "valid",
    action: "llm_intent_add_foods_to_meal",
    replyKind: "executed",
    persisted: { happened: true, kind: "meal", ids: [10] },
  });
}

describe("whatsapp context memory", () => {
  beforeEach(() => {
    __resetWhatsappContextMemoryForTests();
    __resetWhatsappFeedbackForTests();
    __resetWhatsappMessageHistoryForTests();
  });

  it("cria memoria individual a partir de alias informado por feedback", () => {
    const feedback = recordWhatsappUserFeedback({
      userId: 42,
      text: "sempre que eu falar cafe lor e capsula L'Or",
      createdAt: new Date("2026-06-16T12:00:00.000Z"),
    });

    const memory = recordWhatsappMemoryFromFeedback(feedback);
    const retrieval = retrieveWhatsappContextMemory({
      userId: 42,
      text: "registra cafe lor no lanche",
      intent: "add_foods_to_meal",
      now: new Date("2026-06-16T12:01:00.000Z"),
    });

    expect(memory).toEqual(expect.objectContaining({
      scope: "individual",
      kind: "individual_alias",
      userId: 42,
      key: "cafe lor",
      value: "capsula L'Or",
      status: "active",
    }));
    expect(retrieval.memories).toHaveLength(1);
    expect(retrieval.llmContext[0]).toEqual(expect.objectContaining({
      id: memory?.id,
      kind: "individual_alias",
      scope: "individual",
      key: "cafe lor",
    }));
    expect(retrieval.audit.consultedMemoryIds).toEqual([memory?.id]);
  });

  it("recupera alias global aprovado quando relevante", () => {
    const globalAlias = recordWhatsappContextMemory({
      scope: "global",
      kind: "global_alias",
      key: "toddynho zero",
      value: "bebida achocolatada sem acucar cadastrada",
      confidence: 0.88,
      appliesToIntents: ["add_foods_to_meal"],
      source: { sourceType: "global_rule", ruleVersion: "global-food-alias/v1" },
      expiresAt: null,
      createdAt: new Date("2026-06-16T12:00:00.000Z"),
    });

    const retrieval = retrieveWhatsappContextMemory({
      userId: 42,
      text: "tomei toddynho zero",
      intent: "add_foods_to_meal",
      now: new Date("2026-06-16T12:05:00.000Z"),
    });

    expect(retrieval.memories).toEqual([globalAlias]);
    expect(retrieval.audit.consultedRuleIds).toEqual([globalAlias.id]);
    expect(retrieval.llmContext).toHaveLength(1);
  });

  it("prioriza memoria individual quando conflita com regra global generica", () => {
    const globalRule = recordWhatsappContextMemory({
      scope: "global",
      kind: "global_alias",
      key: "shake",
      value: "suplemento proteico generico",
      confidence: 0.92,
      expiresAt: null,
    });
    const personalAlias = recordWhatsappContextMemory({
      userId: 42,
      scope: "individual",
      kind: "global_alias",
      key: "shake",
      value: "vitamina caseira de banana",
      confidence: 0.75,
    });

    const retrieval = retrieveWhatsappContextMemory({
      userId: 42,
      text: "shake",
      intent: "add_foods_to_meal",
    });

    expect(retrieval.memories.map(memory => memory.id)).toEqual([personalAlias.id]);
    expect(retrieval.audit.conflicts).toEqual([expect.objectContaining({
      winningMemoryId: personalAlias.id,
      suppressedMemoryId: globalRule.id,
      reason: "Memoria individual tem prioridade sobre regra global generica.",
    })]);
  });

  it("ignora memoria expirada, desativada ou substituida", () => {
    const expired = recordWhatsappContextMemory({
      userId: 42,
      scope: "individual",
      kind: "individual_preference",
      key: "lanche",
      value: "prefere iogurte natural",
      expiresAt: new Date("2026-06-15T00:00:00.000Z"),
    });
    const disabled = recordWhatsappContextMemory({
      userId: 42,
      scope: "individual",
      kind: "individual_alias",
      key: "pre treino",
      value: "banana",
    });
    deactivateWhatsappContextMemory({ memoryId: disabled.id, reason: "usuario removeu preferencia" });
    const oldAlias = recordWhatsappContextMemory({
      userId: 42,
      scope: "individual",
      kind: "individual_alias",
      key: "cafe",
      value: "cafe com leite",
    });
    const newAlias = recordWhatsappContextMemory({
      userId: 42,
      scope: "individual",
      kind: "individual_alias",
      key: "cafe",
      value: "cafe sem acucar",
      replacesMemoryId: oldAlias.id,
    });

    const retrieval = retrieveWhatsappContextMemory({
      userId: 42,
      text: "cafe lanche pre treino",
      now: new Date("2026-06-16T00:00:00.000Z"),
    });

    expect(listWhatsappContextMemories({ status: "replaced" })).toEqual([expect.objectContaining({ id: oldAlias.id })]);
    expect(listWhatsappContextMemories({ status: "inactive" })).toEqual([expect.objectContaining({ id: disabled.id })]);
    expect(retrieval.memories.map(memory => memory.id)).toEqual([newAlias.id]);
    expect(retrieval.audit.omittedMemoryIds).not.toContain(expired.id);
  });

  it("mantem conhecimento candidato em revisao fora do contexto operacional", () => {
    const target = recordMealHistory();
    const feedback = recordWhatsappUserFeedback({
      userId: 42,
      targetHistoryId: target.id,
      text: "nao era arroz, era batata",
    });

    const candidate = recordWhatsappMemoryFromFeedback(feedback);
    const retrieval = retrieveWhatsappContextMemory({ userId: 42, text: "arroz", intent: "add_foods_to_meal" });

    expect(candidate).toEqual(expect.objectContaining({
      scope: "candidate_global",
      kind: "candidate_knowledge",
      status: "needs_review",
    }));
    expect(retrieval.memories).toHaveLength(0);
  });

  it("limita contexto enviado para LLM e registra auditoria de uso", () => {
    const first = recordWhatsappContextMemory({
      userId: 42,
      scope: "individual",
      kind: "individual_preference",
      key: "preferencia 1",
      value: "prefere porcoes pequenas no jantar",
    });
    const second = recordWhatsappContextMemory({
      userId: 42,
      scope: "individual",
      kind: "individual_preference",
      key: "preferencia 2",
      value: "costuma tomar cafe sem acucar",
    });

    const retrieval = retrieveWhatsappContextMemory({
      userId: 42,
      maxItems: 2,
      maxContextChars: 120,
      now: new Date("2026-06-16T12:00:00.000Z"),
    });
    const usage = recordWhatsappMemoryUsage({
      userId: 42,
      historyId: 99,
      intent: "add_foods_to_meal",
      retrieval,
      createdAt: new Date("2026-06-16T12:00:01.000Z"),
    });

    expect(retrieval.memories.map(memory => memory.id)).toEqual([first.id, second.id]);
    expect(retrieval.llmContext.length).toBeLessThanOrEqual(1);
    expect(usage).toEqual(expect.objectContaining({
      userId: 42,
      historyId: 99,
      consultedMemoryIds: [first.id, second.id],
      contextVersion: "whatsapp-context-memory/v1",
    }));
    expect(listWhatsappMemoryUsage()).toEqual([usage]);
  });
});
