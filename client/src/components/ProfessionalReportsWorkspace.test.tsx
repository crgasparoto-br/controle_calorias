// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reportsExperience = vi.fn(
  ({
    subjectUserId,
    onRangeChange,
  }: {
    subjectUserId: number;
    onRangeChange: (range: { start: string; end: string }) => void;
  }) => (
    <div>
      Relatório canônico {subjectUserId}
      <button
        type="button"
        onClick={() =>
          onRangeChange({ start: "2026-01-01", end: "2026-01-07" })
        }
      >
        Definir período de teste
      </button>
    </div>
  )
);
const portfolioInput = vi.fn();
const setLocation = vi.fn();
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
  }: {
    children: React.ReactNode;
    patientId: number;
    range: { start: string; end: string };
  }) => (
    <div>
      <span>{`Gate ${patientId}: ${range.start} a ${range.end}`}</span>
      {children}
    </div>
  ),
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
        useQuery: (input: unknown) => {
          portfolioInput(input);
          return {
            data: {
              items: [],
              pagination: {
                page: 1,
                pageSize: 20,
                total: 0,
                totalPages: 1,
              },
              summary: {
                active: 1,
                paused: 2,
                ended: 3,
                notStarted: 4,
                activeWithRecentRecords: 8,
                withoutRecentActivity: 5,
                pendingReviews: 6,
                pendingWeighings: 7,
              },
            },
            isLoading: false,
            isError: false,
            refetch: vi.fn(),
          };
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
  setLocation.mockClear();
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
    expect(portfolioInput).toHaveBeenCalled();
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

    expect(portfolioInput).toHaveBeenLastCalledWith(
      expect.objectContaining({ reportStartDate: "2026-07-10" })
    );
  });
});
