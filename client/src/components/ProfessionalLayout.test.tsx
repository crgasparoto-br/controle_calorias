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
import {
  clearAllProfessionalPatientDraftSnapshots,
  readProfessionalPatientDraftSnapshot,
  storeProfessionalPatientDraftSnapshot,
} from "@/lib/professionalPatientDraftStore";

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

class EventSourceMock extends EventTarget {
  static instances: EventSourceMock[] = [];
  readonly url: string;
  readonly withCredentials: boolean;
  close = vi.fn();

  constructor(url: string | URL, init?: EventSourceInit) {
    super();
    this.url = String(url);
    this.withCredentials = Boolean(init?.withCredentials);
    EventSourceMock.instances.push(this);
  }

  emitRevocation(patientId: number) {
    this.dispatchEvent(
      new MessageEvent("access_revoked", {
        data: JSON.stringify({ patientId, occurredAt: Date.now() }),
      })
    );
  }
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);
vi.stubGlobal("EventSource", EventSourceMock);

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
  const { retryRouteAccess, routeAccessStatus, selectedPatient } =
    useProfessionalWorkspace();
  return (
    <div>
      <span>{selectedPatient?.displayName ?? "sem paciente"}</span>
      <span data-testid="route-access-status">{routeAccessStatus}</span>
      <input aria-label="Rascunho da área" defaultValue="" />
      {routeAccessStatus === "error" ? (
        <button type="button" onClick={retryRouteAccess}>
          Tentar novamente
        </button>
      ) : null}
    </div>
  );
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

function pendingPatientContext() {
  patientContextState = {
    data: undefined,
    isLoading: true,
    isFetching: true,
    isError: false,
    isSuccess: false,
    isFetchedAfterMount: false,
    error: null,
    refetch: contextRefetch,
  };
}

function forbiddenError() {
  return {
    message:
      "Este recurso não está disponível para o acesso profissional atual.",
    data: { code: "FORBIDDEN" },
  };
}

afterEach(cleanup);

beforeEach(() => {
  clearAllProfessionalPatientDraftSnapshots();
  location = "/professional";
  setLocation.mockReset();
  refreshAuth.mockClear();
  profileRefetch.mockClear();
  contextRefetch.mockClear();
  contextInput.mockClear();
  removeQueries.mockClear();
  querySubscriber = null;
  mutationSubscriber = null;
  EventSourceMock.instances = [];
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

  it("recognizes canonical authorization and entitlement revocation errors", () => {
    expect(
      isProfessionalPatientAccessUnavailableError(
        new Error("O acesso a este paciente não está mais disponível.")
      )
    ).toBe(true);
    expect(isProfessionalPatientAccessUnavailableError(forbiddenError())).toBe(
      true
    );
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

  it("keeps a validated patient visible during a background context refetch", async () => {
    location = "/professional/patients/10/messages";
    const view = renderPatientLayout();
    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());

    fetchingPatientContext();
    view.rerender(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );

    expect(screen.getByText("Ana")).toBeTruthy();
    expect(
      screen.queryByText("Preparando o contexto seguro do paciente...")
    ).toBeNull();
    expect(document.title).toBe("Mensagens | Área Profissional");
  });

  it("keeps the patient shell and local state mounted while a different route entitlement is revalidated", async () => {
    const user = userEvent.setup();
    location = "/professional/patients/10/goals";
    const view = renderPatientLayout();
    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());
    await user.type(screen.getByLabelText("Rascunho da área"), "preservado");
    expect(screen.getByTestId("route-access-status").textContent).toBe("ready");

    location = "/professional/patients/10/reports";
    pendingPatientContext();
    view.rerender(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );

    expect(screen.getByText("Ana")).toBeTruthy();
    expect(screen.getByTestId("route-access-status").textContent).toBe(
      "validating"
    );
    expect(
      (screen.getByLabelText("Rascunho da área") as HTMLInputElement).value
    ).toBe("preservado");
    expect(
      screen.queryByText("Preparando o contexto seguro do paciente...")
    ).toBeNull();
    expect(contextInput).toHaveBeenLastCalledWith({
      patientId: 10,
      resource: "professional_reports",
    });

    freshPatientContext(10, "Ana");
    view.rerender(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );

    await waitFor(() =>
      expect(screen.getByTestId("route-access-status").textContent).toBe(
        "ready"
      )
    );
    expect(
      (screen.getByLabelText("Rascunho da área") as HTMLInputElement).value
    ).toBe("preservado");
  });

  it("keeps the shell mounted on a transient cross-entitlement failure and still clears it on FORBIDDEN", async () => {
    location = "/professional/patients/10/goals";
    const view = renderPatientLayout();
    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());

    location = "/professional/patients/10/messages";
    patientContextState = {
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      isSuccess: false,
      isFetchedAfterMount: true,
      error: new Error("Falha temporária de conexão"),
      refetch: contextRefetch,
    };
    view.rerender(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );

    expect(screen.getByText("Ana")).toBeTruthy();
    expect(screen.getByTestId("route-access-status").textContent).toBe("error");
    expect(
      screen.getByText(
        "Não foi possível atualizar a validação de acesso agora. O contexto já validado permanece aberto."
      )
    ).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Tentar novamente" })
    );
    expect(contextRefetch).toHaveBeenCalled();

    patientContextState = {
      ...patientContextState,
      error: forbiddenError(),
    };
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
    await waitFor(() => expect(screen.queryByText("Ana")).toBeNull());
  });

  it("keeps the shell visible during background auth and profile refresh", async () => {
    location = "/professional/patients/10";
    const view = renderPatientLayout();
    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());

    authState.loading = true;
    profileState = { ...profileState, isFetching: true };
    view.rerender(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );

    expect(screen.getByText("Ana")).toBeTruthy();
  });

  it("keeps validated content visible after a non-authoritative background error", async () => {
    location = "/professional/patients/10";
    const view = renderPatientLayout();
    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());

    patientContextState = {
      ...patientContextState,
      isFetching: false,
      isError: true,
      isSuccess: false,
      error: new Error("Falha temporária de conexão"),
    };
    view.rerender(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );

    expect(screen.getByText("Ana")).toBeTruthy();
    expect(
      screen.getByText(
        "Não foi possível atualizar a validação de acesso agora. O contexto já validado permanece aberto."
      )
    ).toBeTruthy();
    expect(setLocation).not.toHaveBeenCalled();
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

  it("removes visible data and authorization-scoped drafts when the authenticated event stream reports external revocation", async () => {
    const draftScope = { patientId: 10, authorizationId: "access-10" };
    storeProfessionalPatientDraftSnapshot(draftScope, {
      note: "rascunho sensível",
    });
    location = "/professional/patients/10/reports";
    renderPatientLayout();
    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());
    await waitFor(() => expect(EventSourceMock.instances).toHaveLength(1));
    expect(EventSourceMock.instances[0].url).toContain("patientId=10");
    expect(EventSourceMock.instances[0].url).toContain(
      "resource=professional_reports"
    );

    EventSourceMock.instances[0].emitRevocation(10);

    await waitFor(() =>
      expect(setLocation).toHaveBeenCalledWith(
        "/professional/patients?notice=patient-access-unavailable"
      )
    );
    await waitFor(() => expect(screen.queryByText("Ana")).toBeNull());
    expect(removeQueries).toHaveBeenCalled();
    expect(
      readProfessionalPatientDraftSnapshot(draftScope, () => ({ note: "" }))
    ).toEqual({ note: "" });
  });

  it("ignores an external revocation event for another patient", async () => {
    location = "/professional/patients/10/reports";
    renderPatientLayout();
    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());
    await waitFor(() => expect(EventSourceMock.instances).toHaveLength(1));

    EventSourceMock.instances[0].emitRevocation(20);

    await Promise.resolve();
    expect(setLocation).not.toHaveBeenCalled();
    expect(screen.getByText("Ana")).toBeTruthy();
    expect(removeQueries).not.toHaveBeenCalled();
  });

  it("removes context immediately when a query reports revoked access", async () => {
    location = "/professional/patients/10/messages";
    renderPatientLayout();
    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());

    querySubscriber?.({
      type: "updated",
      query: {
        queryKey: [
          ["professionalRecord", "messages", "list"],
          { input: { patientId: 10 }, type: "query" },
        ],
        state: { error: forbiddenError() },
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
        options: {
          mutationKey: [["professionalRecord", "officialGoal", "activate"]],
        },
        state: {
          error: forbiddenError(),
          submittedAt: Date.now() + 1,
          variables: { patientId: 10 },
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

  it("ignores late query and mutation errors from another patient", async () => {
    location = "/professional/patients/10/messages";
    renderPatientLayout();
    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());

    querySubscriber?.({
      type: "updated",
      query: {
        queryKey: [
          ["professionalRecord", "messages", "list"],
          { input: { patientId: 20 }, type: "query" },
        ],
        state: { error: forbiddenError() },
      },
    });
    mutationSubscriber?.({
      type: "updated",
      mutation: {
        options: {
          mutationKey: [["professionalRecord", "messages", "create"]],
        },
        state: {
          error: forbiddenError(),
          submittedAt: Date.now() + 1,
          variables: { patientId: 20 },
        },
      },
    });

    await Promise.resolve();
    expect(setLocation).not.toHaveBeenCalled();
    expect(screen.getByText("Ana")).toBeTruthy();
    expect(removeQueries).not.toHaveBeenCalled();
  });

  it("ignores an id-less mutation submitted before the current patient became ready", async () => {
    location = "/professional/patients/10";
    const view = renderPatientLayout();
    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());

    location = "/professional/patients/20";
    freshPatientContext(20, "Bruno");
    view.rerender(
      <ProfessionalLayout>
        <PatientFixture />
      </ProfessionalLayout>
    );
    await waitFor(() => expect(screen.getByText("Bruno")).toBeTruthy());
    setLocation.mockClear();
    removeQueries.mockClear();

    mutationSubscriber?.({
      type: "updated",
      mutation: {
        options: {
          mutationKey: [["professionalRecord", "transitionTracking"]],
        },
        state: {
          error: forbiddenError(),
          submittedAt: 1,
          variables: { accessId: "access-10" },
        },
      },
    });

    await Promise.resolve();
    expect(setLocation).not.toHaveBeenCalled();
    expect(screen.getByText("Bruno")).toBeTruthy();
    expect(removeQueries).not.toHaveBeenCalled();
  });

  it("does not trust retained cache when the first authorization revalidation fails", () => {
    location = "/professional/patients/10";
    patientContextState = {
      ...patientContextState,
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

  it("does not trust a cached profile when the first profile revalidation fails", () => {
    location = "/professional/patients/10";
    profileState = {
      ...profileState,
      isFetching: false,
      isError: true,
      isSuccess: false,
      isFetchedAfterMount: true,
      error: new Error("Falha temporária de conexão"),
    };

    renderPatientLayout();

    expect(screen.getByRole("alert").textContent).toContain(
      "Não foi possível confirmar seu acesso"
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
    expect(screen.getByText("Ana")).toBeTruthy();
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
