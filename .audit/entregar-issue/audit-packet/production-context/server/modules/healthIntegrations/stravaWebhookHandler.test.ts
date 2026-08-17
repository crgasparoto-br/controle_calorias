import { beforeEach, describe, expect, it, vi } from "vitest";

const syncMock = vi.fn();
const listStoredStravaUserIdsMock = vi.fn();
const loadStoredStravaTokenStateMock = vi.fn();
const upsertHealthSyncedRecordsMock = vi.fn();

vi.mock("./stravaDetailSafeService", () => ({
  healthIntegrationService: {
    sync: syncMock,
  },
}));

vi.mock("./strava/tokenStorage", () => ({
  listStoredStravaUserIds: listStoredStravaUserIdsMock,
  loadStoredStravaTokenState: loadStoredStravaTokenStateMock,
}));

vi.mock("../../repositories/healthSyncedRecordsRepository", () => ({
  upsertHealthSyncedRecords: upsertHealthSyncedRecordsMock,
}));

const { handleStravaWebhookEvent } = await import("./stravaWebhookHandler");

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
};

function createResponse(): MockResponse {
  return {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

describe("handleStravaWebhookEvent", () => {
  beforeEach(() => {
    syncMock.mockReset();
    listStoredStravaUserIdsMock.mockReset();
    loadStoredStravaTokenStateMock.mockReset();
    upsertHealthSyncedRecordsMock.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("persiste registros sincronizados quando o webhook importa atividade Strava", async () => {
    listStoredStravaUserIdsMock.mockResolvedValue([42]);
    loadStoredStravaTokenStateMock.mockResolvedValue({ athleteId: 777 });
    syncMock.mockResolvedValue({
      importedExercises: { created: 1, updated: 0, skipped: 0 },
      records: [
        {
          id: "123:activity",
          source: "strava",
          dataType: "activity",
          measuredAt: "2026-06-26T23:00:00.000Z",
          value: 51,
          unit: "minutes",
          activityType: "Corrida",
          metadata: { externalId: "123", calories: 383 },
        },
        {
          id: "123:energy",
          source: "strava",
          dataType: "energy_burned",
          measuredAt: "2026-06-26T23:00:00.000Z",
          value: 383,
          unit: "kcal",
          activityType: "Corrida",
          metadata: { externalId: "123", calories: 383 },
        },
      ],
    });

    const res = createResponse();
    handleStravaWebhookEvent({
      body: {
        aspect_type: "create",
        event_time: 1782514800,
        object_id: 123,
        object_type: "activity",
        owner_id: 777,
        subscription_id: 999,
      },
    } as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: "received" });
    await vi.waitFor(() => expect(upsertHealthSyncedRecordsMock).toHaveBeenCalledOnce());
    expect(upsertHealthSyncedRecordsMock).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "123:activity",
        userId: 42,
        provider: "strava",
        source: "strava",
        createdAt: expect.any(Number),
      }),
      expect.objectContaining({
        id: "123:energy",
        userId: 42,
        provider: "strava",
        source: "strava",
        createdAt: expect.any(Number),
      }),
    ]);
  });
});