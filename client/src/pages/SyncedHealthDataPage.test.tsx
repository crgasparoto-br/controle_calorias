/** @vitest-environment jsdom */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const syncedRecordsUseQueryMock = vi.fn();
let lastSyncedRecordsInput: Record<string, unknown> | null = null;
let syncedRecordsState: {
  data?: unknown;
  isLoading?: boolean;
  error?: Error | null;
  isFetching?: boolean;
} = {};

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    nutrition: {
      healthIntegrations: {
        syncedRecords: {
          useQuery: (input: Record<string, unknown>) => syncedRecordsUseQueryMock(input),
        },
      },
    },
  },
}));

const syncedData = {
  items: [
    {
      id: "run-1:activity",
      source: "strava",
      dataType: "activity",
      measuredAt: "2026-06-03T10:00:00Z",
      value: 35,
      unit: "minutes",
      activityType: "Corrida",
      metadata: {
        name: "Corrida matinal",
        sportType: "Run",
        distanceMeters: 7200,
        estimatedCalories: false,
      },
    },
  ],
  total: 1,
  limit: 20,
  offset: 0,
  nextOffset: null,
  sources: ["strava", "mock"],
  dataTypes: ["activity", "energy_burned"],
  totals: {
    steps: 0,
    activityMinutes: 35,
    energyBurnedCalories: 420,
    sleepMinutes: 0,
  },
};

describe("SyncedHealthDataPage", () => {
  beforeEach(() => {
    lastSyncedRecordsInput = null;
    syncedRecordsState = { data: syncedData, isLoading: false, error: null, isFetching: false };
    syncedRecordsUseQueryMock.mockImplementation((input: Record<string, unknown>) => {
      lastSyncedRecordsInput = input;
      return syncedRecordsState;
    });
  });

  it("renderiza dados, aplica filtros de origem, tipo, período e busca", async () => {
    const { default: SyncedHealthDataPage } = await import("./SyncedHealthDataPage");
    const user = userEvent.setup();

    render(React.createElement(SyncedHealthDataPage));

    expect(screen.getByText("Dados sincronizados")).toBeTruthy();
    expect(screen.getByText("Corrida matinal")).toBeTruthy();
    expect(screen.getByText("Gasto externo")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Atividade" }));
    await waitFor(() => expect(lastSyncedRecordsInput).toMatchObject({ dataType: "activity", offset: 0 }));

    await user.click(screen.getByRole("button", { name: "strava" }));
    await waitFor(() => expect(lastSyncedRecordsInput).toMatchObject({ provider: "strava", dataType: "activity" }));

    await user.type(screen.getByPlaceholderText("Buscar por atividade, origem ou tipo"), "matinal");
    await waitFor(() => expect(lastSyncedRecordsInput).toMatchObject({ q: "matinal" }));

    await user.type(screen.getByLabelText("Data inicial"), "2026-06-01");
    await user.type(screen.getByLabelText("Data final"), "2026-06-04");
    await waitFor(() => {
      expect(lastSyncedRecordsInput).toMatchObject({
        from: "2026-06-01T00:00:00.000Z",
        to: "2026-06-04T23:59:59.999Z",
      });
    });
  });

  it("abre os detalhes de uma atividade sincronizada", async () => {
    const { default: SyncedHealthDataPage } = await import("./SyncedHealthDataPage");
    const user = userEvent.setup();

    render(React.createElement(SyncedHealthDataPage));

    await user.click(screen.getByRole("button", { name: /Corrida matinal/i }));

    expect(screen.getByText("Detalhes do provider")).toBeTruthy();
    expect(screen.getByText("Distance Meters")).toBeTruthy();
    expect(screen.getByText("7.200")).toBeTruthy();
    expect(screen.getByText("Estimated Calories")).toBeTruthy();
    expect(screen.getByText("Não")).toBeTruthy();
  });

  it("renderiza estados de loading e vazio", async () => {
    const { default: SyncedHealthDataPage } = await import("./SyncedHealthDataPage");
    const { rerender } = render(React.createElement(SyncedHealthDataPage));

    syncedRecordsState = { isLoading: true, data: undefined, error: null, isFetching: false };
    rerender(React.createElement(SyncedHealthDataPage));
    expect(screen.getByText("Carregando dados sincronizados")).toBeTruthy();

    syncedRecordsState = {
      isLoading: false,
      error: null,
      isFetching: false,
      data: { ...syncedData, items: [], total: 0, nextOffset: null },
    };
    rerender(React.createElement(SyncedHealthDataPage));
    expect(screen.getByText("Nenhum registro encontrado")).toBeTruthy();
  });
});
