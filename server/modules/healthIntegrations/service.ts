import crypto from "node:crypto";
import type {
  ConnectHealthIntegrationInput,
  DisconnectHealthIntegrationInput,
  HealthDataType,
  HealthProvider,
  SyncHealthIntegrationInput,
} from "./schemas";

type HealthConnectionStatus = "connected" | "disconnected" | "error";

type HealthConnection = {
  userId: number;
  provider: HealthProvider;
  status: HealthConnectionStatus;
  consentGrantedAt: number | null;
  disconnectedAt: number | null;
  scopes: HealthDataType[];
  lastSyncedAt: number | null;
  lastError: string | null;
};

type HealthRecord = {
  id: string;
  userId: number;
  provider: HealthProvider;
  source: HealthProvider;
  dataType: HealthDataType;
  measuredAt: string;
  value: number;
  unit: "count" | "kg" | "kcal" | "minutes";
  activityType?: string;
  energyKind?: "burned";
  createdAt: number;
};

const connections = new Map<string, HealthConnection>();
const records = new Map<number, HealthRecord[]>();

const PROVIDERS: Array<{
  provider: HealthProvider;
  label: string;
  platform: "ios" | "android" | "web";
  available: boolean;
  supportedDataTypes: HealthDataType[];
}> = [
  {
    provider: "apple_health",
    label: "Apple Health",
    platform: "ios",
    available: false,
    supportedDataTypes: ["steps", "weight", "activity", "energy_burned", "sleep"],
  },
  {
    provider: "health_connect",
    label: "Health Connect",
    platform: "android",
    available: false,
    supportedDataTypes: ["steps", "weight", "activity", "energy_burned", "sleep"],
  },
  {
    provider: "google_fit",
    label: "Google Fit",
    platform: "android",
    available: false,
    supportedDataTypes: ["steps", "weight", "activity", "energy_burned", "sleep"],
  },
  {
    provider: "mock",
    label: "Mock de desenvolvimento",
    platform: "web",
    available: true,
    supportedDataTypes: ["steps", "weight", "activity", "energy_burned", "sleep"],
  },
];

function connectionKey(userId: number, provider: HealthProvider) {
  return `${userId}:${provider}`;
}

function getProvider(provider: HealthProvider) {
  return PROVIDERS.find(item => item.provider === provider);
}

function publicConnection(connection: HealthConnection) {
  return {
    provider: connection.provider,
    status: connection.status,
    consentGrantedAt: connection.consentGrantedAt,
    disconnectedAt: connection.disconnectedAt,
    scopes: connection.scopes,
    lastSyncedAt: connection.lastSyncedAt,
    lastError: connection.lastError,
  };
}

function buildMockRecords(userId: number, provider: HealthProvider, scopes: HealthDataType[]) {
  const now = new Date();
  const measuredAt = now.toISOString();
  const candidates: HealthRecord[] = [
    {
      id: crypto.randomUUID(),
      userId,
      provider,
      source: provider,
      dataType: "steps",
      measuredAt,
      value: 6420,
      unit: "count",
      createdAt: Date.now(),
    },
    {
      id: crypto.randomUUID(),
      userId,
      provider,
      source: provider,
      dataType: "weight",
      measuredAt,
      value: 82.1,
      unit: "kg",
      createdAt: Date.now(),
    },
    {
      id: crypto.randomUUID(),
      userId,
      provider,
      source: provider,
      dataType: "activity",
      measuredAt,
      value: 35,
      unit: "minutes",
      activityType: "Caminhada",
      createdAt: Date.now(),
    },
    {
      id: crypto.randomUUID(),
      userId,
      provider,
      source: provider,
      dataType: "energy_burned",
      measuredAt,
      value: 260,
      unit: "kcal",
      energyKind: "burned",
      createdAt: Date.now(),
    },
    {
      id: crypto.randomUUID(),
      userId,
      provider,
      source: provider,
      dataType: "sleep",
      measuredAt,
      value: 430,
      unit: "minutes",
      createdAt: Date.now(),
    },
  ];

  return candidates.filter(record => scopes.includes(record.dataType));
}

export class HealthIntegrationService {
  getStatus(userId: number) {
    const userConnections = PROVIDERS.map(provider => {
      const connection = connections.get(connectionKey(userId, provider.provider));
      return {
        ...provider,
        connection: connection ? publicConnection(connection) : null,
      };
    });
    const userRecords = records.get(userId) ?? [];

    return {
      platform: "web" as const,
      providers: userConnections,
      recentRecords: userRecords.slice(-20).reverse().map(({ userId: _userId, ...record }) => record),
      totals: {
        steps: userRecords.filter(record => record.dataType === "steps").reduce((sum, record) => sum + record.value, 0),
        energyBurnedCalories: userRecords.filter(record => record.dataType === "energy_burned").reduce((sum, record) => sum + record.value, 0),
        activityMinutes: userRecords.filter(record => record.dataType === "activity").reduce((sum, record) => sum + record.value, 0),
        sleepMinutes: userRecords.filter(record => record.dataType === "sleep").reduce((sum, record) => sum + record.value, 0),
      },
    };
  }

  connect(userId: number, input: ConnectHealthIntegrationInput) {
    const provider = getProvider(input.provider);
    if (!provider) throw new Error("Provedor de saúde desconhecido.");
    if (!provider.available) {
      throw new Error(`${provider.label} exige app nativo ${provider.platform}; este projeto atual é web.`);
    }

    const allowedScopes = new Set(provider.supportedDataTypes);
    const scopes = input.scopes.filter(scope => allowedScopes.has(scope));
    const connection: HealthConnection = {
      userId,
      provider: input.provider,
      status: "connected",
      consentGrantedAt: Date.now(),
      disconnectedAt: null,
      scopes,
      lastSyncedAt: null,
      lastError: null,
    };
    connections.set(connectionKey(userId, input.provider), connection);
    return publicConnection(connection);
  }

  disconnect(userId: number, input: DisconnectHealthIntegrationInput) {
    const existing = connections.get(connectionKey(userId, input.provider));
    const next: HealthConnection = {
      userId,
      provider: input.provider,
      status: "disconnected",
      consentGrantedAt: existing?.consentGrantedAt ?? null,
      disconnectedAt: Date.now(),
      scopes: [],
      lastSyncedAt: existing?.lastSyncedAt ?? null,
      lastError: null,
    };
    connections.set(connectionKey(userId, input.provider), next);
    records.set(userId, (records.get(userId) ?? []).filter(record => record.provider !== input.provider));
    return publicConnection(next);
  }

  sync(userId: number, input: SyncHealthIntegrationInput) {
    const key = connectionKey(userId, input.provider);
    const connection = connections.get(key);
    if (!connection || connection.status !== "connected" || !connection.consentGrantedAt) {
      throw new Error("Conceda consentimento antes de sincronizar dados de saúde.");
    }

    try {
      const synced = buildMockRecords(userId, input.provider, connection.scopes);
      const existing = (records.get(userId) ?? []).filter(record => record.provider !== input.provider);
      records.set(userId, [...existing, ...synced]);
      const next = { ...connection, lastSyncedAt: Date.now(), lastError: null };
      connections.set(key, next);
      return {
        connection: publicConnection(next),
        records: synced.map(({ userId: _userId, ...record }) => record),
      };
    } catch (error) {
      const next = {
        ...connection,
        status: "error" as const,
        lastError: error instanceof Error ? error.message : "Falha desconhecida na sincronização.",
      };
      connections.set(key, next);
      throw error;
    }
  }
}

export const healthIntegrationService = new HealthIntegrationService();
