import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../../_core/context";
import {
  PROFESSIONAL_HISTORY_PATH,
  PROFESSIONAL_MY_ACCESSES_PATH,
  PROFESSIONAL_PENDING_REQUEST_NAME,
  PROFESSIONAL_PORTFOLIO_PATH,
  PROFESSIONAL_REQUEST_ACCESS_PATH,
  PROFESSIONAL_REQUEST_ACCESS_UNAVAILABLE_MESSAGE,
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
    listActiveReceipts: vi
      .fn()
      .mockResolvedValue([receipt("receipt-active")]),
  };
}

async function runPolicy(input: {
  path: string;
  result: unknown;
  rawInput?: unknown;
  deps?: ReturnType<typeof dependencies>;
}) {
  const deps = input.deps ?? dependencies();
  const policy = createProfessionalRequestAccessPublicBoundary(deps);
  return policy({
    path: input.path,
    result: input.result,
    ctx: context(),
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
          patient: {
            name: "Pessoa protegida",
            email: "protected@example.com",
          },
        },
      },
    });
    const missing = await runPolicy({
      path: PROFESSIONAL_REQUEST_ACCESS_PATH,
      result: {
        ok: false,
        error: new Error(
          "Nenhuma pessoa foi encontrada com esse e-mail ou celular."
        ),
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

  it("preserves input validation errors instead of acknowledging malformed requests", async () => {
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
  });

  it("keeps transient failures distinct without exposing internal details", async () => {
    await expect(
      runPolicy({
        path: PROFESSIONAL_REQUEST_ACCESS_PATH,
        result: {
          ok: false,
          error: new Error("Failed query: users"),
        },
      })
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: PROFESSIONAL_REQUEST_ACCESS_UNAVAILABLE_MESSAGE,
    } satisfies Partial<TRPCError>);
  });

  it("replaces pending portfolio identities with opaque receipts", async () => {
    const result = await runPolicy({
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
        },
      },
    });

    const items = responseData(result).items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      authorizationId: "receipt-active",
      patientUserId: 0,
      patientName: PROFESSIONAL_PENDING_REQUEST_NAME,
      patientEmail: null,
      authorizationStatus: "pending",
    });
    expect(items[1]).toMatchObject({
      authorizationId: "approved-authorization",
      patientName: "Pessoa aprovada",
    });
    expect(JSON.stringify(items)).not.toContain("Pessoa pendente protegida");
    expect(JSON.stringify(items)).not.toContain("protected@example.com");
  });

  it("does not inject receipts into incompatible portfolio filters", async () => {
    const deps = dependencies();
    const result = await runPolicy({
      deps,
      path: PROFESSIONAL_PORTFOLIO_PATH,
      rawInput: { authorizationStatus: "approved", page: 1 },
      result: {
        ok: true,
        data: {
          items: [
            {
              authorizationId: "pending-authorization",
              authorizationStatus: "pending",
            },
          ],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        },
      },
    });

    expect(responseData(result).items).toEqual([]);
    expect(deps.listActiveReceipts).not.toHaveBeenCalled();
  });

  it("makes myAccesses neutral for pending and non-approved relationships", async () => {
    const result = await runPolicy({
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

    const items = (result as { data: Array<Record<string, unknown>> }).data;
    expect(items[0]).toMatchObject({
      id: "receipt-active",
      status: "pending",
      patient: null,
    });
    expect(items.find(item => item.id === "pending-authorization")).toBeUndefined();
    expect(items.find(item => item.id === "rejected-authorization")).toMatchObject({
      patient: null,
      authorizationMessageError: null,
    });
    expect(items.find(item => item.id === "rejected-authorization")).not.toHaveProperty(
      "patientUserId"
    );
    expect(items.find(item => item.id === "approved-authorization")).toHaveProperty(
      "patientUserId",
      44
    );
  });

  it("removes pre-consent and internal receipt events from public history", async () => {
    const result = await runPolicy({
      path: PROFESSIONAL_HISTORY_PATH,
      result: {
        ok: true,
        data: [
          { id: "1", eventType: "access_request_received" },
          { id: "2", eventType: "access_request_linked", patientUserId: 42 },
          { id: "3", eventType: "access_requested", patientUserId: 42 },
          { id: "4", eventType: "access_authorization_whatsapp_sent", patientUserId: 42 },
          { id: "5", eventType: "access_rejected", patientUserId: 42, entityId: "private" },
          { id: "6", eventType: "access_approved", patientUserId: 43 },
        ],
      },
    });

    expect((result as { data: unknown[] }).data).toEqual([
      {
        id: "5",
        eventType: "access_rejected",
        patientUserId: null,
        entityId: null,
      },
      { id: "6", eventType: "access_approved", patientUserId: 43 },
    ]);
  });
});
