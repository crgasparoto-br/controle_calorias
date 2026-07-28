// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const timeZoneRefetch = vi.fn();
const bundleRefetch = vi.fn();
const bundleInput = vi.fn();
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
          useQuery: (input: unknown, options: unknown) => {
            bundleInput(input);
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
  bundleInput.mockReset();
  bundleOptions.mockReset();
  timeZoneState = {
    isSuccess: true,
    isLoading: false,
    isError: false,
    refetch: timeZoneRefetch,
  };
  bundleState = {
    data: { totals: {} },
    isSuccess: true,
    isLoading: false,
    isError: false,
    refetch: bundleRefetch,
  };
});

function children({
  ready,
  feedback,
}: {
  ready: boolean;
  feedback: React.ReactNode;
}) {
  return (
    <div>
      <div>estrutura do relatório</div>
      {ready ? <div>contexto autorizado</div> : feedback}
    </div>
  );
}

describe("ProfessionalReportRecoveryGate", () => {
  it("keeps contextual children hidden while the patient timezone is loading", async () => {
    timeZoneState = {
      isSuccess: false,
      isLoading: true,
      isError: false,
      refetch: timeZoneRefetch,
    };
    const { default: Gate } = await import("./ProfessionalReportRecoveryGate");

    render(
      <Gate patientId={41} range={{ start: "2026-07-01", end: "2026-07-07" }}>
        {children}
      </Gate>
    );

    expect(screen.getByText("estrutura do relatório")).toBeTruthy();
    expect(screen.queryByText("contexto autorizado")).toBeNull();
    expect(screen.getByText("Confirmando o calendário do paciente...")).toBeTruthy();
    expect(bundleOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });

  it("keeps the context protected and retries a timezone failure", async () => {
    timeZoneState = {
      isSuccess: false,
      isLoading: false,
      isError: true,
      refetch: timeZoneRefetch,
    };
    const { default: Gate } = await import("./ProfessionalReportRecoveryGate");

    render(
      <Gate patientId={41} range={{ start: "2026-07-01", end: "2026-07-07" }}>
        {children}
      </Gate>
    );

    expect(
      screen.getByRole("heading", {
        name: "Não foi possível carregar o fuso horário do paciente",
      })
    ).toBeTruthy();
    expect(screen.queryByText("contexto autorizado")).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: "Tentar novamente" })
    );
    expect(timeZoneRefetch).toHaveBeenCalledTimes(1);
  });

  it("does not release alerts or AI while the period bundle is loading", async () => {
    bundleState = {
      isSuccess: false,
      isLoading: true,
      isError: false,
      refetch: bundleRefetch,
    };
    const { default: Gate } = await import("./ProfessionalReportRecoveryGate");

    render(
      <Gate patientId={41} range={{ start: "2026-07-01", end: "2026-07-07" }}>
        {children}
      </Gate>
    );

    expect(screen.getByText("estrutura do relatório")).toBeTruthy();
    expect(screen.queryByText("contexto autorizado")).toBeNull();
    expect(screen.getByText("Carregando o período autorizado...")).toBeTruthy();
  });

  it("keeps partial contextual data hidden and retries the period bundle", async () => {
    bundleState = {
      isSuccess: false,
      isLoading: false,
      isError: true,
      refetch: bundleRefetch,
    };
    const { default: Gate } = await import("./ProfessionalReportRecoveryGate");

    render(
      <Gate patientId={41} range={{ start: "2026-07-01", end: "2026-07-07" }}>
        {children}
      </Gate>
    );

    expect(
      screen.getByRole("heading", {
        name: "Não foi possível carregar os relatórios autorizados",
      })
    ).toBeTruthy();
    expect(screen.queryByText("contexto autorizado")).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: "Tentar novamente" })
    );
    expect(bundleRefetch).toHaveBeenCalledTimes(1);
  });

  it("suspends contextual content immediately during a period transition", async () => {
    const { default: Gate } = await import("./ProfessionalReportRecoveryGate");

    render(
      <Gate
        patientId={41}
        range={{ start: "2026-07-01", end: "2026-07-07" }}
        suspended
      >
        {children}
      </Gate>
    );

    expect(screen.queryByText("contexto autorizado")).toBeNull();
    expect(screen.getByText("Atualizando o período do relatório...")).toBeTruthy();
    expect(bundleOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });

  it("keeps ranges above the canonical limit unavailable to contextual consumers", async () => {
    const { default: Gate } = await import("./ProfessionalReportRecoveryGate");

    render(
      <Gate patientId={41} range={{ start: "2026-01-01", end: "2026-07-07" }}>
        {children}
      </Gate>
    );

    expect(screen.queryByText("contexto autorizado")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Período fora do limite" })
    ).toBeTruthy();
    expect(bundleOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });

  it("renders contextual consumers only after timezone and bundle are healthy", async () => {
    const { default: Gate } = await import("./ProfessionalReportRecoveryGate");

    render(
      <Gate patientId={41} range={{ start: "2026-07-01", end: "2026-07-07" }}>
        {children}
      </Gate>
    );

    expect(screen.getByText("contexto autorizado")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Tentar novamente" })
    ).toBeNull();
    expect(bundleInput).toHaveBeenLastCalledWith({
      patientId: 41,
      startDate: "2026-07-01",
      endDate: "2026-07-07",
    });
    expect(bundleOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true })
    );
  });
});
