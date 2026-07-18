// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfessionalLayout, { useProfessionalWorkspace } from "./ProfessionalLayout";

const setLocation = vi.fn();
const refreshAuth = vi.fn().mockResolvedValue(undefined);
const profileRefetch = vi.fn().mockResolvedValue(undefined);
const accessesRefetch = vi.fn().mockResolvedValue(undefined);
const invalidateTimeZone = vi.fn().mockResolvedValue(undefined);
const invalidateDashboard = vi.fn().mockResolvedValue(undefined);
const invalidatePeriod = vi.fn().mockResolvedValue(undefined);

let location = "/professional";
let authState: {
  loading: boolean;
  user: null | { professionalProfileActive?: boolean };
};
let profileState: any;
let accessesState: any;

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ ...authState, refresh: refreshAuth }),
}));

vi.mock("wouter", () => ({
  useLocation: () => [location, setLocation],
}));

vi.mock("@/hooks/useMobile", () => ({ useIsMobile: () => false }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      nutrition: {
        professionals: {
          patientTimeZone: { invalidate: invalidateTimeZone },
          patientDashboard: { invalidate: invalidateDashboard },
          patientPeriodBundle: { invalidate: invalidatePeriod },
        },
      },
    }),
    nutrition: {
      professionals: {
        profile: { useQuery: () => profileState },
        myAccesses: { useQuery: () => accessesState },
      },
    },
  },
}));

function PatientFixture() {
  const { selectedPatient, selectPatient } = useProfessionalWorkspace();
  return (
    <div>
      <span>{selectedPatient?.displayName ?? "sem paciente"}</span>
      <button
        onClick={() => selectPatient({ patientId: 10, displayName: "Ana" })}
      >
        Selecionar Ana
      </button>
      <button
        onClick={() => selectPatient({ patientId: 20, displayName: "Bruno" })}
      >
        Selecionar Bruno
      </button>
    </div>
  );
}

afterEach(cleanup);

beforeEach(() => {
  location = "/professional";
  setLocation.mockReset();
  refreshAuth.mockClear();
  profileRefetch.mockClear();
  accessesRefetch.mockClear();
  invalidateTimeZone.mockClear();
  invalidateDashboard.mockClear();
  invalidatePeriod.mockClear();
  authState = {
    loading: false,
    user: { professionalProfileActive: true },
  };
  profileState = {
    data: { active: true },
    isLoading: false,
    isError: false,
    isSuccess: true,
    refetch: profileRefetch,
  };
  accessesState = {
    data: [
      { patientUserId: 10, status: "approved" },
      { patientUserId: 20, status: "approved" },
    ],
    isLoading: false,
    isError: false,
    isSuccess: true,
    refetch: accessesRefetch,
  };
});

describe("ProfessionalLayout", () => {
  it("blocks inactive profiles without exposing professional content", () => {
    authState = {
      loading: false,
      user: { professionalProfileActive: false },
    };
    profileState = { ...profileState, data: { active: false } };

    render(<ProfessionalLayout>conteúdo sensível</ProfessionalLayout>);

    expect(screen.getByText("Área Profissional indisponível")).toBeTruthy();
    expect(screen.queryByText("conteúdo sensível")).toBeNull();
  });

  it("shows a distinct backend error state and hides content", () => {
    profileState = {
      ...profileState,
      isError: true,
      isSuccess: false,
      data: undefined,
    };

    render(<ProfessionalLayout>conteúdo sensível</ProfessionalLayout>);

    expect(screen.getByRole("alert").textContent).toContain(
      "Não foi possível confirmar seu acesso"
    );
    expect(screen.queryByText("conteúdo sensível")).toBeNull();
  });

  it("revalidates profile and patient access when focus returns", () => {
    render(<ProfessionalLayout>conteúdo profissional</ProfessionalLayout>);

    window.dispatchEvent(new Event("focus"));

    expect(refreshAuth).toHaveBeenCalledTimes(1);
    expect(profileRefetch).toHaveBeenCalledTimes(1);
    expect(accessesRefetch).toHaveBeenCalledTimes(1);
  });

  it("clears previous patient data when switching patients", async () => {
    render(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );

    await userEvent.click(screen.getByRole("button", { name: "Selecionar Ana" }));
    expect(screen.getByText("Ana")).toBeTruthy();

    await userEvent.click(
      screen.getByRole("button", { name: "Selecionar Bruno" })
    );

    expect(screen.getByText("Bruno")).toBeTruthy();
    expect(invalidateDashboard).toHaveBeenCalledWith({ patientId: 10 });
    expect(invalidateTimeZone).toHaveBeenCalledWith({ patientId: 10 });
  });

  it("removes a selected patient when authorization is revoked", async () => {
    const { rerender } = render(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );
    await userEvent.click(screen.getByRole("button", { name: "Selecionar Ana" }));
    expect(screen.getByText("Paciente: Ana")).toBeTruthy();

    accessesState = {
      ...accessesState,
      data: [{ patientUserId: 10, status: "revoked" }],
    };
    rerender(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );

    await waitFor(() =>
      expect(screen.getByText("Nenhum paciente selecionado")).toBeTruthy()
    );
    expect(screen.queryByText("Paciente: Ana")).toBeNull();
    expect(invalidateDashboard).toHaveBeenCalledWith({ patientId: 10 });
  });

  it("clears patient context before returning to the personal area", async () => {
    render(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );
    await userEvent.click(screen.getByRole("button", { name: "Selecionar Ana" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Minha alimentação" })
    );

    expect(setLocation).toHaveBeenCalledWith("/today");
    expect(invalidateDashboard).toHaveBeenCalledWith({ patientId: 10 });
  });

  it("supports keyboard navigation and exposes the current page", async () => {
    location = "/professional/reports";
    render(<ProfessionalLayout>conteúdo profissional</ProfessionalLayout>);
    const reports = screen.getByRole("button", { name: "Relatórios" });

    expect(reports.getAttribute("aria-current")).toBe("page");
    const user = userEvent.setup();
    reports.focus();
    await user.keyboard("{Enter}");

    expect(setLocation).toHaveBeenCalledWith("/professional/reports");
    expect(document.title).toBe("Relatórios | Área Profissional");
  });

  it("keeps the responsive sidebar control accessible", () => {
    render(<ProfessionalLayout>conteúdo profissional</ProfessionalLayout>);

    expect(
      screen.getByRole("button", {
        name: "Abrir ou recolher navegação profissional",
      })
    ).toBeTruthy();
    expect(
      screen.getByRole("navigation", {
        name: "Navegação da Área Profissional",
      })
    ).toBeTruthy();
  });
});
