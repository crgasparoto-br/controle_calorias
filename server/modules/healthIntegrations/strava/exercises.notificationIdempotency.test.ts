import { beforeEach, describe, expect, it, vi } from "vitest";

const createExerciseMock = vi.fn();
const listExercisesMock = vi.fn();
const updateExerciseMock = vi.fn();
const getUserWhatsappConnectionMock = vi.fn();
const logInferenceEventMock = vi.fn();
const tryCreateQuickEditLinkForExerciseMock = vi.fn();
const sendWhatsAppInteractiveUrlButtonMessageMock = vi.fn();
const sendWhatsAppTextMessageMock = vi.fn();

vi.mock("../../../db", () => ({
  getUserWhatsappConnection: getUserWhatsappConnectionMock,
  logInferenceEvent: logInferenceEventMock,
}));

vi.mock("../../exercises/service", () => ({
  createExercise: createExerciseMock,
  listExercises: listExercisesMock,
  updateExercise: updateExerciseMock,
}));

vi.mock("../../quickEdit/service", () => ({
  tryCreateQuickEditLinkForExercise: tryCreateQuickEditLinkForExerciseMock,
}));

vi.mock("../../whatsapp/webhookUtils", () => ({
  sendWhatsAppInteractiveUrlButtonMessage: sendWhatsAppInteractiveUrlButtonMessageMock,
  sendWhatsAppTextMessage: sendWhatsAppTextMessageMock,
}));

const {
  __resetStravaWhatsAppNotificationIdempotencyForTests,
  upsertStravaActivitiesAsExercises,
} = await import("./exercises");

const activity = {
  id: 987654321,
  name: "Corrida matinal",
  sport_type: "Run",
  type: "Run",
  start_date: "2026-07-07T10:00:00.000Z",
  moving_time: 3600,
  calories: 510,
} as const;

describe("upsertStravaActivitiesAsExercises WhatsApp notification idempotency", () => {
  beforeEach(() => {
    __resetStravaWhatsAppNotificationIdempotencyForTests();
    createExerciseMock.mockReset();
    listExercisesMock.mockReset();
    updateExerciseMock.mockReset();
    getUserWhatsappConnectionMock.mockReset();
    logInferenceEventMock.mockReset();
    tryCreateQuickEditLinkForExerciseMock.mockReset();
    sendWhatsAppInteractiveUrlButtonMessageMock.mockReset();
    sendWhatsAppTextMessageMock.mockReset();

    listExercisesMock.mockResolvedValue([]);
    getUserWhatsappConnectionMock.mockResolvedValue({
      userId: 42,
      phoneNumber: "5511999999999",
      status: "active",
    });
    tryCreateQuickEditLinkForExerciseMock.mockResolvedValue({ url: "https://app.example/exercise/quick-edit" });
    sendWhatsAppInteractiveUrlButtonMessageMock.mockResolvedValue({ ok: true, detail: "sent" });
    sendWhatsAppTextMessageMock.mockResolvedValue({ ok: true, detail: "sent" });
    createExerciseMock.mockImplementation(async (_userId, input) => ({
      id: Number(input.externalId),
      userId: 42,
      ...input,
      externalImportStatus: "created",
    }));
  });

  it("envia WhatsApp apenas uma vez quando a mesma atividade Strava é processada em sincronizações repetidas", async () => {
    const first = await upsertStravaActivitiesAsExercises(42, [{ ...activity }]);
    const second = await upsertStravaActivitiesAsExercises(42, [{ ...activity }]);

    expect(first).toEqual(expect.objectContaining({
      created: 1,
      notificationsSent: 1,
      notificationsSkipped: 0,
    }));
    expect(second).toEqual(expect.objectContaining({
      created: 1,
      notificationsSent: 0,
      notificationsSkipped: 1,
    }));
    expect(createExerciseMock).toHaveBeenCalledTimes(2);
    expect(sendWhatsAppInteractiveUrlButtonMessageMock).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppInteractiveUrlButtonMessageMock).toHaveBeenCalledWith(
      "5511999999999",
      expect.stringContaining("Treino importado do Strava"),
      "Ver exercício",
      "https://app.example/exercise/quick-edit",
    );
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "strava.whatsapp_import_notification_skipped_idempotent",
    }));
  });

  it("continua notificando quando chega uma atividade Strava diferente", async () => {
    await upsertStravaActivitiesAsExercises(42, [{ ...activity }]);
    await upsertStravaActivitiesAsExercises(42, [{ ...activity, id: 987654322, name: "Pedal" }]);

    expect(sendWhatsAppInteractiveUrlButtonMessageMock).toHaveBeenCalledTimes(2);
  });

  it("não reenvia notificação quando a atividade já existe localmente", async () => {
    listExercisesMock.mockResolvedValueOnce([
      {
        id: 15,
        userId: 42,
        activityType: "Corrida",
        durationMinutes: 60,
        caloriesBurned: 510,
        occurredAt: new Date(activity.start_date).getTime(),
        notes: "Importado do Strava. Referencia externa: strava:987654321. Calorias: 510 kcal.",
        externalProvider: "strava",
        externalId: "987654321",
        createdAt: Date.now(),
        updatedAt: new Date(),
      },
    ]);

    const result = await upsertStravaActivitiesAsExercises(42, [{ ...activity }]);

    expect(result).toEqual(expect.objectContaining({
      skipped: 1,
      notificationsSent: 0,
      notificationsSkipped: 1,
    }));
    expect(createExerciseMock).not.toHaveBeenCalled();
    expect(updateExerciseMock).not.toHaveBeenCalled();
    expect(sendWhatsAppInteractiveUrlButtonMessageMock).not.toHaveBeenCalled();
  });
});
