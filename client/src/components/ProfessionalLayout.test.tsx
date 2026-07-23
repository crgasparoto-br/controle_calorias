// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfessionalLayout, {
  isProfessionalPatientAccessUnavailableError,
  isProfessionalPatientQueryKey,
  useProfessionalWorkspace,
} from "./ProfessionalLayout";

const setLocation = vi.fn();
const refreshAuth = vi.fn(async () => undefined);
const profileRefetch = vi.fn(async () => undefined);
const contextRefetch = vi.fn(async () => undefined);
const removeQueries = vi.fn();
const contextInput = vi.fn();
let querySubscriber: ((event: any) => void) | null = null;
let mutationSubscriber: ((event: any) => void) | null = null;

function cacheUtils() {
  return {
    cancel: vi.fn(() => Promise.resolve()),
  };
}

const patientTimeZone = cacheUtils();
const patientDashboard = cacheUtils();
const patientPeriodBundle = cacheUtils();
const contextCache = cacheUtils();
const professionalRecord = cacheUtils();
const messages = cacheUtils();
const operationalAlerts = cacheUtils();
const aiPriorities = cacheUtils();
const officialGoal = cacheUtils();
const patientCaches = [
  patientTimeZone,
  patientDashboard,
  patientPeriodBundle,
  contextCache,
  professionalRecord,
  messages,
  operationalAlerts,
  aiPriorities,
  officialGoal,
];
const stableTrpcUtils = {
  nutrition: {
    professionals: {
      patientTimeZone,
      patientDashboard,
      patientPeriodBundle,
    },
  },
  professionalRecord: {
    context: contextCache,
    get: professionalRecord,
    messages: { list: messages },
    operationalAlerts: { list: operationalAlerts },
    ai: { priorities: aiPriorities },
    officialGoal: { professionalState: officialGoal },
  },
};

const queryClient = {
  removeQueries,
  getQueryCache: () => ({
    subscribe: (subscriber: (event: any) => void) => {
      querySubscriber = subscriber;
      return () => {
        querySubscriber = null;
      };
    },
  }),
  getMutationCache: () => ({
    subscribe: (subscriber: (event: any) => void) => {
      mutationSubscriber = subscriber;
      return () => {
        mutationSubscriber = null;
      };
    },
  }),
};

let location = "/professional";
let authState: {
  loading: boolean;
  user: null | { professionalProfileActive?: boolean };
};
let profileState: Record<string, unknown>;
let patientContextState: Record<string, unknown>;

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => queryClient,
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ ...authState, refresh: refreshAuth }),
}));
vi.mock("wouter", () => ({
  useLocation: () => [location, setLocation],
}));
vi.mock("@/hooks/useMobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => stableTrpcUtils,
    nutrition: {
      professionals: {
        profile: { useQuery: () => profileState },
      },
    },
    professionalRecord: {
      context: {
        useQuery: (input: unknown) => {
          contextInput(input);
          return patientContextState;
        },
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

function freshPatientContext(patientId = 10, displayName = "Ana") {
  patientContextState = {
    data: {
      patientId,
      displayName,
      trackingStatus: "active",
      authorizationId: `access-${patientId}`,
    },
    isLoading: false,
    isFetching: false,
    isError: false,
    isSuccess: true,
    isFetchedAfterMount: true,
    error: null,
    refetch: contextRefetch,
  };
}

function fetchingPatientContext() {
  patientContextState = {
    ...patientContextState,
    isFetching: true,
    isSuccess: true,
  };
}

afterEach(cleanup);

beforeEach(() => {
  location = "/professional";
  setLocation.mockReset();
  refreshAuth.mockClear();
  profileRefetch.mockClear();
  contextRefetch.mockClear();
  contextInput.mockClear();
  removeQueries.mockClear();
  querySubscriber = null;
  mutationSubscriber = null;
  for (const cache of patientCaches) {
    cache.cancel.mockReset();
    cache.cancel.mockImplementation(() => Promise.resolve());
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
  freshPatientContext();
});

describe("professional patient cache helpers", () => {
  it("matches only patient-scoped query paths", () => {
    expect(
      isProfessionalPatientQueryKey([
        ["professionalRecord", "messages", "list"],
        { patientId: 10 },
      ])
    ).toBe(true);
    expect(
      isProfessionalPatientQueryKey([
        ["nutrition", "professionals", "portfolio"],
        {},
      ])
    ).toBe(false);
  });

  it("recognizes canonical authorization revocation errors", () => {
    expect(
      isProfessionalPatientAccessUnavailableError(
        new Error("O acesso a este paciente não está mais disponível.")
      )
    ).toBe(true);
    expect(
      isProfessionalPatientAccessUnavailableError(
        new Error("Falha temporária de conexão")
      )
    ).toBe(false);
  });
});

describe("ProfessionalLayout", () => {
  it("blocks inactive profiles without exposing professional content", () => {
    authState.user = { professionalProfileActive: false };
    profileState = { ...profileState, data: { active: false } };

    render(<ProfessionalLayout>conteúdo sensível</ProfessionalLayout>);

    expect(screen.getByText("Área Profissional indisponível")).toBeTruthy();
    expect(screen.queryByText("conteúdo sensível")).toBeNull();
  });

  it("requests the exact entitlement declared by the patient route", async () => {
    location = "/professional/patients/10/reports";
    renderPatientLayout();

    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());
    expect(contextInput).toHaveBeenCalledWith({
      patientId: 10,
      resource: "professional_reports",
    });
  });

  it("keeps cached authorization protected until refetch finishes", async () => {
    location = "/professional/patients/10/messages";
    fetchingPatientContext();
    const view = renderPatientLayout();

    expect(screen.queryByText("Ana")).toBeNull();
    expect(
      screen.getByText("Preparando o contexto seguro do paciente...")
    ).toBeTruthy();

    freshPatientContext();
    view.rerender(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );

    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());
    expect(document.title).toBe("Mensagens | Área Profissional");
  });

  it("waits for previous-patient cancellation and removal before showing the next patient", async () => {
    location = "/professional/patients/10";
    const view = renderPatientLayout();
    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());

    const pendingCancellation = deferred();
    patientTimeZone.cancel.mockImplementationOnce(
      () => pendingCancellation.promise
    );
    removeQueries.mockClear();

    location = "/professional/patients/20";
    freshPatientContext(20, "Bruno");
    view.rerender(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );

    expect(screen.queryByText("Ana")).toBeNull();
    expect(screen.queryByText("Bruno")).toBeNull();
    pendingCancellation.resolve();

    await waitFor(() => expect(screen.getByText("Bruno")).toBeTruthy());
    expect(removeQueries).toHaveBeenCalled();
  });

  it("removes context immediately when a query reports revoked access", async () => {
    location = "/professional/patients/10/messages";
    renderPatientLayout();
    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());

    querySubscriber?.({
      type: "updated",
      query: {
        state: {
          error: new Error("O acesso a este paciente não está mais disponível."),
        },
      },
    });

    await waitFor(() =>
      expect(setLocation).toHaveBeenCalledWith(
        "/professional/patients?notice=patient-access-unavailable"
      )
    );
    await waitFor(() => expect(screen.queryByText("Ana")).toBeNull());
    expect(removeQueries).toHaveBeenCalled();
  });

  it("removes context immediately when a mutation reports revoked access", async () => {
    location = "/professional/patients/10/goals";
    renderPatientLayout();
    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());

    mutationSubscriber?.({
      type: "updated",
      mutation: {
        state: {
          error: new Error("Acesso profissional não autorizado pela pessoa acompanhada."),
        },
      },
    });

    await waitFor(() =>
      expect(setLocation).toHaveBeenCalledWith(
        "/professional/patients?notice=patient-access-unavailable"
      )
    );
    await waitFor(() => expect(screen.queryByText("Ana")).toBeNull());
  });

  it("keeps patient content protected on a temporary authorization failure", () => {
    location = "/professional/patients/10";
    patientContextState = {
      ...patientContextState,
      data: undefined,
      isFetching: false,
      isError: true,
      isSuccess: false,
      isFetchedAfterMount: true,
      error: new Error("Falha temporária de conexão"),
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
    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());

    window.dispatchEvent(new Event("focus"));

    expect(refreshAuth).toHaveBeenCalledTimes(1);
    expect(profileRefetch).toHaveBeenCalledTimes(1);
    expect(contextRefetch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText("Ana")).toBeNull());
  });

  it("clears patient caches before returning to the personal area", async () => {
    location = "/professional/patients/10";
    renderPatientLayout();
    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());

    await userEvent.click(
      screen.getByRole("button", { name: "Minha alimentação" })
    );

    await waitFor(() => expect(screen.queryByText("Ana")).toBeNull());
    expect(setLocation).toHaveBeenCalledWith("/today");
    expect(removeQueries).toHaveBeenCalled();
  });
});
