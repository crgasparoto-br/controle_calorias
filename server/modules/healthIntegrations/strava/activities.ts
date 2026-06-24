import {
  DEFAULT_STRAVA_RATE_LIMIT_COOLDOWN_MINUTES,
  STRAVA_ACTIVITIES_PER_PAGE,
  STRAVA_ACTIVITIES_URL,
  STRAVA_ACTIVITY_DETAIL_URL,
  STRAVA_BACKFILL_DAYS,
  STRAVA_INCREMENTAL_OVERLAP_HOURS,
  STRAVA_MAX_ACTIVITY_PAGES,
  DEFAULT_STRAVA_MAX_ACTIVITY_DETAIL_REQUESTS_PER_SYNC,
} from "./constants";
import { ensureValidStravaToken } from "./oauth";
import {
  createStravaRateLimitError,
  getStravaCooldownError,
  getStravaGlobalCooldownError,
  isApproachingStravaRateLimit,
  setStravaGlobalCooldown,
} from "./rateLimit";
import type { StravaActivity } from "./types";

function getStravaIncrementalOverlapHours() {
  const configured = Number(process.env.STRAVA_INCREMENTAL_OVERLAP_HOURS ?? STRAVA_INCREMENTAL_OVERLAP_HOURS);
  if (!Number.isFinite(configured) || configured < 0) return STRAVA_INCREMENTAL_OVERLAP_HOURS;
  return configured;
}

export function getStravaActivitiesAfterTimestamp(lastSyncedAt: number | null, now = Date.now()) {
  if (lastSyncedAt) {
    const overlapMs = getStravaIncrementalOverlapHours() * 3_600_000;
    return Math.floor((lastSyncedAt - overlapMs) / 1000);
  }

  const backfillMs = STRAVA_BACKFILL_DAYS * 24 * 3_600_000;
  return Math.floor((now - backfillMs) / 1000);
}

function buildStravaActivitiesUrl(page: number, after: number) {
  const params = new URLSearchParams({
    per_page: String(STRAVA_ACTIVITIES_PER_PAGE),
    page: String(page),
    after: String(after),
  });
  return `${STRAVA_ACTIVITIES_URL}?${params.toString()}`;
}

function buildStravaActivityDetailUrl(activityId: number) {
  return `${STRAVA_ACTIVITY_DETAIL_URL}/${activityId}`;
}

export function shouldFetchStravaActivityDetail(activity: StravaActivity) {
  const calories = typeof activity.calories === "number" ? activity.calories : null;
  const missingCalories = calories == null || calories <= 0;
  return missingCalories && (activity.moving_time ?? 0) > 0;
}

export function getStravaMaxActivityDetailRequestsPerSync() {
  const configured = Number(process.env.STRAVA_MAX_ACTIVITY_DETAIL_REQUESTS_PER_SYNC ?? DEFAULT_STRAVA_MAX_ACTIVITY_DETAIL_REQUESTS_PER_SYNC);
  if (!Number.isFinite(configured) || configured < 0) {
    return DEFAULT_STRAVA_MAX_ACTIVITY_DETAIL_REQUESTS_PER_SYNC;
  }

  return Math.floor(configured);
}

export async function fetchStravaActivityDetail(accessToken: string, activityId: number) {
  const response = await fetch(buildStravaActivityDetailUrl(activityId), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    console.warn("[HealthIntegrations] Failed to fetch Strava activity detail:", {
      activityId,
      status: response.status,
    });
    if (response.status === 429) {
      const error = createStravaRateLimitError(response);
      setStravaGlobalCooldown(error.retryAfterMs);
      throw error;
    }
    return null;
  }

  if (isApproachingStravaRateLimit(response)) {
    setStravaGlobalCooldown(DEFAULT_STRAVA_RATE_LIMIT_COOLDOWN_MINUTES * 60_000);
  }

  const detail = await response.json() as StravaActivity;
  return detail;
}

export async function fetchStravaActivities(userId: number, lastSyncedAt: number | null) {
  const globalCooldownError = getStravaGlobalCooldownError();
  if (globalCooldownError) throw globalCooldownError;

  const cooldownError = getStravaCooldownError(userId);
  if (cooldownError) throw cooldownError;

  const token = await ensureValidStravaToken(userId);
  const activities: StravaActivity[] = [];
  const after = getStravaActivitiesAfterTimestamp(lastSyncedAt);

  for (let page = 1; page <= STRAVA_MAX_ACTIVITY_PAGES; page += 1) {
    const response = await fetch(buildStravaActivitiesUrl(page, after), {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 429) {
        const error = createStravaRateLimitError(response);
        setStravaGlobalCooldown(error.retryAfterMs);
        throw error;
      }
      throw new Error(`Falha ao buscar atividades do Strava (${response.status}).`);
    }

    if (isApproachingStravaRateLimit(response)) {
      setStravaGlobalCooldown(DEFAULT_STRAVA_RATE_LIMIT_COOLDOWN_MINUTES * 60_000);
    }

    const pageActivities = await response.json() as StravaActivity[];
    if (!Array.isArray(pageActivities)) {
      throw new Error("Resposta inesperada do Strava ao buscar atividades.");
    }

    activities.push(...pageActivities);
    if (pageActivities.length < STRAVA_ACTIVITIES_PER_PAGE) break;
  }

  return activities;
}
