import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../../_core/context";
import {
  PROFESSIONAL_APPROVE_ACCESS_PATH,
  PROFESSIONAL_HISTORY_PATH,
  PROFESSIONAL_MY_ACCESSES_PATH,
  PROFESSIONAL_PENDING_REQUEST_NAME,
  PROFESSIONAL_PORTFOLIO_PATH,
  PROFESSIONAL_REQUEST_ACCESS_PATH,
  PROFESSIONAL_REQUEST_ACCESS_UNAVAILABLE_MESSAGE,
  PROFESSIONAL_REVOKE_ACCESS_PATH,
  createProfessionalRequestAccessPublicBoundary,
} from "./requestAccessPublicBoundary";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function context(userId = 879001) {
  const user: AuthenticatedUser = {
    id: userId,
    openId: `user-${userId}`,
    email: `professional-${userId}@example.com`,
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

function receipt(id: string, linkedAuthorizationId: string | null = null) {
  return {
    id,
    status: "pending" as const,
    requestedAt: 1_700_000_000_000,
    linkedAuthorizationId,
  };
}

function dependencies() {
  return {
    createUnresolvedReceipt: vi
      .fn()
      .mockResolvedValue(receipt("receipt-unresolved")),
    createLinkedReceipt: vi
      .fn()
      .mockResolvedValue(receipt("receipt-linked", "authorization-1")),
    resolveAuthorizationIdForPatient: vi.fn().mockResolvedValue(null),
    listActiveReceipts: vi
      .fn()
      .mockResolvedValue([receipt("receipt-active")]),
    approveAccess: vi.fn().mockResolvedValue({
      id: "authorization-1",
      patientUserId: 42,
      status: "approved",
    }),
    revokeAccess: vi.fn().mockResolvedValue({
      id: "authorization-1",
      patientUserId: 42,
      status: "revoked",
    }),
  };
}

async function runPolicy(input: {
  path: string;
  result: unknown;
  rawInput?: unknown;
  userId?: number;
  deps?: ReturnType<typeof dependencies>;
}) {
  const deps = input.deps ?? dependencies();
  const policy = createProfessionalRequestAccessPublicBoundary(deps);
  return policy({
    path: input.path,
    result: input.result,
    ctx: context(input.userId),
    input: input.rawInput,
  });
}

function responseData(value: unknown) {
  return (value as { data: Record<string, unknown> }).data;
}

describe("professional request access public boundary", () => {
  it("returns the same pending receipt shape for existing, missing and self contacts", async () => {
    const existing = await runPolicy({
      path: PROFESSIONAL_REQUEST_ACCESS_PATH,
      result: {
        ok: true,
        data: {
          id: "authorization-1",
          patientUserId: 42,
          status: "pending",
          requestedAt: 1_700_000_000_000,
          patient: { name: "Pessoa protegida", email: "protected@example.com" },
        },
      },
    });
    const missing = await runPolicy({
      path: PROFESSIONAL_REQUEST_ACCESS_PATH,
      result: {
        ok: false,
        error: new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Falha segura",
          cause: new Error(
            "Nenhuma pessoa foi encontrada com esse e-mail ou celular."
          ),
        }),
      },
    });
    const self = await runPolicy({
      path: PROFESSIONAL_REQUEST_ACCESS_PATH,
      result: {
        ok: false,
        error: new Error(
          "Profissional e pessoa acompanhada precisam ser usuários diferentes."
        ),
      },
    });

    for (const result of [existing, missing, self]) {
      expect(result).toMatchObject({ ok: true });
      expect(Object.keys(responseData(result)).sort()).toEqual([
        "id",
        "requestedAt",
        "status",
      ]);
      expect(responseData(result).status).toBe("pending");
      expect(responseData(result)).not.toHaveProperty("patient");
      expect(responseData(result)).not.toHaveProperty("patientUserId");
    }
  });

  it("keeps an approved relationship visible without returning patient PII", async () => {
    const deps = dependencies();
    const result = await runPolicy({
      deps,
      path: PROFESSIONAL_REQUEST_ACCESS_PATH,
      result: {
        ok: true,
        data: {
          id: "approved-authorization",
          patientUserId: 42,
          status: "approved",
          requestedAt: 1_700_000_000_000,
          patient: { name: "Pessoa", email: "approved@example.com" },
        },
      },
    });
    expect(responseData(result)).toEqual({
      id: "approved-authorization",
      status: "approved",
      requestedAt: 1_700_000_000_000,
    });
    expect(deps.createLinkedReceipt).not.toHaveBeenCalled();
  });

  it("preserves validation errors and sanitizes transient failures", async () => {
    const validationError = {
      ok: false,
      error: { code: "BAD_REQUEST", message: "Informe um contato válido." },
    };
    await expect(
      runPolicy({
        path: PROFESSIONAL_REQUEST_ACCESS_PATH,
        result: validationError,
      })
    ).resolves.toEqual(validationError);

    await expect(
      runPolicy({
        path: PROFESSIONAL_REQUEST_ACCESS_PATH,
        result: { ok: false, error: new Error("Failed query: users") },
      })
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: PROFESSIONAL_REQUEST_ACCESS_UNAVAILABLE_MESSAGE,
    } satisfies Partial<TRPCError>);
  });

  it("replaces pending portfolio identities with opaque receipts and neutral counts", async () => {
    const deps = dependencies();
    deps.listActiveReceipts.mockResolvedValueOnce([
      receipt("receipt-active-1", "authorization-1"),
      receipt("receipt-active-2", "authorization-1"),
    ]);
    const result = await runPolicy({
      deps,
      path: PROFESSIONAL_PORTFOLIO_PATH,
      rawInput: {
        search: "",
        authorizationStatus: "all",
        trackingStatus: "all",
        activity: "all",
        nextReview: "all",
        page: 1,
      },
      result: {
        ok: true,
        data: {
          items: [
            {
              authorizationId: "pending-authorization",
              patientUserId: 42,
              patientName: "Pessoa pendente protegida",
              patientEmail: "protected@example.com",
              authorizationStatus: "pending",
            },
            {
              authorizationId: "approved-authorization",
              patientUserId: 43,
              patientName: "Pessoa aprovada",
              patientEmail: "approved@example.com",
              authorizationStatus: "approved",
            },
          ],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
          summary: { pendingRequests: 999, active: 1 },
        },
      },
    });

    const data = responseData(result);
    const items = data.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      authorizationId: "receipt-active-1",
      patientUserId: 0,
      patientName: PROFESSIONAL_PENDING_REQUEST_NAME,
      patientEmail: null,
      authorizationStatus: "pending",
    });
    expect(items[2]).toMatchObject({
      authorizationId: "approved-authorization",
      patientName: "Pessoa aprovada",
    });
    expect(data.summary).toEqual({ pendingRequests: 2, active: 1 });
    expect(JSON.stringify(items)).not.toContain("Pessoa pendente protegida");
    expect(JSON.stringify(items)).not.toContain("protected@example.com");
  });

  it("neutralizes myAccesses and public history before consent", async () => {
    const accesses = await runPolicy({
      path: PROFESSIONAL_MY_ACCESSES_PATH,
      result: {
        ok: true,
        data: [
          {
            id: "pending-authorization",
            patientUserId: 42,
            status: "pending",
            patient: { name: "Pessoa pendente" },
          },
          {
            id: "rejected-authorization",
            patientUserId: 43,
            status: "rejected",
            patient: { name: "Pessoa recusada" },
            authorizationMessageError: "internal provider detail",
          },
          {
            id: "approved-authorization",
            patientUserId: 44,
            status: "approved",
            patient: { name: "Pessoa aprovada" },
          },
        ],
      },
    });
    const accessItems = (accesses as { data: Array<Record<string, unknown>> })
      .data;
    expect(accessItems[0]).toMatchObject({
      id: "receipt-active",
      status: "pending",
      patient: null,
    });
    expect(
      accessItems.find(item => item.id === "pending-authorization")
    ).toBeUndefined();
    expect(
      accessItems.find(item => item.id === "rejected-authorization")
    ).not.toHaveProperty("patientUserId");

    const history = await runPolicy({
      path: PROFESSIONAL_HISTORY_PATH,
      result: {
        ok: true,
        data: [
          { id: "1", eventType: "access_request_received" },
          { id: "2", eventType: "access_requested", patientUserId: 42 },
          {
            id: "3",
            eventType: "access_rejected",
            patientUserId: 42,
            entityId: "private",
          },
          { id: "4", eventType: "access_approved", patientUserId: 43 },
        ],
      },
    });
    expect((history as { data: unknown[] }).data).toEqual([
      {
        id: "3",
        eventType: "access_rejected",
        patientUserId: null,
        entityId: null,
      },
      { id: "4", eventType: "access_approved", patientUserId: 43 },
    ]);
  });
});

describe("opaque receipt patient decisions", () => {
  it.each([
    [PROFESSIONAL_APPROVE_ACCESS_PATH, "approved"],
    [PROFESSIONAL_REVOKE_ACCESS_PATH, "revoked"],
  ] as const)("recovers the canonical authorization on %s", async (path, status) => {
    const deps = dependencies();
    deps.resolveAuthorizationIdForPatient.mockResolvedValueOnce(
      "authorization-1"
    );
    const result = await runPolicy({
      deps,
      path,
      userId: 42,
      rawInput: { accessId: "receipt-opaque" },
      result: {
        ok: false,
        error: new Error("Solicitação de acesso não encontrada."),
      },
    });

    expect(result).toMatchObject({
      ok: true,
      data: { id: "authorization-1", patientUserId: 42, status },
    });
    expect(deps.resolveAuthorizationIdForPatient).toHaveBeenCalledWith(
      "receipt-opaque",
      42
    );
    if (path === PROFESSIONAL_APPROVE_ACCESS_PATH) {
      expect(deps.approveAccess).toHaveBeenCalledWith(42, "authorization-1");
      expect(deps.revokeAccess).not.toHaveBeenCalled();
    } else {
      expect(deps.revokeAccess).toHaveBeenCalledWith(42, "authorization-1");
      expect(deps.approveAccess).not.toHaveBeenCalled();
    }
  });

  it("preserves the canonical not-found response for outsiders and unresolved receipts", async () => {
    const deps = dependencies();
    const original = {
      ok: false,
      error: new Error("Solicitação de acesso não encontrada."),
    };
    await expect(
      runPolicy({
        deps,
        path: PROFESSIONAL_APPROVE_ACCESS_PATH,
        userId: 99,
        rawInput: { accessId: "receipt-opaque" },
        result: original,
      })
    ).resolves.toBe(original);
    expect(deps.approveAccess).not.toHaveBeenCalled();
  });
});
