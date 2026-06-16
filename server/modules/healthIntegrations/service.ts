import crypto from "node:crypto";
import { fetchStravaActivities } from "./strava/activities";
import { getStravaActivityType, getStravaCaloriesBurned, getStravaActivityMetadata } from "./strava/activityUtils";
import { DEFAULT_STRAVA_AUTO_SYNC_INTERVAL_MINUTES } from "./strava/constants";
import { upsertStravaActivitiesAsExercises } from "./strava/exercises";
import { buildStravaAuthorizationUrl, parseStravaScopes, toStravaTokenState, fetchStravaToken } from "./strava/oauth";
import { StravaRateLimitError, setStravaUserCooldown } from "./strava/rateLimit";
import { deleteStoredStravaTokenState, listStoredStravaUserIds, loadStoredStravaTokenState, persistStravaTokenState } from "./strava/tokenStorage";
import type {
  HealthConnection,
  HealthRecord,
  HealthSetupStatus,
  IntegrationKind,
  StravaActivity,
  StravaAutoSyncSummary,
  StravaExerciseImportSummary,
} from "./strava/types";
import type {
  ConnectHealthIntegrationInput,
  DisconnectHealthIntegrationInput,
  HealthDataType,
  HealthProvider,
  SyncHealthIntegrationInput,
} from "./schemas";

const connections = new Map<string, HealthConnection>();
const records = new Map<number, HealthRecord[]>();

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
    provider: "garmin_connect",
    label: "Garmin Connect",
    platform: "web",
    available: false,
    supportedDataTypes: ["activity", "energy_burned"],
    integrationKind: "oauth",
    setupStatus: "missing_credentials",
    docsUrl: "https://developer.garmin.com/health-api/overview/",
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

function hasStravaCredentials() {
  return Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET && process.env.STRAVA_REDIRECT_URI);
}

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

function publicStravaConnection(userId: number, token: { connectedAt: number; scope: string; lastSyncedAt: number | null }) {
  const current = connections.get(connectionKey(userId, "strava"));
  if (current) return publicConnection(current);

  return publicConnection({
    userId,
    provider: "strava",
    status: "connected",
    consentGrantedAt: token.connectedAt,
    disconnectedAt: null,
    scopes: parseStravaScopes(token.scope),
    lastSyncedAt: token.lastSyncedAt,
    lastError: null,
  });
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

function mapStravaActivitiesToRecords(userId: number, activities: StravaActivity[]) {
  return activities.flatMap(activity => {
    const caloriesBurned = getStravaCaloriesBurned(activity);
    const metadata = getStravaActivityMetadata(activity);
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
        activityType: getStravaActivityType(activity),
        metadata,
        createdAt: Date.now(),
      },
    ];

    if (caloriesBurned > 0) {
      recordsForActivity.push({
        id: `${activity.id}:energy`,
        userId,
        provider: "strava",
        source: "strava",
        dataType: "energy_burned",
        measuredAt: activity.start_date,
        value: caloriesBurned,
        unit: "kcal",
        energyKind: "burned",
        activityType: getStravaActivityType(activity),
        metadata,
        createdAt: Date.now(),
      });
    }

    return recordsForActivity;
  });
}

function formatStravaImportSummary(summary: StravaExerciseImportSummary) {
  const imported = summary.created + summary.updated;
  if (imported <= 0) {
    return "Nenhum exercício novo foi registrado automaticamente.";
  }

  return `${imported} exercício(s) registrado(s) a partir das atividades recentes.`;
}

function mergeStravaImportSummary(target: StravaExerciseImportSummary, source: StravaExerciseImportSummary | null | undefined) {
  if (!source) return target;

  target.created += source.created;
  target.updated += source.updated;
  target.skipped += source.skipped;
  return target;
}

function getStravaAutoSyncIntervalMs() {
  if (["1", "true", "yes", "on"].includes(process.env.STRAVA_AUTO_SYNC_DISABLED?.toLowerCase() ?? "")) {
    return null;
  }

  const configuredMinutes = Number(process.env.STRAVA_AUTO_SYNC_INTERVAL_MINUTES ?? DEFAULT_STRAVA_AUTO_SYNC_INTERVAL_MINUTES);
  if (!Number.isFinite(configuredMinutes) || configuredMinutes <= 0) {
    return null;
  }

  return Math.max(configuredMinutes, 5) * 60_000;
}

function runTimerWithoutKeepingProcessAlive(timer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>) {
  const maybeUnref = (timer as { unref?: () => void }).unref;
  if (typeof maybeUnref === "function") {
    maybeUnref.call(timer);
  }
}

export class HealthIntegrationService {
  async getStatus(userId: number) {
    const storedStravaToken = await loadStoredStravaTokenState(userId);
    const userConnections = PROVIDERS.map(provider => {
      const connection = connections.get(connectionKey(userId, provider.provider));
      const stravaConnection = provider.provider === "strava" && storedStravaToken
        ? publicStravaConnection(userId, storedStravaToken)
        : null;
      return {
        ...provider,
        authorizationUrl: provider.provider === "strava" ? buildStravaAuthorizationUrl(userId) : null,
        connection: connection ? publicConnection(connection) : stravaConnection,
        athleteName: provider.provider === "strava" ? (storedStravaToken?.athleteName ?? null) : null,
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
    if (provider.integrationKind === "oauth" && provider.provider !== "strava") {
      throw new Error(`${provider.label} ainda precisa de implementação OAuth no backend antes de conectar exercícios automaticamente.`);
    }
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

      const existingToken = await loadStoredStravaTokenState(decodedState.userId);
      const token = await fetchStravaToken({
        client_id: clientId,
        client_secret: clientSecret,
        code: input.code,
        grant_type: "authorization_code",
      });
      const tokenState = toStravaTokenState(token, existingToken);
      await persistStravaTokenState(decodedState.userId, tokenState);
      const connection = upsertConnectionState(decodedState.userId, {
        provider: "strava",
        status: "connected",
        consentGrantedAt: tokenState.connectedAt,
        disconnectedAt: null,
        scopes: parseStravaScopes(input.scope ?? token.scope),
        lastSyncedAt: tokenState.lastSyncedAt,
        lastError: null,
      });

      try {
        const syncResult = await this.sync(decodedState.userId, { provider: "strava" });
        return {
          ok: true,
          redirectTo: "/health-integrations?provider=strava&status=connected",
          message: `Strava conectado com sucesso para o usuário ${connection.userId}. ${formatStravaImportSummary(syncResult.importedExercises ?? { created: 0, updated: 0, skipped: 0 })}`,
        } as const;
      } catch (syncError) {
        upsertConnectionState(decodedState.userId, {
          provider: "strava",
          status: "connected",
          lastError: syncError instanceof Error ? syncError.message : "Falha desconhecida na sincronização inicial do Strava.",
        });
        return {
          ok: true,
          redirectTo: "/health-integrations?provider=strava&status=connected",
          message: `Strava conectado com sucesso para o usuário ${connection.userId}. A rotina automática tentará importar os exercícios recentes novamente em segundo plano.`,
        } as const;
      }
    } catch (error) {
      return {
        ok: false,
        redirectTo: "/health-integrations?provider=strava&status=error",
        message: error instanceof Error ? error.message : "Falha desconhecida ao concluir o OAuth do Strava.",
      } as const;
    }
  }

  async disconnect(userId: number, input: DisconnectHealthIntegrationInput) {
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
      await deleteStoredStravaTokenState(userId);
    }
    return publicConnection(next);
  }

  async sync(userId: number, input: SyncHealthIntegrationInput) {
    const key = connectionKey(userId, input.provider);
    const storedStravaToken = input.provider === "strava" ? await loadStoredStravaTokenState(userId) : null;
    const connection = connections.get(key);
    if ((!connection || connection.status !== "connected" || !connection.consentGrantedAt) && !storedStravaToken) {
      throw new Error("Conceda consentimento antes de sincronizar dados de saúde.");
    }

    try {
      const stravaActivities = input.provider === "strava" ? await fetchStravaActivities(userId, storedStravaToken?.lastSyncedAt ?? null) : null;
      const importedExercises = stravaActivities
        ? await upsertStravaActivitiesAsExercises(userId, stravaActivities)
        : null;
      const synced = stravaActivities
        ? mapStravaActivitiesToRecords(userId, stravaActivities)
        : buildMockRecords(userId, input.provider, connection?.scopes ?? []);
      const existing = (records.get(userId) ?? []).filter(record => record.provider !== input.provider);
      records.set(userId, [...existing, ...synced]);
      const lastSyncedAt = Date.now();
      const next = upsertConnectionState(userId, {
        provider: input.provider,
        status: "connected",
        consentGrantedAt: connection?.consentGrantedAt ?? storedStravaToken?.connectedAt ?? Date.now(),
        scopes: connection?.scopes ?? (storedStravaToken ? parseStravaScopes(storedStravaToken.scope) : []),
        lastSyncedAt,
        lastError: null,
      });
      if (input.provider === "strava") {
        const currentToken = await loadStoredStravaTokenState(userId);
        if (currentToken) {
          await persistStravaTokenState(userId, { ...currentToken, lastSyncedAt });
        }
      }
      return {
        connection: publicConnection(next),
        records: synced.map(({ userId: _userId, ...record }) => record),
        importedExercises,
      };
    } catch (error) {
      if (error instanceof StravaRateLimitError) {
        setStravaUserCooldown(userId, error.retryAfterMs);
      }
      const next = upsertConnectionState(userId, {
        provider: input.provider,
        status: "error",
        consentGrantedAt: connection?.consentGrantedAt ?? storedStravaToken?.connectedAt ?? null,
        scopes: connection?.scopes ?? (storedStravaToken ? parseStravaScopes(storedStravaToken.scope) : []),
        lastError: error instanceof Error ? error.message : "Falha desconhecida na sincronização.",
      });
      connections.set(key, next);
      throw error;
    }
  }

  async syncConnectedStravaUsers(): Promise<StravaAutoSyncSummary> {
    const userIds = await listStoredStravaUserIds();
    const summary: StravaAutoSyncSummary = {
      attempted: userIds.length,
      succeeded: 0,
      failed: 0,
      importedExercises: { created: 0, updated: 0, skipped: 0 },
    };

    for (const userId of userIds) {
      try {
        const result = await this.sync(userId, { provider: "strava" });
        mergeStravaImportSummary(summary.importedExercises, result.importedExercises);
        summary.succeeded += 1;
      } catch (error) {
        summary.failed += 1;
        console.warn("[HealthIntegrations] Automatic Strava sync failed for connected user:", {
          userId,
          message: error instanceof Error ? error.message : "Falha desconhecida.",
        });
      }
    }

    return summary;
  }
}

export const healthIntegrationService = new HealthIntegrationService();

export function startStravaAutoSyncScheduler() {
  if (!hasStravaCredentials()) {
    console.warn("[HealthIntegrations] Automatic Strava sync disabled because OAuth credentials are missing.");
    return { enabled: false as const, stop: () => undefined };
  }

  const intervalMs = getStravaAutoSyncIntervalMs();
  if (!intervalMs) {
    console.warn("[HealthIntegrations] Automatic Strava sync disabled by configuration.");
    return { enabled: false as const, stop: () => undefined };
  }

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await healthIntegrationService.syncConnectedStravaUsers();
      if (summary.attempted > 0) {
        console.log("[HealthIntegrations] Automatic Strava sync completed:", summary);
      }
    } catch (error) {
      console.warn("[HealthIntegrations] Automatic Strava sync skipped:", error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  };

  const initialRun = setTimeout(() => {
    void run();
  }, 5_000);
  const interval = setInterval(() => {
    void run();
  }, intervalMs);
  runTimerWithoutKeepingProcessAlive(initialRun);
  runTimerWithoutKeepingProcessAlive(interval);

  return {
    enabled: true as const,
    stop: () => {
      clearTimeout(initialRun);
      clearInterval(interval);
    },
  };
}
