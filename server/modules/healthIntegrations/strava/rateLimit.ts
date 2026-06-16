import { DEFAULT_STRAVA_RATE_LIMIT_COOLDOWN_MINUTES } from "./constants";

export class StravaRateLimitError extends Error {
  retryAfterMs: number;

  constructor(retryAfterMs: number) {
    const retryAt = new Date(Date.now() + retryAfterMs);
    super(`Limite de requisições do Strava atingido. Tente sincronizar novamente após ${retryAt.toLocaleString("pt-BR")}.`);
    this.name = "StravaRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

const stravaRateLimitCooldowns = new Map<number, number>();
let stravaGlobalRateLimitCooldownAt: number | null = null;

export function parseRetryAfterMs(response: Response) {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) {
    return DEFAULT_STRAVA_RATE_LIMIT_COOLDOWN_MINUTES * 60_000;
  }

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  const retryAt = Date.parse(retryAfter);
  if (Number.isFinite(retryAt)) {
    return Math.max(retryAt - Date.now(), 60_000);
  }

  return DEFAULT_STRAVA_RATE_LIMIT_COOLDOWN_MINUTES * 60_000;
}

export function createStravaRateLimitError(response: Response) {
  return new StravaRateLimitError(parseRetryAfterMs(response));
}

export function getStravaCooldownError(userId: number) {
  const retryAt = stravaRateLimitCooldowns.get(userId);
  if (!retryAt) return null;

  const retryAfterMs = retryAt - Date.now();
  if (retryAfterMs <= 0) {
    stravaRateLimitCooldowns.delete(userId);
    return null;
  }

  return new StravaRateLimitError(retryAfterMs);
}

export function getStravaGlobalCooldownError() {
  if (!stravaGlobalRateLimitCooldownAt) return null;

  const retryAfterMs = stravaGlobalRateLimitCooldownAt - Date.now();
  if (retryAfterMs <= 0) {
    stravaGlobalRateLimitCooldownAt = null;
    return null;
  }

  return new StravaRateLimitError(retryAfterMs);
}

export function setStravaGlobalCooldown(retryAfterMs: number) {
  const retryAt = Date.now() + retryAfterMs;
  if (!stravaGlobalRateLimitCooldownAt || retryAt > stravaGlobalRateLimitCooldownAt) {
    stravaGlobalRateLimitCooldownAt = retryAt;
  }
}

export function setStravaUserCooldown(userId: number, retryAfterMs: number) {
  stravaRateLimitCooldowns.set(userId, Date.now() + retryAfterMs);
}

export function isApproachingStravaRateLimit(response: Response) {
  const limit = response.headers.get("X-ReadRateLimit-Limit");
  const usage = response.headers.get("X-ReadRateLimit-Usage");
  if (!limit || !usage) return false;

  const limits = limit.split(",").map(Number);
  const usages = usage.split(",").map(Number);
  return usages.some((u, i) => limits[i] > 0 && u / limits[i] > 0.9);
}
