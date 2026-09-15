import { safeLogDetail } from "../../privacy";
import { getDb, logInferenceEvent, logPersistenceWarning } from "../../db";
import {
  createDrizzleWhatsAppQuestionRecoveryRepository,
  type RecoverableWhatsappQuestion,
  type WhatsAppQuestionRecoveryRepository,
} from "../../repositories/whatsappQuestionRecoveryRepository";
import { sendWhatsAppLogicalDomainReply } from "./logicalReplyDelivery";
import {
  DEFAULT_PROCESSING_HEARTBEAT_TIMEOUT_MS,
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
// Só aguardamos dentro do ciclo quando o owner já está perto de ficar stale.
// Owners saudáveis, renovados a cada 5 s, não bloqueiam o batch por 30 s.
export const MAX_NEAR_STALE_CLAIM_RECHECK_DELAY_MS = 12_000;
export const CLAIM_RECHECK_GRACE_MS = 100;
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

export function resolveNearStaleClaimRecheckDelayMs(
  heartbeatAt: Date | null,
  now = new Date(),
) {
  if (!heartbeatAt) return null;
  const heartbeatMs = heartbeatAt.getTime();
  if (!Number.isFinite(heartbeatMs)) return null;
  const remainingMs = heartbeatMs
    + DEFAULT_PROCESSING_HEARTBEAT_TIMEOUT_MS
    - now.getTime();
  if (
    remainingMs <= 0
    || remainingMs > MAX_NEAR_STALE_CLAIM_RECHECK_DELAY_MS
  ) return null;
  return remainingMs + CLAIM_RECHECK_GRACE_MS;
}

function waitForClaimRecheck(delayMs: number) {
  return new Promise<void>(resolve => {
    const timer = setTimeout(resolve, delayMs);
    if (typeof timer === "object" && "unref" in timer) timer.unref();
  });
}

async function claimRecoverableLifecycle(
  lifecycleHandle: NonNullable<Awaited<ReturnType<typeof beginInboundMessage>>>,
  candidate: RecoverableWhatsappQuestion,
) {
  let claimStatus = await claimMessageForProcessingState(lifecycleHandle);
  if (claimStatus === "inflight") {
    const recheckDelayMs = resolveNearStaleClaimRecheckDelayMs(
      candidate.processingHeartbeatAt,
    );
    if (recheckDelayMs !== null) {
      await waitForClaimRecheck(recheckDelayMs);
      // O segundo claim continua sendo a autoridade. Se um owner saudável
      // renovou o heartbeat durante a espera, ele permanece inflight; se o
      // runtime anterior morreu, o compare-and-swap assume o owner stale.
      claimStatus = await claimMessageForProcessingState(lifecycleHandle);
    }
  }
  if (claimStatus === "inflight") return { terminal: true as const, outcome: "inflight" as const };
  if (claimStatus === "processed") return { terminal: true as const, outcome: "processed" as const };
  if (claimStatus === "unavailable") return { terminal: true as const, outcome: "unavailable" as const };
  return { terminal: false as const, claimStatus };
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

      // Uma resposta funcional já persistida é terminal para o produto, mas a
      // conclusão do lifecycle ainda deve respeitar ownership. Isso evita roubar
      // um owner saudável e permite que um owner órfão seja assumido/limpo junto
      // com processedAt, sem deixar processing claim residual.
      if (await wasMessageAlreadyProcessed(lifecycleHandle)) {
        const completionClaim = await claimRecoverableLifecycle(lifecycleHandle, candidate);
        if (completionClaim.terminal) return completionClaim.outcome;
        await markMessageProcessed(lifecycleHandle);
        console.info("[WhatsAppQuestionRecovery] completed_existing", {
          ...recoveryDetail(candidate),
          claimStatus: completionClaim.claimStatus,
        });
        return "completed_existing";
      }

      const claim = await claimRecoverableLifecycle(lifecycleHandle, candidate);
      if (claim.terminal) return claim.outcome;
      const claimStatus = claim.claimStatus;

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
