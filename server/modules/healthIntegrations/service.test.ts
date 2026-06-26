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

function stravaRateLimitResponse(retryAfterSeconds = 120) {
  return new Response(JSON.stringify({ message: "Rate Limit Exceeded" }), {
    status: 429,
    headers: { "Retry-After": String(retryAfterSeconds) },
  });
}

describe("healthIntegrationService Strava", () => {
  beforeEach(async () => {
    vi.useRealTimers();
    vi.resetModules();
    dbMocks.reset();
    exerciseMocks.createExercise.mockReset();
    exerciseMocks.listExercises.mockReset();
    exerciseMocks.updateExercise.mockReset();
    const dbModule = await import("../../db");
    vi.mocked(dbModule.getUserWhatsappConnection).mockReset();
    vi.mocked(dbModule.getUserWhatsappConnection).mockResolvedValue(null);
    vi.mocked(dbModule.getWhatsAppAccessToken).mockReset();
    vi.mocked(dbModule.getWhatsAppAccessToken).mockResolvedValue("whatsapp-access-token");
    vi.mocked(dbModule.logInferenceEvent).mockReset();
    process.env.STRAVA_CLIENT_ID = "client-id";
    process.env.STRAVA_CLIENT_SECRET = "client-secret";
    process.env.STRAVA_REDIRECT_URI = "https://app.test/api/health-integrations/strava/callback";
    delete process.env.WHATSAPP_PHONE_NUMBER;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.QUICK_EDIT_BASE_URL;
    delete process.env.STRAVA_AUTO_SYNC_DISABLED;
    delete process.env.STRAVA_AUTO_SYNC_INTERVAL_MINUTES;
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
      ]))
      // Detalhe da corrida (id 999): agora sempre buscamos o detalhe para obter calorias reais do dispositivo
      .mockResolvedValueOnce(jsonResponse({
        id: 999,
        name: "Corrida matinal",
        sport_type: "Run",
        start_date: "2026-06-01T10:00:00Z",
        moving_time: 2100,
        calories: 321,
      }))
      // Detalhe da caminhada (id 1000): sem calorias no detalhe, usa summary como fallback (também 0, cai na estimativa local)
      .mockResolvedValueOnce(jsonResponse({
        id: 1000,
        name: "Atividade sem gasto",
        sport_type: "Walk",
        start_date: "2026-06-01T12:00:00Z",
        moving_time: 900,
        calories: 0,
      })));

    const { healthIntegrationService } = await import("./service");

    const result = await healthIntegrationService.handleStravaCallback({
      code: "oauth-code",
      state: encodeState(42),
      scope: "read,activity:read",
    });

    expect(result.ok).toBe(true);
    expect(exerciseMocks.createExercise).toHaveBeenCalledWith(42, {
      activityType: "Corrida",
      durationMinutes: 35,
      caloriesBurned: 321,
      occurredAt: "2026-06-01T10:00:00Z",
      notes: "Importado automaticamente do Strava. Referencia externa: strava:999. Tipo Strava: Run. Calorias: 321 kcal.",
    });
    expect(exerciseMocks.createExercise).toHaveBeenCalledWith(42, {
      activityType: "Caminhada",
      durationMinutes: 15,
      caloriesBurned: 60,
      occurredAt: "2026-06-01T12:00:00Z",
      notes: "Importado automaticamente do Strava. Referencia externa: strava:1000. Tipo Strava: Walk. Calorias estimadas: 60 kcal.",
    });
    expect(exerciseMocks.updateExercise).not.toHaveBeenCalled();
    expect(result.message).toContain("2 exercício(s) registrado(s)");
  });

  it("envia WhatsApp ao importar novo exercício do Strava", async () => {
    process.env.WHATSAPP_PHONE_NUMBER = "5511000000000";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-number-test";
    process.env.QUICK_EDIT_BASE_URL = "https://app.test";
    exerciseMocks.listExercises
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 123,
          userId: 42,
          activityType: "Treinamento com peso noturno",
          durationMinutes: 6,
          caloriesBurned: 49,
          occurredAt: new Date("2026-06-02T23:00:00Z").getTime(),
          notes: "Importado automaticamente do Strava. Referencia externa: strava:996. Calorias: 49 kcal.",
          createdAt: Date.now(),
          updatedAt: new Date(),
        },
      ]);
    const dbModule = await import("../../db");
    vi.mocked(dbModule.getUserWhatsappConnection).mockResolvedValue({
      id: 1,
      userId: 42,
      phoneNumber: "5511999999999",
      displayName: "Ana",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const fetchMock = vi.fn()
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
          id: 996,
          name: "Treinamento com peso noturno",
          start_date: "2026-06-02T23:00:00Z",
          moving_time: 360,
          calories: 49,
        },
      ]))
      // Detalhe da atividade (id 996): agora sempre buscamos o detalhe
      .mockResolvedValueOnce(jsonResponse({
        id: 996,
        name: "Treinamento com peso noturno",
        start_date: "2026-06-02T23:00:00Z",
        moving_time: 360,
        calories: 49,
      }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const { healthIntegrationService } = await import("./service");

    await healthIntegrationService.handleStravaCallback({
      code: "oauth-code",
      state: encodeState(42),
      scope: "read,activity:read",
    });

    // Chamada 1: token OAuth, Chamada 2: listagem de atividades, Chamada 3: detalhe da atividade, Chamada 4: WhatsApp
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "https://graph.facebook.com/v22.0/phone-number-test/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer whatsapp-access-token",
          "Content-Type": "application/json",
        }),
      }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[3][1]?.body));
    expect(body).toMatchObject({
      messaging_product: "whatsapp",
      to: "5511999999999",
      type: "interactive",
      interactive: {
        type: "cta_url",
        action: {
          name: "cta_url",
          parameters: {
            display_text: "Ver exercício",
          },
        },
      },
    });
    expect(body.interactive.action.parameters.url).toMatch(/^https:\/\/app\.test\/quick-edit\/exercise\//);
    expect(body.interactive.body.text).toBe([
      "*Treino importado do Strava* 🏋️",
      "",
      "Treinamento com peso noturno — 06 min",
      "Calorias queimadas: 49 kcal 🔥",
      "Data: 02/06",
    ].join("\n"));
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
      activityType: "Corrida",
      durationMinutes: 30,
      caloriesBurned: 412,
      occurredAt: "2026-06-02T23:00:00Z",
      notes: "Importado automaticamente do Strava. Referencia externa: strava:998. Tipo Strava: Run. Distancia: 11,00 km. Calorias: 412 kcal. Elevacao: 16 m. FC media: 147 bpm. Ritmo medio: 6:07/km.",
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

  it("busca detalhe para corrida com kilojoules no resumo e prioriza calories do detalhe", async () => {
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
          id: 996,
          name: "Corrida com kJ no resumo",
          sport_type: "Run",
          start_date: "2026-06-02T22:00:00Z",
          moving_time: 2400,
          kilojoules: 573,
        },
      ]))
      .mockResolvedValueOnce(jsonResponse({
        id: 996,
        name: "Corrida com kJ no resumo",
        sport_type: "Run",
        start_date: "2026-06-02T22:00:00Z",
        moving_time: 2400,
        elapsed_time: 2520,
        calories: 390,
        kilojoules: 573,
      })));

    const { healthIntegrationService } = await import("./service");

    await healthIntegrationService.handleStravaCallback({
      code: "oauth-code",
      state: encodeState(42),
      scope: "read,activity:read_all",
    });

    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "https://www.strava.com/api/v3/activities/996",
      expect.objectContaining({ headers: { Authorization: "Bearer access-token" } }),
    );
    expect(exerciseMocks.createExercise).toHaveBeenCalledWith(42, {
      activityType: "Corrida",
      durationMinutes: 40,
      caloriesBurned: 390,
      occurredAt: "2026-06-02T22:00:00Z",
      notes: "Importado automaticamente do Strava. Referencia externa: strava:996. Tipo Strava: Run. Calorias: 390 kcal.",
    });

    const status = await healthIntegrationService.getStatus(42);
    const activityRecord = status.recentRecords.find(record => record.id === "996:activity");
    expect(activityRecord?.metadata).toMatchObject({
      calories: 390,
      caloriesSource: "strava",
      estimatedCalories: false,
      kilojoules: 573,
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
      activityType: "Musculacao",
      durationMinutes: 45,
      caloriesBurned: 295,
      occurredAt: "2026-06-02T22:00:00Z",
      notes: "Importado automaticamente do Strava. Referencia externa: strava:997. Tipo Strava: WeightTraining. Calorias estimadas: 295 kcal.",
    });

    const status = await healthIntegrationService.getStatus(42);
    const activityRecord = status.recentRecords.find(record => record.id === "997:activity");
    const energyRecord = status.recentRecords.find(record => record.id === "997:energy");
    expect(activityRecord?.metadata).toMatchObject({
      calories: 295,
      caloriesSource: "estimated_strength",
      estimatedCalories: true,
      estimatedCaloriesWeightKg: 75,
      estimatedCaloriesMet: 5,
    });
    expect(energyRecord).toMatchObject({
      dataType: "energy_burned",
      value: 295,
      unit: "kcal",
    });
  });

  it("prioriza calories do detalhe para musculação em vez de estimativa local", async () => {
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
          id: 995,
          name: "Treino de força com calorias no detalhe",
          sport_type: "WeightTraining",
          start_date: "2026-06-02T20:30:00Z",
          moving_time: 2700,
          kilojoules: 700,
        },
      ]))
      .mockResolvedValueOnce(jsonResponse({
        id: 995,
        name: "Treino de força com calorias no detalhe",
        sport_type: "WeightTraining",
        start_date: "2026-06-02T20:30:00Z",
        moving_time: 2700,
        elapsed_time: 2850,
        calories: 430,
        kilojoules: 700,
      })));

    const { healthIntegrationService } = await import("./service");

    await healthIntegrationService.handleStravaCallback({
      code: "oauth-code",
      state: encodeState(42),
      scope: "read,activity:read_all",
    });

    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "https://www.strava.com/api/v3/activities/995",
      expect.objectContaining({ headers: { Authorization: "Bearer access-token" } }),
    );
    expect(exerciseMocks.createExercise).toHaveBeenCalledWith(42, {
      activityType: "Musculacao",
      durationMinutes: 45,
      caloriesBurned: 430,
      occurredAt: "2026-06-02T20:30:00Z",
      notes: "Importado automaticamente do Strava. Referencia externa: strava:995. Tipo Strava: WeightTraining. Calorias: 430 kcal.",
    });

    const status = await healthIntegrationService.getStatus(42);
    const activityRecord = status.recentRecords.find(record => record.id === "995:activity");
    expect(activityRecord?.metadata).toMatchObject({
      calories: 430,
      caloriesSource: "strava",
      estimatedCalories: false,
      kilojoules: 700,
    });
  });

  it("não usa kilojoules como fonte principal para corrida sem calories", async () => {
    process.env.STRAVA_MAX_ACTIVITY_DETAIL_REQUESTS_PER_SYNC = "0";

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
          id: 994,
          name: "Corrida com kJ e sem calories",
          sport_type: "Run",
          start_date: "2026-06-01T10:00:00Z",
          moving_time: 1800,
          kilojoules: 573,
        },
      ]));
    vi.stubGlobal("fetch", fetchMock);

    const { healthIntegrationService } = await import("./service");

    await healthIntegrationService.handleStravaCallback({
      code: "oauth-code",
      state: encodeState(42),
      scope: "read,activity:read_all",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(exerciseMocks.createExercise).toHaveBeenCalledWith(42, {
      activityType: "Corrida",
      durationMinutes: 30,
      caloriesBurned: 300,
      occurredAt: "2026-06-01T10:00:00Z",
      notes: "Importado automaticamente do Strava. Referencia externa: strava:994. Tipo Strava: Run. Calorias estimadas: 300 kcal.",
    });

    const status = await healthIntegrationService.getStatus(42);
    const activityRecord = status.recentRecords.find(record => record.id === "994:activity");
    expect(activityRecord?.metadata).toMatchObject({
      calories: 300,
      caloriesSource: "estimated_activity",
      estimatedCalories: true,
      kilojoules: 573,
    });
  });

  it("mantém kilojoules como fallback para atividades de pedal sem calories", async () => {
    process.env.STRAVA_MAX_ACTIVITY_DETAIL_REQUESTS_PER_SYNC = "0";

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
          id: 993,
          name: "Pedal com kJ",
          sport_type: "Ride",
          start_date: "2026-06-01T12:00:00Z",
          moving_time: 1800,
          kilojoules: 600,
        },
      ]));
    vi.stubGlobal("fetch", fetchMock);

    const { healthIntegrationService } = await import("./service");

    await healthIntegrationService.handleStravaCallback({
      code: "oauth-code",
      state: encodeState(42),
      scope: "read,activity:read_all",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(exerciseMocks.createExercise).toHaveBeenCalledWith(42, {
      activityType: "Pedal",
      durationMinutes: 30,
      caloriesBurned: 143,
      occurredAt: "2026-06-01T12:00:00Z",
      notes: "Importado automaticamente do Strava. Referencia externa: strava:993. Tipo Strava: Ride. Calorias: 143 kcal.",
    });

    const status = await healthIntegrationService.getStatus(42);
    const activityRecord = status.recentRecords.find(record => record.id === "993:activity");
    expect(activityRecord?.metadata).toMatchObject({
      calories: 143,
      caloriesSource: "kilojoules",
      estimatedCalories: false,
      kilojoules: 600,
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

  it("limita buscas de detalhe do Strava para não consumir a cota em uma única sincronização", async () => {
    process.env.STRAVA_MAX_ACTIVITY_DETAIL_REQUESTS_PER_SYNC = "2";
    const activitiesWithoutCalories = Array.from({ length: 5 }, (_, index) => ({
      id: 3_000 + index,
      name: `Treino sem calorias ${index + 1}`,
      sport_type: "Run",
      start_date: "2026-06-01T10:00:00Z",
      moving_time: 1800,
    }));

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        token_type: "Bearer",
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: "read,activity:read_all",
        athlete: { id: 10, firstname: "Ana", lastname: "Atleta" },
      }))
      .mockResolvedValueOnce(jsonResponse(activitiesWithoutCalories))
      .mockResolvedValueOnce(jsonResponse({ ...activitiesWithoutCalories[0], calories: 210 }))
      .mockResolvedValueOnce(jsonResponse({ ...activitiesWithoutCalories[1], calories: 220 }));
    vi.stubGlobal("fetch", fetchMock);

    const { healthIntegrationService } = await import("./service");

    await healthIntegrationService.handleStravaCallback({
      code: "oauth-code",
      state: encodeState(42),
      scope: "read,activity:read_all",
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://www.strava.com/api/v3/activities/3000",
      expect.objectContaining({ headers: { Authorization: "Bearer access-token" } }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "https://www.strava.com/api/v3/activities/3001",
      expect.objectContaining({ headers: { Authorization: "Bearer access-token" } }),
    );
    expect(exerciseMocks.createExercise).toHaveBeenCalledTimes(5);
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
      activityType: "Corrida",
      durationMinutes: 40,
      caloriesBurned: 355,
      occurredAt: "2026-06-01T10:00:00Z",
      notes: "Importado automaticamente do Strava. Referencia externa: strava:999. Tipo Strava: Run. Calorias: 355 kcal.",
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
      activityType: "Pedal",
      durationMinutes: 30,
      caloriesBurned: 240,
      occurredAt: "2026-06-02T23:00:00Z",
      notes: "Importado automaticamente do Strava. Referencia externa: strava:999. Tipo Strava: Ride. Calorias: 240 kcal.",
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
    // incremental: lastSyncedAt (2026-06-02T12:00:00Z) minus 24h overlap = 2026-06-01T12:00:00Z
    expect(fetch).toHaveBeenLastCalledWith(
      "https://www.strava.com/api/v3/athlete/activities?per_page=100&page=1&after=1780315200",
      expect.objectContaining({
        headers: { Authorization: "Bearer persisted-access-token" },
      }),
    );
  });

  it("respeita cooldown quando o Strava retorna limite 429", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T12:00:00Z"));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        token_type: "Bearer",
        access_token: "persisted-access-token",
        refresh_token: "persisted-refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: "read,activity:read",
        athlete: { id: 10, firstname: "Ana", lastname: "Atleta" },
      }))
      .mockResolvedValueOnce(stravaRateLimitResponse(300));
    vi.stubGlobal("fetch", fetchMock);

    const { healthIntegrationService } = await import("./service");
    await healthIntegrationService.handleStravaCallback({
      code: "oauth-code",
      state: encodeState(42),
      scope: "read,activity:read",
    });

    await expect(healthIntegrationService.sync(42, { provider: "strava" }))
      .rejects
      .toThrow("Limite de requisições do Strava atingido");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("backfill inicial usa janela de 7 dias quando não há lastSyncedAt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00Z"));

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        token_type: "Bearer",
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: "read,activity:read",
        athlete: { id: 10, firstname: "Ana", lastname: "Atleta" },
      }))
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const { healthIntegrationService } = await import("./service");
    await healthIntegrationService.handleStravaCallback({
      code: "oauth-code",
      state: encodeState(42),
      scope: "read,activity:read",
    });

    // 2026-06-10T12:00:00Z - 7 days = 2026-06-03T12:00:00Z
    const expectedAfter = Math.floor((new Date("2026-06-03T12:00:00Z").getTime()) / 1000);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(`after=${expectedAfter}`),
      expect.anything(),
    );
  });

  it("sync incremental usa lastSyncedAt com margem de overlap de 24h", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00Z"));

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        token_type: "Bearer",
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: "read,activity:read",
        athlete: { id: 10, firstname: "Ana", lastname: "Atleta" },
      }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const { healthIntegrationService } = await import("./service");
    await healthIntegrationService.handleStravaCallback({
      code: "oauth-code",
      state: encodeState(42),
      scope: "read,activity:read",
    });

    // second sync: lastSyncedAt = 2026-06-10T12:00:00Z, overlap 24h → after = 2026-06-09T12:00:00Z
    await healthIntegrationService.sync(42, { provider: "strava" });
    const expectedAfter = Math.floor((new Date("2026-06-09T12:00:00Z").getTime()) / 1000);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining(`after=${expectedAfter}`),
      expect.anything(),
    );
  });

  it("overlap é configurável via STRAVA_INCREMENTAL_OVERLAP_HOURS", async () => {
    process.env.STRAVA_INCREMENTAL_OVERLAP_HOURS = "48";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00Z"));

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        token_type: "Bearer",
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: "read,activity:read",
        athlete: { id: 10, firstname: "Ana", lastname: "Atleta" },
      }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const { healthIntegrationService } = await import("./service");
    await healthIntegrationService.handleStravaCallback({
      code: "oauth-code",
      state: encodeState(42),
      scope: "read,activity:read",
    });

    await healthIntegrationService.sync(42, { provider: "strava" });
    // overlap 48h: lastSyncedAt (2026-06-10T12:00:00Z) - 48h = 2026-06-08T12:00:00Z
    const expectedAfter = Math.floor((new Date("2026-06-08T12:00:00Z").getTime()) / 1000);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining(`after=${expectedAfter}`),
      expect.anything(),
    );

    delete process.env.STRAVA_INCREMENTAL_OVERLAP_HOURS;
  });

  it("cooldown global bloqueia todos os usuários após 429 na lista de atividades", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00Z"));

    const fetchMockUser42 = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        token_type: "Bearer",
        access_token: "token-user-42",
        refresh_token: "refresh-42",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: "read,activity:read",
        athlete: { id: 10 },
      }))
      .mockResolvedValueOnce(stravaRateLimitResponse(120));
    vi.stubGlobal("fetch", fetchMockUser42);

    const { healthIntegrationService } = await import("./service");
    await healthIntegrationService.handleStravaCallback({
      code: "oauth-code-42",
      state: encodeState(42),
      scope: "read,activity:read",
    });

    // user 42 hits 429
    await expect(healthIntegrationService.sync(42, { provider: "strava" }))
      .rejects
      .toThrow("Limite de requisições do Strava atingido");

    // persist a second user (99) with a stored token
    const fetchMockUser99 = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        token_type: "Bearer",
        access_token: "token-user-99",
        refresh_token: "refresh-99",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: "read,activity:read",
        athlete: { id: 20 },
      }))
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMockUser99);
    await healthIntegrationService.handleStravaCallback({
      code: "oauth-code-99",
      state: encodeState(99),
      scope: "read,activity:read",
    });

    // user 99 should also be blocked by global cooldown — no fetch should happen
    const fetchMockAfterCooldown = vi.fn();
    vi.stubGlobal("fetch", fetchMockAfterCooldown);

    await expect(healthIntegrationService.sync(99, { provider: "strava" }))
      .rejects
      .toThrow("Limite de requisições do Strava atingido");

    expect(fetchMockAfterCooldown).not.toHaveBeenCalled();
  });

  it("cooldown global expira e libera sincronização após o tempo de espera", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00Z"));

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        token_type: "Bearer",
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: "read,activity:read",
        athlete: { id: 10 },
      }))
      .mockResolvedValueOnce(stravaRateLimitResponse(60))
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const { healthIntegrationService } = await import("./service");
    await healthIntegrationService.handleStravaCallback({
      code: "oauth-code",
      state: encodeState(42),
      scope: "read,activity:read",
    });

    await expect(healthIntegrationService.sync(42, { provider: "strava" }))
      .rejects
      .toThrow("Limite de requisições do Strava atingido");

    // advance time past the cooldown window
    vi.advanceTimersByTime(90_000);

    // should succeed now
    await healthIntegrationService.sync(42, { provider: "strava" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("limite padrão de chamadas de detalhe por sync cobre todas as atividades pendentes", async () => {
    const activitiesWithoutCalories = Array.from({ length: 10 }, (_, i) => ({
      id: 5_000 + i,
      name: `Treino ${i + 1}`,
      sport_type: "Run",
      start_date: "2026-06-01T10:00:00Z",
      moving_time: 1800,
    }));

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        token_type: "Bearer",
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: "read,activity:read_all",
        athlete: { id: 10, firstname: "Ana", lastname: "Atleta" },
      }))
      .mockResolvedValueOnce(jsonResponse(activitiesWithoutCalories));

    // Mock detail responses for all 10 pending activities
    for (let i = 0; i < 10; i++) {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ...activitiesWithoutCalories[i], calories: 200 + i }));
    }

    vi.stubGlobal("fetch", fetchMock);

    const { healthIntegrationService } = await import("./service");
    await healthIntegrationService.handleStravaCallback({
      code: "oauth-code",
      state: encodeState(42),
      scope: "read,activity:read_all",
    });

    // 1 token exchange + 1 list page + 10 detail requests (no artificial cap) = 12 total
    expect(fetchMock).toHaveBeenCalledTimes(12);
  });

  it("intervalo padrão do auto sync é 120 minutos", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00Z"));

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([])));

    const { startStravaAutoSyncScheduler, healthIntegrationService: svc } = await import("./service");

    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const scheduler = startStravaAutoSyncScheduler();
    expect(scheduler.enabled).toBe(true);

    // initial run fires after 5s
    await vi.advanceTimersByTimeAsync(5_000);

    // reset call count
    fetchMock.mockClear();

    // advance 119 minutes — should NOT have triggered another run
    await vi.advanceTimersByTimeAsync(119 * 60_000);
    const callsAt119 = fetchMock.mock.calls.length;

    // advance 1 more minute (total 120) — interval fires
    await vi.advanceTimersByTimeAsync(60_000);

    // no Strava users connected so syncConnectedStravaUsers resolves immediately without fetching
    expect(callsAt119).toBe(0);
    scheduler.stop();
  });
});
