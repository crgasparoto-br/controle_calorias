// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listOptions = vi.fn();
let enabledResources: string[] = [];
let alertData: unknown[] = [];

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    professionalRecord: {
      settings: {
        entitlements: {
          useQuery: () => ({
            data: { allowed: true, enabledResources },
            isLoading: false,
            isError: false,
            refetch: vi.fn(),
          }),
        },
      },
      operationalAlerts: {
        list: {
          useQuery: (_input: unknown, options: unknown) => {
            listOptions(options);
            return {
              data: alertData,
              isLoading: false,
              isError: false,
              refetch: vi.fn(),
            };
          },
        },
        close: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
        evaluate: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
      },
    },
  },
}));

beforeEach(() => {
  enabledResources = ["professional_record"];
  alertData = [];
  listOptions.mockClear();
});

afterEach(cleanup);

describe("ProfessionalOperationalAlertsPanel entitlement", () => {
  it("does not request alerts when the optional resource is unavailable", async () => {
    const { default: ProfessionalOperationalAlertsPanel } = await import(
      "./ProfessionalOperationalAlertsPanel"
    );
    render(<ProfessionalOperationalAlertsPanel patientId={41} />);

    expect(screen.getByText("Pendências operacionais")).toBeTruthy();
    expect(screen.getByText(/Esta capacidade não está incluída/)).toBeTruthy();
    expect(listOptions).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false })
    );
    expect(
      screen.queryByText("Não foi possível carregar as pendências.")
    ).toBeNull();
  });

  it("loads alerts only when the optional resource is enabled", async () => {
    enabledResources = [
      "professional_record",
      "professional_operational_alerts",
    ];
    const { default: ProfessionalOperationalAlertsPanel } = await import(
      "./ProfessionalOperationalAlertsPanel"
    );
    render(<ProfessionalOperationalAlertsPanel patientId={41} />);

    expect(
      screen.getByText("Nenhuma pendência operacional aberta.")
    ).toBeTruthy();
    expect(listOptions).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true })
    );
  });

  it("uses product labels without exposing severity codes or origin identifiers", async () => {
    enabledResources = [
      "professional_record",
      "professional_operational_alerts",
    ];
    alertData = [
      {
        id: 9,
        patientUserId: 41,
        patientName: "Ana",
        type: "record_requires_review",
        reason: "Confira o registro antes do próximo retorno.",
        period: { start: null, end: null },
        origin: { type: "meals", id: "meal-visual-1" },
        suggestedAction: "Revisar o registro com o paciente.",
        severity: "attention",
      },
    ];
    const { default: ProfessionalOperationalAlertsPanel } = await import(
      "./ProfessionalOperationalAlertsPanel"
    );
    render(<ProfessionalOperationalAlertsPanel patientId={41} />);

    expect(screen.getByText("Atenção")).toBeTruthy();
    expect(screen.getByText("Registros alimentares")).toBeTruthy();
    expect(screen.queryByText("attention")).toBeNull();
    expect(screen.queryByText(/meal-visual-1/)).toBeNull();
  });

  it("uses safe fallbacks for unknown alert and origin values", async () => {
    enabledResources = [
      "professional_record",
      "professional_operational_alerts",
    ];
    alertData = [
      {
        id: 10,
        patientUserId: 41,
        patientName: "Ana",
        type: "internal_future_alert",
        reason: "Revise esta pendência.",
        period: { start: null, end: null },
        origin: { type: "provider_internal", id: "origin-10" },
        suggestedAction: "Revisar o acompanhamento.",
        severity: "info",
      },
    ];
    const { default: ProfessionalOperationalAlertsPanel } = await import(
      "./ProfessionalOperationalAlertsPanel"
    );
    render(<ProfessionalOperationalAlertsPanel patientId={41} />);

    expect(screen.getAllByText("Não informado")).toHaveLength(2);
    expect(screen.queryByText("internal_future_alert")).toBeNull();
    expect(screen.queryByText("provider_internal")).toBeNull();
    expect(screen.queryByText("origin-10")).toBeNull();
  });
});
