import { eq } from "drizzle-orm";
import { userProfiles } from "../../../drizzle/schema";
import {
  resolveUserTimeZoneValue,
  type UserTimeZoneFallbackReason,
  type UserTimeZoneValueResolution,
} from "../../../shared/timeZone";
import { getDb } from "../../db";
import { canUseMemoryPersistenceFallback } from "../../repositories/memoryFallback";

export type EffectiveUserTimeZone = UserTimeZoneValueResolution;

type StoredProfileTimeZone = {
  profileExists: boolean;
  timeZone: string | null | undefined;
};

type EffectiveUserTimeZoneServiceDependencies = {
  readProfileTimeZone: (userId: number) => Promise<StoredProfileTimeZone>;
  onFallback?: (reason: UserTimeZoneFallbackReason) => void;
};

export class UserTimeZoneResolutionError extends Error {
  readonly cause?: unknown;

  constructor(cause?: unknown) {
    super("Não foi possível consultar o fuso horário configurado.");
    this.name = "UserTimeZoneResolutionError";
    this.cause = cause;
  }
}

export function createEffectiveUserTimeZoneService(
  dependencies: EffectiveUserTimeZoneServiceDependencies,
) {
  return {
    async resolve(userId: number): Promise<EffectiveUserTimeZone> {
      let stored: StoredProfileTimeZone;
      try {
        stored = await dependencies.readProfileTimeZone(userId);
      } catch (error) {
        if (error instanceof UserTimeZoneResolutionError) throw error;
        throw new UserTimeZoneResolutionError(error);
      }

      const resolved = resolveUserTimeZoneValue(stored.timeZone, {
        profileExists: stored.profileExists,
      });
      if (resolved.source === "fallback" && resolved.fallbackReason) {
        dependencies.onFallback?.(resolved.fallbackReason);
      }
      return resolved;
    },
  };
}

async function readPersistedProfileTimeZone(userId: number): Promise<StoredProfileTimeZone> {
  const db = await getDb();
  if (!db) {
    if (canUseMemoryPersistenceFallback()) {
      return { profileExists: false, timeZone: null };
    }
    throw new UserTimeZoneResolutionError();
  }

  try {
    const rows = await db
      .select({ timeZone: userProfiles.timezone })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);
    const profile = rows[0];
    return profile
      ? { profileExists: true, timeZone: profile.timeZone }
      : { profileExists: false, timeZone: null };
  } catch (error) {
    throw new UserTimeZoneResolutionError(error);
  }
}

export const effectiveUserTimeZoneService = createEffectiveUserTimeZoneService({
  readProfileTimeZone: readPersistedProfileTimeZone,
  onFallback(reason) {
    console.warn("[TimeZone] Effective timezone fallback applied", { reason });
  },
});

export async function resolveEffectiveUserTimeZone(userId: number) {
  return effectiveUserTimeZoneService.resolve(userId);
}

export async function getEffectiveUserTimeZone(userId: number) {
  return (await resolveEffectiveUserTimeZone(userId)).timeZone;
}
