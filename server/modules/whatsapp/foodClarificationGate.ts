import { getDb, logPersistenceWarning } from "../../db";
import { createDrizzleWhatsAppPendingOperationRepository } from "../../repositories/whatsappPendingOperationRepository";
import {
  handleWhatsappFoodClarification,
  PENDING_FOOD_CLARIFICATION_TYPE,
  type WhatsappFoodClarificationResult,
} from "./foodClarification";
import * as messageLifecycle from "./messageLifecycle";
import { isStandaloneWhatsappCommandWord } from "./standaloneCommandWords";

const pendingOperationRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

function getLifecycleInboundMessageId() {
  return (messageLifecycle as { getCurrentInboundExternalMessageId?: () => string | null })
    .getCurrentInboundExternalMessageId?.() ?? null;
}

/**
 * Gate antecipado usado antes do contexto conversacional e dos demais intents.
 * Ele somente resolve uma pendência alimentar já existente ou bloqueia comando
 * isolado sem pendência. A criação de uma nova clarificação permanece em
 * executeWhatsappTextIntent, depois dos parsers alimentares especializados.
 */
export async function resolvePendingWhatsappFoodClarification(input: {
  userId: number;
  text?: string | null;
  receivedAt?: Date;
  userTimezone: string;
  messageId?: string | null;
}): Promise<WhatsappFoodClarificationResult | null> {
  const active = await pendingOperationRepository.getActivePendingOperation(input.userId, input.receivedAt);
  const correlatedInput = {
    ...input,
    messageId: input.messageId?.trim() || getLifecycleInboundMessageId(),
  };

  if (active?.type === PENDING_FOOD_CLARIFICATION_TYPE) {
    return handleWhatsappFoodClarification(correlatedInput);
  }

  // Uma resposta curta pertencente a outra pendência deve permanecer sob a
  // responsabilidade do resolvedor daquela operação.
  if (active) return null;

  return isStandaloneWhatsappCommandWord(input.text)
    ? handleWhatsappFoodClarification(correlatedInput)
    : null;
}
