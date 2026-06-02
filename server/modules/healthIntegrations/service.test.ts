import { beforeEach, describe, expect, it, vi } from "vitest";

const exerciseMocks = vi.hoisted(() => ({
  createExercise: vi.fn(),
  listExercises: vi.fn(),
  updateExercise: vi.fn(),
}));

vi.mock("../exercises/service", () => ({
  createExercise: exerciseMocks.createExercise,
  listExercises: exerciseMocks.listExercises,
  updateExercise: exerciseMocks.updateExercise,
}));

function encodeState(userId: number) {
  return Buffer.from(JSON.stringify({ provider: "strava", userId, createdAt: Date.now() })).toString("base64url");
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("healthIntegrationService Strava", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.STRAVA_CLIENT_ID = "client-id";
    process.env.STRAVA_CLIENT_SECRET = "client-secret";
    process.env.STRAVA_REDIRECT_URI = "https://app.test/api/health-integrations/strava/callback";
    exerciseMocks.listExercises.mockResolvedValue([]);
    exerciseMocks.createExercise.mockImplementation(async (_userId, input) => ({
      id: 123,
      userId: _userId,
      ...input,
      occurredAt: new Date(input.occurredAt).getTime(),
      createdAt: Date.now(),
      updatedAt: new Date(),
    }));
    exerciseMocks.updateExercise.mockResolvedValue({ id: 456 });
  });

  it("registra atividades recentes do Strava como exercícios no callback OAuth", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        token_type: "Bearer",
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: "read,activity:read",
        athlete: { id: 10, firstname: "Ana", lastname: "Atleta" },
      }))
      .mockResolvedValueOnce(jsonResponse([
        {
          id: 999,
          name: "Corrida matinal",
          sport_type: "Run",
          start_date: "2026-06-01T10:00:00Z",
          moving_time: 2100,
          calories: 321.4,
        },
        {
          id: 1000,
          name: "Atividade sem gasto",
          sport_type: "Walk",
          start_date: "2026-06-01T12:00:00Z",
          moving_time: 900,
          calories: 0,
        },
      ])));

    const { healthIntegrationService } = await import("./service");

    const result = await healthIntegrationService.handleStravaCallback({
      code: "oauth-code",
      state: encodeState(42),
      scope: "read,activity:read",
    });

    expect(result.ok).toBe(true);
    expect(exerciseMocks.createExercise).toHaveBeenCalledWith(42, {
      activityType: "Run",
      durationMinutes: 35,
      caloriesBurned: 321,
      occurredAt: "2026-06-01T10:00:00Z",
      notes: "Importado automaticamente do Strava. Referencia externa: strava:999.",
    });
    expect(exerciseMocks.updateExercise).not.toHaveBeenCalled();
    expect(result.message).toContain("1 exercício(s) registrado(s)");
  });

  it("atualiza exercício Strava já importado em vez de duplicar", async () => {
    exerciseMocks.listExercises.mockResolvedValue([
      {
        id: 456,
        userId: 42,
        activityType: "Run",
        durationMinutes: 30,
        caloriesBurned: 280,
        occurredAt: new Date("2026-06-01T10:00:00Z").getTime(),
        notes: "Importado automaticamente do Strava. Referencia externa: strava:999.",
        createdAt: Date.now(),
        updatedAt: new Date(),
      },
    ]);
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        token_type: "Bearer",
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: "read,activity:read",
        athlete: { id: 10, username: "atleta" },
      }))
      .mockResolvedValueOnce(jsonResponse([
        {
          id: 999,
          name: "Corrida matinal atualizada",
          sport_type: "Run",
          start_date: "2026-06-01T10:00:00Z",
          moving_time: 2400,
          calories: 355,
        },
      ])));

    const { healthIntegrationService } = await import("./service");

    await healthIntegrationService.handleStravaCallback({
      code: "oauth-code",
      state: encodeState(42),
      scope: "read,activity:read",
    });

    expect(exerciseMocks.createExercise).not.toHaveBeenCalled();
    expect(exerciseMocks.updateExercise).toHaveBeenCalledWith(42, {
      exerciseId: 456,
      activityType: "Run",
      durationMinutes: 40,
      caloriesBurned: 355,
      occurredAt: "2026-06-01T10:00:00Z",
      notes: "Importado automaticamente do Strava. Referencia externa: strava:999.",
    });
  });
});
