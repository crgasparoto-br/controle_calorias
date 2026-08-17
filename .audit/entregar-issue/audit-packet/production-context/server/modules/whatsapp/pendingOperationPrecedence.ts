import { getDb, logPersistenceWarning } from "../../db";
import { createDrizzleWhatsAppPendingOperationRepository } from "../../repositories/whatsappPendingOperationRepository";

const pendingOperationRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

const MAX_PENDING_OPERATIONS_PER_REPLACEMENT = 20;

/**
 * Marca pendências anteriores como substituídas quando um novo comando completo
 * assume a conversa. A operação é fail-closed: qualquer transição que não puder
 * ser confirmada interrompe a substituição.
 */
export async function supersedeActiveWhatsappPendingOperations(
  userId: number,
  receivedAt?: Date,
): Promise<boolean> {
  for (let index = 0; index < MAX_PENDING_OPERATIONS_PER_REPLACEMENT; index += 1) {
    const active = await pendingOperationRepository.getActivePendingOperation(userId, receivedAt);
    if (!active) return true;

    const transition = await pendingOperationRepository.supersedePendingOperation(active.id);
    if (!transition.superseded) return false;
  }

  return !(await pendingOperationRepository.getActivePendingOperation(userId, receivedAt));
}
