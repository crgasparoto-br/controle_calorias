import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getUserWhatsappConnection: vi.fn(),
  logPersistenceWarning: vi.fn(),
  send: vi.fn(),
}));

vi.mock("../../db", () => ({
  getDb: dbMocks.getDb,
  getUserWhatsappConnection: dbMocks.getUserWhatsappConnection,
  logPersistenceWarning: dbMocks.logPersistenceWarning,
}));
vi.mock("../whatsapp/logicalReplyDelivery", () => ({
  sendWhatsAppStandaloneLogicalReply: dbMocks.send,
}));

import {
  activateProfessionalOfficialGoal,
  deliverProfessionalGoalNotification,
  ProfessionalGoalConflictError,
  requestProfessionalGoalReview,
  resolveProfessionalGoalRowsForDate,
} from "./officialGoalsService";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "goal-1",
    authorizationId: "authorization-1",
    trackingId: "tracking-1",
    professionalUserId: 10,
    patientUserId: 20,
    activePatientKey: "20",
    version: 1,
    calories: 2000,
    proteinGrams: 140,
    carbsGrams: 220,
    fatGrams: 65,
    includeExerciseCalories: true,
    exceptionsJson: [],
    effectiveFrom: new Date("2026-07-01T00:00:00Z"),
    effectiveUntil: null,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    professionalDisplayName: "Nutricionista",
    trackingStatus: "active",
    ...overrides,
  };
}

describe("official professional goals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getUserWhatsappConnection.mockResolvedValue({
      phoneNumber: "5511999999999",
      status: "active",
    });
    dbMocks.send.mockResolvedValue({
      result: { primaryOk: true, sends: [{ ok: true, detail: "sent" }] },
    });
  });

  it("resolves version history deterministically and stops precedence at effectiveUntil", () => {
    const rows = [
      row({
        id: "v1",
        version: 1,
        effectiveUntil: new Date("2026-07-15T00:00:00Z"),
      }),
      row({
        id: "v2",
        version: 2,
        calories: 2100,
        effectiveFrom: new Date("2026-07-15T00:00:00Z"),
      }),
    ];
    expect(
      resolveProfessionalGoalRowsForDate(rows, "2026-07-14")
    ).toMatchObject({
      professionalGoalId: "v1",
      calories: 2000,
      goalOrigin: "professional",
    });
    expect(
      resolveProfessionalGoalRowsForDate(rows, "2026-07-15")
    ).toMatchObject({ professionalGoalId: "v2", calories: 2100 });
    expect(
      resolveProfessionalGoalRowsForDate(
        [row({ effectiveUntil: new Date("2026-07-20T00:00:00Z") })],
        "2026-07-20"
      )
    ).toBeNull();
  });

  it("keeps weekday exceptions and the exercise flag in the canonical result", () => {
    const resolved = resolveProfessionalGoalRowsForDate(
      [
        row({
          effectiveFrom: new Date("2026-07-06T00:00:00Z"),
          includeExerciseCalories: false,
          exceptionsJson: [
            {
              weekday: 0,
              durationType: "1_week",
              calories: 2300,
              proteinGrams: 150,
              carbsGrams: 250,
              fatGrams: 70,
            },
          ],
        }),
      ],
      "2026-07-06"
    );
    expect(resolved).toMatchObject({
      source: "exception",
      calories: 2300,
      includeExerciseCalories: false,
    });
    expect(
      resolveProfessionalGoalRowsForDate(
        [
          row({
            effectiveFrom: new Date("2026-07-06T00:00:00Z"),
            exceptionsJson: [
              {
                weekday: 0,
                durationType: "1_week",
                calories: 2300,
                proteinGrams: 150,
                carbsGrams: 250,
                fatGrams: 70,
              },
            ],
          }),
        ],
        "2026-07-13"
      )
    ).toMatchObject({ source: "default", calories: 2000 });
  });

  it("keeps the last effective goal while tracking is paused", () => {
    expect(
      resolveProfessionalGoalRowsForDate(
        [row({ trackingStatus: "paused" })],
        "2026-07-20"
      )
    ).toMatchObject({
      calories: 2000,
      trackingStatus: "paused",
      goalOrigin: "professional",
    });
  });

  it("rejects inconsistent persisted exceptions instead of silently using zero or a fallback", () => {
    expect(() =>
      resolveProfessionalGoalRowsForDate(
        [row({ exceptionsJson: [{ weekday: 0, calories: 0 }] })],
        "2026-07-20"
      )
    ).toThrow("Exceções da meta profissional persistida são inválidas.");
  });

  it("activates the goal transactionally and records a successful notification without exposing justification", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        [
          {
            authorizationId: "authorization-1",
            trackingId: "tracking-1",
            trackingStatus: "active",
          },
        ],
      ])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([
        [
          {
            goalId: "ignored",
            patientUserId: 20,
            professionalUserId: 10,
            version: 1,
            calories: 2000,
            proteinGrams: 140,
            carbsGrams: 220,
            fatGrams: 65,
            effectiveFrom: new Date("2026-07-21T00:00:00Z"),
            professionalDisplayName: "Nutricionista",
          },
        ],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    const db = {
      execute,
      transaction: (callback: (tx: { execute: typeof execute }) => unknown) =>
        callback({ execute }),
    };
    dbMocks.getDb.mockResolvedValue(db);
    const result = await activateProfessionalOfficialGoal(10, {
      patientId: 20,
      effectiveFrom: "2026-07-21",
      justification: "Justificativa clínica privada",
      goal: {
        includeExerciseCalories: true,
        defaultGoal: {
          calories: 2000,
          proteinGrams: 140,
          carbsGrams: 220,
          fatGrams: 65,
        },
        exceptions: [],
      },
    });
    expect(result).toMatchObject({
      version: 1,
      notification: { status: "sent" },
    });
    const reply = dbMocks.send.mock.calls[0][1];
    expect(JSON.stringify(reply)).not.toContain(
      "Justificativa clínica privada"
    );
    expect(execute).toHaveBeenCalledTimes(9);
  });

  it("blocks a second professional instead of silently replacing the active goal", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        [
          {
            authorizationId: "authorization-2",
            trackingId: "tracking-2",
            trackingStatus: "active",
          },
        ],
      ])
      .mockResolvedValueOnce([[row({ professionalUserId: 99 })]]);
    dbMocks.getDb.mockResolvedValue({
      execute,
      transaction: (callback: (tx: { execute: typeof execute }) => unknown) =>
        callback({ execute }),
    });
    await expect(
      activateProfessionalOfficialGoal(10, {
        patientId: 20,
        effectiveFrom: "2026-07-21",
        justification: "Nova avaliação",
        goal: {
          includeExerciseCalories: true,
          defaultGoal: {
            calories: 2000,
            proteinGrams: 140,
            carbsGrams: 220,
            fatGrams: 65,
          },
          exceptions: [],
        },
      })
    ).rejects.toBeInstanceOf(ProfessionalGoalConflictError);
    expect(dbMocks.send).not.toHaveBeenCalled();
  });

  it("does not resend a notification already claimed or sent", async () => {
    dbMocks.getDb.mockResolvedValue({
      execute: vi.fn().mockResolvedValue([{ affectedRows: 0 }]),
    });
    await expect(
      deliverProfessionalGoalNotification(
        "f34f132b-94a5-47a6-bbe0-4a9720d4167d",
        10
      )
    ).resolves.toEqual({ status: "unchanged" });
    expect(dbMocks.send).not.toHaveBeenCalled();
  });

  it("returns the existing open review request on an idempotent retry", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[
        { id: "goal-1", professionalUserId: 10 },
      ]])
      .mockResolvedValueOnce([[
        { id: "review-1", status: "open", createdAt: new Date("2026-07-20T12:00:00Z") },
      ]]);
    dbMocks.getDb.mockResolvedValue({
      execute,
      transaction: vi.fn().mockRejectedValue(new Error("duplicate")),
    });
    await expect(
      requestProfessionalGoalReview(20, { reason: "Revisar distribuição" })
    ).resolves.toMatchObject({
      id: "review-1",
      status: "open",
      idempotent: true,
    });
  });
});
