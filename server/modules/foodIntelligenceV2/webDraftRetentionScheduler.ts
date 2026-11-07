import { deleteExpiredFoodD1WebDrafts, FOOD_D1_WEB_DRAFT_CLEANUP_INTERVAL_MS } from "./publicWebDraftRepository";

let cleanupTimer: NodeJS.Timeout | null = null;
let cleanupRunning = false;

export function startFoodD1WebDraftRetentionScheduler() {
  if (cleanupTimer) return cleanupTimer;
  const run = async () => {
    if (cleanupRunning) return;
    cleanupRunning = true;
    try {
      const deleted = await deleteExpiredFoodD1WebDrafts();
      if (deleted > 0) {
        console.info("[Food D1 web drafts] Expired drafts deleted", { count: deleted });
      }
    } catch (error) {
      console.error("[Food D1 web drafts] Expiry cleanup failed", {
        errorType: error instanceof Error ? error.name : "unknown",
      });
    } finally {
      cleanupRunning = false;
    }
  };
  void run();
  cleanupTimer = setInterval(() => void run(), FOOD_D1_WEB_DRAFT_CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
  return cleanupTimer;
}

export function stopFoodD1WebDraftRetentionSchedulerForTests() {
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = null;
  cleanupRunning = false;
}
