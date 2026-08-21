/**
 * Coordena o acknowledgement de processamento de mídia da epic #779/#785.
 *
 * O timer é único e cancelável. A resposta funcional deve chamar
 * `beforeFinalReply()` imediatamente antes do primeiro envio final:
 * - se o processamento terminou antes do limiar, o acknowledgement é cancelado;
 * - se o timer já iniciou o envio, a resposta final aguarda esse envio terminar;
 * - nenhuma corrida permite acknowledgement tardio depois da resposta final.
 */
export const WHATSAPP_PROCESSING_ACK_DELAY_MS = 1_200;

type AcknowledgementSendResult = { ok: boolean; detail: string };

type ProcessingAcknowledgementOptions = {
  send: () => Promise<AcknowledgementSendResult>;
  onFailure?: (detail: string) => Promise<void> | void;
  delayMs?: number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
};

export type ProcessingAcknowledgementCoordinator = {
  beforeFinalReply(): Promise<void>;
  state(): "pending" | "sending" | "sent" | "cancelled";
};

export function startProcessingAcknowledgement(
  options: ProcessingAcknowledgementOptions,
): ProcessingAcknowledgementCoordinator {
  let currentState: "pending" | "sending" | "sent" | "cancelled" = "pending";
  let sendPromise: Promise<void> = Promise.resolve();
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;

  const timer = setTimer(() => {
    if (currentState !== "pending") return;
    currentState = "sending";
    sendPromise = (async () => {
      try {
        const result = await options.send();
        if (!result.ok) await options.onFailure?.(result.detail);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Falha desconhecida ao enviar acknowledgement.";
        await options.onFailure?.(detail);
      } finally {
        currentState = "sent";
      }
    })();
  }, options.delayMs ?? WHATSAPP_PROCESSING_ACK_DELAY_MS);

  return {
    async beforeFinalReply() {
      if (currentState === "pending") {
        currentState = "cancelled";
        clearTimer(timer);
      }
      if (currentState === "sending") {
        await sendPromise;
      }
    },
    state() {
      return currentState;
    },
  };
}
