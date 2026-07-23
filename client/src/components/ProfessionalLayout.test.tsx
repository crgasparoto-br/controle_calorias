// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfessionalLayout, { useProfessionalWorkspace } from "./ProfessionalLayout";

const setLocation = vi.fn();
const refreshAuth = vi.fn(async () => undefined);
const profileRefetch = vi.fn(async () => undefined);
const accessesRefetch = vi.fn(async () => undefined);
const cancelPatientData = vi.fn(async () => undefined);
const resetPatientData = vi.fn(async () => undefined);

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

const queryUtils = () => ({
  cancel: cancelPatientData,
  reset: resetPatientData,
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      nutrition: {
        professionals: {
          patientTimeZone: queryUtils(),
          patientDashboard: queryUtils(),
          patientPeriodBundle: queryUtils(),
          history: queryUtils(),
        },
      },
      professionalRecord: {
        get: queryUtils(),
        messages: { list: queryUtils() },
        operationalAlerts: { list: queryUtils() },
        ai: { priorities: queryUtils() },
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
  const { selectedPatient } = useProfessionalWorkspace();
  return <span>{selectedPatient?.displayName ?? "sem paciente"}</span>;
}

afterEach(cleanup);

beforeEach(() => {
  location = "/professional";
  setLocation.mockReset();
  refreshAuth.mockClear();
  profileRefetch.mockClear();
  accessesRefetch.mockClear();
  cancelPatientData.mockClear();
  resetPatientData.mockClear();
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
      {
        patientUserId: 10,
        status: "approved",
        patient: { name: "Ana", email: "ana@example.com" },
      },
      {
        patientUserId: 20,
        status: "approved",
        patient: { name: "Bruno", email: "bruno@example.com" },
      },
    ],
    isLoading: false,
    isError: false,
    isSuccess: true,
    refetch: accessesRefetch,
  };
});

describe("ProfessionalLayout", () => {
  it("blocks inactive profiles without exposing professional content", () => {
    authState.user = { professionalProfileActive: false };
    profileState = { ...profileState, data: { active: false } };

    render(<ProfessionalLayout>conteúdo sensível</ProfessionalLayout>);

    expect(screen.getByText("Área Profissional indisponível")).toBeTruthy();
    expect(screen.queryByText("conteúdo sensível")).toBeNull();
  });

  it("shows a distinct profile error state and hides content", () => {
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

  it("derives the selected patient exclusively from the URL", async () => {
    location = "/professional/patients/10/reports";

    render(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );

    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());
    expect(screen.getByText("Paciente: Ana")).toBeTruthy();
    expect(document.title).toBe("Relatórios | Área Profissional");
  });

  it("hides the previous patient while switching URL context", async () => {
    location = "/professional/patients/10";
    const view = render(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );
    await waitFor(() => expect(screen.getByText("Paciente: Ana")).toBeTruthy());

    cancelPatientData.mockClear();
    resetPatientData.mockClear();
    location = "/professional/patients/20";
    view.rerender(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );

    expect(screen.queryByText("Paciente: Ana")).toBeNull();
    expect(screen.queryByText("Paciente: Bruno")).toBeNull();
    expect(
      screen.getByText("Preparando o contexto seguro do paciente...")
    ).toBeTruthy();

    await waitFor(() => expect(screen.getByText("Paciente: Bruno")).toBeTruthy());
    expect(cancelPatientData).toHaveBeenCalledTimes(8);
    expect(resetPatientData).toHaveBeenCalledTimes(8);
  });

  it("clears visible patient data and redirects when authorization is revoked", async () => {
    location = "/professional/patients/10";
    const view = render(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );
    await waitFor(() => expect(screen.getByText("Paciente: Ana")).toBeTruthy());

    accessesState = {
      ...accessesState,
      data: [{ patientUserId: 10, status: "revoked" }],
    };
    view.rerender(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );

    expect(screen.queryByText("Paciente: Ana")).toBeNull();
    await waitFor(() =>
      expect(setLocation).toHaveBeenCalledWith(
        "/professional/patients?notice=patient-access-unavailable"
      )
    );
    expect(cancelPatientData).toHaveBeenCalled();
    expect(resetPatientData).toHaveBeenCalled();
  });

  it("protects patient content while authorization cannot be revalidated", () => {
    location = "/professional/patients/10";
    accessesState = {
      ...accessesState,
      isError: true,
      isSuccess: false,
      data: undefined,
    };

    render(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Não foi possível confirmar a autorização do paciente"
    );
    expect(screen.queryByText("Ana")).toBeNull();
  });

  it("clears patient caches before returning to the personal area", async () => {
    location = "/professional/patients/10";
    render(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );
    await waitFor(() => expect(screen.getByText("Paciente: Ana")).toBeTruthy());

    await userEvent.click(
      screen.getByRole("button", { name: "Minha alimentação" })
    );

    expect(screen.queryByText("Paciente: Ana")).toBeNull();
    expect(setLocation).toHaveBeenCalledWith("/today");
    expect(cancelPatientData).toHaveBeenCalled();
    expect(resetPatientData).toHaveBeenCalled();
  });

  it("supports keyboard navigation and exposes the current page", async () => {
    location = "/professional/reports";
    render(<ProfessionalLayout>conteúdo profissional</ProfessionalLayout>);
    const reports = screen.getByRole("button", { name: "Relatórios" });

    expect(reports.getAttribute("aria-current")).toBe("page");
    reports.focus();
    await userEvent.keyboard("{Enter}");

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
