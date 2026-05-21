import crypto from "node:crypto";
import type {
  ConnectHealthIntegrationInput,
  DisconnectHealthIntegrationInput,
  HealthDataType,
  HealthProvider,
  SyncHealthIntegrationInput,
} from "./schemas";

type HealthConnectionStatus = "connected" | "disconnected" | "error" | "pending";
type HealthSetupStatus = "ready" | "missing_credentials" | "native_required" | "dev_only";
type IntegrationKind = "native" | "oauth" | "mock";

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

type StravaTokenState = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  athleteId: number;
  athleteName: string | null;
  scope: string;
};

type StravaTokenResponse = {
  token_type: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope?: string;
  athlete?: {
    id?: number;
    firstname?: string | null;
    lastname?: string | null;
    username?: string | null;
  };
};

type StravaActivity = {
  id: number;
  name: string;
  sport_type?: string;
  type?: string;
  start_date: string;
  moving_time: number;
  calories?: number | null;
};

const connections = new Map<string, HealthConnection>();
const records = new Map<number, HealthRecord[]>();
const stravaTokens = new Map<number, StravaTokenState>();

const STRAVA_AUTHORIZATION_URL = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
const STRAVA_ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities";
const STRAVA_SCOPES = "read,activity:read";

function hasStravaCredentials() {
  return Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET && process.env.STRAVA_REDIRECT_URI);
}

const PROVIDERS: Array<{
  provider: HealthProvider;
  label: string;
  platform: "ios" | "android" | "web";
  available: boolean;
  supportedDataTypes: HealthDataType[];
  integrationKind: IntegrationKind;
  setupStatus: HealthSetupStatus;
  docsUrl?: string;
}> = [
  {
    provider: "apple_health",
    label: "Apple Health",
    platform: "ios",
    available: false,
    supportedDataTypes: ["steps", "weight", "activity", "energy_burned", "sleep"],
    integrationKind: "native",
    setupStatus: "native_required",
  },
  {
    provider: "health_connect",
    label: "Health Connect",
    platform: "android",
    available: false,
    supportedDataTypes: ["steps", "weight", "activity", "energy_burned", "sleep"],
    integrationKind: "native",
    setupStatus: "native_required",
  },
  {
    provider: "google_fit",
    label: "Google Fit",
    platform: "android",
    available: false,
    supportedDataTypes: ["steps", "weight", "activity", "energy_burned", "sleep"],
    integrationKind: "native",
    setupStatus: "native_required",
  },
  {
    provider: "strava",
    label: "Strava",
    platform: "web",
    available: hasStravaCredentials(),
    supportedDataTypes: ["activity", "energy_burned"],
    integrationKind: "oauth",
    setupStatus: hasStravaCredentials() ? "ready" : "missing_credentials",
    docsUrl: "https://developers.strava.com/docs/authentication/",
  },
  {
    provider: "mock",
    label: "Mock de desenvolvimento",
    platform: "web",
    available: true,
    supportedDataTypes: ["steps", "weight", "activity", "energy_burned", "sleep"],
    integrationKind: "mock",
    setupStatus: "dev_only",
  },
];

function connectionKey(userId: number, provider: HealthProvider) {
  return `${userId}:${provider}`;
}

function getProvider(provider: HealthProvider) {
  return PROVIDERS.find(item => item.provider === provider);
}

function buildStravaAuthorizationUrl(userId: number) {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const redirectUri = process.env.STRAVA_REDIRECT_URI;
  if (!clientId || !redirectUri) return null;

  const state = Buffer.from(JSON.stringify({ provider: "strava", userId, createdAt: Date.now() })).toString("base64url");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: STRAVA_SCOPES,
    state,
  });

  return `${STRAVA_AUTHORIZATION_URL}?${params.toString()}`;
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
      activityType: provider === "strava" ? "Corrida" : "Caminhada",
      createdAt: Date.now(),
    },
    {
      id: crypto.randomUUID(),
      userId,
      provider,
      source: provider,
      dataType: "energy_burned",
      measuredAt,
      value: provider === "strava" ? 510 : 260,
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

function parseStravaScopes(scope: string | null | undefined): HealthDataType[] {
  const normalized = (scope ?? "").split(",").map(item => item.trim()).filter(Boolean);
  const nextScopes = new Set<HealthDataType>();

  if (normalized.some(item => item === "activity:read" || item === "activity:read_all")) {
    nextScopes.add("activity");
    nextScopes.add("energy_burned");
  }

  return Array.from(nextScopes);
}

async function fetchStravaToken(payload: Record<string, string>) {
  const response = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Falha ao falar com o OAuth do Strava (${response.status}). ${detail}`);
  }

  return await response.json() as StravaTokenResponse;
}

function toStravaTokenState(token: StravaTokenResponse): StravaTokenState {
  const athleteName = [token.athlete?.firstname, token.athlete?.lastname].filter(Boolean).join(" ").trim() || token.athlete?.username || null;

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: token.expires_at * 1000,
    athleteId: token.athlete?.id ?? 0,
    athleteName,
    scope: token.scope ?? STRAVA_SCOPES,
  };
}

async function ensureValidStravaToken(userId: number) {
  const token = stravaTokens.get(userId);
  if (!token) {
    throw new Error("Conecte o Strava antes de sincronizar atividades.");
  }

  const now = Date.now();
  if (token.expiresAt - 60_000 > now) {
    return token;
  }

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Credenciais do Strava ausentes para renovar o token OAuth.");
  }

  const refreshed = await fetchStravaToken({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: token.refreshToken,
  });
  const nextToken = toStravaTokenState(refreshed);
  stravaTokens.set(userId, nextToken);
  return nextToken;
}

async function fetchStravaActivities(userId: number) {
  const token = await ensureValidStravaToken(userId);
  const response = await fetch(`${STRAVA_ACTIVITIES_URL}?per_page=20`, {
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Falha ao buscar atividades do Strava (${response.status}). ${detail}`);
  }

  return await response.json() as StravaActivity[];
}

function mapStravaActivitiesToRecords(userId: number, activities: StravaActivity[]) {
  return activities.flatMap(activity => {
    const recordsForActivity: HealthRecord[] = [
      {
        id: `${activity.id}:activity`,
        userId,
        provider: "strava",
        source: "strava",
        dataType: "activity",
        measuredAt: activity.start_date,
        value: Math.max(Math.round((activity.moving_time ?? 0) / 60), 0),
        unit: "minutes",
        activityType: activity.sport_type || activity.type || activity.name,
        createdAt: Date.now(),
      },
    ];

    if (typeof activity.calories === "number" && activity.calories > 0) {
      recordsForActivity.push({
        id: `${activity.id}:energy`,
        userId,
        provider: "strava",
        source: "strava",
        dataType: "energy_burned",
        measuredAt: activity.start_date,
        value: Math.round(activity.calories),
        unit: "kcal",
        energyKind: "burned",
        activityType: activity.sport_type || activity.type || activity.name,
        createdAt: Date.now(),
      });
    }

    return recordsForActivity;
  });
}

function upsertConnectionState(userId: number, patch: Partial<HealthConnection> & Pick<HealthConnection, "provider">) {
  const key = connectionKey(userId, patch.provider);
  const current = connections.get(key);
  const next: HealthConnection = {
    userId,
    provider: patch.provider,
    status: patch.status ?? current?.status ?? "pending",
    consentGrantedAt: patch.consentGrantedAt ?? current?.consentGrantedAt ?? null,
    disconnectedAt: patch.disconnectedAt ?? current?.disconnectedAt ?? null,
    scopes: patch.scopes ?? current?.scopes ?? [],
    lastSyncedAt: patch.lastSyncedAt ?? current?.lastSyncedAt ?? null,
    lastError: patch.lastError ?? current?.lastError ?? null,
  };
  connections.set(key, next);
  return next;
}

export class HealthIntegrationService {
  getStatus(userId: number) {
    const userConnections = PROVIDERS.map(provider => {
      const connection = connections.get(connectionKey(userId, provider.provider));
      return {
        ...provider,
        authorizationUrl: provider.provider === "strava" ? buildStravaAuthorizationUrl(userId) : null,
        connection: connection ? publicConnection(connection) : null,
        athleteName: provider.provider === "strava" ? (stravaTokens.get(userId)?.athleteName ?? null) : null,
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
    if (provider.provider === "strava") {
      if (!provider.available) {
        throw new Error("Configure STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET e STRAVA_REDIRECT_URI antes de iniciar o OAuth do Strava.");
      }
      const connection = upsertConnectionState(userId, {
        provider: "strava",
        status: "pending",
        consentGrantedAt: null,
        disconnectedAt: null,
        scopes: input.scopes,
        lastSyncedAt: null,
        lastError: null,
      });
      return publicConnection(connection);
    }
    if (!provider.available) {
      throw new Error(`${provider.label} exige app nativo ${provider.platform}; este projeto atual é web.`);
    }

    const allowedScopes = new Set(provider.supportedDataTypes);
    const scopes = input.scopes.filter(scope => allowedScopes.has(scope));
    const connection = upsertConnectionState(userId, {
      provider: input.provider,
      status: "connected",
      consentGrantedAt: Date.now(),
      disconnectedAt: null,
      scopes,
      lastSyncedAt: null,
      lastError: null,
    });
    return publicConnection(connection);
  }

  async handleStravaCallback(input: { code?: string; state?: string; error?: string; scope?: string }) {
    if (input.error) {
      return {
        ok: false,
        redirectTo: "/health-integrations?provider=strava&status=error",
        message: `OAuth do Strava cancelado ou recusado: ${input.error}`,
      } as const;
    }

    if (!input.code || !input.state) {
      return {
        ok: false,
        redirectTo: "/health-integrations?provider=strava&status=error",
        message: "Callback do Strava recebido sem code ou state válidos.",
      } as const;
    }

    try {
      const decodedState = JSON.parse(Buffer.from(input.state, "base64url").toString("utf8")) as { provider: string; userId: number };
      if (decodedState.provider !== "strava" || !decodedState.userId) {
        throw new Error("State do Strava inválido.");
      }

      const clientId = process.env.STRAVA_CLIENT_ID;
      const clientSecret = process.env.STRAVA_CLIENT_SECRET;
      const redirectUri = process.env.STRAVA_REDIRECT_URI;
      if (!clientId || !clientSecret || !redirectUri) {
        throw new Error("Credenciais do Strava ausentes no backend.");
      }

      const token = await fetchStravaToken({
        client_id: clientId,
        client_secret: clientSecret,
        code: input.code,
        grant_type: "authorization_code",
      });
      stravaTokens.set(decodedState.userId, toStravaTokenState(token));
      const connection = upsertConnectionState(decodedState.userId, {
        provider: "strava",
        status: "connected",
        consentGrantedAt: Date.now(),
        disconnectedAt: null,
        scopes: parseStravaScopes(input.scope ?? token.scope ?? STRAVA_SCOPES),
        lastError: null,
      });

      return {
        ok: true,
        redirectTo: "/health-integrations?provider=strava&status=connected",
        message: `Strava conectado com sucesso para o usuário ${connection.userId}.`,
      } as const;
    } catch (error) {
      return {
        ok: false,
        redirectTo: "/health-integrations?provider=strava&status=error",
        message: error instanceof Error ? error.message : "Falha desconhecida ao concluir o OAuth do Strava.",
      } as const;
    }
  }

  disconnect(userId: number, input: DisconnectHealthIntegrationInput) {
    const existing = connections.get(connectionKey(userId, input.provider));
    const next = upsertConnectionState(userId, {
      provider: input.provider,
      status: "disconnected",
      consentGrantedAt: existing?.consentGrantedAt ?? null,
      disconnectedAt: Date.now(),
      scopes: [],
      lastSyncedAt: existing?.lastSyncedAt ?? null,
      lastError: null,
    });
    records.set(userId, (records.get(userId) ?? []).filter(record => record.provider !== input.provider));
    if (input.provider === "strava") {
      stravaTokens.delete(userId);
    }
    return publicConnection(next);
  }

  async sync(userId: number, input: SyncHealthIntegrationInput) {
    const key = connectionKey(userId, input.provider);
    const connection = connections.get(key);
    if (!connection || connection.status !== "connected" || !connection.consentGrantedAt) {
      throw new Error("Conceda consentimento antes de sincronizar dados de saúde.");
    }

    try {
      const synced = input.provider === "strava"
        ? mapStravaActivitiesToRecords(userId, await fetchStravaActivities(userId))
        : buildMockRecords(userId, input.provider, connection.scopes);
      const existing = (records.get(userId) ?? []).filter(record => record.provider !== input.provider);
      records.set(userId, [...existing, ...synced]);
      const next = upsertConnectionState(userId, {
        provider: input.provider,
        status: "connected",
        lastSyncedAt: Date.now(),
        lastError: null,
      });
      return {
        connection: publicConnection(next),
        records: synced.map(({ userId: _userId, ...record }) => record),
      };
    } catch (error) {
      const next = upsertConnectionState(userId, {
        provider: input.provider,
        status: "error",
        lastError: error instanceof Error ? error.message : "Falha desconhecida na sincronização.",
      });
      connections.set(key, next);
      throw error;
    }
  }
}

export const healthIntegrationService = new HealthIntegrationService();
