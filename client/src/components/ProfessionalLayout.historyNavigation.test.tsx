// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfessionalLayout, {
  useProfessionalWorkspace,
} from "./ProfessionalLayout";

let location = "/professional/patients/10";
const setLocation = vi.fn();
const removeQueries = vi.fn();
const contextRefetch = vi.fn(async () => undefined);
const profileRefetch = vi.fn(async () => undefined);
const refreshAuth = vi.fn(async () => undefined);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function cache() {
  return { cancel: vi.fn(() => Promise.resolve()) };
}

const patientTimeZone = cache();
const patientDashboard = cache();
const patientPeriodBundle = cache();
const contextCache = cache();
const record = cache();
const messages = cache();
const alerts = cache();
const priorities = cache();
const officialGoal = cache();
const caches = [
  patientTimeZone,
  patientDashboard,
  patientPeriodBundle,
  contextCache,
  record,
  messages,
  alerts,
  priorities,
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
    get: record,
    messages: { list: messages },
    operationalAlerts: { list: alerts },
    ai: { priorities },
    officialGoal: { professionalState: officialGoal },
  },
};
const stableQueryClient = {
  removeQueries,
  getQueryCache: () => ({ subscribe: () => () => undefined }),
  getMutationCache: () => ({ subscribe: () => () => undefined }),
};

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => stableQueryClient,
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    loading: false,
    user: { professionalProfileActive: true },
    refresh: refreshAuth,
  }),
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
        profile: {
          useQuery: () => ({
            data: { active: true },
            isLoading: false,
            isFetching: false,
            isError: false,
            isSuccess: true,
            isFetchedAfterMount: true,
            refetch: profileRefetch,
          }),
        },
      },
    },
    professionalRecord: {
      context: {
        useQuery: (input: { patientId: number }) => ({
          data: {
            patientId: input.patientId,
            authorizationId: `authorization-${input.patientId}`,
            displayName: input.patientId === 10 ? "Ana" : "Bruno",
            trackingStatus: "active",
          },
          isLoading: false,
          isFetching: false,
          isError: false,
          isSuccess: true,
          isFetchedAfterMount: true,
          error: null,
          refetch: contextRefetch,
        }),
      },
    },
  },
}));

function PatientName() {
  const { selectedPatient } = useProfessionalWorkspace();
  return <span>{selectedPatient?.displayName ?? "sem paciente"}</span>;
}

beforeEach(() => {
  location = "/professional/patients/10";
  setLocation.mockReset();
  removeQueries.mockReset();
  for (const item of caches) {
    item.cancel.mockReset();
    item.cancel.mockImplementation(() => Promise.resolve());
  }
});

afterEach(cleanup);

describe("ProfessionalLayout browser history", () => {
  it("ignores a late patient transition after rapid back and forward navigation", async () => {
    const view = render(
      <ProfessionalLayout>
        <PatientName />
      </ProfessionalLayout>
    );
    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());

    const firstTransition = deferred();
    patientTimeZone.cancel.mockImplementationOnce(() => firstTransition.promise);

    location = "/professional/patients/20";
    view.rerender(
      <ProfessionalLayout>
        <PatientName />
      </ProfessionalLayout>
    );
    expect(screen.queryByText("Bruno")).toBeNull();

    location = "/professional/patients/10";
    view.rerender(
      <ProfessionalLayout>
        <PatientName />
      </ProfessionalLayout>
    );

    firstTransition.resolve();
    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());
    expect(screen.queryByText("Bruno")).toBeNull();
  });
});
