import type { HealthDataType } from "../schemas";
import { STRAVA_AUTHORIZATION_URL, STRAVA_SCOPES, STRAVA_TOKEN_URL } from "./constants";
import { loadStoredStravaTokenState, persistStravaTokenState } from "./tokenStorage";
import type { StravaTokenResponse, StravaTokenState } from "./types";

export function parseStravaScopes(scope: string | null | undefined): HealthDataType[] {
  const normalized = (scope ?? "").split(",").map(item => item.trim()).filter(Boolean);
  const nextScopes = new Set<HealthDataType>();

  if (normalized.some(item => item === "activity:read" || item === "activity:read_all")) {
    nextScopes.add("activity");
    nextScopes.add("energy_burned");
  }

  return Array.from(nextScopes);
}

export function buildStravaAuthorizationUrl(userId: number) {
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

export async function fetchStravaToken(payload: Record<string, string>) {
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

export function toStravaTokenState(token: StravaTokenResponse, current?: StravaTokenState | null): StravaTokenState {
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

export async function ensureValidStravaToken(userId: number) {
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
