// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listOptions = vi.fn();
let enabledResources: string[] = [];

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
              data: [],
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
    expect(
      screen.getByText(/Esta capacidade não está incluída/)
    ).toBeTruthy();
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
});
