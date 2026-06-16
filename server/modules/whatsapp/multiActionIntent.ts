import { validateWhatsappRuntimeIntentForPersistence, type WhatsappBackendValidationIssue } from "./intentValidation";
import type { WhatsappInterpretedIntent } from "./intentSchema";

export type WhatsappMultiActionType =
  | "adicionar_alimento"
  | "trocar_alimento"
  | "corrigir_alimento"
  | "excluir_alimento"
  | "somar_quantidade";

export type WhatsappMultiActionValidationStatus =
  | "needs_confirmation"
  | "needs_clarification"
  | "blocked";

type ExtractedActionDraft = {
  actionType: WhatsappMultiActionType;
  sourceText: string;
  sourceFood?: string;
  targetFood?: string;
  itemName?: string;
  itemNames?: string[];
  quantity?: number;
  unit?: string;
  mealLabel?: string;
  dependsOnActionIds?: string[];
};

export type WhatsappMultiActionExtractedAction = ExtractedActionDraft & {
  actionId: string;
  order: number;
  validationStatus: WhatsappMultiActionValidationStatus;
  validationIssues: WhatsappBackendValidationIssue[];
  resultStatus: "pending_confirmation" | "needs_clarification" | "not_executed";
};

type WhatsappMultiActionIntentResult = {
  handled: true;
  action: "multi_action_confirmation_needed" | "multi_action_clarification_needed";
  reply: string;
  eventType: "whatsapp.multi_action.confirmation_needed" | "whatsapp.multi_action.clarification_needed";
  detail: string;
  data: {
    originalText: string;
    actionCount: number;
    transactionMode: "all_or_nothing";
    partialSuccessAllowed: false;
    extractedActions: WhatsappMultiActionExtractedAction[];
    validationSummary: {
      pendingConfirmationCount: number;
      needsClarificationCount: number;
      blockedCount: number;
    };
    temporalContext?: Record<string, unknown>;
  };
};

type ExecuteWhatsappMultiActionIntentInput = {
  text?: string | null;
  temporalContext?: Record<string, unknown> | null;
};

const ACTION_SPLIT_RE = /\s+(?:e|depois|entao|então)\s+(?=(?:troca|trocar|substitui|substituir|remove|remover|tira|tirar|retira|retirar|corrige|corrigir|ajusta|ajustar|soma|somar|some|adiciona|adicionar|adicione|inclui|inclua|lança|lanca|registre|registra|não é|nao e|não era|nao era)\b)/gi;
const QUANTITY_RE = /^(\d+(?:[,.]\d+)?)\s*(g|gramas?|kg|ml|l|litros?|unidades?|un|fatia|fatias|colher|colheres)\b/i;

function cleanText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/^[-–—\s]+|[-–—\s]+$/g, "")
    .trim();
}

function removeArticle(value: string) {
  return cleanText(value.replace(/^(?:o|a|os|as|um|uma|uns|umas)\s+/i, ""));
}

function splitPotentialActions(text: string) {
  return text
    .replace(/[;]+/g, ",")
    .replace(ACTION_SPLIT_RE, ",")
    .split(",")
    .map(cleanText)
    .filter(Boolean);
}

function splitItemList(value: string) {
  return value
    .split(/\s*(?:,|\be\b)\s*/i)
    .map(removeArticle)
    .filter(Boolean);
}

function parseQuantity(value: string) {
  const match = value.match(QUANTITY_RE);
  if (!match) {
    return null;
  }
  return {
    quantity: Number(match[1].replace(",", ".")),
    unit: match[2].toLowerCase(),
  };
}

function parseMealFoodListAction(text: string): ExtractedActionDraft | null {
  const match = text.match(/^(?:no|na)\s+(café da manhã|cafe da manha|almoço|almoco|jantar|lanche)\s+(?:foi|foram|era|eram|teve)\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const itemNames = splitItemList(match[2]);
  if (!itemNames.length) {
    return null;
  }

  return {
    actionType: "adicionar_alimento",
    sourceText: text,
    itemName: itemNames.join(", "),
    itemNames,
    mealLabel: match[1],
  };
}

function parseReplaceAction(text: string): ExtractedActionDraft | null {
  const match = text.match(/^(?:troca|trocar|substitui|substituir|não é|nao e|não era|nao era)\s+(.+?)\s+(?:por|é|e|era|e sim)\s+(.+)$/i);
  if (!match) {
    return null;
  }

  return {
    actionType: "trocar_alimento",
    sourceText: text,
    sourceFood: removeArticle(match[1]),
    targetFood: removeArticle(match[2]),
  };
}

function parseCorrectionAction(text: string): ExtractedActionDraft | null {
  const match = text.match(/^(?:corrige|corrigir|ajusta|ajustar)\s+(.+?)\s+(?:para|pra|por|e)\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const quantity = parseQuantity(match[2]);
  if (quantity) {
    return {
      actionType: "corrigir_alimento",
      sourceText: text,
      sourceFood: removeArticle(match[1]),
      quantity: quantity.quantity,
      unit: quantity.unit,
    };
  }

  return {
    actionType: "trocar_alimento",
    sourceText: text,
    sourceFood: removeArticle(match[1]),
    targetFood: removeArticle(match[2]),
  };
}

function parseRemoveAction(text: string): ExtractedActionDraft | null {
  const match = text.match(/^(?:remove|remover|tira|tirar|retira|retirar|apaga|apagar|exclui|excluir)\s+(.+)$/i);
  if (!match) {
    return null;
  }

  return {
    actionType: "excluir_alimento",
    sourceText: text,
    itemName: removeArticle(match[1]),
  };
}

function parseAddAction(text: string): ExtractedActionDraft | null {
  const match = text.match(/^(?:adiciona|adicionar|adicione|inclui|inclua|lança|lanca|registre|registra)\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const itemNames = splitItemList(match[1]);
  return {
    actionType: "adicionar_alimento",
    sourceText: text,
    itemName: itemNames.join(", "),
    itemNames,
  };
}

function parseSumAction(text: string): ExtractedActionDraft | null {
  const match = text.match(/^(?:soma|somar|some)\s+(\d+(?:[,.]\d+)?)\s*(g|gramas?|kg|ml|l|litros?|unidades?|un|fatia|fatias)\b(?:\s+(?:em|no|na|ao|a)\s+(.+))?$/i);
  if (!match) {
    return null;
  }

  return {
    actionType: "somar_quantidade",
    sourceText: text,
    itemName: match[3] ? removeArticle(match[3]) : undefined,
    quantity: Number(match[1].replace(",", ".")),
    unit: match[2].toLowerCase(),
  };
}

function parseAction(text: string): ExtractedActionDraft | null {
  return parseMealFoodListAction(text)
    ?? parseReplaceAction(text)
    ?? parseCorrectionAction(text)
    ?? parseRemoveAction(text)
    ?? parseAddAction(text)
    ?? parseSumAction(text);
}

function buildIntentForValidation(action: ExtractedActionDraft): WhatsappInterpretedIntent | null {
  switch (action.actionType) {
    case "adicionar_alimento":
      return {
        intent: "add_foods_to_meal",
        confidence: 0.82,
        date: null,
        meal: action.mealLabel ? { label: action.mealLabel, createIfMissing: false } : null,
        items: (action.itemNames?.length ? action.itemNames : action.itemName ? [action.itemName] : []).map(foodName => ({
          foodName,
          quantity: action.quantity ?? null,
          unit: action.unit ?? null,
          brand: null,
          preparation: null,
        })),
        sourceFood: null,
        targetFood: null,
        quantity: null,
        requiresConfirmation: true,
        clarificationQuestion: null,
        possibleIntents: [],
        reason: null,
      };
    case "trocar_alimento":
      return {
        intent: "replace_food_in_meal",
        confidence: 0.86,
        date: null,
        meal: null,
        items: [],
        sourceFood: action.sourceFood ?? null,
        targetFood: action.targetFood ?? null,
        quantity: null,
        requiresConfirmation: true,
        clarificationQuestion: null,
        possibleIntents: [],
        reason: null,
      };
    case "corrigir_alimento":
    case "somar_quantidade":
      return {
        intent: "edit_food_quantity",
        confidence: 0.8,
        date: null,
        meal: null,
        items: [],
        sourceFood: action.sourceFood ?? action.itemName ?? null,
        targetFood: null,
        quantity: action.quantity && action.unit ? { value: action.quantity, unit: action.unit } : null,
        requiresConfirmation: true,
        clarificationQuestion: null,
        possibleIntents: [],
        reason: null,
      };
    default:
      return null;
  }
}

function issue(code: WhatsappBackendValidationIssue["code"], message: string): WhatsappBackendValidationIssue {
  return { code, message };
}

function validationStatusFromIssues(issues: WhatsappBackendValidationIssue[]): WhatsappMultiActionValidationStatus {
  if (issues.some(item => item.code !== "autonomy_not_executable")) {
    return "needs_clarification";
  }
  return "needs_confirmation";
}

function validateAction(action: ExtractedActionDraft) {
  if (action.actionType === "excluir_alimento") {
    if (!action.itemName) {
      return {
        validationStatus: "needs_clarification" as const,
        validationIssues: [issue("missing_edit_target", "Preciso saber qual alimento remover antes de alterar o registro.")],
      };
    }
    return {
      validationStatus: "needs_confirmation" as const,
      validationIssues: [issue("autonomy_not_executable", "Essa remoção precisa de confirmação antes de ser aplicada.")],
    };
  }

  const intent = buildIntentForValidation(action);
  if (!intent) {
    return {
      validationStatus: "blocked" as const,
      validationIssues: [issue("unsupported_persistent_intent", "Essa ação ainda não tem execução segura no WhatsApp.")],
    };
  }

  const validation = validateWhatsappRuntimeIntentForPersistence({
    intent,
    validationStatus: "valid",
  });

  return {
    validationStatus: validation.status === "blocked" && validation.issues.every(item => item.code === "autonomy_not_executable")
      ? "needs_confirmation" as const
      : validationStatusFromIssues(validation.issues),
    validationIssues: validation.issues,
  };
}

function formatAction(action: WhatsappMultiActionExtractedAction) {
  switch (action.actionType) {
    case "adicionar_alimento":
      return `Adicionar ${action.itemName ?? "alimento"}${action.mealLabel ? ` em ${action.mealLabel}` : ""}`;
    case "trocar_alimento":
      return `Trocar ${action.sourceFood ?? "item"} por ${action.targetFood ?? "novo item"}`;
    case "corrigir_alimento":
      return `Corrigir ${action.sourceFood ?? "item"} para ${action.quantity ?? "?"} ${action.unit ?? ""}`.trim();
    case "excluir_alimento":
      return `Remover ${action.itemName ?? "item"}`;
    case "somar_quantidade":
      return `Somar ${action.quantity ?? "?"} ${action.unit ?? ""}${action.itemName ? ` em ${action.itemName}` : ""}`.trim();
    default:
      return action.sourceText;
  }
}

function summarizeIssues(action: WhatsappMultiActionExtractedAction) {
  const actionableIssues = action.validationIssues.filter(item => item.code !== "autonomy_not_executable");
  if (!actionableIssues.length) {
    return "pronto para confirmação";
  }
  return actionableIssues.map(item => item.message).join(" ");
}

function buildReply(actions: WhatsappMultiActionExtractedAction[], needsClarification: boolean) {
  const header = needsClarification
    ? `Encontrei ${actions.length} ações, mas preciso ajustar algumas antes de aplicar qualquer coisa:`
    : `Encontrei ${actions.length} ações. Revise antes de eu alterar qualquer registro:`;
  const lines = actions.map(action => `${action.order}. ${formatAction(action)} — ${summarizeIssues(action)}.`);
  const footer = needsClarification
    ? "Envie os detalhes faltantes ou reformule as ações. Nada foi aplicado ainda."
    : "Responda \"sim\" para continuar em modo seguro ou \"cancela\". Nada foi aplicado ainda.";
  return [header, ...lines, footer].join("\n");
}

export function executeWhatsappMultiActionIntent(input: ExecuteWhatsappMultiActionIntentInput): WhatsappMultiActionIntentResult | null {
  const text = cleanText(input.text ?? "");
  if (!text) {
    return null;
  }

  const clauses = splitPotentialActions(text);
  if (clauses.length < 2) {
    return null;
  }

  const parsedActions = clauses.map(parseAction).filter((action): action is ExtractedActionDraft => Boolean(action));
  if (parsedActions.length < 2) {
    return null;
  }

  const extractedActions: WhatsappMultiActionExtractedAction[] = parsedActions.map((action, index) => {
    const validation = validateAction(action);
    return {
      ...action,
      actionId: `multi-${index + 1}`,
      order: index + 1,
      validationStatus: validation.validationStatus,
      validationIssues: validation.validationIssues,
      resultStatus: validation.validationStatus === "needs_confirmation" ? "pending_confirmation" : "needs_clarification",
    };
  });

  const needsClarification = extractedActions.some(action => action.validationStatus !== "needs_confirmation");
  const pendingConfirmationCount = extractedActions.filter(action => action.validationStatus === "needs_confirmation").length;
  const needsClarificationCount = extractedActions.filter(action => action.validationStatus === "needs_clarification").length;
  const blockedCount = extractedActions.filter(action => action.validationStatus === "blocked").length;

  return {
    handled: true,
    action: needsClarification ? "multi_action_clarification_needed" : "multi_action_confirmation_needed",
    reply: buildReply(extractedActions, needsClarification),
    eventType: needsClarification ? "whatsapp.multi_action.clarification_needed" : "whatsapp.multi_action.confirmation_needed",
    detail: needsClarification
      ? "Mensagem com múltiplas ações foi decomposta, mas pelo menos uma ação precisa de esclarecimento antes de qualquer persistência."
      : "Mensagem com múltiplas ações foi decomposta e aguarda confirmação antes de qualquer persistência.",
    data: {
      originalText: text,
      actionCount: extractedActions.length,
      transactionMode: "all_or_nothing",
      partialSuccessAllowed: false,
      extractedActions,
      validationSummary: {
        pendingConfirmationCount,
        needsClarificationCount,
        blockedCount,
      },
      ...(input.temporalContext ? { temporalContext: input.temporalContext } : {}),
    },
  };
}
