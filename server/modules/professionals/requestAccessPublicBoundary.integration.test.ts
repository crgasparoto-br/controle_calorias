import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../../_core/context";
import { appRouter } from "../../routers";
import { upsertProfessionalProfile } from "./service";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createContext(userId: number): TrpcContext {
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

describe("nutrition.professionals.requestAccess public caller", () => {
  it("keeps malformed input as a validation failure before target lookup", async () => {
    const professionalUserId = 879221;
    await upsertProfessionalProfile(professionalUserId, {
      displayName: "Profissional de validação",
      active: true,
    });
    const caller = appRouter.createCaller(createContext(professionalUserId));

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
    const caller = appRouter.createCaller(createContext(professionalUserId));

    await expect(
      caller.nutrition.professionals.requestAccess({
        patientContact: "anyone@example.com",
        reason: "Tentativa inativa",
      })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});
