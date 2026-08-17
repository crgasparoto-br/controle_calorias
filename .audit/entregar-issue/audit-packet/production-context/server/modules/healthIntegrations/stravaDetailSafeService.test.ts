import { beforeEach, describe, expect, it, vi } from "vitest";

const baseHealthIntegrationService = vi.hoisted(() => ({
  getStatus: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  handleStravaCallback: vi.fn(),
  sync: vi.fn(),
  syncConnectedStravaUsers: vi.fn(),
}));

vi.mock("./service", () => ({
  healthIntegrationService: baseHealthIntegrationService,
}));

describe("stravaDetailSafeService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    delete process.env.STRAVA_MAX_ACTIVITY_DETAIL_REQUESTS_PER_SYNC;
  });

  it("traduz limite all para todas as atividades possíveis do sync atual", async () => {
    process.env.STRAVA_MAX_ACTIVITY_DETAIL_REQUESTS_PER_SYNC = "all";
    let observedLimit: string | undefined;
    baseHealthIntegrationService.sync.mockImplementationOnce(async () => {
      observedLimit = process.env.STRAVA_MAX_ACTIVITY_DETAIL_REQUESTS_PER_SYNC;
      return { ok: true };
    });

    const { healthIntegrationService } = await import("./stravaDetailSafeService");
    await healthIntegrationService.sync(42, { provider: "strava" });

    expect(observedLimit).toBe("2000");
    expect(process.env.STRAVA_MAX_ACTIVITY_DETAIL_REQUESTS_PER_SYNC).toBe("all");
  });

  it("preserva comportamento numerico existente", async () => {
    process.env.STRAVA_MAX_ACTIVITY_DETAIL_REQUESTS_PER_SYNC = "2";
    let observedLimit: string | undefined;
    baseHealthIntegrationService.sync.mockImplementationOnce(async () => {
      observedLimit = process.env.STRAVA_MAX_ACTIVITY_DETAIL_REQUESTS_PER_SYNC;
      return { ok: true };
    });

    const { healthIntegrationService } = await import("./stravaDetailSafeService");
    await healthIntegrationService.sync(42, { provider: "strava" });

    expect(observedLimit).toBe("2");
    expect(process.env.STRAVA_MAX_ACTIVITY_DETAIL_REQUESTS_PER_SYNC).toBe("2");
  });

  it("interrompe sync quando detalhe do Strava falha sem 429", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "temporary error" }), { status: 500 })));
    baseHealthIntegrationService.sync.mockImplementationOnce(async () => {
      await fetch("https://www.strava.com/api/v3/activities/123");
      return { ok: true };
    });

    const { healthIntegrationService } = await import("./stravaDetailSafeService");
    await expect(healthIntegrationService.sync(42, { provider: "strava" }))
      .rejects
      .toThrow("Falha ao buscar detalhe da atividade do Strava (500).");
  });

  it("mantem 429 de detalhe para o tratamento de cooldown do serviço base", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "rate limit" }), { status: 429 })));
    baseHealthIntegrationService.sync.mockImplementationOnce(async () => {
      const response = await fetch("https://www.strava.com/api/v3/activities/123");
      return response.status;
    });

    const { healthIntegrationService } = await import("./stravaDetailSafeService");
    await expect(healthIntegrationService.sync(42, { provider: "strava" })).resolves.toBe(429);
  });

  it("nao interfere em falhas da listagem de atividades", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "temporary error" }), { status: 500 })));
    baseHealthIntegrationService.sync.mockImplementationOnce(async () => {
      const response = await fetch("https://www.strava.com/api/v3/athlete/activities?per_page=100&page=1&after=0");
      return response.status;
    });

    const { healthIntegrationService } = await import("./stravaDetailSafeService");
    await expect(healthIntegrationService.sync(42, { provider: "strava" })).resolves.toBe(500);
  });
});