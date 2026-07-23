// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfessionalLayout, {
  useProfessionalWorkspace,
} from "./ProfessionalLayout";

const setLocation = vi.fn();
const refreshAuth = vi.fn(async () => undefined);
const profileRefetch = vi.fn(async () => undefined);
const accessesRefetch = vi.fn(async () => undefined);

function cacheUtils() {
  return {
    cancel: vi.fn(() => Promise.resolve()),
    reset: vi.fn(() => Promise.resolve()),
  };
}

const patientTimeZone = cacheUtils();
const patientDashboard = cacheUtils();
const patientPeriodBundle = cacheUtils();
const history = cacheUtils();
const professionalRecord = cacheUtils();
const messages = cacheUtils();
const operationalAlerts = cacheUtils();
const aiPriorities = cacheUtils();
const patientCaches = [
  patientTimeZone,
  patientDashboard,
  patientPeriodBundle,
  history,
  professionalRecord,
  messages,
  operationalAlerts,
  aiPriorities,
];

let location = "/professional";
let authState: {
  loading: boolean;
  user: null | { professionalProfileActive?: boolean };
};
let profileState: Record<string, unknown>;
let accessesState: Record<string, unknown>;

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
          patientTimeZone,
          patientDashboard,
          patientPeriodBundle,
          history,
        },
      },
      professionalRecord: {
        get: professionalRecord,
        messages: { list: messages },
        operationalAlerts: { list: operationalAlerts },
        ai: { priorities: aiPriorities },
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function renderPatientLayout() {
  return render(
    <ProfessionalLayout>
      <PatientFixture />
    </ProfessionalLayout>
  );
}

function markAccessesFetching() {
  accessesState = {
    ...accessesState,
    isFetching: true,
  };
}

function markAccessesFresh(data = accessesState.data) {
  accessesState = {
    ...accessesState,
    data,
    isLoading: false,
    isFetching: false,
    isError: false,
    isSuccess: true,
    isFetchedAfterMount: true,
  };
}

afterEach(cleanup);

beforeEach(() => {
  location = "/professional";
  setLocation.mockReset();
  refreshAuth.mockClear();
  profileRefetch.mockClear();
  accessesRefetch.mockClear();
  for (const cache of patientCaches) {
    cache.cancel.mockReset();
    cache.cancel.mockImplementation(() => Promise.resolve());
    cache.reset.mockReset();
    cache.reset.mockImplementation(() => Promise.resolve());
  }
  authState = {
    loading: false,
    user: { professionalProfileActive: true },
  };
  profileState = {
    data: { active: true },
    isLoading: false,
    isFetching: false,
    isError: false,
    isSuccess: true,
    isFetchedAfterMount: true,
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
    isFetching: false,
    isError: false,
    isSuccess: true,
    isFetchedAfterMount: true,
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

  it("keeps cached authorization protected until refetch finishes", async () => {
    location = "/professional/patients/10/reports";
    markAccessesFetching();
    const view = renderPatientLayout();

    expect(screen.queryByText("Paciente: Ana")).toBeNull();
    expect(
      screen.getByText("Preparando o contexto seguro do paciente...")
    ).toBeTruthy();

    markAccessesFresh();
    view.rerender(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );

    await waitFor(() => expect(screen.getByText("Paciente: Ana")).toBeTruthy());
    expect(document.title).toBe("Relatórios | Área Profissional");
  });

  it("waits for every previous-patient cache reset before showing the next patient", async () => {
    location = "/professional/patients/10";
    const view = renderPatientLayout();
    await waitFor(() => expect(screen.getByText("Paciente: Ana")).toBeTruthy());

    const pendingCancellation = deferred();
    patientTimeZone.cancel.mockImplementationOnce(
      () => pendingCancellation.promise
    );
    for (const cache of patientCaches) {
      cache.cancel.mockClear();
      cache.reset.mockClear();
    }

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

    await Promise.resolve();
    expect(screen.queryByText("Paciente: Bruno")).toBeNull();
    expect(patientTimeZone.reset).not.toHaveBeenCalled();

    pendingCancellation.resolve();
    await waitFor(() => expect(screen.getByText("Paciente: Bruno")).toBeTruthy());

    for (const cache of patientCaches) {
      expect(cache.cancel).toHaveBeenCalledTimes(1);
      expect(cache.reset).toHaveBeenCalledTimes(1);
    }
  });

  it("ignores a late transition after rapid back and forward navigation", async () => {
    location = "/professional/patients/10";
    const view = renderPatientLayout();
    await waitFor(() => expect(screen.getByText("Paciente: Ana")).toBeTruthy());

    const firstTransition = deferred();
    patientTimeZone.cancel.mockImplementationOnce(() => firstTransition.promise);

    location = "/professional/patients/20";
    view.rerender(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );
    expect(screen.queryByText("Paciente: Bruno")).toBeNull();

    location = "/professional/patients/10";
    view.rerender(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );

    firstTransition.resolve();
    await waitFor(() => expect(screen.getByText("Paciente: Ana")).toBeTruthy());
    expect(screen.queryByText("Paciente: Bruno")).toBeNull();
  });

  it("hides cached content immediately while revocation is being revalidated", async () => {
    location = "/professional/patients/10";
    const view = renderPatientLayout();
    await waitFor(() => expect(screen.getByText("Paciente: Ana")).toBeTruthy());

    markAccessesFetching();
    view.rerender(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );
    expect(screen.queryByText("Paciente: Ana")).toBeNull();

    markAccessesFresh([{ patientUserId: 10, status: "revoked" }]);
    view.rerender(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );

    await waitFor(() =>
      expect(setLocation).toHaveBeenCalledWith(
        "/professional/patients?notice=patient-access-unavailable"
      )
    );
    expect(screen.queryByText("Paciente: Ana")).toBeNull();
  });

  it("keeps patient content protected on a temporary authorization failure", () => {
    location = "/professional/patients/10";
    accessesState = {
      ...accessesState,
      data: undefined,
      isFetching: false,
      isError: true,
      isSuccess: false,
      isFetchedAfterMount: true,
    };

    renderPatientLayout();

    expect(screen.getByRole("alert").textContent).toContain(
      "Não foi possível confirmar a autorização do paciente"
    );
    expect(screen.queryByText("Ana")).toBeNull();
  });

  it("revalidates profile and patient access when focus returns", async () => {
    location = "/professional/patients/10";
    renderPatientLayout();
    await waitFor(() => expect(screen.getByText("Paciente: Ana")).toBeTruthy());

    window.dispatchEvent(new Event("focus"));

    expect(refreshAuth).toHaveBeenCalledTimes(1);
    expect(profileRefetch).toHaveBeenCalledTimes(1);
    expect(accessesRefetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Paciente: Ana")).toBeNull();
  });

  it("clears patient caches before returning to the personal area", async () => {
    location = "/professional/patients/10";
    renderPatientLayout();
    await waitFor(() => expect(screen.getByText("Paciente: Ana")).toBeTruthy());

    await userEvent.click(
      screen.getByRole("button", { name: "Minha alimentação" })
    );

    expect(screen.queryByText("Paciente: Ana")).toBeNull();
    expect(setLocation).toHaveBeenCalledWith("/today");
    for (const cache of patientCaches) {
      expect(cache.cancel).toHaveBeenCalled();
      expect(cache.reset).toHaveBeenCalled();
    }
  });

  it("keeps navigation and the responsive sidebar control accessible", async () => {
    location = "/professional/reports";
    render(<ProfessionalLayout>conteúdo profissional</ProfessionalLayout>);
    const reports = screen.getByRole("button", { name: "Relatórios" });

    expect(reports.getAttribute("aria-current")).toBe("page");
    reports.focus();
    await userEvent.keyboard("{Enter}");

    expect(setLocation).toHaveBeenCalledWith("/professional/reports");
    expect(
      screen.getByRole("button", {
        name: "Abrir ou recolher navegação profissional",
      })
    ).toBeTruthy();
  });
});
