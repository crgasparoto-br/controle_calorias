import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserEntitlements: vi.fn(),
  getUserSubscriptionStatus: vi.fn(),
  searchAdminUsers: vi.fn(),
  grantAdminOverride: vi.fn(),
  revokeAdminOverride: vi.fn(),
  getAdminAnalytics: vi.fn(),
}));

vi.mock("./service", () => ({ billingService: mocks }));

import { billingRouter } from "./router";

function context(role: "user" | "admin", id = 71) {
  return {
    user: {
      id,
      email: `${role}@example.com`,
      name: role,
      role,
    },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAdminAnalytics.mockResolvedValue({ plans: [] });
  mocks.grantAdminOverride.mockResolvedValue({ id: "override" });
  mocks.revokeAdminOverride.mockResolvedValue({ id: "override" });
});

describe("billing router administration", () => {
  it("blocks every administrative procedure for a regular user", async () => {
    const caller = billingRouter.createCaller(context("user"));

    await expect(caller.adminAnalytics()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller.adminSearchUsers({ query: "", limit: 25 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.adminGrantOverride({ userId: 99, reason: "Acesso de suporte" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.adminRevokeOverride({
        overrideId: "11111111-1111-4111-8111-111111111111",
        reason: "Solicitação encerrada",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(mocks.getAdminAnalytics).not.toHaveBeenCalled();
    expect(mocks.grantAdminOverride).not.toHaveBeenCalled();
  });

  it("takes grant and revoke authorship from the authenticated admin", async () => {
    const caller = billingRouter.createCaller(context("admin", 314));

    await caller.adminGrantOverride({
      userId: 99,
      reason: "Acesso temporário aprovado",
    });
    await caller.adminRevokeOverride({
      overrideId: "11111111-1111-4111-8111-111111111111",
      reason: "Período de suporte finalizado",
    });

    expect(mocks.grantAdminOverride).toHaveBeenCalledWith({
      userId: 99,
      reason: "Acesso temporário aprovado",
      grantedByUserId: 314,
    });
    expect(mocks.revokeAdminOverride).toHaveBeenCalledWith({
      overrideId: "11111111-1111-4111-8111-111111111111",
      reason: "Período de suporte finalizado",
      revokedByUserId: 314,
    });
  });
});
