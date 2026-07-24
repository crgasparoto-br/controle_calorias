// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  invalidateMyAccesses,
  patientTimeZoneFetch,
  portfolioState,
  portfolioUseQuery,
  refetchPortfolio,
  requestAccessInput,
  requestAccessResult,
} = vi.hoisted(() => ({
  invalidateMyAccesses: vi.fn().mockResolvedValue(undefined),
  patientTimeZoneFetch: vi.fn().mockResolvedValue(undefined),
  portfolioState: {
    current: {
      items: [] as Array<Record<string, unknown>>,
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    },
  },
  portfolioUseQuery: vi.fn(),
  refetchPortfolio: vi.fn().mockResolvedValue(undefined),
  requestAccessInput: vi.fn(),
  requestAccessResult: {
    current: {
      status: "pending" as "pending" | "approved" | "rejected" | "revoked",
    },
  },
}));

vi.mock("@/components/professional/ProfessionalUi", () => ({
  ProfessionalPage: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
  ProfessionalPageHeader: ({
    actions,
    title,
  }: {
    actions?: React.ReactNode;
    title: string;
  }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
  ProfessionalStatusBadge: ({ value }: { value: string }) => <span>{value}</span>,
  ProfessionalLoadingState: ({ label }: { label: string }) => <p>{label}</p>,
  ProfessionalAsyncState: ({ title }: { title: string }) => <p>{title}</p>,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      nutrition: {
        professionals: {
          myAccesses: { invalidate: invalidateMyAccesses },
          patientTimeZone: { fetch: patientTimeZoneFetch },
        },
      },
    }),
    nutrition: {
      professionals: {
        portfolio: { useQuery: portfolioUseQuery },
        requestAccess: {
          useMutation: (options: {
            onSuccess?: (result: { status: string }) => Promise<void> | void;
          }) => ({
            error: null,
            isError: false,
            isPending: false,
            mutate: (input: unknown) => {
              requestAccessInput(input);
              void options.onSuccess?.(requestAccessResult.current);
            },
            reset: vi.fn(),
          }),
        },
      },
    },
  },
}));

import ProfessionalPatients from "./ProfessionalPatients";

function portfolioQueryResult() {
  return {
    data: portfolioState.current,
    isError: false,
    isLoading: false,
    refetch: refetchPortfolio,
  };
}

function requestAccess() {
  fireEvent.click(screen.getByRole("button", { name: "Solicitar acesso" }));
  fireEvent.change(screen.getByPlaceholderText("paciente@exemplo.com ou celular"), {
    target: { value: "paciente@example.com" },
  });
  fireEvent.change(
    screen.getByPlaceholderText("Ex.: iniciar acompanhamento nutricional"),
    { target: { value: "Iniciar acompanhamento" } }
  );
  fireEvent.click(screen.getByRole("button", { name: "Enviar solicitação" }));
}

beforeEach(() => {
  window.history.replaceState({}, "", "/professional/patients");
  portfolioState.current = {
    items: [],
    pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
  };
  portfolioUseQuery.mockImplementation(portfolioQueryResult);
  invalidateMyAccesses.mockClear();
  patientTimeZoneFetch.mockClear();
  patientTimeZoneFetch.mockResolvedValue(undefined);
  refetchPortfolio.mockClear();
  requestAccessInput.mockClear();
  requestAccessResult.current = { status: "pending" };
});

afterEach(() => cleanup());

describe("ProfessionalPatients audit regressions", () => {
  it("refreshes the active portfolio even when the pending filter is already selected", async () => {
    window.history.replaceState(
      {},
      "",
      "/professional/patients?authorization=pending"
    );
    render(<ProfessionalPatients />);

    requestAccess();

    await waitFor(() => {
      expect(refetchPortfolio).toHaveBeenCalledTimes(1);
      expect(invalidateMyAccesses).toHaveBeenCalledTimes(1);
    });
    expect(window.location.search).toBe("?authorization=pending");
    expect(screen.getByRole("status").textContent).toContain(
      "A carteira foi atualizada para mostrar os acessos pendentes."
    );
  });

  it("mirrors the canonical maximum lengths in the request form", () => {
    render(<ProfessionalPatients />);
    fireEvent.click(screen.getByRole("button", { name: "Solicitar acesso" }));

    expect(
      screen
        .getByPlaceholderText("paciente@exemplo.com ou celular")
        .getAttribute("maxlength")
    ).toBe("320");
    expect(
      screen
        .getByPlaceholderText("Ex.: iniciar acompanhamento nutricional")
        .getAttribute("maxlength")
    ).toBe("500");
  });

  it("separates authorization and tracking and exposes safe fallback values", () => {
    portfolioState.current = {
      items: [
        {
          authorizationId: "approved-1",
          patientUserId: 41,
          patientName: "Paciente Aprovado com Nome Muito Longo para Validação",
          patientEmail: "approved@example.com",
          authorizationStatus: "approved",
          trackingStatus: "not_started",
          lastFoodActivityAt: null,
          nextReviewAt: null,
        },
        {
          authorizationId: "pending-1",
          patientUserId: 42,
          patientName: "Paciente Pendente",
          patientEmail: "must-not-render@example.com",
          authorizationStatus: "pending",
          trackingStatus: null,
        },
        {
          authorizationId: "rejected-1",
          patientUserId: 43,
          patientName: "Paciente Recusado",
          authorizationStatus: "rejected",
          trackingStatus: null,
        },
        {
          authorizationId: "revoked-1",
          patientUserId: 44,
          patientName: "Paciente Revogado",
          authorizationStatus: "revoked",
          trackingStatus: null,
        },
      ],
      pagination: { page: 1, pageSize: 20, total: 4, totalPages: 1 },
    };

    render(<ProfessionalPatients />);

    expect(screen.getByText("approved")).not.toBeNull();
    expect(screen.getByText("not_started")).not.toBeNull();
    expect(screen.getByText("Não informado")).not.toBeNull();
    expect(screen.getByText("Sem revisão agendada", { selector: "dd" })).not.toBeNull();
    expect(screen.queryByText("must-not-render@example.com")).toBeNull();

    expect(
      (screen.getByRole("button", { name: "Abrir paciente" }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
    expect(
      (
        screen.getByRole("button", {
          name: "Aguardando autorização",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Solicitação recusada",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Acesso revogado" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(
      screen.getAllByText("Dados pessoais e clínicos disponíveis após autorização")
    ).toHaveLength(3);
  });

  it("validates an approved patient before navigating to the contextual route", async () => {
    portfolioState.current = {
      items: [
        {
          authorizationId: "approved-1",
          patientUserId: 41,
          patientName: "Paciente Aprovado",
          patientEmail: "approved@example.com",
          authorizationStatus: "approved",
          trackingStatus: "active",
        },
      ],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    };
    render(<ProfessionalPatients />);

    fireEvent.click(screen.getByRole("button", { name: "Abrir paciente" }));

    await waitFor(() =>
      expect(patientTimeZoneFetch).toHaveBeenCalledWith({
        patientId: 41,
        weekOffset: 0,
      })
    );
    await waitFor(() =>
      expect(window.location.pathname).toBe("/professional/patients/41")
    );
  });

  it("keeps stale patient data closed when access validation fails", async () => {
    patientTimeZoneFetch.mockRejectedValueOnce(new Error("FORBIDDEN"));
    portfolioState.current = {
      items: [
        {
          authorizationId: "approved-1",
          patientUserId: 41,
          patientName: "Paciente Aprovado",
          patientEmail: "approved@example.com",
          authorizationStatus: "approved",
          trackingStatus: "active",
        },
      ],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    };
    render(<ProfessionalPatients />);

    fireEvent.click(screen.getByRole("button", { name: "Abrir paciente" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "O acesso a este paciente não está mais disponível."
      );
      expect(refetchPortfolio).toHaveBeenCalledTimes(1);
    });
    expect(window.location.pathname).toBe("/professional/patients");
  });
});
