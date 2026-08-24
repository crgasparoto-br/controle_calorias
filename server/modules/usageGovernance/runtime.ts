import { setAiUsageGate } from "../../_core/ai/usageGate";
import { enforceUsageAllowance, refreshEconomicAggregates, runUsageRetention } from "./service";

const GOVERNANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;
let retentionTimer: NodeJS.Timeout | null = null;

export function configureUsageGovernanceRuntime() {
  setAiUsageGate(enforceUsageAllowance);
}

export function startUsageGovernanceRetentionScheduler() {
  if (retentionTimer) return retentionTimer;
  const run = async () => {
    try {
      await refreshEconomicAggregates();
      await runUsageRetention();
    } catch (error) {
      console.warn("[Usage governance] Aggregation/retention cycle skipped", {
        errorType: error instanceof Error ? error.name : "unknown",
      });
    }
  };
  void run();
  retentionTimer = setInterval(() => void run(), GOVERNANCE_INTERVAL_MS);
  retentionTimer.unref?.();
  return retentionTimer;
}

export function stopUsageGovernanceRetentionSchedulerForTests() {
  if (retentionTimer) clearInterval(retentionTimer);
  retentionTimer = null;
  setAiUsageGate(null);
}
