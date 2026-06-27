import { beforeEach, describe, expect, it, vi } from "vitest";

const exerciseMocks = vi.hoisted(() => ({
  createExercise: vi.fn(),
  listExercises: vi.fn(),
  updateExercise: vi.fn(),
}));

const dbMocks = vi.hoisted(() => {
  const appSecretRows: Array<{
    id: number;
    secretKey: string;
    valueEncrypted: string;
    updatedByUserId: number | null;
  }> = [];
  let sequence = 1;

  function projectRows(projection?: Record<string, unknown>) {
    if (projection?.secretKey) {
      return appSecretRows.map(row => ({ secretKey: row.secretKey }));
    }

    return appSecretRows;
  }

  const db = {
    select: vi.fn((projection?: Record<string, unknown>) => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn((limit = 1) => projectRows(projection).slice(0, limit)),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((value: { secretKey: string; valueEncrypted: string; updatedByUserId?: number | null }) => {
        appSecretRows.push({
          id: sequence++,
          secretKey: value.secretKey,
          valueEncrypted: value.valueEncrypted,
          updatedByUserId: value.updatedByUserId ?? null,
        });
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((value: { valueEncrypted: string; updatedByUserId?: number | null }) => ({
        where: vi.fn(() => {
          if (appSecretRows[0]) {
            appSecretRows[0].valueEncrypted = value.valueEncrypted;
            appSecretRows[0].updatedByUserId = value.updatedByUserId ?? null;
          }
        }),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => {
        appSecretRows.splice(0, appSecretRows.length);
      }),
    })),
  };

  return {
    appSecretRows,
    db,
    getDb: vi.fn(async () => db),
    reset: () => {
      appSecretRows.splice(0, appSecretRows.length);
      sequence = 1;
      vi.clearAllMocks();
    },
  };
});

vi.mock("../../db", () => ({
  getDb: dbMocks.getDb,
  getUserWhatsappConnection: vi.fn(async () => null),
  getWhatsAppAccessToken: vi.fn(async () => "whatsapp-access-token"),
  logInferenceEvent: vi.fn(),
}));

vi.mock("../../_core/env", () => ({
  ENV: { cookieSecret: "test-cookie-secret" },
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
  beforeEach(async () => {
    vi.useRealTimers();
    vi.resetModules();
    dbMocks.reset();
    exerciseMocks.createExercise.mockReset();
    exerciseMocks.listExercises.mockReset();
    exerciseMocks.updateExercise.mockReset();
    process.env.STRAVA_CLIENT_ID = "client-id";
    process.env.STRAVA_CLIENT_SECRET = "client-secret";
    process.env.STRAVA_REDIRECT_URI = "https://app.test/api/health-integrations/strava/callback";
    delete process.env.STRAVA_MAX_ACTIVITY_DETAIL_REQUESTS_PER_SYNC;
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

  it("conclui OAuth sem importar atividades automaticamente", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      token_type: "Bearer",
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      scope: "read,activity:read_all",
      athlete: { id: 10, firstname: "Ana", lastname: "Atleta" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { healthIntegrationService } = await import("./service");
    const result = await healthIntegrationService.handleStravaCallback({
      code: "oauth-code",
      state: encodeState(42),
      scope: "read,activity:read_all",
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("Use a sincronização manual");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(exerciseMocks.createExercise).not.toHaveBeenCalled();
    expect(exerciseMocks.updateExercise).not.toHaveBeenCalled();
  });

  it("importa atividades apenas quando a sincronização manual é chamada", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        token_type: "Bearer",
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: "read,activity:read_all",
        athlete: { id: 10, firstname: "Ana", lastname: "Atleta" },
      }))
      .mockResolvedValueOnce(jsonResponse([
        {
          id: 999,
          name: "Corrida matinal",
          sport_type: "Run",
          start_date: "2026-06-01T10:00:00Z",
          moving_time: 2100,
        },
      ]))
      .mockResolvedValueOnce(jsonResponse({
        id: 999,
        name: "Corrida matinal",
        sport_type: "Run",
        start_date: "2026-06-01T10:00:00Z",
        moving_time: 2100,
        calories: 321,
      }));
    vi.stubGlobal("fetch", fetchMock);

    const { healthIntegrationService } = await import("./service");
    await healthIntegrationService.handleStravaCallback({
      code: "oauth-code",
      state: encodeState(42),
      scope: "read,activity:read_all",
    });

    const syncResult = await healthIntegrationService.sync(42, { provider: "strava" });

    expect(exerciseMocks.createExercise).toHaveBeenCalledWith(42, {
      activityType: "Corrida",
      durationMinutes: 35,
      caloriesBurned: 321,
      occurredAt: "2026-06-01T10:00:00Z",
      notes: "Importado automaticamente do Strava. Referencia externa: strava:999. Tipo Strava: Run. Calorias: 321 kcal.",
    });
    expect(syncResult.records.find(record => record.id === "999:activity")?.metadata).toMatchObject({
      calories: 321,
      caloriesSource: "strava",
      estimatedCalories: false,
    });
  });

  it("não duplica exercício e preserva as calorias salvas no exercício existente", async () => {
    exerciseMocks.listExercises.mockResolvedValue([
      {
        id: 456,
        userId: 42,
        activityType: "Corrida",
        durationMinutes: 35,
        caloriesBurned: 280,
        occurredAt: new Date("2026-06-01T10:00:00Z").getTime(),
        notes: "Importado automaticamente do Strava. Referencia externa: strava:999. Tipo Strava: Run. Calorias: 321 kcal.",
        createdAt: Date.now(),
        updatedAt: new Date(),
      },
    ]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        token_type: "Bearer",
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: "read,activity:read_all",
        athlete: { id: 10, firstname: "Ana", lastname: "Atleta" },
      }))
      .mockResolvedValueOnce(jsonResponse([
        {
          id: 999,
          name: "Corrida matinal",
          sport_type: "Run",
          start_date: "2026-06-01T10:00:00Z",
          moving_time: 2100,
        },
      ]));
    vi.stubGlobal("fetch", fetchMock);

    const { healthIntegrationService } = await import("./service");
    await healthIntegrationService.handleStravaCallback({
      code: "oauth-code",
      state: encodeState(42),
      scope: "read,activity:read_all",
    });

    const syncResult = await healthIntegrationService.sync(42, { provider: "strava" });
    const activityRecord = syncResult.records.find(record => record.id === "999:activity");
    const energyRecord = syncResult.records.find(record => record.id === "999:energy");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(exerciseMocks.createExercise).not.toHaveBeenCalled();
    expect(exerciseMocks.updateExercise).not.toHaveBeenCalled();
    expect(activityRecord?.metadata).toMatchObject({
      calories: 280,
      caloriesSource: "strava",
      caloriesOrigin: "strava_summary",
      estimatedCalories: false,
    });
    expect(energyRecord).toMatchObject({
      dataType: "energy_burned",
      value: 280,
      unit: "kcal",
    });
  });
});