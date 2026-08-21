import { eq, like } from "drizzle-orm";
import { appSecrets } from "../../../../drizzle/schema";
import { getDb } from "../../../db";
import { STRAVA_TOKEN_SECRET_PREFIX } from "./constants";
import { decryptSecretValue, encryptSecretValue } from "./encryption";
import type { StravaTokenState } from "./types";

const stravaTokens = new Map<number, StravaTokenState>();

export function buildStravaSecretKey(userId: number) {
  return `${STRAVA_TOKEN_SECRET_PREFIX}_${userId}`;
}

export function parseStravaUserIdFromSecretKey(secretKey: string) {
  const prefix = `${STRAVA_TOKEN_SECRET_PREFIX}_`;
  if (!secretKey.startsWith(prefix)) return null;

  const userId = Number(secretKey.slice(prefix.length));
  return Number.isInteger(userId) && userId > 0 ? userId : null;
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

export async function loadStoredStravaTokenState(userId: number) {
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

export async function persistStravaTokenState(userId: number, token: StravaTokenState) {
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

export async function deleteStoredStravaTokenState(userId: number) {
  stravaTokens.delete(userId);

  const db = await getDb();
  if (!db) return;

  try {
    await db.delete(appSecrets).where(eq(appSecrets.secretKey, buildStravaSecretKey(userId)));
  } catch (error) {
    console.warn("[HealthIntegrations] Failed to delete persisted Strava OAuth state:", error instanceof Error ? error.message : error);
  }
}

export async function listStoredStravaUserIds() {
  const userIds = new Set(stravaTokens.keys());
  const db = await getDb();
  if (!db) return Array.from(userIds);

  try {
    const rows = await db
      .select({ secretKey: appSecrets.secretKey })
      .from(appSecrets)
      .where(like(appSecrets.secretKey, `${STRAVA_TOKEN_SECRET_PREFIX}_%`))
      .limit(500);

    for (const row of rows) {
      const userId = parseStravaUserIdFromSecretKey(row.secretKey);
      if (userId) userIds.add(userId);
    }
  } catch (error) {
    console.warn("[HealthIntegrations] Failed to list persisted Strava OAuth users:", error instanceof Error ? error.message : error);
  }

  return Array.from(userIds);
}
