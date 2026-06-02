import { beforeEach, describe, expect, it, vi } from "vitest";

const createExerciseMock = vi.fn();
const listExercisesMock = vi.fn();
const updateExerciseMock = vi.fn();

vi.mock("../exercises/service", () => ({
  createExercise: createExerciseMock,
  listExercises: listExercisesMock,
  updateExercise: updateExerciseMock,
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
    listExercisesMock.mockResolvedValue([]);
    createExerciseMock.mockImplementation(async (_userId, input) => ({
      id: 123,
      userId: _userId,
      ...input,
      occurredAt: new Date(input.occurredAt).getTime(),
      createdAt: Date.now(),
      updatedAt: new Date(),
    }));
    updateExerciseMock.mockResolvedValue({ id: 456 });
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
    expect(createExerciseMock).toHaveBeenCalledWith(42, {
      activityType: "Run",
      durationMinutes: 35,
      caloriesBurned: 321,
      occurredAt: "2026-06-01T10:00:00Z",
      notes: "Importado automaticamente do Strava. Referencia externa: strava:999.",
    });
    expect(updateExerciseMock).not.toHaveBeenCalled();
    expect(result.message).toContain("1 exercício(s) registrado(s)");
  });

  it("atualiza exercício Strava já importado em vez de duplicar", async () => {
    listExercisesMock.mockResolvedValue([
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

    expect(createExerciseMock).not.toHaveBeenCalled();
    expect(updateExerciseMock).toHaveBeenCalledWith(42, {
      exerciseId: 456,
      activityType: "Run",
      durationMinutes: 40,
      caloriesBurned: 355,
      occurredAt: "2026-06-01T10:00:00Z",
      notes: "Importado automaticamente do Strava. Referencia externa: strava:999.",
    });
  });
});
