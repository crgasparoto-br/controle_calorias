import type { WhatsAppPendingOperationRecord } from "../../repositories/whatsappPendingOperationRepository";
import { executeWhatsappDeleteIntent } from "./deleteIntent";
import { handleWhatsappFoodClarification } from "./foodClarification";
import {
  isCompleteWhatsappCommand,
  isPendingFoodClarificationTarget,
  parseFoodClarificationQuantityReply,
  parseFoodClarificationSelectionReply,
} from "./foodClarificationContract";
import { attachWhatsappFoodClarificationPresentation } from "./foodClarificationPresentation";
import { getCurrentWhatsappInboundExternalMessageId } from "./inboundCorrelationContext";
import {
  parseIntentClarificationTextAction,
  resolveWhatsappIntentClarificationText,
} from "./intentClarificationInteraction";
import { claimWhatsAppTextPendingOperation } from "./interactiveCallback";
import { resolveTextMealItemSelection } from "./mealItemSelectionCallback";
import {
  completeWhatsappPeriodReportCallback,
  PENDING_PERIOD_REPORT_TYPE,
  WHATSAPP_PERIOD_REPORT_OPTIONS,
} from "./periodReportClarification";
import type { WhatsAppLogicalReply } from "./replyContract";
import {
  isStandaloneWhatsappCancellationWord,
  isStandaloneWhatsappConfirmationWord,
  normalizeStandaloneWhatsappCommand,
} from "./standaloneCommandWords";
import {
  completeWhatsappGenericConfirmationCallback,
  handlePendingWhatsAppConfirmation,
  PENDING_CONFIRMATION_TYPE,
} from "./webhookTextCommands";
import type { WhatsAppWebhookMessage } from "./webhookUtils";

const PENDING_PROFESSIONAL_ACCESS_TYPE = "professional_access";

export type WhatsappInteractionTextClassification = "resolve" | "invalid";

export type WhatsappInteractionTextResult = {
  handled: true;
  action: string;
  reply: string;
  eventType: string;
  detail: string;
  data?: Record<string, unknown>;
  interactiveReply?: WhatsAppLogicalReply;
};

export type WhatsappInteractionTextInput = {
  userId: number;
  pendingOperation: WhatsAppPendingOperationRecord;
  text?: string | null;
  receivedAt?: Date;
  userTimezone: string;
  messageId?: string | null;
};

type ResolvedInteractionLike = {
  handled?: boolean;
  action?: string;
  reply: string;
  eventType: string;
  detail: string;
  data?: Record<string, unknown>;
  interactiveReply?: WhatsAppLogicalReply;
};

function normalizeResolvedInteraction(
  value: ResolvedInteractionLike,
  fallbackAction: string,
): WhatsappInteractionTextResult {
  return {
    ...value,
    handled: true,
    action: value.action ?? fallbackAction,
  };
}

function parseBareIndex(text: string) {
  const normalized = normalizeStandaloneWhatsappCommand(text);
  const ordinalWords: Record<string, number> = {
    primeiro: 0,
    primeira: 0,
    segundo: 1,
    segunda: 1,
    terceiro: 2,
    terceira: 2,
    quarto: 3,
    quarta: 3,
    quinto: 4,
    quinta: 4,
  };
  if (normalized in ordinalWords) return ordinalWords[normalized];
  const match = normalized.match(/^(?:opcao\s*)?(\d{1,2})$/);
  return match ? Number(match[1]) - 1 : null;
}

function normalizePeriodLabel(value: string) {
  return normalizeStandaloneWhatsappCommand(value)
    .replace(/\b(?:de|da|do)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePeriodAction(text: string) {
  const normalized = normalizePeriodLabel(text);
  if (isStandaloneWhatsappCancellationWord(normalized)) return "cancel";
  return WHATSAPP_PERIOD_REPORT_OPTIONS.find(option => {
    const token = option.action.replace("period:", "");
    const canonical = new Set([
      normalizePeriodLabel(token),
      normalizePeriodLabel(option.title),
      normalizePeriodLabel(option.intentText),
    ]);
    return canonical.has(normalized);
  })?.action ?? null;
}

function parseScopeAction(text: string) {
  const normalized = normalizeStandaloneWhatsappCommand(text);
  if (isStandaloneWhatsappCancellationWord(normalized)) return "cancel";
  if (/^(?:apenas|somente|so)(?:\s+compativeis)?$/.test(normalized) || normalized === "1") return "confirm";
  if (/^(?:todos|todas)(?:\s+recentes)?$/.test(normalized) || normalized === "2") return "confirm_all";
  return null;
}

function parseConfirmationAction(text: string) {
  const normalized = normalizeStandaloneWhatsappCommand(text);
  if (isStandaloneWhatsappCancellationWord(normalized)) return "cancel";
  if (isStandaloneWhatsappConfirmationWord(normalized)) return "confirm";
  return null;
}

export function classifyDeleteText(target: unknown, text?: string | null): WhatsappInteractionTextClassification {
  const raw = text?.trim() ?? "";
  const normalized = normalizeStandaloneWhatsappCommand(raw);
  const pending = target as { kind?: string; candidates?: unknown[] };
  if (isStandaloneWhatsappCancellationWord(normalized)) return "resolve";
  if (pending?.kind === "selection") {
    const index = parseBareIndex(raw);
    return index !== null && index >= 0 && index < (pending.candidates?.length ?? 0) ? "resolve" : "invalid";
  }
  return isStandaloneWhatsappConfirmationWord(normalized) ? "resolve" : "invalid";
}

export async function resolveDeleteText(input: WhatsappInteractionTextInput) {
  const resolved = await executeWhatsappDeleteIntent(input.userId, {
    text: input.text,
    receivedAt: input.receivedAt,
    timeZone: input.userTimezone,
    entrypoint: "pendingInteractionGate",
  });
  return resolved ? normalizeResolvedInteraction(resolved, "delete_intent_resolved") : null;
}

export function classifyMealItemSelectionText(target: unknown, text?: string | null): WhatsappInteractionTextClassification {
  const raw = text?.trim() ?? "";
  const normalized = normalizeStandaloneWhatsappCommand(raw);
  const pending = target as { candidates?: unknown[] };
  if (isStandaloneWhatsappCancellationWord(normalized)) return "resolve";
  const index = parseBareIndex(raw);
  return index !== null && index >= 0 && index < (pending.candidates?.length ?? 0) ? "resolve" : "invalid";
}

export async function resolveMealItemSelectionText(input: WhatsappInteractionTextInput) {
  const resolved = await resolveTextMealItemSelection(input.userId, input.text);
  return resolved ? normalizeResolvedInteraction(resolved, "meal_item_selection_resolved") : null;
}

function parseGenericConfirmationAction(target: unknown, text?: string | null) {
  const pending = target as { decision?: string };
  return pending.decision === "reclassify_scope"
    ? parseScopeAction(text ?? "")
    : parseConfirmationAction(text ?? "");
}

export function classifyGenericConfirmationText(target: unknown, text?: string | null): WhatsappInteractionTextClassification {
  return parseGenericConfirmationAction(target, text) ? "resolve" : "invalid";
}

export async function resolveGenericConfirmationText(input: WhatsappInteractionTextInput) {
  const target = input.pendingOperation.target as { decision?: string };
  if (target.decision !== "reclassify_scope") {
    const message: WhatsAppWebhookMessage = { text: { body: input.text ?? "" } };
    const completed = await handlePendingWhatsAppConfirmation(message, input.userId);
    return completed ? normalizeResolvedInteraction(completed, "confirmation_resolved") : null;
  }

  const action = parseScopeAction(input.text ?? "");
  if (!action) return null;
  const claim = await claimWhatsAppTextPendingOperation(
    input.userId,
    PENDING_CONFIRMATION_TYPE,
    action,
    input.receivedAt,
  );
  if (claim.status !== "claimed") return null;
  const completed = await completeWhatsappGenericConfirmationCallback(
    input.userId,
    claim.pendingOperation,
    action,
  );
  return normalizeResolvedInteraction(
    completed,
    action === "cancel" ? "confirmation_cancelled" : "confirmation_resolved",
  );
}

export function classifyPeriodReportText(_target: unknown, text?: string | null): WhatsappInteractionTextClassification {
  return parsePeriodAction(text ?? "") ? "resolve" : "invalid";
}

export async function resolvePeriodReportText(input: WhatsappInteractionTextInput) {
  const action = parsePeriodAction(input.text ?? "");
  if (!action) return null;
  const claim = await claimWhatsAppTextPendingOperation(
    input.userId,
    PENDING_PERIOD_REPORT_TYPE,
    action,
    input.receivedAt,
  );
  if (claim.status !== "claimed") return null;
  const completed = await completeWhatsappPeriodReportCallback(input.userId, action, input.receivedAt);
  return normalizeResolvedInteraction(completed, action === "cancel" ? "period_report_cancelled" : "period_report");
}

export function classifyIntentClarificationText(_target: unknown, text?: string | null): WhatsappInteractionTextClassification {
  return parseIntentClarificationTextAction(text) ? "resolve" : "invalid";
}

export async function resolveIntentClarificationText(input: WhatsappInteractionTextInput) {
  const completed = await resolveWhatsappIntentClarificationText({
    userId: input.userId,
    pendingOperation: input.pendingOperation,
    text: input.text,
    receivedAt: input.receivedAt,
  });
  return completed ? normalizeResolvedInteraction(completed, "intent_clarification_resolved") : null;
}

export function classifyProfessionalAccessText(_target: unknown, text?: string | null): WhatsappInteractionTextClassification {
  const normalized = normalizeStandaloneWhatsappCommand(text ?? "").toUpperCase();
  return /\b(?:AUTORIZAR|AUTORIZO|APROVAR|APROVO|ACEITAR|ACEITO|NEGAR|NEGO|RECUSAR|RECUSO)\b/.test(normalized)
    ? "resolve"
    : "invalid";
}

export async function resolveProfessionalAccessText(input: WhatsappInteractionTextInput) {
  const service = await import("../professionals/service");
  const decision = service.parseProfessionalAccessWhatsappDecision(input.text ?? "");
  if (!decision) return null;
  const action = decision === "approved" ? "authorize" : "reject";
  const claim = await claimWhatsAppTextPendingOperation(
    input.userId,
    PENDING_PROFESSIONAL_ACCESS_TYPE,
    action,
    input.receivedAt,
  );
  if (claim.status !== "claimed") return null;
  const completed = await service.completeWhatsAppProfessionalAccessCallback(
    input.userId,
    claim.pendingOperation,
    action,
  );
  return normalizeResolvedInteraction(completed, "professional_access_resolved");
}

export function classifyFoodClarificationText(target: unknown, text?: string | null): WhatsappInteractionTextClassification {
  if (!isPendingFoodClarificationTarget(target)) return "invalid";
  if (isStandaloneWhatsappCancellationWord(text)) return "resolve";

  if (target.pendingKind === "quantity") {
    if (parseFoodClarificationQuantityReply(text)) return "resolve";
  } else if (target.pendingKind === "confirmation") {
    if (isStandaloneWhatsappConfirmationWord(text)) return "resolve";
  } else {
    const selection = parseFoodClarificationSelectionReply(text, target.candidates.length);
    if (selection !== null) return "resolve";
  }

  // Respostas incompletas continuam no resolvedor do domínio para produzir a
  // orientação específica. Apenas um novo comando completo é incompatível com
  // a pendência alimentar atual e deve substituí-la no gate central.
  return isCompleteWhatsappCommand(text) ? "invalid" : "resolve";
}

export async function resolveFoodClarificationText(input: WhatsappInteractionTextInput) {
  const foodResult = await handleWhatsappFoodClarification({
    userId: input.userId,
    text: input.text,
    receivedAt: input.receivedAt,
    userTimezone: input.userTimezone,
    messageId: input.messageId?.trim() || getCurrentWhatsappInboundExternalMessageId(),
  });
  const presented = await attachWhatsappFoodClarificationPresentation(
    input.userId,
    foodResult,
    input.receivedAt,
  );
  return presented ? normalizeResolvedInteraction(presented, "food_clarification_resolved") : null;
}
