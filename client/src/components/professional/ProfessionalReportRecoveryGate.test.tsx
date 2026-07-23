// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const timeZoneRefetch = vi.fn();
const bundleRefetch = vi.fn();
const bundleOptions = vi.fn();
let timeZoneState: Record<string, unknown>;
let bundleState: Record<string, unknown>;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    nutrition: {
      professionals: {
        patientTimeZone: {
          useQuery: () => timeZoneState,
        },
        patientPeriodBundle: {
          useQuery: (_input: unknown, options: unknown) => {
            bundleOptions(options);
            return bundleState;
          },
        },
      },
    },
  },
}));

afterEach(cleanup);

beforeEach(() => {
  timeZoneRefetch.mockReset();
  bundleRefetch.mockReset();
  bundleOptions.mockReset();
  timeZoneState = {
    isSuccess: true,
    isError: false,
    refetch: timeZoneRefetch,
  };
  bundleState = {
    isError: false,
    refetch: bundleRefetch,
  };
});

describe("ProfessionalReportRecoveryGate", () => {
  it("keeps the report protected and retries a timezone failure", async () => {
    timeZoneState = {
      isSuccess: false,
      isError: true,
      refetch: timeZoneRefetch,
    };
    const { default: Gate } = await import("./ProfessionalReportRecoveryGate");

    render(
      <Gate patientId={41} range={{ start: "2026-07-01", end: "2026-07-07" }}>
        <div>dados do relatório</div>
      </Gate>
    );

    expect(
      screen.getByRole("heading", {
        name: "Não foi possível carregar o fuso horário do paciente",
      })
    ).toBeTruthy();
    expect(screen.queryByText("dados do relatório")).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: "Tentar novamente" })
    );
    expect(timeZoneRefetch).toHaveBeenCalledTimes(1);
  });

  it("keeps partial report data hidden and retries the period bundle", async () => {
    bundleState = {
      isError: true,
      refetch: bundleRefetch,
    };
    const { default: Gate } = await import("./ProfessionalReportRecoveryGate");

    render(
      <Gate patientId={41} range={{ start: "2026-07-01", end: "2026-07-07" }}>
        <div>dados do relatório</div>
      </Gate>
    );

    expect(
      screen.getByRole("heading", {
        name: "Não foi possível carregar os relatórios autorizados",
      })
    ).toBeTruthy();
    expect(screen.queryByText("dados do relatório")).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: "Tentar novamente" })
    );
    expect(bundleRefetch).toHaveBeenCalledTimes(1);
  });

  it("leaves ranges above the canonical limit to the report validation", async () => {
    bundleState = {
      isError: true,
      refetch: bundleRefetch,
    };
    const { default: Gate } = await import("./ProfessionalReportRecoveryGate");

    render(
      <Gate patientId={41} range={{ start: "2026-01-01", end: "2026-07-07" }}>
        <div>validação do período</div>
      </Gate>
    );

    expect(screen.getByText("validação do período")).toBeTruthy();
    expect(
      screen.queryByRole("heading", {
        name: "Não foi possível carregar os relatórios autorizados",
      })
    ).toBeNull();
    expect(bundleOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });

  it("renders the report only after both recovery checks are healthy", async () => {
    const { default: Gate } = await import("./ProfessionalReportRecoveryGate");

    render(
      <Gate patientId={41} range={{ start: "2026-07-01", end: "2026-07-07" }}>
        <div>dados do relatório</div>
      </Gate>
    );

    expect(screen.getByText("dados do relatório")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Tentar novamente" })
    ).toBeNull();
    expect(bundleOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true })
    );
  });
});
