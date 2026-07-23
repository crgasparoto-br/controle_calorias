// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let location = "/professional/patients/41/reports";
const setLocation = vi.fn();
const removeQueries = vi.fn();
const contextInput = vi.fn();
let querySubscriber: ((event: any) => void) | null = null;
let mutationSubscriber: ((event: any) => void) | null = null;

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

const trpcUtils = {
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
  useAuth: () => ({
    loading: false,
    user: { professionalProfileActive: true },
    refresh: vi.fn(async () => undefined),
  }),
}));
vi.mock("wouter", () => ({
  useLocation: () => [location, setLocation],
}));
vi.mock("@/hooks/useMobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => trpcUtils,
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
            refetch: vi.fn(async () => undefined),
          }),
        },
      },
    },
    professionalRecord: {
      context: {
        useQuery: (input: { patientId: number; resource: string }) => {
          contextInput(input);
          const patient =
            input.patientId === 72
              ? { displayName: "Bruno", trackingStatus: "paused" }
              : { displayName: "Ana", trackingStatus: "active" };
          return {
            data: {
              patientId: input.patientId,
              authorizationId: `authorization-${input.patientId}`,
              ...patient,
            },
            isLoading: false,
            isFetching: false,
            isError: false,
            isSuccess: true,
            isFetchedAfterMount: true,
            error: null,
            refetch: vi.fn(async () => undefined),
          };
        },
      },
    },
  },
}));

vi.mock("@/components/ProfessionalReportsWorkspace", () => ({
  default: () => <div>Relatórios individuais</div>,
}));
vi.mock("@/components/ProfessionalMessagesPanel", () => ({
  default: () => <div>Mensagens individuais</div>,
}));
vi.mock("@/pages/professional/ProfessionalHome", () => ({
  default: () => <div>Início profissional</div>,
}));
vi.mock("@/pages/professional/ProfessionalPatients", () => ({
  default: () => <div>Carteira profissional</div>,
}));
vi.mock("@/pages/professional/ProfessionalPatientWorkspace", () => ({
  default: () => <div>Prontuário individual</div>,
}));

beforeEach(() => {
  location = "/professional/patients/41/reports";
  setLocation.mockReset();
  removeQueries.mockReset();
  contextInput.mockReset();
  querySubscriber = null;
  mutationSubscriber = null;
  for (const item of caches) {
    item.cancel.mockReset();
    item.cancel.mockImplementation(() => Promise.resolve());
  }
});

afterEach(cleanup);

describe("ProfessionalAreaPage integration", () => {
  it("recreates the authorized patient from the URL after remount", async () => {
    const { default: ProfessionalAreaPage } = await import("./ProfessionalAreaPage");
    const firstTab = render(<ProfessionalAreaPage />);

    await waitFor(() => expect(screen.getByText("Paciente: Ana")).toBeTruthy());
    expect(screen.getByText("Relatórios individuais")).toBeTruthy();
    expect(contextInput).toHaveBeenCalledWith({
      patientId: 41,
      resource: "professional_reports",
    });

    firstTab.unmount();
    contextInput.mockClear();
    render(<ProfessionalAreaPage />);

    await waitFor(() => expect(screen.getByText("Paciente: Ana")).toBeTruthy());
    expect(screen.getByText("Relatórios individuais")).toBeTruthy();
    expect(contextInput).toHaveBeenCalledWith({
      patientId: 41,
      resource: "professional_reports",
    });
  });

  it("follows URL history changes without retaining the previous patient", async () => {
    const { default: ProfessionalAreaPage } = await import("./ProfessionalAreaPage");
    const view = render(<ProfessionalAreaPage />);
    await waitFor(() => expect(screen.getByText("Paciente: Ana")).toBeTruthy());

    location = "/professional/patients/72/messages";
    view.rerender(<ProfessionalAreaPage />);

    await waitFor(() => expect(screen.getByText("Paciente: Bruno")).toBeTruthy());
    expect(screen.getByText("Mensagens individuais")).toBeTruthy();
    expect(screen.queryByText("Paciente: Ana")).toBeNull();

    location = "/professional/patients/41/reports";
    view.rerender(<ProfessionalAreaPage />);

    await waitFor(() => expect(screen.getByText("Paciente: Ana")).toBeTruthy());
    expect(screen.getByText("Relatórios individuais")).toBeTruthy();
    expect(screen.queryByText("Paciente: Bruno")).toBeNull();
  });

  it("removes the visible patient when message retry reports FORBIDDEN", async () => {
    location = "/professional/patients/41/messages";
    const { default: ProfessionalAreaPage } = await import("./ProfessionalAreaPage");
    render(<ProfessionalAreaPage />);
    await waitFor(() => expect(screen.getByText("Paciente: Ana")).toBeTruthy());

    act(() => {
      mutationSubscriber?.({
        type: "updated",
        mutation: {
          options: {
            mutationKey: [["professionalRecord", "messages", "retry"]],
          },
          state: {
            error: {
              message: "O acesso a este paciente não está mais disponível.",
              data: { code: "FORBIDDEN" },
            },
            submittedAt: Date.now() + 1,
            variables: {
              messageId: "f3c9b83a-7574-4ddf-a291-964b420393e2",
            },
          },
        },
      });
    });

    await waitFor(() =>
      expect(setLocation).toHaveBeenCalledWith(
        "/professional/patients?notice=patient-access-unavailable"
      )
    );
    await waitFor(() => expect(screen.queryByText("Paciente: Ana")).toBeNull());
    expect(removeQueries).toHaveBeenCalled();
  });
});
