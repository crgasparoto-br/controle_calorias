import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../../_core/context";
import { appRouter } from "../../routers";
import { upsertProfessionalProfile } from "./service";
import { PROFESSIONAL_REQUEST_ACCESS_REJECTED_MESSAGE } from "./requestAccessPublicBoundary";

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

async function publicRejection(
  caller: ReturnType<typeof appRouter.createCaller>,
  patientContact: string
) {
  try {
    await caller.nutrition.professionals.requestAccess({
      patientContact,
      reason: "Tentativa inválida",
    });
  } catch (error) {
    return error as { code?: string; message?: string };
  }
  throw new Error("Expected request access to reject");
}

describe("nutrition.professionals.requestAccess public caller", () => {
  it("returns only the opaque id and status for a pending request", async () => {
    const professionalUserId = 879201;
    const patientUserId = 879202;
    await upsertProfessionalProfile(professionalUserId, {
      displayName: "Profissional de fronteira",
      active: true,
    });

    const caller = appRouter.createCaller(
      createProfessionalContext(professionalUserId)
    );
    const result = await caller.nutrition.professionals.requestAccess({
      patientContact: `user-${patientUserId}@example.com`,
      reason: "Acompanhamento com consentimento",
    });

    expect(result).toEqual({ id: expect.any(String), status: "pending" });
    expect(result).not.toHaveProperty("patient");
    expect(result).not.toHaveProperty("patientUserId");
  });

  it("makes nonexistent and self-link targets indistinguishable", async () => {
    const professionalUserId = 879211;
    await upsertProfessionalProfile(professionalUserId, {
      displayName: "Profissional sem enumeração",
      active: true,
    });

    const caller = appRouter.createCaller(
      createProfessionalContext(professionalUserId)
    );
    const selfLink = await publicRejection(
      caller,
      `user-${professionalUserId}@example.com`
    );
    const nonexistent = await publicRejection(
      caller,
      "user-879999@example.com"
    );

    expect(selfLink).toMatchObject({
      code: "BAD_REQUEST",
      message: PROFESSIONAL_REQUEST_ACCESS_REJECTED_MESSAGE,
    });
    expect(nonexistent).toEqual(
      expect.objectContaining({
        code: selfLink.code,
        message: selfLink.message,
      })
    );
  });
});
