/**
 * Agendador da rotina de retenção do histórico do WhatsApp (issue #767).
 * Mesmo padrão setInterval+.unref() de stravaScheduler.ts — sem introduzir um
 * framework de agendamento genérico novo.
 */
import { runConversationRetentionSweep } from "./conversationRetentionService";

const DEFAULT_RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;

function runTimerWithoutKeepingProcessAlive(timer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>) {
  const maybeUnref = (timer as { unref?: () => void }).unref;
  if (typeof maybeUnref === "function") {
    maybeUnref.call(timer);
  }
}

export function startConversationRetentionScheduler(intervalMs: number = DEFAULT_RETENTION_INTERVAL_MS) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runConversationRetentionSweep("scheduled");
    } catch (error) {
      console.warn("[WhatsAppRetention] Retention sweep skipped:", error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  };

  const initialRun = setTimeout(() => {
    void run();
  }, 30_000);
  const interval = setInterval(() => {
    void run();
  }, intervalMs);

  runTimerWithoutKeepingProcessAlive(initialRun);
  runTimerWithoutKeepingProcessAlive(interval);

  return {
    enabled: true as const,
    stop: () => {
      clearTimeout(initialRun);
      clearInterval(interval);
    },
  };
}
