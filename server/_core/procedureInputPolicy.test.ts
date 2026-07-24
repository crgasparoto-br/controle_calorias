import { afterEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "./context";
import {
  _forTestOnly_clearProtectedProcedureInputPolicies,
  enforceProtectedProcedureInputPolicies,
  registerProtectedProcedureInputPolicy,
} from "./procedureInputPolicy";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function authenticatedContext() {
  const user: AuthenticatedUser = {
    id: 42,
    openId: "user-42",
    email: "user-42@example.com",
    name: "User 42",
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

afterEach(() => {
  _forTestOnly_clearProtectedProcedureInputPolicies();
});

describe("protected procedure input policies", () => {
  it("synchronizes a replacement object into the original raw input reference", async () => {
    registerProtectedProcedureInputPolicy(({ input }) => ({
      ...(input as Record<string, unknown>),
      accessId: "authorization-42",
    }));
    const rawInput = { accessId: "receipt-opaque", keep: true };

    const result = await enforceProtectedProcedureInputPolicies({
      path: "nutrition.professionals.approveAccess",
      ctx: authenticatedContext(),
      input: rawInput,
    });

    expect(result).toBe(rawInput);
    expect(rawInput).toEqual({
      accessId: "authorization-42",
      keep: true,
    });
  });

  it("preserves scalar inputs when no mutable replacement is possible", async () => {
    registerProtectedProcedureInputPolicy(() => "transformed");

    await expect(
      enforceProtectedProcedureInputPolicies({
        path: "example.scalar",
        ctx: authenticatedContext(),
        input: "original",
      })
    ).resolves.toBe("transformed");
  });
});
