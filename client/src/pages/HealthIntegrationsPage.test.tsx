import React from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invalidateStatusMock = vi.fn(async () => undefined);
const invalidateExercisesMock = vi.fn(async () => undefined);
const syncMutateMock = vi.fn();
const disconnectMutateMock = vi.fn();

let healthStatusState: {
  data?: unknown;
  isLoading?: boolean;
  error?: Error | null;
} = {};
let syncPending = false;

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      nutrition: {
        healthIntegrations: { status: { invalidate: invalidateStatusMock } },
        exercises: { list: { invalidate: invalidateExercisesMock } },
      },
    }),
    nutrition: {
      healthIntegrations: {
        status: {
          useQuery: () => ({
            data: healthStatusState.data,
            isLoading: Boolean(healthStatusState.isLoading),
            error: healthStatusState.error ?? null,
          }),
        },
        sync: {
          useMutation: () => ({ isPending: syncPending, mutate: syncMutateMock }),
        },
        disconnect: {
          useMutation: () => ({ isPending: false, mutate: disconnectMutateMock }),
        },
      },
    },
  },
}));

function connectedStatus() {
  return {
    providers: [
      {
        provider: "strava",
        label: "Strava",
        available: true,
        platform: "web",
        supportedDataTypes: ["activity", "energy_burned"],
        authorizationUrl: "https://www.strava.com/oauth/authorize",
        athleteName: "Claudinei",
        connection: {
          status: "connected",
          scopes: ["activity"],
          consentGrantedAt: Date.parse("2026-06-01T10:00:00Z"),
          lastSyncedAt: Date.parse("2026-06-02T10:00:00Z"),
          lastError: null,
        },
      },
      {
        provider: "garmin_connect",
        label: "Garmin Connect",
        available: true,
        platform: "web",
        supportedDataTypes: ["activity"],
        connection: null,
      },
      {
        provider: "mock",
        label: "Mock de desenvolvimento",
        available: true,
        platform: "web",
        supportedDataTypes: ["steps"],
        connection: null,
      },
    ],
    recentRecords: [
      { id: "run-1", source: "strava", dataType: "activity", measuredAt: "2026-06-02T10:00:00Z", value: 35, unit: "minutes" },
    ],
  };
}

describe("HealthIntegrationsPage", () => {
  beforeEach(() => {
    healthStatusState = { data: connectedStatus() };
    syncPending = false;
    syncMutateMock.mockClear();
    disconnectMutateMock.mockClear();
    invalidateStatusMock.mockClear();
    invalidateExercisesMock.mockClear();
  });

  it("exibe somente o Strava finalizado e mantém permissões dentro do card", async () => {
    const { default: HealthIntegrationsPage } = await import("./HealthIntegrationsPage");
    const html = renderToString(React.createElement(HealthIntegrationsPage));

    expect(html).toContain("Strava");
    expect(html).toContain("Claudinei");
    expect(html).toContain("Conectado com pendências");
    expect(html).toContain("Permissões da integração");
    expect(html).toContain("Atividade física");
    expect(html).toContain("Gasto energético pendente");
    expect(html).not.toContain("Garmin Connect");
    expect(html).not.toContain("Mock de desenvolvimento");
  });

  it("mostra estado de sincronização e erro do Strava", async () => {
    const baseStatus = connectedStatus();
    const stravaProvider = baseStatus.providers[0];

    syncPending = true;
    healthStatusState = {
      data: {
        ...baseStatus,
        providers: [
          {
            ...stravaProvider,
            connection: {
              status: "error",
              scopes: ["activity"],
              consentGrantedAt: Date.parse("2026-06-01T10:00:00Z"),
              lastSyncedAt: Date.parse("2026-06-02T10:00:00Z"),
              lastError: "Token expirado no Strava",
            },
          },
        ],
      },
    };

    const { default: HealthIntegrationsPage } = await import("./HealthIntegrationsPage");
    const html = renderToString(React.createElement(HealthIntegrationsPage));

    expect(html).toContain("Sincronizando");
    expect(html).toContain("Token expirado no Strava");
  });
});
