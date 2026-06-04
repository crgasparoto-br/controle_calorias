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
  beforeEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    dbMocks.reset();
    exerciseMocks.createExercise.mockReset();
    exerciseMocks.listExercises.mockReset();
    exerciseMocks.updateExercise.mockReset();
    process.env.STRAVA_CLIENT_ID = "client-id";
    process.env.STRAVA_CLIENT_SECRET = "client-secret";
    process.env.STRAVA_REDIRECT_URI = "https://app.test/api/health-integrations/strava/callback";
    delete process.env.STRAVA_AUTO_SYNC_DISABLED;
    delete process.env.STRAVA_AUTO_SYNC_INTERVAL_MINUTES;
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
      notes: "Importado automaticamente do Strava. Referencia externa: strava:999. Calorias: 321 kcal.",
    });
    expect(exerciseMocks.updateExercise).not.toHaveBeenCalled();
    expect(result.message).toContain("1 exercício(s) registrado(s)");
  });

  it("busca o detalhe da atividade quando o resumo do Strava vem sem calorias", async () => {
    vi.stubGlobal("fetch", vi.fn()
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
          id: 998,
          name: "Treino sem calorias no resumo",
          sport_type: "Run",
          start_date: "2026-06-02T23:00:00Z",
          moving_time: 1800,
        },
      ]))
      .mockResolvedValueOnce(jsonResponse({
        id: 998,
        name: "Treino sem calorias no resumo",
        sport_type: "Run",
        start_date: "2026-06-02T23:00:00Z",
        start_date_local: "2026-06-02T20:00:00Z",
        timezone: "America/Sao_Paulo",
        moving_time: 1800,
        elapsed_time: 1980,
        calories: 412,
        distance: 11000,
        total_elevation_gain: 16,
        average_speed: 2.723,
        max_speed: 4.7,
        average_heartrate: 147,
        max_heartrate: 180,
        average_cadence: 82.5,
        average_watts: 210,
        max_watts: 420,
        weighted_average_watts: 235,
        device_name: "Garmin Edge",
        gear_id: "b123",
        visibility: "followers_only",
        achievement_count: 2,
        kudos_count: 5,
        pr_count: 1,
        trainer: false,
        commute: false,
        manual: false,
        private: true,
        has_heartrate: true,
      })));

    const { healthIntegrationService } = await import("./service");

    await healthIntegrationService.handleStravaCallback({
      code: "oauth-code",
      state: encodeState(42),
      scope: "read,activity:read_all",
    });

    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "https://www.strava.com/api/v3/activities/998",
      expect.objectContaining({ headers: { Authorization: "Bearer access-token" } }),
    );
    expect(exerciseMocks.createExercise).toHaveBeenCalledWith(42, {
      activityType: "Run",
      durationMinutes: 30,
      caloriesBurned: 412,
      occurredAt: "2026-06-02T23:00:00Z",
      notes: "Importado automaticamente do Strava. Referencia externa: strava:998. Distancia: 11,00 km. Calorias: 412 kcal. Elevacao: 16 m. FC media: 147 bpm. Ritmo medio: 6:07/km.",
    });

    const status = await healthIntegrationService.getStatus(42);
    const activityRecord = status.recentRecords.find(record => record.id === "998:activity");
    expect(activityRecord?.metadata).toMatchObject({
      externalId: "998",
      name: "Treino sem calorias no resumo",
      sportType: "Run",
      distanceMeters: 11000,
      movingTimeSeconds: 1800,
      elapsedTimeSeconds: 1980,
      calories: 412,
      caloriesSource: "strava",
      estimatedCalories: false,
      totalElevationGainMeters: 16,
      averageSpeedMetersPerSecond: 2.723,
      maxSpeedMetersPerSecond: 4.7,
      averageHeartRate: 147,
      maxHeartRate: 180,
      averageCadence: 82.5,
      averageWatts: 210,
      maxWatts: 420,
      weightedAverageWatts: 235,
      deviceName: "Garmin Edge",
      gearId: "b123",
      startDateLocal: "2026-06-02T20:00:00Z",
      timezone: "America/Sao_Paulo",
      visibility: "followers_only",
      achievementCount: 2,
      kudosCount: 5,
      prCount: 1,
      trainer: false,
      commute: false,
      manual: false,
      private: true,
      hasHeartRate: true,
    });
  });

  it("estima calorias para treino com peso quando o Strava não retorna gasto energético", async () => {
    vi.stubGlobal("fetch", vi.fn()
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
          id: 997,
          name: "Treino de força",
          sport_type: "WeightTraining",
          start_date: "2026-06-02T22:00:00Z",
          moving_time: 2700,
        },
      ]))
      .mockResolvedValueOnce(jsonResponse({
        id: 997,
        name: "Treino de força",
        sport_type: "WeightTraining",
        start_date: "2026-06-02T22:00:00Z",
        moving_time: 2700,
        elapsed_time: 3000,
      })));

    const { healthIntegrationService } = await import("./service");

    await healthIntegrationService.handleStravaCallback({
      code: "oauth-code",
      state: encodeState(42),
      scope: "read,activity:read_all",
    });

    expect(exerciseMocks.createExercise).toHaveBeenCalledWith(42, {
      activityType: "WeightTraining",
      durationMinutes: 45,
      caloriesBurned: 207,
      occurredAt: "2026-06-02T22:00:00Z",
      notes: "Importado automaticamente do Strava. Referencia externa: strava:997. Calorias estimadas: 207 kcal.",
    });

    const status = await healthIntegrationService.getStatus(42);
    const activityRecord = status.recentRecords.find(record => record.id === "997:activity");
    const energyRecord = status.recentRecords.find(record => record.id === "997:energy");
    expect(activityRecord?.metadata).toMatchObject({
      calories: 207,
      caloriesSource: "estimated_strength",
      estimatedCalories: true,
      estimatedCaloriesWeightKg: 75,
      estimatedCaloriesMet: 3.5,
    });
    expect(energyRecord).toMatchObject({
      dataType: "energy_burned",
      value: 207,
      unit: "kcal",
    });
  });

  it("busca todas as páginas recentes do Strava antes de registrar exercícios", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: 1_000 + index,
      name: `Corrida ${index + 1}`,
      sport_type: "Run",
      start_date: "2026-06-01T10:00:00Z",
      moving_time: 60,
      calories: 50,
    }));
    const secondPage = [{
      id: 2_000,
      name: "Pedal noturno",
      sport_type: "Ride",
      start_date: "2026-06-02T23:00:00Z",
      moving_time: 1800,
      calories: 240,
    }];

    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        token_type: "Bearer",
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: "read,activity:read",
        athlete: { id: 10, firstname: "Ana", lastname: "Atleta" },
      }))
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockResolvedValueOnce(jsonResponse(secondPage)));

    const { healthIntegrationService } = await import("./service");

    await healthIntegrationService.handleStravaCallback({
      code: "oauth-code",
      state: encodeState(42),
      scope: "read,activity:read",
    });

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("per_page=100&page=1&after="),
      expect.objectContaining({ headers: { Authorization: "Bearer access-token" } }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("per_page=100&page=2&after="),
      expect.objectContaining({ headers: { Authorization: "Bearer access-token" } }),
    );
    expect(exerciseMocks.createExercise).toHaveBeenCalledTimes(101);
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
      notes: "Importado automaticamente do Strava. Referencia externa: strava:999. Calorias: 355 kcal.",
    });
  });

  it("sincroniza automaticamente usuários com token Strava persistido", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        token_type: "Bearer",
        access_token: "persisted-access-token",
        refresh_token: "persisted-refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: "read,activity:read",
        athlete: { id: 10, firstname: "Ana", lastname: "Atleta" },
      }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([
        {
          id: 999,
          name: "Treino noturno",
          sport_type: "Ride",
          start_date: "2026-06-02T23:00:00Z",
          moving_time: 1800,
          calories: 240,
        },
      ])));

    const { healthIntegrationService } = await import("./service");
    await healthIntegrationService.handleStravaCallback({
      code: "oauth-code",
      state: encodeState(42),
      scope: "read,activity:read",
    });

    const summary = await healthIntegrationService.syncConnectedStravaUsers();

    expect(summary).toMatchObject({
      attempted: 1,
      succeeded: 1,
      failed: 0,
      importedExercises: { created: 1, updated: 0, skipped: 0 },
    });
    expect(exerciseMocks.createExercise).toHaveBeenCalledWith(42, {
      activityType: "Ride",
      durationMinutes: 30,
      caloriesBurned: 240,
      occurredAt: "2026-06-02T23:00:00Z",
      notes: "Importado automaticamente do Strava. Referencia externa: strava:999. Calorias: 240 kcal.",
    });
  });

  it("mantém o Strava conectado após recriar o serviço usando token persistido", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-02T12:00:00Z"));
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        token_type: "Bearer",
        access_token: "persisted-access-token",
        refresh_token: "persisted-refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: "read,activity:read",
        athlete: { id: 10, firstname: "Ana", lastname: "Atleta" },
      }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([])));

    const firstImport = await import("./service");
    await firstImport.healthIntegrationService.handleStravaCallback({
      code: "oauth-code",
      state: encodeState(42),
      scope: "read,activity:read",
    });

    vi.resetModules();
    const secondImport = await import("./service");
    const status = await secondImport.healthIntegrationService.getStatus(42);
    const strava = status.providers.find(provider => provider.provider === "strava");

    expect(strava?.connection?.status).toBe("connected");
    expect(strava?.athleteName).toBe("Ana Atleta");

    await secondImport.healthIntegrationService.sync(42, { provider: "strava" });
    expect(fetch).toHaveBeenLastCalledWith(
      "https://www.strava.com/api/v3/athlete/activities?per_page=100&page=1&after=1775131200",
      expect.objectContaining({
        headers: { Authorization: "Bearer persisted-access-token" },
      }),
    );
  });
});
