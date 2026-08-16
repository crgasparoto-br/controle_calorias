import { setAiUsageGate } from "../../_core/ai/usageGate";
import { enforceUsageAllowance, runUsageRetention } from "./service";

const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;
let retentionTimer: NodeJS.Timeout | null = null;

export function configureUsageGovernanceRuntime() {
  setAiUsageGate(enforceUsageAllowance);
}

export function startUsageGovernanceRetentionScheduler() {
  if (retentionTimer) return retentionTimer;

  const run = () => {
    void runUsageRetention().catch(error => {
      console.warn("[Usage governance] Retention cleanup skipped:", error);
    });
  };

  run();
  retentionTimer = setInterval(run, RETENTION_INTERVAL_MS);
  retentionTimer.unref?.();
  return retentionTimer;
}

export function stopUsageGovernanceRetentionSchedulerForTests() {
  if (retentionTimer) clearInterval(retentionTimer);
  retentionTimer = null;
  setAiUsageGate(null);
}
