import { safeLogDetail } from "../privacy";

export type RuntimeTerminationProcess = {
  pid: number;
  on: (event: "uncaughtExceptionMonitor" | "exit", listener: (...args: any[]) => void) => unknown;
  once: (event: "SIGTERM" | "SIGINT", listener: () => void) => unknown;
  kill: (pid: number, signal: NodeJS.Signals) => boolean;
};

type RuntimeLogger = (message: string, detail: Record<string, unknown>) => void;

export function installRuntimeTerminationDiagnostics(input: {
  bootId: string;
  bootStartedAt: number;
  commit: string | null;
  runtime?: RuntimeTerminationProcess;
  now?: () => number;
  logInfo?: RuntimeLogger;
  logError?: RuntimeLogger;
}) {
  const runtime: RuntimeTerminationProcess =
    input.runtime ?? (process as RuntimeTerminationProcess);
  const now = input.now ?? Date.now;
  const logInfo = input.logInfo ?? console.info;
  const logError = input.logError ?? console.error;
  const baseDetail = () => ({
    bootId: input.bootId,
    pid: runtime.pid,
    commit: input.commit,
    uptimeMs: Math.max(0, now() - input.bootStartedAt),
  });

  runtime.on("uncaughtExceptionMonitor", (error: Error, origin: string) => {
    logError("[Runtime] uncaught_exception_monitor", {
      ...baseDetail(),
      origin,
      error: safeLogDetail(error),
    });
  });

  runtime.on("exit", (code: number) => {
    logInfo("[Runtime] process_exit", {
      ...baseDetail(),
      code,
    });
  });

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    runtime.once(signal, () => {
      logInfo("[Runtime] termination_signal", {
        ...baseDetail(),
        signal,
      });
      // `once` remove este observador antes da chamada. Reenviar o mesmo sinal
      // preserva a semântica padrão de término em vez de transformar o listener
      // de diagnóstico em um handler de graceful shutdown.
      runtime.kill(runtime.pid, signal);
    });
  }
}
