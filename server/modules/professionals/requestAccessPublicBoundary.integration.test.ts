import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../../_core/context";
import { appRouter } from "../../routers";
import { upsertProfessionalProfile } from "./service";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createProfessionalContext(userId: number): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId: `user-${userId}`,
    email: `user-${userId}@example.com`,
    name: `Professional ${userId}`,
    loginMethod: "password",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined } as TrpcContext["res"],
  };
}

function expectPendingReceipt(result: unknown) {
  expect(result).toEqual({
    id: expect.any(String),
    status: "pending",
    requestedAt: expect.any(Number),
  });
  expect(result).not.toHaveProperty("patient");
  expect(result).not.toHaveProperty("patientUserId");
  expect(result).not.toHaveProperty("authorizationId");
}

describe("nutrition.professionals.requestAccess public caller", () => {
  it("makes existing, missing and self contacts externally indistinguishable", async () => {
    const professionalUserId = 879201;
    const patientUserId = 879202;
    await upsertProfessionalProfile(professionalUserId, {
      displayName: "Profissional de fronteira",
      active: true,
    });

    const caller = appRouter.createCaller(
      createProfessionalContext(professionalUserId)
    );
    const existing = await caller.nutrition.professionals.requestAccess({
      patientContact: `user-${patientUserId}@example.com`,
      reason: "Acompanhamento com consentimento",
    });
    const missing = await caller.nutrition.professionals.requestAccess({
      patientContact: "missing-person@example.com",
      reason: "Acompanhamento com consentimento",
    });
    const self = await caller.nutrition.professionals.requestAccess({
      patientContact: `user-${professionalUserId}@example.com`,
      reason: "Acompanhamento com consentimento",
    });

    expectPendingReceipt(existing);
    expectPendingReceipt(missing);
    expectPendingReceipt(self);
    expect(Object.keys(existing).sort()).toEqual(Object.keys(missing).sort());
    expect(Object.keys(existing).sort()).toEqual(Object.keys(self).sort());
  });

  it("keeps pending identities hidden in myAccesses and portfolio", async () => {
    const professionalUserId = 879211;
    const patientUserId = 879212;
    await upsertProfessionalProfile(professionalUserId, {
      displayName: "Profissional sem enumeração",
      active: true,
    });
    const caller = appRouter.createCaller(
      createProfessionalContext(professionalUserId)
    );

    await caller.nutrition.professionals.requestAccess({
      patientContact: `user-${patientUserId}@example.com`,
      reason: "Solicitação existente",
    });
    await caller.nutrition.professionals.requestAccess({
      patientContact: "unknown-879@example.com",
      reason: "Solicitação não resolvida",
    });

    const accesses = await caller.nutrition.professionals.myAccesses();
    expect(accesses).toHaveLength(2);
    for (const access of accesses) {
      expect(access).toMatchObject({ status: "pending", patient: null });
      expect(access).not.toHaveProperty("patientUserId");
    }

    const portfolio = await caller.nutrition.professionals.portfolio({
      search: "",
      authorizationStatus: "pending",
      trackingStatus: "all",
      activity: "all",
      nextReview: "all",
      page: 1,
      pageSize: 20,
      includeHistoricalActivity: true,
    });
    expect(portfolio.items).toHaveLength(2);
    for (const item of portfolio.items) {
      expect(item).toMatchObject({
        patientUserId: 0,
        patientName: "Solicitação aguardando confirmação",
        patientEmail: null,
        authorizationStatus: "pending",
      });
    }
    expect(JSON.stringify(portfolio)).not.toContain(String(patientUserId));
    expect(JSON.stringify(portfolio)).not.toContain(
      `user-${patientUserId}@example.com`
    );
  });

  it("keeps malformed input as validation failure", async () => {
    const professionalUserId = 879221;
    await upsertProfessionalProfile(professionalUserId, {
      displayName: "Profissional de validação",
      active: true,
    });
    const caller = appRouter.createCaller(
      createProfessionalContext(professionalUserId)
    );

    await expect(
      caller.nutrition.professionals.requestAccess({
        patientContact: "x",
        reason: "ok",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("does not acknowledge requests from an inactive professional profile", async () => {
    const professionalUserId = 879231;
    await upsertProfessionalProfile(professionalUserId, {
      displayName: "Profissional inativo",
      active: false,
    });
    const caller = appRouter.createCaller(
      createProfessionalContext(professionalUserId)
    );

    await expect(
      caller.nutrition.professionals.requestAccess({
        patientContact: "anyone@example.com",
        reason: "Tentativa inativa",
      })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});
