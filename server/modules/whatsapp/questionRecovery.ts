import { safeLogDetail } from "../../privacy";
import { getDb, logInferenceEvent, logPersistenceWarning } from "../../db";
import {
  createDrizzleWhatsAppQuestionRecoveryRepository,
  type RecoverableWhatsappQuestion,
  type WhatsAppQuestionRecoveryRepository,
} from "../../repositories/whatsappQuestionRecoveryRepository";
import { sendWhatsAppLogicalDomainReply } from "./logicalReplyDelivery";
import {
  beginInboundMessage,
  claimMessageForProcessingState,
  markMessageProcessed,
  runWithMessageLifecycleRequestScope,
  wasMessageAlreadyProcessed,
} from "./messageLifecycle";
import { resolveWhatsAppPrecedenceGate } from "./messageRouter";
import { runWithQuestionLatencyContext } from "./questionLatencyContext";
import { recordConversationTurn } from "./conversationHistory";
import { resolveWhatsAppOperationTimeZone } from "./timeZoneContext";
import { fingerprintWhatsAppMessageId } from "./webhookCorrelation";

export const DEFAULT_QUESTION_RECOVERY_INTERVAL_MS = 15_000;
// Deve permanecer abaixo do TTL de 30 min da conversa: beginInboundMessage
// precisa reutilizar a conversa original para manter a mesma identidade de resposta.
export const DEFAULT_QUESTION_RECOVERY_HORIZON_MS = 20 * 60 * 1000;
export const DEFAULT_QUESTION_RECOVERY_BATCH_SIZE = 10;

export type WhatsappQuestionRecoveryOutcome =
  | "completed_existing"
  | "recovered"
  | "delivery_pending"
  | "inflight"
  | "processed"
  | "unavailable"
  | "not_question";

const defaultRepository = createDrizzleWhatsAppQuestionRecoveryRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

function recoveryDetail(candidate: RecoverableWhatsappQuestion) {
  return {
    messageId: candidate.messageId,
    fingerprint: fingerprintWhatsAppMessageId(candidate.externalMessageId),
  };
}

/**
 * Retoma uma QUESTION já persistida sem fabricar um novo inbound da Meta.
 * O beginInboundMessage reutiliza a mesma chave externa e o claim persistente
 * continua sendo a única autoridade para ownership/exclusão mútua.
 */
export async function recoverPendingWhatsappQuestion(
  candidate: RecoverableWhatsappQuestion,
): Promise<WhatsappQuestionRecoveryOutcome> {
  return runWithQuestionLatencyContext(() =>
    runWithMessageLifecycleRequestScope(async () => {
      const lifecycleHandle = await beginInboundMessage({
        userId: candidate.userId,
        whatsappConnectionId: null,
        phoneNumber: candidate.phoneNumber,
        externalMessageId: candidate.externalMessageId,
        contentType: "text",
        text: candidate.text,
        occurredAt: candidate.occurredAt,
        allowRawContentStorage: true,
      });
      if (!lifecycleHandle) return "unavailable";

      // Uma resposta funcional já persistida é terminal mesmo que o processo
      // anterior tenha morrido antes de preencher processedAt.
      if (await wasMessageAlreadyProcessed(lifecycleHandle)) {
        await markMessageProcessed(lifecycleHandle);
        console.info("[WhatsAppQuestionRecovery] completed_existing", recoveryDetail(candidate));
        return "completed_existing";
      }

      const claimStatus = await claimMessageForProcessingState(lifecycleHandle);
      if (claimStatus === "inflight") return "inflight";
      if (claimStatus === "processed") return "processed";
      if (claimStatus === "unavailable") return "unavailable";

      const timeZoneResolution = await resolveWhatsAppOperationTimeZone(candidate.userId);
      const userTimezone = timeZoneResolution.timeZone;
      const gate = await resolveWhatsAppPrecedenceGate({
        userId: candidate.userId,
        text: candidate.text,
        receivedAt: candidate.occurredAt,
        userTimezone,
        sourcePhone: candidate.phoneNumber,
        messageId: candidate.externalMessageId,
      });
      if (gate.step !== "ai_question") {
        console.warn("[WhatsAppQuestionRecovery] non_question_candidate", recoveryDetail(candidate));
        return "not_question";
      }

      const result = gate.result;
      logInferenceEvent({
        userId: candidate.userId,
        origin: "whatsapp",
        status: result.action === "ai_question_unavailable" ? "warning" : "success",
        eventType: `${result.eventType}.recovered`,
        detail: `QUESTION retomada pelo recovery durável após perda do runtime. messageId=${candidate.messageId}`,
      });

      const delivery = await sendWhatsAppLogicalDomainReply({
        to: candidate.phoneNumber,
        userId: candidate.userId,
        replyText: result.reply,
        lifecycleHandle,
      });
      const replyOk = delivery.result.primaryOk;
      recordConversationTurn(
        candidate.userId,
        candidate.text,
        replyOk ? result.reply : null,
        candidate.occurredAt.getTime(),
      );

      if (!replyOk) {
        // Não finaliza nem libera artificialmente o owner. Ao encerrar o escopo
        // o heartbeat para; uma próxima rodada só assume depois da janela de
        // liveness persistente, evitando loop apertado e owners concorrentes.
        console.warn("[WhatsAppQuestionRecovery] delivery_pending", recoveryDetail(candidate));
        return "delivery_pending";
      }

      await markMessageProcessed(lifecycleHandle);
      console.info("[WhatsAppQuestionRecovery] recovered", {
        ...recoveryDetail(candidate),
        claimStatus,
      });
      return "recovered";
    }),
  );
}

export async function runWhatsappQuestionRecoveryCycle(input: {
  repository?: WhatsAppQuestionRecoveryRepository;
  now?: Date;
  horizonMs?: number;
  limit?: number;
} = {}) {
  const repository = input.repository ?? defaultRepository;
  const now = input.now ?? new Date();
  const candidates = await repository.findRecoverableQuestions({
    now,
    horizonMs: input.horizonMs ?? DEFAULT_QUESTION_RECOVERY_HORIZON_MS,
    limit: input.limit ?? DEFAULT_QUESTION_RECOVERY_BATCH_SIZE,
  });
  const outcomes: Array<{
    messageId: number;
    outcome: WhatsappQuestionRecoveryOutcome | "error";
  }> = [];

  for (const candidate of candidates) {
    try {
      outcomes.push({
        messageId: candidate.messageId,
        outcome: await recoverPendingWhatsappQuestion(candidate),
      });
    } catch (error) {
      console.error("[WhatsAppQuestionRecovery] candidate_failed", safeLogDetail({
        ...recoveryDetail(candidate),
        error,
      }));
      outcomes.push({ messageId: candidate.messageId, outcome: "error" });
    }
  }

  return { candidates: candidates.length, outcomes };
}

export function startWhatsappQuestionRecoveryScheduler(input: {
  intervalMs?: number;
  horizonMs?: number;
  limit?: number;
  repository?: WhatsAppQuestionRecoveryRepository;
} = {}) {
  const intervalMs = Math.max(5_000, input.intervalMs ?? DEFAULT_QUESTION_RECOVERY_INTERVAL_MS);
  let running = false;
  let stopped = false;

  const runCycle = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const result = await runWhatsappQuestionRecoveryCycle({
        repository: input.repository,
        horizonMs: input.horizonMs,
        limit: input.limit,
      });
      if (result.candidates > 0) {
        console.info("[WhatsAppQuestionRecovery] cycle", {
          candidates: result.candidates,
          outcomes: result.outcomes,
        });
      }
    } catch (error) {
      console.error("[WhatsAppQuestionRecovery] cycle_failed", safeLogDetail(error));
    } finally {
      running = false;
    }
  };

  const startupTimer = setTimeout(() => void runCycle(), 1_000);
  const interval = setInterval(() => void runCycle(), intervalMs);
  if (typeof startupTimer === "object" && "unref" in startupTimer) startupTimer.unref();
  if (typeof interval === "object" && "unref" in interval) interval.unref();

  return () => {
    stopped = true;
    clearTimeout(startupTimer);
    clearInterval(interval);
  };
}
