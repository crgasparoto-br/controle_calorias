// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const selectPatient = vi.fn();
const clearPatient = vi.fn();
const reportsExperience = vi.fn(({ subjectUserId }: { subjectUserId: number }) => <div>Relatório canônico {subjectUserId}</div>);

vi.mock("@/components/ProfessionalLayout", () => ({
  useProfessionalWorkspace: () => ({ selectedPatient: null, selectPatient, clearPatient }),
}));
vi.mock("@/components/ProfessionalOperationalAlertsPanel", () => ({ default: () => <div>Pendências objetivas</div> }));
vi.mock("@/features/reports/ReportsExperience", () => ({ default: reportsExperience }));
vi.mock("@/lib/trpc", () => ({ trpc: { nutrition: { professionals: { portfolio: { useQuery: () => ({
  data: {
    items: [{ authorizationId: "a-1", patientUserId: 41, patientName: "Ana", patientEmail: "ana@example.com" }],
    pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    summary: { active: 1, paused: 2, ended: 3, notStarted: 4, activeWithRecentRecords: 8, withoutRecentActivity: 5, pendingReviews: 6, pendingWeighings: 7 },
  },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}) } } } } }));

afterEach(() => { cleanup(); selectPatient.mockClear(); clearPatient.mockClear(); reportsExperience.mockClear(); });

describe("ProfessionalReportsWorkspace", () => {
  it("mostra agregados sem carregar bundle individual antes da seleção", async () => {
    const { default: ProfessionalReportsWorkspace } = await import("./ProfessionalReportsWorkspace");
    render(<ProfessionalReportsWorkspace />);
    expect(screen.getByRole("heading", { name: "Relatórios profissionais" })).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("Pendências objetivas")).toBeTruthy();
    expect(screen.getByText("Selecione uma pessoa autorizada para carregar o relatório individual.")).toBeTruthy();
    expect(reportsExperience).not.toHaveBeenCalled();
  });

  it("seleciona exclusivamente o paciente autorizado da página atual", async () => {
    const { default: ProfessionalReportsWorkspace } = await import("./ProfessionalReportsWorkspace");
    render(<ProfessionalReportsWorkspace />);
    fireEvent.change(screen.getByLabelText("Pessoa acompanhada"), { target: { value: "41" } });
    expect(selectPatient).toHaveBeenCalledWith({ patientId: 41, displayName: "Ana" });
  });
});
