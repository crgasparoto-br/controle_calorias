/** @vitest-environment jsdom */

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/dateTime", () => ({
  toDateInputValue: () => "2026-06-09",
  zonedDateTimeLocalToIso: (value: string) => `${value}:00.000Z`,
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
      activityType: "Run",
      metadata: {
        externalId: "run-1",
        name: "Morning Run",
        sportType: "Run",
        workoutType: "Workout",
        perceivedEffort: "moderate",
        sourceStatus: "synced",
        distanceMeters: 7200,
        movingTimeSeconds: 2100,
        averageSpeedMetersPerSecond: 3.42,
        calories: 420,
        caloriesSource: "strava",
        gearId: "shoe-123",
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

const estimatedSyncedData = {
  ...syncedData,
  items: [
    {
      id: "walk-1:activity",
      source: "strava",
      dataType: "activity",
      measuredAt: "2026-06-09T12:00:00Z",
      value: 15,
      unit: "minutes",
      activityType: "Walk",
      metadata: {
        externalId: "walk-1",
        name: "Walk without official calories",
        sportType: "Walk",
        movingTimeSeconds: 900,
        calories: 60,
        caloriesSource: "estimated_activity",
        estimatedCalories: true,
      },
    },
  ],
  totals: {
    steps: 0,
    activityMinutes: 15,
    energyBurnedCalories: 60,
    sleepMinutes: 0,
  },
};

describe("SyncedHealthDataPage", () => {
  afterEach(cleanup);

  beforeEach(() => {
    lastSyncedRecordsInput = null;
    syncedRecordsState = { data: syncedData, isLoading: false, error: null, isFetching: false };
    syncedRecordsUseQueryMock.mockImplementation((input: Record<string, unknown>) => {
      lastSyncedRecordsInput = input;
      return syncedRecordsState;
    });
  });

  it("renderiza dados, aplica filtros de origem, tipo, dia selecionado e busca", async () => {
    const { default: SyncedHealthDataPage } = await import("./SyncedHealthDataPage");
    const user = userEvent.setup();

    render(React.createElement(SyncedHealthDataPage));

    expect(screen.getAllByText("Dados sincronizados").length).toBeGreaterThan(0);
    expect(screen.getByText("Dia selecionado")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Corrida/i })).toBeTruthy();
    expect(screen.queryByText("Morning Run")).toBeNull();
    expect(screen.getByText("Calorias sincronizadas")).toBeTruthy();
    expect(screen.getAllByText("420 kcal").length).toBeGreaterThan(0);
    expect(lastSyncedRecordsInput).toMatchObject({
      from: "2026-06-09T00:00:00.000Z",
      to: "2026-06-09T23:59:59.999Z",
    });

    await user.click(screen.getByRole("button", { name: "Atividade" }));
    await waitFor(() => expect(lastSyncedRecordsInput).toMatchObject({ dataType: "activity", offset: 0 }));

    await user.click(screen.getByRole("button", { name: "Strava" }));
    await waitFor(() => expect(lastSyncedRecordsInput).toMatchObject({ provider: "strava", dataType: "activity" }));

    await user.type(screen.getByPlaceholderText("Buscar por atividade, origem ou tipo"), "corrida");
    await waitFor(() => expect(lastSyncedRecordsInput).toMatchObject({ q: "corrida" }));

    await user.click(screen.getByLabelText("Dia anterior"));
    await waitFor(() => {
      expect(lastSyncedRecordsInput).toMatchObject({
        from: "2026-06-08T00:00:00.000Z",
        to: "2026-06-08T23:59:59.999Z",
      });
    });
  });

  it("abre os detalhes de uma atividade sincronizada sem campos técnicos nem textos crus em inglês", async () => {
    const { default: SyncedHealthDataPage } = await import("./SyncedHealthDataPage");
    const user = userEvent.setup();

    render(React.createElement(SyncedHealthDataPage));

    await user.click(screen.getByRole("button", { name: /Corrida/i }));

    expect(screen.getByText("Detalhes da atividade")).toBeTruthy();
    expect(screen.getByText("Distância")).toBeTruthy();
    expect(screen.getByText("7,20 km")).toBeTruthy();
    expect(screen.getAllByText("Calorias").length).toBeGreaterThan(0);
    expect(screen.getByText("Fonte das calorias")).toBeTruthy();
    expect(screen.getAllByText("Strava").length).toBeGreaterThan(0);
    expect(screen.getByText("Tipo de treino")).toBeTruthy();
    expect(screen.getAllByText("Treino").length).toBeGreaterThan(0);
    expect(screen.getByText("Esforço percebido")).toBeTruthy();
    expect(screen.getByText("Moderado")).toBeTruthy();
    expect(screen.getByText("Status da sincronização")).toBeTruthy();
    expect(screen.getByText("Sincronizado")).toBeTruthy();
    expect(screen.queryByText("External Id")).toBeNull();
    expect(screen.queryByText("Gear Id")).toBeNull();
    expect(screen.queryByText("ID")).toBeNull();
    expect(screen.queryByText("Morning Run")).toBeNull();
    expect(screen.queryByText("Workout")).toBeNull();
    expect(screen.queryByText("moderate")).toBeNull();
    expect(screen.queryByText("synced")).toBeNull();
  });

  it("explica quando as calorias foram estimadas porque o Strava não retornou valor oficial", async () => {
    syncedRecordsState = { data: estimatedSyncedData, isLoading: false, error: null, isFetching: false };
    const { default: SyncedHealthDataPage } = await import("./SyncedHealthDataPage");
    const user = userEvent.setup();

    render(React.createElement(SyncedHealthDataPage));

    await user.click(screen.getByRole("button", { name: /Caminhada/i }));

    expect(screen.getByText("Estimativa local; Strava não retornou calorias oficiais")).toBeTruthy();
    expect(screen.queryByText("Walk without official calories")).toBeNull();
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
