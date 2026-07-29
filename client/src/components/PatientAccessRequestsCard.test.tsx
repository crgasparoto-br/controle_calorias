// @vitest-environment jsdom
import React from "react";
import { renderToString } from "react-dom/server";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const profileState = vi.hoisted(() => ({
  data: null as {
    displayName?: string;
    registrationNumber?: string;
    active?: boolean;
  } | null,
  isSuccess: true,
  isLoading: false,
  isError: false,
}));

const patientRequestsState = vi.hoisted(() => ({
  requests: [] as unknown[],
  isLoading: false,
  isError: false,
}));

const invalidateMock = vi.fn(async () => undefined);
const refetchProfileMock = vi.fn(async () => undefined);
const refetchPatientRequestsMock = vi.fn(async () => undefined);
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
          useQuery: () => ({
            ...profileState,
            refetch: refetchProfileMock,
          }),
        },
        upsertProfile: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
        patientRequests: {
          useQuery: () => ({
            data: patientRequestsState.requests,
            isLoading: patientRequestsState.isLoading,
            isError: patientRequestsState.isError,
            refetch: refetchPatientRequestsMock,
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
    authorizationMessageSentAt:
      input.authorizationMessageStatus === "sent"
        ? Date.parse("2026-06-16T12:05:00Z")
        : null,
    authorizationMessageError: input.authorizationMessageError ?? null,
    professional: { displayName: input.professionalName },
  };
}

describe("PatientAccessRequestsCard", () => {
  beforeEach(() => {
    profileState.data = null;
    profileState.isSuccess = true;
    profileState.isLoading = false;
    profileState.isError = false;
    patientRequestsState.requests = [];
    patientRequestsState.isLoading = false;
    patientRequestsState.isError = false;
    approveMutateMock.mockClear();
    revokeMutateMock.mockClear();
    refetchProfileMock.mockClear();
    refetchPatientRequestsMock.mockClear();
  });

  afterEach(cleanup);

  it("oferece retry local quando o perfil profissional falha", async () => {
    profileState.isSuccess = false;
    profileState.isError = true;
    const { default: ProfessionalProfileSettings } = await import(
      "./ProfessionalProfileSettings"
    );

    render(<ProfessionalProfileSettings />);

    expect(
      screen.getByRole("heading", {
        name: "Não foi possível carregar o perfil profissional",
      })
    ).toBeTruthy();
    const retry = screen.getByRole("button", { name: "Tentar novamente" });
    fireEvent.click(retry);
    expect(refetchProfileMock).toHaveBeenCalledTimes(1);
    expect(
      (
        screen.getByRole("button", {
          name: "Salvar perfil profissional",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it("mostra pendentes, ativos e encerrados com status da notificação", async () => {
    patientRequestsState.requests = [
      accessRequest({
        id: "pending-1",
        status: "pending",
        professionalName: "Marina Souza",
        authorizationMessageStatus: "failed",
        authorizationMessageError: "Meta retornou 500",
      }),
      accessRequest({
        id: "approved-2",
        status: "approved",
        professionalName: "Camila Pereira",
        authorizationMessageStatus: "sent",
      }),
      accessRequest({
        id: "rejected-3",
        status: "rejected",
        professionalName: "Beatriz Lima",
        authorizationMessageStatus: "skipped",
      }),
      accessRequest({
        id: "revoked-4",
        status: "revoked",
        professionalName: "Rafa Costa",
      }),
    ];

    const { PatientAccessRequestsCard } = await import(
      "./ProfessionalProfileSettings"
    );
    const html = renderToString(
      React.createElement(PatientAccessRequestsCard, { embedded: true })
    );

    expect(html).toContain("Solicitações de acesso");
    expect(html).toContain("Vínculo");
    expect(html).toContain("Marina Souza");
    expect(html).toContain("Pendente");
    expect(html).toContain("Notificação não entregue");
    expect(html).toContain("Camila Pereira");
    expect(html).toContain("Aprovada");
    expect(html).toContain("Notificação enviada");
    expect(html).toContain("Beatriz Lima");
    expect(html).toContain("Recusada");
    expect(html).toContain("Notificação não enviada");
    expect(html).toContain("Rafa Costa");
    expect(html).toContain("Revogada");
    expect(html).toContain("Notificação não concluída");
    expect(html).toContain(
      "A notificação não foi concluída. O vínculo pode ser revisado normalmente."
    );
    expect(html).not.toContain("Meta retornou 500");
  });

  it("sanitiza estados desconhecidos sem exibir códigos técnicos", async () => {
    patientRequestsState.requests = [
      {
        ...accessRequest({
          id: "future-5",
          status: "internal_future_status",
          professionalName: "Nome não utilizado",
          authorizationMessageStatus: "provider_retrying",
        }),
        professional: null,
      },
    ];

    const { PatientAccessRequestsCard } = await import(
      "./ProfessionalProfileSettings"
    );
    const html = renderToString(
      React.createElement(PatientAccessRequestsCard, { embedded: true })
    );

    expect(html).toContain("Não informado");
    expect(html).toContain(">Profissional<");
    expect(html).not.toContain("internal_future_status");
    expect(html).not.toContain("provider_retrying");
    expect(html).not.toContain("Profissional #");
  });

  it("oferece retry local quando a consulta de solicitações falha", async () => {
    patientRequestsState.isError = true;
    const { PatientAccessRequestsCard } = await import(
      "./ProfessionalProfileSettings"
    );

    render(<PatientAccessRequestsCard embedded />);

    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(refetchPatientRequestsMock).toHaveBeenCalledTimes(1);
  });
});
