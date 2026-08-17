import { healthIntegrationService } from "./stravaDetailSafeService";

const DEFAULT_STRAVA_AUTO_SYNC_INTERVAL_MINUTES = 120;

function hasStravaCredentials() {
  return Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET && process.env.STRAVA_REDIRECT_URI);
}

function getStravaAutoSyncIntervalMs() {
  if (["1", "true", "yes", "on"].includes(process.env.STRAVA_AUTO_SYNC_DISABLED?.toLowerCase() ?? "")) {
    return null;
  }

  const configuredMinutes = Number(process.env.STRAVA_AUTO_SYNC_INTERVAL_MINUTES ?? DEFAULT_STRAVA_AUTO_SYNC_INTERVAL_MINUTES);
  if (!Number.isFinite(configuredMinutes) || configuredMinutes <= 0) {
    return null;
  }

  return Math.max(configuredMinutes, 5) * 60_000;
}

function runTimerWithoutKeepingProcessAlive(timer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>) {
  const maybeUnref = (timer as { unref?: () => void }).unref;
  if (typeof maybeUnref === "function") {
    maybeUnref.call(timer);
  }
}

export function startStravaAutoSyncScheduler() {
  if (!hasStravaCredentials()) {
    console.warn("[HealthIntegrations] Automatic Strava sync disabled because OAuth credentials are missing.");
    return { enabled: false as const, stop: () => undefined };
  }

  const intervalMs = getStravaAutoSyncIntervalMs();
  if (!intervalMs) {
    console.warn("[HealthIntegrations] Automatic Strava sync disabled by configuration.");
    return { enabled: false as const, stop: () => undefined };
  }

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await healthIntegrationService.syncConnectedStravaUsers();
      if (summary.attempted > 0) {
        console.log("[HealthIntegrations] Automatic Strava sync completed:", summary);
      }
    } catch (error) {
      console.warn("[HealthIntegrations] Automatic Strava sync skipped:", error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  };

  const initialRun = setTimeout(() => {
    void run();
  }, 5_000);
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