import React from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const patientRequestsState = vi.hoisted(() => ({
  requests: [] as unknown[],
  isLoading: false,
  isError: false,
}));

const invalidateMock = vi.fn(async () => undefined);
const approveMutateMock = vi.fn();
const revokeMutateMock = vi.fn();

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 42, name: "Paciente" } }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      auth: { me: { invalidate: invalidateMock } },
      nutrition: {
        professionals: {
          profile: { invalidate: invalidateMock },
          myAccesses: { invalidate: invalidateMock },
          patientRequests: { invalidate: invalidateMock },
          history: { invalidate: invalidateMock },
        },
      },
    }),
    nutrition: {
      professionals: {
        profile: {
          useQuery: () => ({ isSuccess: true, data: null, isLoading: false, isError: false }),
        },
        upsertProfile: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
        patientRequests: {
          useQuery: () => ({
            data: patientRequestsState.requests,
            isLoading: patientRequestsState.isLoading,
            isError: patientRequestsState.isError,
          }),
        },
        approveAccess: {
          useMutation: () => ({ isPending: false, mutate: approveMutateMock }),
        },
        revokeAccess: {
          useMutation: () => ({ isPending: false, mutate: revokeMutateMock }),
        },
      },
    },
  },
}));

function accessRequest(input: {
  id: string;
  status: string;
  professionalName: string;
  authorizationMessageStatus?: string | null;
  authorizationMessageError?: string | null;
}) {
  return {
    id: input.id,
    professionalUserId: Number(input.id.replace(/\D/g, "")) || 1,
    patientUserId: 42,
    status: input.status,
    reason: "Acompanhamento semanal",
    requestedAt: Date.parse("2026-06-16T12:00:00Z"),
    approvedAt: null,
    revokedAt: null,
    rejectedAt: null,
    respondedAt: null,
    responseOrigin: null,
    responseDecision: null,
    authorizationMessageStatus: input.authorizationMessageStatus ?? null,
    authorizationMessageSentAt: input.authorizationMessageStatus === "sent" ? Date.parse("2026-06-16T12:05:00Z") : null,
    authorizationMessageError: input.authorizationMessageError ?? null,
    professional: { displayName: input.professionalName },
  };
}

describe("PatientAccessRequestsCard", () => {
  beforeEach(() => {
    patientRequestsState.requests = [];
    patientRequestsState.isLoading = false;
    patientRequestsState.isError = false;
    approveMutateMock.mockClear();
    revokeMutateMock.mockClear();
  });

  it("mostra pendentes, ativos e encerrados com status da notificação", async () => {
    patientRequestsState.requests = [
      accessRequest({ id: "pending-1", status: "pending", professionalName: "Marina Souza", authorizationMessageStatus: "failed", authorizationMessageError: "Meta retornou 500" }),
      accessRequest({ id: "approved-2", status: "approved", professionalName: "Camila Pereira", authorizationMessageStatus: "sent" }),
      accessRequest({ id: "rejected-3", status: "rejected", professionalName: "Beatriz Lima", authorizationMessageStatus: "skipped" }),
      accessRequest({ id: "revoked-4", status: "revoked", professionalName: "Rafa Costa" }),
    ];

    const { PatientAccessRequestsCard } = await import("./ProfessionalProfileSettings");
    const html = renderToString(React.createElement(PatientAccessRequestsCard, { embedded: true }));

    expect(html).toContain("Solicitações de acesso");
    expect(html).toContain("Vínculo:");
    expect(html).toContain("Marina Souza");
    expect(html).toContain("Pendente");
    expect(html).toContain("Notificação não entregue");
    expect(html).toContain("Meta retornou 500");
    expect(html).toContain("Camila Pereira");
    expect(html).toContain("Aprovado");
    expect(html).toContain("Notificação enviada");
    expect(html).toContain("Beatriz Lima");
    expect(html).toContain("Recusado");
    expect(html).toContain("Notificação não enviada");
    expect(html).toContain("Rafa Costa");
    expect(html).toContain("Revogado");
    expect(html).toContain("Notificação não concluída");
  });
});