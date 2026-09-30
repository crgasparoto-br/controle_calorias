/**
 * Agendador da rotina de retenção do histórico do WhatsApp (issue #767).
 * Mesmo padrão setInterval+.unref() de stravaScheduler.ts — sem introduzir um
 * framework de agendamento genérico novo.
 */
import { logRuntimeMemoryOperation } from "../../_core/runtimeMemoryOperationTelemetry";
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
    logRuntimeMemoryOperation({ operation: "scheduler.whatsapp_retention", stage: "start", always: true });
    try {
      await runConversationRetentionSweep("scheduled");
    } catch (error) {
      console.warn("[WhatsAppRetention] Retention sweep skipped:", error instanceof Error ? error.message : error);
    } finally {
      logRuntimeMemoryOperation({ operation: "scheduler.whatsapp_retention", stage: "end" });
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
