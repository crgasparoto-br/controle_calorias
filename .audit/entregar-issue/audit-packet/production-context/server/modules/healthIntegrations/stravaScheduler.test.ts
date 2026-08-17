import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  syncConnectedStravaUsers: vi.fn(),
}));

vi.mock("./service", () => ({
  healthIntegrationService: {
    syncConnectedStravaUsers: serviceMocks.syncConnectedStravaUsers,
  },
}));

const originalEnv = { ...process.env };

async function importSchedulerModule() {
  vi.resetModules();
  return import("./stravaScheduler");
}

describe("stravaScheduler", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.STRAVA_CLIENT_ID;
    delete process.env.STRAVA_CLIENT_SECRET;
    delete process.env.STRAVA_REDIRECT_URI;
    delete process.env.STRAVA_AUTO_SYNC_DISABLED;
    delete process.env.STRAVA_AUTO_SYNC_INTERVAL_MINUTES;
    serviceMocks.syncConnectedStravaUsers.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("does not start when Strava OAuth credentials are missing", async () => {
    const { startStravaAutoSyncScheduler } = await importSchedulerModule();

    const scheduler = startStravaAutoSyncScheduler();

    expect(scheduler.enabled).toBe(false);
    expect(serviceMocks.syncConnectedStravaUsers).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      "[HealthIntegrations] Automatic Strava sync disabled because OAuth credentials are missing."
    );
  });

  it("does not start when auto sync is disabled by configuration", async () => {
    process.env.STRAVA_CLIENT_ID = "client-id";
    process.env.STRAVA_CLIENT_SECRET = "client-secret";
    process.env.STRAVA_REDIRECT_URI = "https://api.test/strava/callback";
    process.env.STRAVA_AUTO_SYNC_DISABLED = "true";
    const { startStravaAutoSyncScheduler } = await importSchedulerModule();

    const scheduler = startStravaAutoSyncScheduler();

    expect(scheduler.enabled).toBe(false);
    expect(serviceMocks.syncConnectedStravaUsers).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      "[HealthIntegrations] Automatic Strava sync disabled by configuration."
    );
  });

  it("runs the first automatic sync after startup delay", async () => {
    vi.useFakeTimers();
    process.env.STRAVA_CLIENT_ID = "client-id";
    process.env.STRAVA_CLIENT_SECRET = "client-secret";
    process.env.STRAVA_REDIRECT_URI = "https://api.test/strava/callback";
    process.env.STRAVA_AUTO_SYNC_INTERVAL_MINUTES = "5";
    serviceMocks.syncConnectedStravaUsers.mockResolvedValue({
      attempted: 1,
      succeeded: 1,
      failed: 0,
      importedExercises: { created: 1, updated: 0, skipped: 0 },
    });
    const { startStravaAutoSyncScheduler } = await importSchedulerModule();

    const scheduler = startStravaAutoSyncScheduler();

    expect(scheduler.enabled).toBe(true);
    expect(serviceMocks.syncConnectedStravaUsers).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);

    expect(serviceMocks.syncConnectedStravaUsers).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith(
      "[HealthIntegrations] Automatic Strava sync completed:",
      expect.objectContaining({ attempted: 1, succeeded: 1 })
    );

    scheduler.stop();
  });
});
