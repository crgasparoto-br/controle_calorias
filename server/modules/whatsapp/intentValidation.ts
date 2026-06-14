import type { WhatsappAutonomyDecision } from "./autonomyPolicy";
import type { WhatsappIntentValidationStatus } from "./intentAuditLog";
import {
  WHATSAPP_INTENT_CONFIDENCE,
  parseWhatsappInterpretedIntent,
  type WhatsappIntentName,
  type WhatsappInterpretedIntent,
} from "./intentSchema";

export const whatsappPersistentRuntimeIntentNames = [
  "add_foods_to_meal",
  "replace_food_in_meal",
  "edit_food_quantity",
] as const satisfies readonly WhatsappIntentName[];

export type WhatsappBackendValidationStatus = "valid" | "invalid_payload" | "blocked";

export type WhatsappBackendValidationIssueCode =
  | "invalid_schema"
  | "unsupported_persistent_intent"
  | "low_confidence"
  | "autonomy_not_executable"
  | "missing_meal_target"
  | "missing_food_items"
  | "invalid_food_item"
  | "invalid_quantity"
  | "invalid_unit"
  | "missing_replacement_target"
  | "ambiguous_or_non_food";

export type WhatsappBackendValidationIssue = {
  code: WhatsappBackendValidationIssueCode;
  message: string;
};

export type WhatsappBackendValidationResult = {
  valid: boolean;
  status: WhatsappBackendValidationStatus;
  issues: WhatsappBackendValidationIssue[];
  fallbackReason?: string;
  errorCode?: WhatsappBackendValidationIssueCode;
};

type ValidateWhatsappRuntimeIntentForPersistenceInput = {
  intent: WhatsappInterpretedIntent;
  autonomyDecision: WhatsappAutonomyDecision;
  validationStatus: WhatsappIntentValidationStatus;
  allowedIntents?: readonly WhatsappIntentName[];
};

function buildValidationResult(
  status: WhatsappBackendValidationStatus,
  issues: WhatsappBackendValidationIssue[],
): WhatsappBackendValidationResult {
  const firstIssue = issues[0];
  return {
    valid: status === "valid" && issues.length === 0,
    status,
    issues,
    ...(firstIssue ? {
      fallbackReason: "backend_validation_failed",
      errorCode: firstIssue.code,
    } : {}),
  };
}

function hasText(value?: string | null) {
  return Boolean(value?.trim());
}

function hasQuantity(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validateAddFoodsToMeal(intent: WhatsappInterpretedIntent, issues: WhatsappBackendValidationIssue[]) {
  if (!hasText(intent.meal?.label)) {
    issues.push({
      code: "missing_meal_target",
      message: "Preciso saber em qual refeicao devo registrar esse alimento antes de salvar.",
    });
  }

  if (!intent.items.length) {
    issues.push({
      code: "missing_food_items",
      message: "Nao encontrei um alimento claro para registrar. Me envie alimento, quantidade e unidade.",
    });
    return;
  }

  intent.items.forEach(item => {
    if (!hasText(item.foodName)) {
      issues.push({
        code: "invalid_food_item",
        message: "Um dos alimentos interpretados esta sem nome claro. Me envie o alimento novamente.",
      });
    }
    if (!hasQuantity(item.quantity)) {
      issues.push({
        code: "invalid_quantity",
        message: "Preciso de uma quantidade clara para registrar esse alimento com seguranca.",
      });
    }
    if (!hasText(item.unit)) {
      issues.push({
        code: "invalid_unit",
        message: "Preciso da unidade da quantidade, como g, ml, unidade ou fatia, antes de salvar.",
      });
    }
  });
}

function validateReplaceFoodInMeal(intent: WhatsappInterpretedIntent, issues: WhatsappBackendValidationIssue[]) {
  if (!hasText(intent.sourceFood) || !hasText(intent.targetFood)) {
    issues.push({
      code: "missing_replacement_target",
      message: "Preciso saber exatamente qual alimento trocar e qual alimento colocar no lugar.",
    });
  }
}

function validateEditFoodQuantity(intent: WhatsappInterpretedIntent, issues: WhatsappBackendValidationIssue[]) {
  if (!hasText(intent.sourceFood)) {
    issues.push({
      code: "missing_replacement_target",
      message: "Preciso saber qual alimento deve ter a quantidade corrigida.",
    });
  }
  if (!hasQuantity(intent.quantity?.value)) {
    issues.push({
      code: "invalid_quantity",
      message: "Preciso de uma nova quantidade clara antes de alterar o registro.",
    });
  }
  if (!hasText(intent.quantity?.unit)) {
    issues.push({
      code: "invalid_unit",
      message: "Preciso da unidade da nova quantidade antes de alterar o registro.",
    });
  }
}

export function validateWhatsappRuntimeIntentForPersistence(
  input: ValidateWhatsappRuntimeIntentForPersistenceInput,
): WhatsappBackendValidationResult {
  const parsedIntent = parseWhatsappInterpretedIntent(input.intent);
  if (!parsedIntent.success) {
    return buildValidationResult("invalid_payload", [{
      code: "invalid_schema",
      message: "A interpretacao estruturada nao passou pelo schema esperado.",
    }]);
  }

  const intent = parsedIntent.data;
  const issues: WhatsappBackendValidationIssue[] = [];

  if (input.validationStatus !== "valid") {
    issues.push({
      code: "invalid_schema",
      message: "A interpretacao da IA nao foi validada como payload estruturado confiavel.",
    });
  }

  if (!input.autonomyDecision.canExecute) {
    issues.push({
      code: "autonomy_not_executable",
      message: "Essa acao precisa de confirmacao ou revisao antes de ser aplicada.",
    });
  }

  const allowedIntents = input.allowedIntents ?? whatsappPersistentRuntimeIntentNames;
  if (!allowedIntents.includes(intent.intent)) {
    issues.push({
      code: intent.intent === "ambiguous" || intent.intent === "unknown" ? "ambiguous_or_non_food" : "unsupported_persistent_intent",
      message: "Essa mensagem nao foi classificada como uma acao persistente segura.",
    });
  }

  if (intent.confidence < WHATSAPP_INTENT_CONFIDENCE.execute) {
    issues.push({
      code: "low_confidence",
      message: "A interpretacao ficou com baixa confianca. Preciso que voce confirme ou envie mais detalhes.",
    });
  }

  switch (intent.intent) {
    case "add_foods_to_meal":
      validateAddFoodsToMeal(intent, issues);
      break;
    case "replace_food_in_meal":
      validateReplaceFoodInMeal(intent, issues);
      break;
    case "edit_food_quantity":
      validateEditFoodQuantity(intent, issues);
      break;
    default:
      break;
  }

  if (issues.length > 0) {
    return buildValidationResult(input.autonomyDecision.canExecute ? "invalid_payload" : "blocked", issues);
  }

  return buildValidationResult("valid", []);
}
