import { getDb, logPersistenceWarning } from "../../db";
import { createDrizzleWhatsAppPendingOperationRepository } from "../../repositories/whatsappPendingOperationRepository";
import type { WhatsappIntentResult } from "./intent/types";
import {
  getFoodClarificationInteractionId,
  isPendingFoodClarificationTarget,
  PENDING_FOOD_CLARIFICATION_TYPE,
} from "./foodClarificationContract";
import {
  buildWhatsappClosedDecisionReply,
  buildWhatsappInteractionTelemetry,
} from "./interactionPresentation";

const pendingOperationRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

/**
 * Liga o contrato estruturado da #855 ao componente transversal da #858.
 * Perguntas abertas permanecem textuais; confirmação e seleção usam o mesmo
 * pendingOperationId, ações, ordem e rótulos persistidos no target.
 */
export async function attachWhatsappFoodClarificationPresentation(
  userId: number,
  result: WhatsappIntentResult | null,
  receivedAt?: Date,
): Promise<WhatsappIntentResult | null> {
  if (!result?.data) return result;
  const pendingOperationId = typeof result.data.pendingOperationId === "number"
    ? result.data.pendingOperationId
    : null;
  if (!pendingOperationId) return result;

  const active = await pendingOperationRepository.getActivePendingOperation(userId, receivedAt);
  if (!active || active.id !== pendingOperationId || active.type !== PENDING_FOOD_CLARIFICATION_TYPE) {
    return result;
  }
  if (!isPendingFoodClarificationTarget(active.target)) return result;

  const target = active.target;
  const telemetry = buildWhatsappInteractionTelemetry({
    interactionId: getFoodClarificationInteractionId(target.pendingKind),
    origin: active.origin,
    classification: target.classification,
    actions: target.actions,
    lifecycle: result.action === "food_clarification_reprompted" ? "represented" : "created",
    invalidResponseReason: result.action === "food_clarification_reprompted" ? "incompatible_text" : null,
  });

  if (target.classification === "open") {
    return {
      ...result,
      data: { ...result.data, ...telemetry },
    };
  }

  return {
    ...result,
    data: { ...result.data, ...telemetry },
    interactiveReply: buildWhatsappClosedDecisionReply({
      bodyText: result.reply,
      pendingOperationId: active.id,
      actions: target.actions,
    }),
  };
}
