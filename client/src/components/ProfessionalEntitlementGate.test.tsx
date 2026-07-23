// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setLocation = vi.fn();
let location = "/professional/patients/41/reports";
let enabledResources: string[] = ["professional_reports"];

vi.mock("wouter", () => ({
  useLocation: () => [location, setLocation],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    professionalRecord: {
      settings: {
        entitlements: {
          useQuery: () => ({
            data: {
              allowed: true,
              enabledResources,
              planName: "Plano profissional",
            },
            isLoading: false,
            isError: false,
            refetch: vi.fn(),
          }),
        },
      },
    },
  },
}));

beforeEach(() => {
  location = "/professional/patients/41/reports";
  enabledResources = ["professional_reports"];
  setLocation.mockClear();
});

afterEach(cleanup);

describe("ProfessionalEntitlementGate patient route revocation", () => {
  it("redirects a patient route to the portfolio when its exact entitlement is revoked", async () => {
    const { default: ProfessionalEntitlementGate } = await import(
      "./ProfessionalEntitlementGate"
    );
    const view = render(
      <ProfessionalEntitlementGate resource="professional_reports">
        <div>Relatório autorizado</div>
      </ProfessionalEntitlementGate>
    );

    expect(screen.getByText("Relatório autorizado")).toBeTruthy();

    enabledResources = [];
    view.rerender(
      <ProfessionalEntitlementGate resource="professional_reports">
        <div>Relatório autorizado</div>
      </ProfessionalEntitlementGate>
    );

    expect(screen.queryByText("Relatório autorizado")).toBeNull();
    expect(screen.getByText("Removendo o contexto indisponível...")).toBeTruthy();
    await waitFor(() =>
      expect(setLocation).toHaveBeenCalledWith(
        "/professional/patients?notice=patient-access-unavailable"
      )
    );
  });

  it("keeps aggregate denials on the resource access screen", async () => {
    location = "/professional/reports";
    enabledResources = [];
    const { default: ProfessionalEntitlementGate } = await import(
      "./ProfessionalEntitlementGate"
    );
    render(
      <ProfessionalEntitlementGate resource="professional_reports">
        <div>Relatório autorizado</div>
      </ProfessionalEntitlementGate>
    );

    expect(
      screen.getByRole("heading", { name: "Recurso profissional indisponível" })
    ).toBeTruthy();
    expect(setLocation).not.toHaveBeenCalled();
  });
});
