// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reportsExperience = vi.fn(
  ({
    subjectUserId,
    onRangeChange,
    onRangeTransitionStart,
  }: {
    subjectUserId: number;
    onRangeChange: (range: { start: string; end: string }) => void;
    onRangeTransitionStart: () => void;
  }) => {
    React.useLayoutEffect(() => {
      onRangeTransitionStart();
      onRangeChange({ start: "2026-07-21", end: "2026-07-27" });
    }, [onRangeChange, onRangeTransitionStart, subjectUserId]);

    return (
      <div>
        Relatório canônico {subjectUserId}
        <button
          type="button"
          onClick={() => {
            onRangeTransitionStart();
            onRangeChange({ start: "2026-01-01", end: "2026-01-07" });
          }}
        >
          Definir período de teste
        </button>
        <button type="button" onClick={onRangeTransitionStart}>
          Iniciar troca de período
        </button>
        <button
          type="button"
          onClick={() =>
            onRangeChange({ start: "2026-02-01", end: "2026-02-07" })
          }
        >
          Concluir troca de período
        </button>
      </div>
    );
  }
);
const portfolioInput = vi.fn();
const activityRefetch = vi.fn();
const scheduleRefetch = vi.fn();
const trackingRefetch = vi.fn();
const setLocation = vi.fn();
type ReportBlock = "activity" | "schedule" | "tracking";
type ReportState = {
  data?: {
    summary: Record<string, number | null>;
  };
  isLoading: boolean;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
};
let reportStates: Record<ReportBlock, ReportState>;
let selectedPatient:
  | {
      patientId: number;
      displayName: string;
      trackingStatus: "active";
    }
  | null = null;

vi.mock("@/components/ProfessionalLayout", () => ({
  useProfessionalWorkspace: () => ({ selectedPatient, clearPatient: vi.fn() }),
}));
vi.mock("@/components/professional/ProfessionalAiAssistant", () => ({
  default: ({ patient }: { patient: { displayName: string } }) => (
    <div>IA contextual de {patient.displayName}</div>
  ),
}));
vi.mock("@/components/professional/ProfessionalReportRecoveryGate", () => ({
  default: ({
    children,
    patientId,
    range,
    suspended,
  }: {
    children: (state: {
      ready: boolean;
      feedback: React.ReactNode;
    }) => React.ReactNode;
    patientId: number;
    range: { start: string; end: string } | null;
    suspended?: boolean;
  }) => {
    const ready = Boolean(range) && !suspended;
    return (
      <div>
        <span>
          {range
            ? `Gate ${patientId}: ${range.start} a ${range.end}`
            : `Gate ${patientId}: período pendente`}
        </span>
        {children({
          ready,
          feedback: <div>Contexto em atualização</div>,
        })}
      </div>
    );
  },
}));
vi.mock("@/components/ProfessionalOperationalAlertsPanel", () => ({
  default: ({ patientId }: { patientId?: number }) => (
    <div>{patientId ? `Pendências de ${patientId}` : "Pendências da carteira"}</div>
  ),
}));
vi.mock("@/features/reports/ReportsExperience", () => ({
  default: reportsExperience,
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/professional/reports", setLocation],
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    professionalRecord: {
      portfolioReport: {
        useQuery: (input: { block: ReportBlock }) => {
          portfolioInput(input);
          return reportStates[input.block];
        },
      },
    },
  },
}));

afterEach(cleanup);

beforeEach(() => {
  selectedPatient = null;
  reportsExperience.mockClear();
  portfolioInput.mockClear();
  activityRefetch.mockReset();
  scheduleRefetch.mockReset();
  trackingRefetch.mockReset();
  setLocation.mockClear();
  reportStates = {
    activity: {
      data: {
        summary: {
          activeWithRecentRecords: 8,
          withoutRecentActivity: 5,
        },
      },
      isLoading: false,
      isError: false,
      refetch: activityRefetch,
    },
    schedule: {
      data: {
        summary: { pendingReviews: 6, pendingWeighings: 7 },
      },
      isLoading: false,
      isError: false,
      refetch: scheduleRefetch,
    },
    tracking: {
      data: {
        summary: { active: 1, paused: 2, ended: 3, notStarted: 4 },
      },
      isLoading: false,
      isError: false,
      refetch: trackingRefetch,
    },
  };
});

describe("ProfessionalReportsWorkspace", () => {
  it("shows aggregate indicators through the reports resource without duplicating the global priority list", async () => {
    const { default: ProfessionalReportsWorkspace } = await import(
      "./ProfessionalReportsWorkspace"
    );
    render(<ProfessionalReportsWorkspace />);

    expect(
      screen.getByRole("heading", { name: "Relatórios da carteira" })
    ).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.queryByText("Pendências da carteira")).toBeNull();
    expect(
      screen.getByText(/prioridades globais ficam centralizadas no Início/)
    ).toBeTruthy();
    expect(reportsExperience).not.toHaveBeenCalled();
    expect(portfolioInput).toHaveBeenCalledTimes(3);
    expect(portfolioInput).toHaveBeenCalledWith(
      expect.objectContaining({ block: "activity" })
    );
    expect(portfolioInput).toHaveBeenCalledWith({ block: "schedule" });
    expect(portfolioInput).toHaveBeenCalledWith({ block: "tracking" });
  });

  it("keeps healthy aggregate blocks visible and retries only the failed block", async () => {
    reportStates.activity = {
      isLoading: false,
      isError: true,
      refetch: activityRefetch,
    };
    const { default: ProfessionalReportsWorkspace } = await import(
      "./ProfessionalReportsWorkspace"
    );
    render(<ProfessionalReportsWorkspace />);

    expect(
      screen.getByRole("heading", {
        name: "Não foi possível carregar os registros do período",
      })
    ).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(activityRefetch).toHaveBeenCalledTimes(1);
    expect(scheduleRefetch).not.toHaveBeenCalled();
    expect(trackingRefetch).not.toHaveBeenCalled();
  });

  it("distinguishes unavailable aggregate data from a real zero", async () => {
    reportStates.activity.data = {
      summary: {
        activeWithRecentRecords: null,
        withoutRecentActivity: 0,
      },
    };
    const { default: ProfessionalReportsWorkspace } = await import(
      "./ProfessionalReportsWorkspace"
    );
    render(<ProfessionalReportsWorkspace />);

    const unavailableCard = screen
      .getByText("Ativos com registros no período")
      .closest('[data-slot="card"]');
    const zeroCard = screen
      .getByText("Sem registros no período")
      .closest('[data-slot="card"]');
    expect(unavailableCard).toBeTruthy();
    expect(zeroCard).toBeTruthy();
    expect(
      within(unavailableCard as HTMLElement).getByText("Não informado")
    ).toBeTruthy();
    expect(within(zeroCard as HTMLElement).getByText("0")).toBeTruthy();
  });

  it("uses only the patient provided by the URL-backed workspace context", async () => {
    selectedPatient = {
      patientId: 41,
      displayName: "Ana",
      trackingStatus: "active",
    };
    const { default: ProfessionalReportsWorkspace } = await import(
      "./ProfessionalReportsWorkspace"
    );
    render(<ProfessionalReportsWorkspace />);

    expect(screen.getByText("Relatório canônico 41")).toBeTruthy();
    expect(screen.getByText("Pendências de 41")).toBeTruthy();
    expect(screen.getByText("IA contextual de Ana")).toBeTruthy();
    expect(portfolioInput).not.toHaveBeenCalled();
  });


  it("hides alerts and AI immediately while a new period is being resolved", async () => {
    selectedPatient = {
      patientId: 41,
      displayName: "Ana",
      trackingStatus: "active",
    };
    const { default: ProfessionalReportsWorkspace } = await import(
      "./ProfessionalReportsWorkspace"
    );
    render(<ProfessionalReportsWorkspace />);

    expect(screen.getByText("Pendências de 41")).toBeTruthy();
    expect(screen.getByText("IA contextual de Ana")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Iniciar troca de período" })
    );

    expect(screen.getByText("Relatório canônico 41")).toBeTruthy();
    expect(screen.queryByText("Pendências de 41")).toBeNull();
    expect(screen.queryByText("IA contextual de Ana")).toBeNull();
    expect(screen.getByText("Contexto em atualização")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Concluir troca de período" })
    );

    expect(screen.getByText("Pendências de 41")).toBeTruthy();
    expect(screen.getByText("IA contextual de Ana")).toBeTruthy();
    expect(screen.getByText("Gate 41: 2026-02-01 a 2026-02-07")).toBeTruthy();
  });

  it("does not retain an individual report after patient context is cleared", async () => {
    selectedPatient = {
      patientId: 41,
      displayName: "Ana",
      trackingStatus: "active",
    };
    const { default: ProfessionalReportsWorkspace } = await import(
      "./ProfessionalReportsWorkspace"
    );
    const view = render(<ProfessionalReportsWorkspace />);
    expect(screen.getByText("Relatório canônico 41")).toBeTruthy();

    selectedPatient = null;
    view.rerender(<ProfessionalReportsWorkspace />);

    expect(screen.queryByText("Relatório canônico 41")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Relatórios da carteira" })
    ).toBeTruthy();
  });

  it("opens exact portfolio filters for report-period, review, weighing, and tracking indicators", async () => {
    const { default: ProfessionalReportsWorkspace } = await import(
      "./ProfessionalReportsWorkspace"
    );
    render(<ProfessionalReportsWorkspace />);

    fireEvent.change(screen.getByLabelText("Início do período"), {
      target: { value: "2026-07-01" },
    });
    fireEvent.change(screen.getByLabelText("Fim do período"), {
      target: { value: "2026-07-07" },
    });

    const detailButtons = screen.getAllByRole("button", {
      name: "Ver pacientes",
    });
    fireEvent.click(detailButtons[0]);
    expect(setLocation).toHaveBeenLastCalledWith(
      "/professional/patients?authorization=approved&tracking=active&records=with_records&reportStart=2026-07-01&reportEnd=2026-07-07"
    );
    fireEvent.click(detailButtons[1]);
    expect(setLocation).toHaveBeenLastCalledWith(
      "/professional/patients?authorization=approved&records=without_records&reportStart=2026-07-01&reportEnd=2026-07-07"
    );
    fireEvent.click(detailButtons[2]);
    expect(setLocation).toHaveBeenLastCalledWith(
      "/professional/patients?authorization=approved&review=overdue"
    );
    fireEvent.click(detailButtons[3]);
    expect(setLocation).toHaveBeenLastCalledWith(
      "/professional/patients?authorization=approved&weighing=overdue"
    );
    fireEvent.click(detailButtons[4]);
    expect(setLocation).toHaveBeenLastCalledWith(
      "/professional/patients?authorization=approved&tracking=active"
    );
  });

  it("remounts individual report state when the URL patient changes", async () => {
    selectedPatient = {
      patientId: 41,
      displayName: "Ana",
      trackingStatus: "active",
    };
    const { default: ProfessionalReportsWorkspace } = await import(
      "./ProfessionalReportsWorkspace"
    );
    const view = render(<ProfessionalReportsWorkspace />);

    fireEvent.click(
      screen.getByRole("button", { name: "Definir período de teste" })
    );
    expect(screen.getByText("Gate 41: 2026-01-01 a 2026-01-07")).toBeTruthy();

    selectedPatient = {
      patientId: 42,
      displayName: "Bia",
      trackingStatus: "active",
    };
    view.rerender(<ProfessionalReportsWorkspace />);

    expect(screen.getByText("Relatório canônico 42")).toBeTruthy();
    expect(screen.queryByText("Gate 42: 2026-01-01 a 2026-01-07")).toBeNull();
  });

  it("recalculates aggregate indicators when the configured period changes", async () => {
    const { default: ProfessionalReportsWorkspace } = await import(
      "./ProfessionalReportsWorkspace"
    );
    render(<ProfessionalReportsWorkspace />);

    fireEvent.change(screen.getByLabelText("Início do período"), {
      target: { value: "2026-07-10" },
    });

    expect(portfolioInput).toHaveBeenCalledWith(
      expect.objectContaining({
        block: "activity",
        reportStartDate: "2026-07-10",
      })
    );
  });
});
