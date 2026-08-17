import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express from "express";
import type { TrpcContext } from "../../_core/context";
import { router } from "../../_core/trpc";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("../../db", async importOriginal => {
  const actual = await importOriginal<typeof import("../../db")>();
  return {
    ...actual,
    getDb: mocks.getDb,
  };
});

import { usageGovernanceRouter } from "./router";

const adminUser = {
  id: 1,
  openId: "admin-1",
  name: "Admin",
  email: "admin@example.com",
  loginMethod: "test",
  role: "admin" as const,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  lastSignedIn: new Date("2026-08-01T00:00:00.000Z"),
} as TrpcContext["user"];

const publicRouter = router({ usageGovernance: usageGovernanceRouter });

async function withPublicTrpcServer<T>(run: (baseUrl: string) => Promise<T>) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: publicRouter,
      createContext: ({ req, res }) => ({ req, res, user: adminUser }),
    }),
  );
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

type TrpcWireError = {
  message?: string;
  data?: { code?: string };
};

async function requestTrpc(
  baseUrl: string,
  path: string,
  input: unknown,
  method: "GET" | "POST" = "POST",
) {
  const serializedInput = JSON.stringify({ json: input });
  const endpoint = method === "GET"
    ? `${baseUrl}/api/trpc/${path}?input=${encodeURIComponent(serializedInput)}`
    : `${baseUrl}/api/trpc/${path}`;
  const response = await fetch(endpoint, {
    method,
    ...(method === "POST"
      ? {
          headers: { "content-type": "application/json" },
          body: serializedInput,
        }
      : {}),
  });
  const body = await response.json() as {
    error?: { json?: TrpcWireError };
    result?: unknown;
  };
  return { response, body, error: body.error?.json };
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

    await withPublicTrpcServer(async baseUrl => {
      const { response, body, error } = await requestTrpc(baseUrl, "usageGovernance.configurePolicy", validPolicyInput);
      expect(response.status).toBe(500);
      expect(error).toMatchObject({
        message: "Não foi possível atualizar a governança de consumo.",
        data: { code: "INTERNAL_SERVER_ERROR" },
      });
      expect(response.headers.get("x-error-code")).toBe("API_UNEXPECTED_ERROR");
      expect(response.headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/i);
      const publicProjection = JSON.stringify({
        body,
        errorCode: response.headers.get("x-error-code"),
        correlationId: response.headers.get("x-correlation-id"),
      });
      for (const marker of ["P0001", "fingerprint", "idempotencyKey", "98765", "raw SQL", "secret-fp", "idem-secret"]) {
        expect(publicProjection).not.toContain(marker);
      }
    });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(tx.execute).toHaveBeenCalledTimes(2);
    expect(db.execute).not.toHaveBeenCalled();
    expect(activePolicyId).toBe("policy-old");
  });

  it("treats persistence unavailability as a generic 5xx instead of exposing an internal usage_* code", async () => {
    mocks.getDb.mockResolvedValue(null);
    await withPublicTrpcServer(async baseUrl => {
      const { response, body, error } = await requestTrpc(baseUrl, "usageGovernance.analytics", {
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-08-02T00:00:00.000Z",
      }, "GET");
      expect(response.status).toBe(500);
      expect(error).toMatchObject({
        message: "Não foi possível atualizar a governança de consumo.",
        data: { code: "INTERNAL_SERVER_ERROR" },
      });
      expect(JSON.stringify(body)).not.toContain("usage_governance_persistence_unavailable");
      expect(response.headers.get("x-error-code")).toBe("API_UNEXPECTED_ERROR");
      expect(response.headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/i);
    });
  });

  it("keeps expected domain validation errors as controlled 4xx without unexpected-error headers", async () => {
    mocks.getDb.mockResolvedValue({ execute: vi.fn(), transaction: vi.fn() });
    await withPublicTrpcServer(async baseUrl => {
      const { response, error } = await requestTrpc(baseUrl, "usageGovernance.configurePolicy", {
        ...validPolicyInput,
        observationStartsAt: "2026-11-01T00:00:00.000Z",
        observationEndsAt: "2026-08-01T00:00:00.000Z",
      });
      expect(response.status).toBe(400);
      expect(error).toMatchObject({
        message: "usage_policy_observation_range_invalid",
        data: { code: "BAD_REQUEST" },
      });
      expect(response.headers.get("x-error-code")).toBeNull();
      expect(response.headers.get("x-correlation-id")).toBeNull();
    });
  });
});
