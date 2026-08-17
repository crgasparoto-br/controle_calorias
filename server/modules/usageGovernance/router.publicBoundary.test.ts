import type { TrpcContext } from "../../_core/context";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("../../db", () => ({
  getDb: mocks.getDb,
}));

import { usageGovernanceRouter } from "./router";

function createAdminContext() {
  const headers = new Map<string, string>();
  const setHeader = vi.fn((name: string, value: string) => {
    headers.set(name.toLowerCase(), String(value));
  });
  const ctx = {
    req: {},
    res: { setHeader },
    user: {
      id: 1,
      openId: "admin-1",
      name: "Admin",
      email: "admin@example.com",
      loginMethod: "test",
      role: "admin",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
      lastSignedIn: new Date("2026-08-01T00:00:00.000Z"),
    },
  } as unknown as TrpcContext;
  return { ctx, headers, setHeader };
}

const validPolicyInput = {
  scopeType: "global" as const,
  scopeId: "default",
  currency: "BRL",
  expectedBudgetMicros: 2_000_000,
  alertThresholdPercentages: [70, 85, 100],
  observationStartsAt: "2026-08-01T00:00:00.000Z",
  observationEndsAt: "2026-11-01T00:00:00.000Z",
  reason: "controle adversarial",
};

describe("usage governance public boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("PB-ERR-001 sanitizes an unexpected adapter error and preserves transactional rollback", async () => {
    let activePolicyId: string | null = "policy-old";
    let txExecuteCalls = 0;
    const sensitiveAdapterError = Object.assign(
      new Error("P0001 fingerprint=secret-fp idempotencyKey=idem-secret amountMinor=98765 raw SQL stack"),
      { code: "P0001" },
    );

    const tx = {
      execute: vi.fn(async () => {
        txExecuteCalls += 1;
        if (txExecuteCalls === 1) {
          activePolicyId = null;
          return [];
        }
        throw sensitiveAdapterError;
      }),
    };
    const db = {
      execute: vi.fn(async () => {
        throw new Error("repository must keep the replacement inside db.transaction");
      }),
      transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => {
        const before = activePolicyId;
        try {
          return await callback(tx);
        } catch (error) {
          activePolicyId = before;
          throw error;
        }
      }),
    };
    mocks.getDb.mockResolvedValue(db);

    const { ctx, headers } = createAdminContext();
    const caller = usageGovernanceRouter.createCaller(ctx);
    let publicError: unknown;
    try {
      await caller.configurePolicy(validPolicyInput);
    } catch (error) {
      publicError = error;
    }

    expect(publicError).toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Não foi possível atualizar a governança de consumo.",
    });
    expect(headers.get("x-error-code")).toBe("API_UNEXPECTED_ERROR");
    expect(headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/i);
    const publicProjection = JSON.stringify({
      code: (publicError as { code?: string }).code,
      message: (publicError as { message?: string }).message,
      errorCode: headers.get("x-error-code"),
      correlationId: headers.get("x-correlation-id"),
    });
    for (const marker of ["P0001", "fingerprint", "idempotencyKey", "98765", "raw SQL", "secret-fp", "idem-secret"]) {
      expect(publicProjection).not.toContain(marker);
    }
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(tx.execute).toHaveBeenCalledTimes(2);
    expect(db.execute).not.toHaveBeenCalled();
    expect(activePolicyId).toBe("policy-old");
  });

  it("treats persistence unavailability as a generic 5xx instead of exposing an internal usage_* code", async () => {
    mocks.getDb.mockResolvedValue(null);
    const { ctx, headers } = createAdminContext();
    const caller = usageGovernanceRouter.createCaller(ctx);

    await expect(caller.analytics({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-02T00:00:00.000Z",
    })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Não foi possível atualizar a governança de consumo.",
    });
    expect(headers.get("x-error-code")).toBe("API_UNEXPECTED_ERROR");
    expect(headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("keeps expected domain validation errors as controlled 4xx without unexpected-error headers", async () => {
    mocks.getDb.mockResolvedValue({ execute: vi.fn(), transaction: vi.fn() });
    const { ctx, headers } = createAdminContext();
    const caller = usageGovernanceRouter.createCaller(ctx);

    await expect(caller.configurePolicy({
      ...validPolicyInput,
      observationStartsAt: "2026-11-01T00:00:00.000Z",
      observationEndsAt: "2026-08-01T00:00:00.000Z",
    })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "usage_policy_observation_range_invalid",
    });
    expect(headers.has("x-error-code")).toBe(false);
    expect(headers.has("x-correlation-id")).toBe(false);
  });
});
