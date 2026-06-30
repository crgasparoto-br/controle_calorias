import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getUserWhatsappConnection: vi.fn(),
  logInferenceEvent: vi.fn(),
}));
const exerciseMocks = vi.hoisted(() => ({
  createExercise: vi.fn(),
  listExercises: vi.fn(),
  updateExercise: vi.fn(),
}));
const quickEditMocks = vi.hoisted(() => ({
  tryCreateQuickEditLinkForExercise: vi.fn(),
}));
const whatsappMocks = vi.hoisted(() => ({
  sendWhatsAppInteractiveUrlButtonMessage: vi.fn(),
  sendWhatsAppTextMessage: vi.fn(),
}));

vi.mock("../../../db", () => ({
  getUserWhatsappConnection: dbMocks.getUserWhatsappConnection,
  logInferenceEvent: dbMocks.logInferenceEvent,
}));

vi.mock("../../exercises/service", () => ({
  createExercise: exerciseMocks.createExercise,
  listExercises: exerciseMocks.listExercises,
  updateExercise: exerciseMocks.updateExercise,
}));

vi.mock("../../quickEdit/service", () => ({
  tryCreateQuickEditLinkForExercise: quickEditMocks.tryCreateQuickEditLinkForExercise,
}));

vi.mock("../../whatsapp/webhookUtils", () => ({
  sendWhatsAppInteractiveUrlButtonMessage: whatsappMocks.sendWhatsAppInteractiveUrlButtonMessage,
  sendWhatsAppTextMessage: whatsappMocks.sendWhatsAppTextMessage,
}));

vi.mock("./activities", () => ({
  fetchStravaActivityDetail: vi.fn(),
  getStravaMaxActivityDetailRequestsPerSync: () => 0,
  shouldFetchStravaActivityDetail: () => false,
}));

vi.mock("./oauth", () => ({
  ensureValidStravaToken: vi.fn(),
}));

vi.mock("./rateLimit", () => ({
  StravaRateLimitError: class StravaRateLimitError extends Error {},
  getStravaGlobalCooldownError: () => null,
  setStravaUserCooldown: vi.fn(),
}));

const { upsertStravaActivitiesAsExercises } = await import("./exercises");

const activity = {
  id: 999,
  name: "Corrida matinal",
  sport_type: "Run",
  start_date: "2026-06-30T10:00:00Z",
  moving_time: 2100,
  calories: 321,
} as const;

function existingExercise(notes: string) {
  return {
    id: 456,
    userId: 42,
    activityType: "Corrida",
    durationMinutes: 35,
    caloriesBurned: 280,
    occurredAt: Date.parse("2026-06-30T10:00:00Z"),
    notes,
    createdAt: Date.now(),
    updatedAt: new Date(),
  };
}

describe("Strava WhatsApp import notification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getUserWhatsappConnection.mockResolvedValue({ status: "active", phoneNumber: "5511999999999" });
    quickEditMocks.tryCreateQuickEditLinkForExercise.mockResolvedValue({ url: "https://app.test/quick-edit/exercise/token" });
    whatsappMocks.sendWhatsAppInteractiveUrlButtonMessage.mockResolvedValue({ ok: true, detail: "sent" });
    exerciseMocks.createExercise.mockImplementation(async (_userId, input) => ({ id: 123, userId: _userId, ...input }));
    exerciseMocks.updateExercise.mockResolvedValue({ id: 456 });
  });

  it("envia WhatsApp quando cria exercício Strava novo", async () => {
    exerciseMocks.listExercises.mockResolvedValue([]);

    await upsertStravaActivitiesAsExercises(42, [{ ...activity }]);

    expect(exerciseMocks.createExercise).toHaveBeenCalledOnce();
    expect(whatsappMocks.sendWhatsAppInteractiveUrlButtonMessage).toHaveBeenCalledOnce();
  });

  it("não reenvia WhatsApp quando apenas atualiza exercício Strava existente", async () => {
    exerciseMocks.listExercises.mockResolvedValue([
      existingExercise("Importado automaticamente do Strava. Referencia externa: strava:999. Calorias estimadas: 280 kcal."),
    ]);

    await upsertStravaActivitiesAsExercises(42, [{ ...activity }]);

    expect(exerciseMocks.updateExercise).toHaveBeenCalledOnce();
    expect(exerciseMocks.createExercise).not.toHaveBeenCalled();
    expect(whatsappMocks.sendWhatsAppInteractiveUrlButtonMessage).not.toHaveBeenCalled();
    expect(whatsappMocks.sendWhatsAppTextMessage).not.toHaveBeenCalled();
  });
});
