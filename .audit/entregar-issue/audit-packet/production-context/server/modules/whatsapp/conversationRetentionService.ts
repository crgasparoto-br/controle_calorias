/**
 * Rotina de retenção do histórico conversacional do WhatsApp (issue #767).
 *
 * Reaproveita as classes de retenção já existentes em aiLearningPrivacy.ts
 * (ephemeral/operational/audit) em vez de criar uma taxonomia paralela:
 * - texto/transcript bruto: classe ephemeral, controlada pelo retentionExpiresAt
 *   já calculado e persistido por mensagem desde a issue #763.
 * - texto sanitizado: classe operational (30 dias) a partir de occurredAt.
 * - linha inteira (metadados/auditoria): classe audit (365 dias) a partir de
 *   occurredAt, só depois que bruto e sanitizado já estão nulos.
 * - pendências operacionais não ativas: classe operational (30 dias).
 * - resumo: não governado por tempo aqui — é superado imediatamente ao gerar
 *   um novo (ver whatsappConversationRepository.ts#insertConversationSummary).
 *
 * Nunca toca meals/waterLogs/weightEntries/exercises — são registros de domínio
 * permanentes, fora do escopo de retenção de conversa.
 */
import { getDb, logInferenceEvent, logPersistenceWarning } from "../../db";
import { RETENTION_DAYS } from "../aiLearningPrivacy";
import { createDrizzleWhatsAppConversationRepository, type WhatsAppConversationRepository } from "../../repositories/whatsappConversationRepository";
import { createDrizzleWhatsAppPendingOperationRepository, type WhatsAppPendingOperationRepository } from "../../repositories/whatsappPendingOperationRepository";

const conversationRepository: WhatsAppConversationRepository = createDrizzleWhatsAppConversationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

const pendingOperationRepository: WhatsAppPendingOperationRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

export type ConversationRetentionSweepResult = {
  rowsRawNulled: number;
  rowsSanitizedNulled: number;
  rowsDeleted: number;
  pendingOpsDeleted: number;
};

export type ConversationRetentionTrigger = "scheduled" | "admin";

/**
 * Executa uma rodada de limpeza. Idempotente por natureza — cada passo é uma
 * condição de tempo (`WHERE ... <= now`); rodar de novo sem linhas vencidas é
 * um no-op seguro. Nunca lança; falhas de uma etapa não impedem as demais.
 */
export async function runConversationRetentionSweep(
  trigger: ConversationRetentionTrigger,
  now: Date = new Date(),
): Promise<ConversationRetentionSweepResult> {
  const rowsRawNulled = await conversationRepository.purgeExpiredRawText(now);
  const rowsSanitizedNulled = await conversationRepository.purgeExpiredSanitizedText(RETENTION_DAYS.operational, now);
  const rowsDeleted = await conversationRepository.purgeExpiredAuditRows(RETENTION_DAYS.audit, now);
  const pendingOpsDeleted = await pendingOperationRepository.purgeInactiveOperations(RETENTION_DAYS.operational, now);

  const result: ConversationRetentionSweepResult = { rowsRawNulled, rowsSanitizedNulled, rowsDeleted, pendingOpsDeleted };

  logInferenceEvent({
    origin: "whatsapp",
    status: "success",
    eventType: "whatsapp.history.retention_run",
    detail: JSON.stringify({ trigger, ...result }),
  });

  return result;
}
