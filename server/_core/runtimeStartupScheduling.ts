import { safeLogDetail } from "../privacy";

export const RUNTIME_STARTUP_DELAYS_MS = {
  foodCatalogSync: 15_000,
  usageGovernance: 45_000,
  asaasBilling: 60_000,
  asaasPixAuthorization: 75_000,
} as const;

type RuntimeStartupLogger = (
  message: string,
  detail: Record<string, unknown>,
) => void;

type StartupTimer = {
  unref?: () => void;
};

type SetTimeoutLike = (
  handler: () => void,
  timeoutMs: number,
) => StartupTimer;

type ClearTimeoutLike = (timer: StartupTimer) => void;

export type RuntimeStartupStep = {
  name: string;
  delayMs: number;
  start: () => unknown | Promise<unknown>;
};

export function scheduleRuntimeStartupSteps(input: {
  steps: RuntimeStartupStep[];
  setTimeoutFn?: SetTimeoutLike;
  clearTimeoutFn?: ClearTimeoutLike;
  logInfo?: RuntimeStartupLogger;
  logWarn?: RuntimeStartupLogger;
}) {
  const setTimeoutFn =
    input.setTimeoutFn ??
    ((handler, timeoutMs) => setTimeout(handler, timeoutMs));
  const clearTimeoutFn =
    input.clearTimeoutFn ??
    (timer => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const logInfo = input.logInfo ?? console.info;
  const logWarn = input.logWarn ?? console.warn;

  const timers = input.steps.map(step => {
    const delayMs = Math.max(0, step.delayMs);
    logInfo("[Runtime] startup_task_scheduled", {
      name: step.name,
      delayMs,
    });

    const timer = setTimeoutFn(() => {
      logInfo("[Runtime] startup_task_started", {
        name: step.name,
        delayMs,
      });
      void Promise.resolve()
        .then(() => step.start())
        .then(() => {
          logInfo("[Runtime] startup_task_settled", {
            name: step.name,
            delayMs,
          });
        })
        .catch(error => {
          logWarn("[Runtime] startup_task_failed", {
            name: step.name,
            delayMs,
            error: safeLogDetail(error),
          });
        });
    }, delayMs);
    timer.unref?.();
    return timer;
  });

  return {
    stop() {
      for (const timer of timers) clearTimeoutFn(timer);
    },
  };
}
