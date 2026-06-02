import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { appSecrets } from "../../../drizzle/schema";
import { ENV } from "../../_core/env";
import { getDb } from "../../db";
import { createExercise, listExercises, updateExercise } from "../exercises/service";
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

type EncryptedSecretPayload = {
  iv: string;
  tag: string;
  value: string;
};

type StravaTokenState = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  athleteId: number;
  athleteName: string | null;
  scope: string;
  connectedAt: number;
  lastSyncedAt: number | null;
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

type StravaExerciseImportSummary = {
  created: number;
  updated: number;
  skipped: number;
};

const connections = new Map<string, HealthConnection>();
const records = new Map<number, HealthRecord[]>();
const stravaTokens = new Map<number, StravaTokenState>();

const STRAVA_AUTHORIZATION_URL = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
const STRAVA_ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities";
const STRAVA_SCOPES = "read,activity:read";
const STRAVA_ACTIVITY_NOTE_PREFIX = "Importado automaticamente do Strava";
const STRAVA_TOKEN_SECRET_PREFIX = "strava_oauth_user";
const STRAVA_SYNC_LOOKBACK_MONTHS = 2;

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

function buildStravaSecretKey(userId: number) {
  return `${STRAVA_TOKEN_SECRET_PREFIX}_${userId}`;
}

function getSecretCipherKey() {
  return crypto
    .createHash("sha256")
    .update(`controle-calorias::health-integrations::${ENV.cookieSecret}`)
    .digest();
}

function encryptSecretValue(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getSecretCipherKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    value: encrypted.toString("base64"),
  } satisfies EncryptedSecretPayload);
}

function decryptSecretValue(payload: string) {
  const parsed = JSON.parse(payload) as EncryptedSecretPayload;
  const decipher = crypto.createDecipheriv("aes-256-gcm", getSecretCipherKey(), Buffer.from(parsed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.value, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

function isStravaTokenState(value: unknown): value is StravaTokenState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StravaTokenState>;
  return Boolean(
    typeof candidate.accessToken === "string" &&
    typeof candidate.refreshToken === "string" &&
    typeof candidate.expiresAt === "number" &&
    typeof candidate.athleteId === "number" &&
    typeof candidate.scope === "string" &&
    typeof candidate.connectedAt === "number",
  );
}

async function loadStoredStravaTokenState(userId: number) {
  const cached = stravaTokens.get(userId);
  if (cached) return cached;

  const db = await getDb();
  if (!db) return null;

  try {
    const rows = await db.select().from(appSecrets).where(eq(appSecrets.secretKey, buildStravaSecretKey(userId))).limit(1);
    const row = rows[0];
    if (!row) return null;

    const parsed = JSON.parse(decryptSecretValue(row.valueEncrypted));
    if (!isStravaTokenState(parsed)) return null;

    const token: StravaTokenState = {
      ...parsed,
      athleteName: parsed.athleteName ?? null,
      lastSyncedAt: parsed.lastSyncedAt ?? null,
    };
    stravaTokens.set(userId, token);
    return token;
  } catch (error) {
    console.warn("[HealthIntegrations] Failed to load persisted Strava OAuth state:", error instanceof Error ? error.message : error);
    return null;
  }
}

async function persistStravaTokenState(userId: number, token: StravaTokenState) {
  stravaTokens.set(userId, token);

  const db = await getDb();
  if (!db) return;

  const secretKey = buildStravaSecretKey(userId);
  const valueEncrypted = encryptSecretValue(JSON.stringify(token));
  try {
    const existing = await db.select().from(appSecrets).where(eq(appSecrets.secretKey, secretKey)).limit(1);
    if (existing[0]) {
      await db
        .update(appSecrets)
        .set({ valueEncrypted, updatedByUserId: userId })
        .where(eq(appSecrets.id, existing[0].id));
    } else {
      await db.insert(appSecrets).values({
        secretKey,
        valueEncrypted,
        updatedByUserId: userId,
      });
    }
  } catch (error) {
    console.warn("[HealthIntegrations] Failed to persist Strava OAuth state:", error instanceof Error ? error.message : error);
  }
}

async function deleteStoredStravaTokenState(userId: number) {
  stravaTokens.delete(userId);

  const db = await getDb();
  if (!db) return;

  try {
    await db.delete(appSecrets).where(eq(appSecrets.secretKey, buildStravaSecretKey(userId)));
  } catch (error) {
    console.warn("[HealthIntegrations] Failed to delete persisted Strava OAuth state:", error instanceof Error ? error.message : error);
  }
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

function publicStravaConnection(userId: number, token: StravaTokenState) {
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

async function fetchStravaToken(payload: Record<string, string>) {
  const response = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(payload),
  });

  if (!response.ok) {
    throw new Error(`Falha ao falar com o OAuth do Strava (${response.status}).`);
  }

  return await response.json() as StravaTokenResponse;
}

function toStravaTokenState(token: StravaTokenResponse, current?: StravaTokenState | null): StravaTokenState {
  const athleteName = [token.athlete?.firstname, token.athlete?.lastname].filter(Boolean).join(" ").trim() || token.athlete?.username || current?.athleteName || null;

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: token.expires_at * 1000,
    athleteId: token.athlete?.id ?? current?.athleteId ?? 0,
    athleteName,
    scope: token.scope ?? current?.scope ?? STRAVA_SCOPES,
    connectedAt: current?.connectedAt ?? Date.now(),
    lastSyncedAt: current?.lastSyncedAt ?? null,
  };
}

async function ensureValidStravaToken(userId: number) {
  const token = await loadStoredStravaTokenState(userId);
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
  const nextToken = toStravaTokenState(refreshed, token);
  await persistStravaTokenState(userId, nextToken);
  return nextToken;
}

function getStravaActivitiesAfterTimestamp(now = new Date()) {
  const lookbackDate = new Date(now);
  lookbackDate.setMonth(lookbackDate.getMonth() - STRAVA_SYNC_LOOKBACK_MONTHS);
  return Math.floor(lookbackDate.getTime() / 1000);
}

function buildStravaActivitiesUrl() {
  const params = new URLSearchParams({
    per_page: "20",
    after: String(getStravaActivitiesAfterTimestamp()),
  });
  return `${STRAVA_ACTIVITIES_URL}?${params.toString()}`;
}

async function fetchStravaActivities(userId: number) {
  const token = await ensureValidStravaToken(userId);
  const response = await fetch(buildStravaActivitiesUrl(), {
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Falha ao buscar atividades do Strava (${response.status}).`);
  }

  return await response.json() as StravaActivity[];
}

function getStravaActivityType(activity: StravaActivity) {
  return activity.sport_type || activity.type || activity.name || "Atividade Strava";
}

function getStravaExerciseNote(activity: StravaActivity) {
  return `${STRAVA_ACTIVITY_NOTE_PREFIX}. Referencia externa: strava:${activity.id}.`;
}

function toStravaExerciseInput(activity: StravaActivity) {
  const durationMinutes = Math.max(Math.round((activity.moving_time ?? 0) / 60), 0);
  const caloriesBurned = typeof activity.calories === "number" ? Math.round(activity.calories) : 0;
  if (durationMinutes < 1 || caloriesBurned < 1) return null;

  return {
    activityType: getStravaActivityType(activity),
    durationMinutes,
    caloriesBurned,
    occurredAt: activity.start_date,
    notes: getStravaExerciseNote(activity),
  };
}

async function upsertStravaActivitiesAsExercises(userId: number, activities: StravaActivity[]): Promise<StravaExerciseImportSummary> {
  const existingExercises = await listExercises(userId);
  const summary: StravaExerciseImportSummary = { created: 0, updated: 0, skipped: 0 };

  for (const activity of activities) {
    const exerciseInput = toStravaExerciseInput(activity);
    if (!exerciseInput) {
      summary.skipped += 1;
      continue;
    }

    const externalReference = `strava:${activity.id}`;
    const existing = existingExercises.find(exercise => exercise.notes?.includes(externalReference));
    if (existing) {
      await updateExercise(userId, {
        exerciseId: existing.id,
        ...exerciseInput,
      });
      summary.updated += 1;
    } else {
      const created = await createExercise(userId, exerciseInput);
      existingExercises.push(created);
      summary.created += 1;
    }
  }

  return summary;
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
        activityType: getStravaActivityType(activity),
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
        activityType: getStravaActivityType(activity),
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

function formatStravaImportSummary(summary: StravaExerciseImportSummary) {
  const imported = summary.created + summary.updated;
  if (imported <= 0) {
    return "Nenhum exercício novo foi registrado automaticamente.";
  }

  return `${imported} exercício(s) registrado(s) a partir das atividades recentes.`;
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
        scopes: parseStravaScopes(input.scope ?? token.scope ?? STRAVA_SCOPES),
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
          message: `Strava conectado com sucesso para o usuário ${connection.userId}. Sincronize novamente para importar os exercícios recentes.`,
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
      const stravaActivities = input.provider === "strava" ? await fetchStravaActivities(userId) : null;
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
}

export const healthIntegrationService = new HealthIntegrationService();