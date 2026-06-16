import {
  buildExpectedWhatsappRegressionActual,
  runWhatsappRegressionCase,
  type WhatsappRegressionActualOutput,
  type WhatsappRegressionCase,
  type WhatsappRegressionIssue,
} from "./regressionDataset";
import type { WhatsappMessageHistoryInputType } from "./messageHistory";

export type WhatsappConversationPendingState = {
  id: string;
  kind: "food_quantity" | "option_selection" | "correction_target" | "professional_confirmation";
  status: "active" | "consumed" | "expired" | "cancelled";
  referenceId: string | null;
  expiresAt?: string | null;
};

export type WhatsappConversationRecordState = {
  id: string;
  kind: "meal" | "water" | "weight" | "none";
  foods: string[];
  mealLabel: string | null;
  localDate: string | null;
  timezone: string | null;
  status: "created" | "updated" | "removed" | "unchanged";
};

export type WhatsappConversationTurn = {
  id: string;
  input: {
    text: string;
    inputType: WhatsappMessageHistoryInputType;
  };
  expectedCase: WhatsappRegressionCase;
  expectedPendingBefore: WhatsappConversationPendingState | null;
  expectedPendingAfter: WhatsappConversationPendingState | null;
};

export type WhatsappConversationRegressionCase = {
  id: string;
  title: string;
  timezone: string;
  critical: boolean;
  turns: WhatsappConversationTurn[];
  expectedFinalState: {
    records: WhatsappConversationRecordState[];
    pending: WhatsappConversationPendingState | null;
    consumedPendingIds: string[];
    blockedUnsafePersistence: boolean;
  };
  reason: string;
};

export type WhatsappConversationRegressionActual = {
  turns: Array<{
    turnId: string;
    output: WhatsappRegressionActualOutput;
    pendingBefore: WhatsappConversationPendingState | null;
    pendingAfter: WhatsappConversationPendingState | null;
  }>;
  finalState: WhatsappConversationRegressionCase["expectedFinalState"];
};

export const WHATSAPP_CONVERSATION_REGRESSION_VERSION = "whatsapp-conversation-regression/v1";

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function regressionCase(input: {
  id: string;
  text: string;
  inputType?: WhatsappMessageHistoryInputType;
  intent: WhatsappRegressionCase["expected"]["intent"];
  action: string;
  persistence: WhatsappRegressionCase["expected"]["persistence"];
  entities?: WhatsappRegressionCase["expected"]["entities"];
  critical?: boolean;
  reason: string;
}): WhatsappRegressionCase {
  return {
    id: input.id,
    category: input.persistence === "save" ? "simple_food_record" : "ambiguous_or_insufficient",
    input: { text: input.text, inputType: input.inputType ?? "text", anonymized: true },
    initialContext: null,
    expected: {
      intent: input.intent,
      schemaVersion: "whatsapp-intent-output/v1",
      entities: input.entities ?? {},
      action: input.action,
      persistence: input.persistence,
    },
    critical: input.critical ?? true,
    reason: input.reason,
    origin: "synthetic",
  };
}

export const whatsappConversationRegressionCases: WhatsappConversationRegressionCase[] = [
  {
    id: "conversation-clarify-food-quantity",
    title: "Registro com baixa quantidade seguido de esclarecimento",
    timezone: "America/Sao_Paulo",
    critical: true,
    turns: [
      {
        id: "turn-ask-quantity",
        input: { text: "comi arroz", inputType: "text" },
        expectedCase: regressionCase({
          id: "conversation-clarify-food-quantity/turn-ask-quantity",
          text: "comi arroz",
          intent: "add_foods_to_meal",
          action: "ask_food_quantity",
          persistence: "ask_clarification",
          entities: { foods: ["arroz"] },
          reason: "Alimento sem quantidade deve criar pendencia em vez de salvar estimativa insegura.",
        }),
        expectedPendingBefore: null,
        expectedPendingAfter: { id: "pending-rice-quantity", kind: "food_quantity", status: "active", referenceId: "draft-rice" },
      },
      {
        id: "turn-answer-quantity",
        input: { text: "100g", inputType: "text" },
        expectedCase: regressionCase({
          id: "conversation-clarify-food-quantity/turn-answer-quantity",
          text: "100g",
          intent: "add_foods_to_meal",
          action: "resolve_pending_food_quantity",
          persistence: "save",
          entities: { foods: ["arroz"], quantity: { value: 100, unit: "g" } },
          reason: "Resposta deve consumir pendencia compativel e salvar o alimento certo.",
        }),
        expectedPendingBefore: { id: "pending-rice-quantity", kind: "food_quantity", status: "active", referenceId: "draft-rice" },
        expectedPendingAfter: { id: "pending-rice-quantity", kind: "food_quantity", status: "consumed", referenceId: "draft-rice" },
      },
    ],
    expectedFinalState: {
      records: [{
        id: "meal-rice",
        kind: "meal",
        foods: ["arroz"],
        mealLabel: null,
        localDate: "2026-06-16",
        timezone: "America/Sao_Paulo",
        status: "created",
      }],
      pending: null,
      consumedPendingIds: ["pending-rice-quantity"],
      blockedUnsafePersistence: true,
    },
    reason: "Valida pendencia criada e consumida entre dois turnos.",
  },
  {
    id: "conversation-option-selection",
    title: "Selecao por numero apos lista de opcoes",
    timezone: "America/Sao_Paulo",
    critical: true,
    turns: [
      {
        id: "turn-ambiguous-brand",
        input: { text: "iogurte zero", inputType: "text" },
        expectedCase: regressionCase({
          id: "conversation-option-selection/turn-ambiguous-brand",
          text: "iogurte zero",
          intent: "ambiguous",
          action: "ask_option_selection",
          persistence: "ask_clarification",
          entities: { foods: ["iogurte zero"] },
          reason: "Produto ambiguo deve pedir selecao antes de persistir.",
        }),
        expectedPendingBefore: null,
        expectedPendingAfter: { id: "pending-yogurt-options", kind: "option_selection", status: "active", referenceId: "food-options-yogurt" },
      },
      {
        id: "turn-select-option",
        input: { text: "2", inputType: "text" },
        expectedCase: regressionCase({
          id: "conversation-option-selection/turn-select-option",
          text: "2",
          intent: "add_foods_to_meal",
          action: "resolve_food_option_selection",
          persistence: "save",
          entities: { foods: ["iogurte zero marca exemplo"], quantity: { value: 1, unit: "unidade" } },
          reason: "Numero seleciona opcao apenas com pendencia ativa compativel.",
        }),
        expectedPendingBefore: { id: "pending-yogurt-options", kind: "option_selection", status: "active", referenceId: "food-options-yogurt" },
        expectedPendingAfter: { id: "pending-yogurt-options", kind: "option_selection", status: "consumed", referenceId: "food-options-yogurt" },
      },
    ],
    expectedFinalState: {
      records: [{
        id: "meal-yogurt",
        kind: "meal",
        foods: ["iogurte zero marca exemplo"],
        mealLabel: null,
        localDate: "2026-06-16",
        timezone: "America/Sao_Paulo",
        status: "created",
      }],
      pending: null,
      consumedPendingIds: ["pending-yogurt-options"],
      blockedUnsafePersistence: true,
    },
    reason: "Valida selecao por opcoes sem aceitar numero solto fora de contexto.",
  },
  {
    id: "conversation-correction-after-record",
    title: "Correcao posterior vinculada ao registro anterior",
    timezone: "America/Sao_Paulo",
    critical: true,
    turns: [
      {
        id: "turn-save-rice",
        input: { text: "almocei arroz", inputType: "text" },
        expectedCase: regressionCase({
          id: "conversation-correction-after-record/turn-save-rice",
          text: "almocei arroz",
          intent: "add_foods_to_meal",
          action: "llm_intent_add_foods_to_meal",
          persistence: "save",
          entities: { foods: ["arroz"], mealLabel: "almoco" },
          reason: "Registro inicial cria alvo corrigivel.",
        }),
        expectedPendingBefore: null,
        expectedPendingAfter: null,
      },
      {
        id: "turn-replace-rice",
        input: { text: "nao era arroz, era batata", inputType: "text" },
        expectedCase: regressionCase({
          id: "conversation-correction-after-record/turn-replace-rice",
          text: "nao era arroz, era batata",
          intent: "replace_food_in_meal",
          action: "llm_intent_replace_food_in_meal",
          persistence: "ask_confirmation",
          entities: { sourceFood: "arroz", targetFood: "batata" },
          reason: "Correcao deve se vincular ao registro anterior antes de alterar.",
        }),
        expectedPendingBefore: null,
        expectedPendingAfter: { id: "pending-replace-rice", kind: "correction_target", status: "active", referenceId: "meal-rice" },
      },
    ],
    expectedFinalState: {
      records: [{
        id: "meal-rice",
        kind: "meal",
        foods: ["arroz"],
        mealLabel: "almoco",
        localDate: "2026-06-16",
        timezone: "America/Sao_Paulo",
        status: "unchanged",
      }],
      pending: { id: "pending-replace-rice", kind: "correction_target", status: "active", referenceId: "meal-rice" },
      consumedPendingIds: [],
      blockedUnsafePersistence: true,
    },
    reason: "Correcao posterior nao altera alvo sem confirmacao segura.",
  },
  {
    id: "conversation-cancel-pending",
    title: "Cancelamento consome pendencia sem persistir",
    timezone: "America/Sao_Paulo",
    critical: true,
    turns: [
      {
        id: "turn-create-pending",
        input: { text: "comi alguma coisa no lanche", inputType: "text" },
        expectedCase: regressionCase({
          id: "conversation-cancel-pending/turn-create-pending",
          text: "comi alguma coisa no lanche",
          intent: "ambiguous",
          action: "ask_clarification",
          persistence: "ask_clarification",
          entities: { mealLabel: "lanche" },
          reason: "Mensagem insuficiente cria pendencia de esclarecimento.",
        }),
        expectedPendingBefore: null,
        expectedPendingAfter: { id: "pending-snack-clarification", kind: "food_quantity", status: "active", referenceId: "draft-snack" },
      },
      {
        id: "turn-cancel",
        input: { text: "cancela", inputType: "text" },
        expectedCase: regressionCase({
          id: "conversation-cancel-pending/turn-cancel",
          text: "cancela",
          intent: "ambiguous",
          action: "cancel_pending_context",
          persistence: "do_not_save",
          reason: "Cancelamento remove pendencia sem persistencia alimentar.",
        }),
        expectedPendingBefore: { id: "pending-snack-clarification", kind: "food_quantity", status: "active", referenceId: "draft-snack" },
        expectedPendingAfter: { id: "pending-snack-clarification", kind: "food_quantity", status: "cancelled", referenceId: "draft-snack" },
      },
    ],
    expectedFinalState: {
      records: [],
      pending: null,
      consumedPendingIds: ["pending-snack-clarification"],
      blockedUnsafePersistence: true,
    },
    reason: "Cancelamento nao deve deixar pendencia ativa nem criar registro.",
  },
  {
    id: "conversation-relative-date-timezone",
    title: "Data relativa usa fuso horario do usuario",
    timezone: "America/Sao_Paulo",
    critical: true,
    turns: [
      {
        id: "turn-yesterday-dinner",
        input: { text: "ontem no jantar comi sopa", inputType: "text" },
        expectedCase: regressionCase({
          id: "conversation-relative-date-timezone/turn-yesterday-dinner",
          text: "ontem no jantar comi sopa",
          intent: "add_foods_to_meal",
          action: "llm_intent_add_foods_to_meal",
          persistence: "save",
          entities: { foods: ["sopa"], mealLabel: "jantar" },
          reason: "Data relativa deve ser interpretada no fuso configurado.",
        }),
        expectedPendingBefore: null,
        expectedPendingAfter: null,
      },
    ],
    expectedFinalState: {
      records: [{
        id: "meal-yesterday-soup",
        kind: "meal",
        foods: ["sopa"],
        mealLabel: "jantar",
        localDate: "2026-06-15",
        timezone: "America/Sao_Paulo",
        status: "created",
      }],
      pending: null,
      consumedPendingIds: [],
      blockedUnsafePersistence: true,
    },
    reason: "Evita fixar fuso global para data relativa.",
  },
  {
    id: "conversation-expired-pending-selection",
    title: "Resposta a pendencia expirada nao aplica acao antiga",
    timezone: "America/Sao_Paulo",
    critical: true,
    turns: [
      {
        id: "turn-expired-answer",
        input: { text: "opcao 2", inputType: "multi_turn" },
        expectedCase: regressionCase({
          id: "conversation-expired-pending-selection/turn-expired-answer",
          text: "opcao 2",
          inputType: "multi_turn",
          intent: "ambiguous",
          action: "expired_context_ask_new_selection",
          persistence: "ask_clarification",
          entities: { quantity: { value: 2, unit: "unknown" } },
          reason: "Pendencia expirada deve pedir nova selecao.",
        }),
        expectedPendingBefore: { id: "pending-old-options", kind: "option_selection", status: "expired", referenceId: "old-options" },
        expectedPendingAfter: { id: "pending-old-options", kind: "option_selection", status: "expired", referenceId: "old-options" },
      },
    ],
    expectedFinalState: {
      records: [],
      pending: null,
      consumedPendingIds: [],
      blockedUnsafePersistence: true,
    },
    reason: "Resposta a lista expirada nao pode aplicar selecao antiga.",
  },
];

function issue(input: Omit<WhatsappRegressionIssue, "caseId">, caseId: string): WhatsappRegressionIssue {
  return { ...input, caseId };
}

function samePending(expected: WhatsappConversationPendingState | null, actual: WhatsappConversationPendingState | null) {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

function sameRecords(expected: WhatsappConversationRecordState[], actual: WhatsappConversationRecordState[]) {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

export function validateWhatsappConversationRegressionCoverage(cases: WhatsappConversationRegressionCase[] = whatsappConversationRegressionCases) {
  const issues: WhatsappRegressionIssue[] = [];
  const ids = new Set(cases.map(testCase => testCase.id));
  const required = [
    "conversation-clarify-food-quantity",
    "conversation-option-selection",
    "conversation-correction-after-record",
    "conversation-cancel-pending",
    "conversation-relative-date-timezone",
    "conversation-expired-pending-selection",
  ];

  for (const id of required) {
    if (!ids.has(id)) {
      issues.push(issue({
        field: "coverage.case",
        severity: "blocking",
        expected: id,
        actual: [...ids],
        message: "Cenario multi-turn obrigatorio ausente.",
      }, "conversation-regression-coverage"));
    }
  }

  if (!cases.some(testCase => testCase.expectedFinalState.records.some(record => record.timezone === testCase.timezone))) {
    issues.push(issue({
      field: "coverage.timezone",
      severity: "blocking",
      expected: "registro final com timezone do usuario",
      actual: cases.map(testCase => testCase.timezone),
      message: "Suite multi-turn precisa cobrir fuso horario do usuario.",
    }, "conversation-regression-coverage"));
  }

  return issues;
}

export function runWhatsappConversationRegressionCase(
  testCase: WhatsappConversationRegressionCase,
  actual: WhatsappConversationRegressionActual,
) {
  const issues: WhatsappRegressionIssue[] = [];

  if (actual.turns.length !== testCase.turns.length) {
    issues.push(issue({
      field: "turns.length",
      severity: "blocking",
      expected: testCase.turns.length,
      actual: actual.turns.length,
      message: "Quantidade de turnos processados mudou.",
    }, testCase.id));
  }

  for (const [index, expectedTurn] of testCase.turns.entries()) {
    const actualTurn = actual.turns[index];
    if (!actualTurn) continue;

    if (actualTurn.turnId !== expectedTurn.id) {
      issues.push(issue({
        field: "turn.id",
        severity: "blocking",
        expected: expectedTurn.id,
        actual: actualTurn.turnId,
        message: "Ordem ou identificador de turno mudou.",
      }, testCase.id));
    }

    issues.push(...runWhatsappRegressionCase(expectedTurn.expectedCase, actualTurn.output));

    if (!samePending(expectedTurn.expectedPendingBefore, actualTurn.pendingBefore)) {
      issues.push(issue({
        field: `${expectedTurn.id}.pendingBefore`,
        severity: "blocking",
        expected: expectedTurn.expectedPendingBefore,
        actual: actualTurn.pendingBefore,
        message: "Estado pendente antes do turno mudou.",
      }, testCase.id));
    }

    if (!samePending(expectedTurn.expectedPendingAfter, actualTurn.pendingAfter)) {
      issues.push(issue({
        field: `${expectedTurn.id}.pendingAfter`,
        severity: "blocking",
        expected: expectedTurn.expectedPendingAfter,
        actual: actualTurn.pendingAfter,
        message: "Estado pendente depois do turno mudou.",
      }, testCase.id));
    }
  }

  if (!sameRecords(testCase.expectedFinalState.records, actual.finalState.records)) {
    issues.push(issue({
      field: "finalState.records",
      severity: testCase.critical ? "blocking" : "review",
      expected: testCase.expectedFinalState.records,
      actual: actual.finalState.records,
      message: "Estado final dos registros afetados mudou.",
    }, testCase.id));
  }

  if (!samePending(testCase.expectedFinalState.pending, actual.finalState.pending)) {
    issues.push(issue({
      field: "finalState.pending",
      severity: "blocking",
      expected: testCase.expectedFinalState.pending,
      actual: actual.finalState.pending,
      message: "Pendencia final da conversa mudou.",
    }, testCase.id));
  }

  if (JSON.stringify(testCase.expectedFinalState.consumedPendingIds) !== JSON.stringify(actual.finalState.consumedPendingIds)) {
    issues.push(issue({
      field: "finalState.consumedPendingIds",
      severity: "blocking",
      expected: testCase.expectedFinalState.consumedPendingIds,
      actual: actual.finalState.consumedPendingIds,
      message: "Pendencias consumidas pela conversa mudaram.",
    }, testCase.id));
  }

  if (actual.finalState.blockedUnsafePersistence !== testCase.expectedFinalState.blockedUnsafePersistence) {
    issues.push(issue({
      field: "finalState.blockedUnsafePersistence",
      severity: "blocking",
      expected: testCase.expectedFinalState.blockedUnsafePersistence,
      actual: actual.finalState.blockedUnsafePersistence,
      message: "Guarda contra persistencia insegura mudou.",
    }, testCase.id));
  }

  return issues;
}

export function buildExpectedWhatsappConversationActual(testCase: WhatsappConversationRegressionCase): WhatsappConversationRegressionActual {
  return {
    turns: testCase.turns.map(turn => ({
      turnId: turn.id,
      output: buildExpectedWhatsappRegressionActual(turn.expectedCase),
      pendingBefore: cloneValue(turn.expectedPendingBefore),
      pendingAfter: cloneValue(turn.expectedPendingAfter),
    })),
    finalState: cloneValue(testCase.expectedFinalState),
  };
}
