// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reportsExperience = vi.fn(
  ({ subjectUserId }: { subjectUserId: number }) => (
    <div>Relatório canônico {subjectUserId}</div>
  )
);
const portfolioInput = vi.fn();
let selectedPatient: { patientId: number; displayName: string } | null = null;

vi.mock("@/components/ProfessionalLayout", () => ({
  useProfessionalWorkspace: () => ({ selectedPatient, clearPatient: vi.fn() }),
}));
vi.mock("@/components/professional/ProfessionalAiAssistant", () => ({
  default: ({ patient }: { patient: { displayName: string } }) => (
    <div>IA contextual de {patient.displayName}</div>
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
vi.mock("wouter", () => ({ useLocation: () => ["/professional/reports", vi.fn()] }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    nutrition: {
      professionals: {
        portfolio: {
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
  },
}));

afterEach(cleanup);

beforeEach(() => {
  selectedPatient = null;
  reportsExperience.mockClear();
  portfolioInput.mockClear();
});

describe("ProfessionalReportsWorkspace", () => {
  it("shows aggregate indicators without loading an individual bundle", async () => {
    const { default: ProfessionalReportsWorkspace } = await import(
      "./ProfessionalReportsWorkspace"
    );
    render(<ProfessionalReportsWorkspace />);

    expect(
      screen.getByRole("heading", { name: "Relatórios da carteira" })
    ).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("Pendências da carteira")).toBeTruthy();
    expect(reportsExperience).not.toHaveBeenCalled();
  });

  it("uses only the patient provided by the URL-backed workspace context", async () => {
    selectedPatient = { patientId: 41, displayName: "Ana" };
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
    selectedPatient = { patientId: 41, displayName: "Ana" };
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
