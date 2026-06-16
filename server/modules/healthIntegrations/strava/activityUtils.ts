import {
  DEFAULT_STRENGTH_ESTIMATION_WEIGHT_KG,
  STRAVA_ACTIVITY_CALORIES_PER_MINUTE,
  STRAVA_ACTIVITY_TYPE_LABELS,
} from "./constants";
import type { StravaActivity, StravaActivityMetadata } from "./types";

export function normalizeStravaActivityKey(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

export function getOriginalStravaActivityType(activity: StravaActivity) {
  return activity.sport_type || activity.type || activity.name || "Atividade Strava";
}

export function getStravaActivityTypeKey(activity: StravaActivity) {
  return normalizeStravaActivityKey(getOriginalStravaActivityType(activity));
}

export function getStravaActivityType(activity: StravaActivity) {
  const originalType = getOriginalStravaActivityType(activity);
  return STRAVA_ACTIVITY_TYPE_LABELS[getStravaActivityTypeKey(activity)] ?? originalType;
}

export function isStravaRideActivity(activity: StravaActivity) {
  const typeKey = getStravaActivityTypeKey(activity);
  if (/(^|_)(ride|bike|cycling|bicycle|ebike|handcycle|velomobile)(_|$)/.test(typeKey)) {
    return true;
  }

  const value = `${activity.sport_type ?? ""} ${activity.type ?? ""} ${activity.name ?? ""}`;
  return /ride|bike|cycling|ciclismo|pedal|bicicleta|handcycle|e-?bike|mtb/i.test(value);
}

export function isStravaStrengthActivity(activity: StravaActivity) {
  const value = `${activity.sport_type ?? ""} ${activity.type ?? ""} ${activity.name ?? ""}`;
  return /weight|strength|workout|crossfit|hiit|highintensity|training|musculacao|muscula[cç][aã]o|for[cç]a|peso/i.test(value);
}

export function getStrengthActivityMet(activity: StravaActivity) {
  const value = `${activity.sport_type ?? ""} ${activity.type ?? ""} ${activity.name ?? ""}`;
  if (/crossfit|hiit|highintensity/i.test(value)) return 8;
  if (/workout|training/i.test(value)) return 5;
  return 3.5;
}

export function estimateStravaStrengthCalories(activity: StravaActivity) {
  if (!isStravaStrengthActivity(activity)) return null;

  const durationMinutes = Math.max(Math.round((activity.moving_time ?? activity.elapsed_time ?? 0) / 60), 0);
  if (durationMinutes < 1) return null;

  const met = getStrengthActivityMet(activity);
  const calories = Math.round((met * 3.5 * DEFAULT_STRENGTH_ESTIMATION_WEIGHT_KG * durationMinutes) / 200);
  return calories > 0
    ? {
      calories,
      met,
      weightKg: DEFAULT_STRENGTH_ESTIMATION_WEIGHT_KG,
    }
    : null;
}

export function estimateStravaActivityCalories(activity: StravaActivity) {
  const durationMinutes = Math.max(Math.round((activity.moving_time ?? activity.elapsed_time ?? 0) / 60), 0);
  if (durationMinutes < 1) return null;

  const caloriesPerMinute = STRAVA_ACTIVITY_CALORIES_PER_MINUTE[getStravaActivityTypeKey(activity)];
  if (!caloriesPerMinute) return null;

  const calories = Math.round(caloriesPerMinute * durationMinutes);
  return calories > 0
    ? {
      calories,
      met: null,
      weightKg: null,
    }
    : null;
}

export function getStravaCaloriesInfo(activity: StravaActivity) {
  if (typeof activity.calories === "number" && activity.calories > 0) {
    return {
      calories: Math.round(activity.calories),
      source: "strava" as const,
      estimated: false,
      estimatedWeightKg: null,
      estimatedMet: null,
    };
  }

  if (
    typeof activity.kilojoules === "number"
    && activity.kilojoules > 0
    && isStravaRideActivity(activity)
  ) {
    return {
      calories: Math.round(activity.kilojoules * 0.239006),
      source: "kilojoules" as const,
      estimated: false,
      estimatedWeightKg: null,
      estimatedMet: null,
    };
  }

  const estimated = estimateStravaStrengthCalories(activity);
  if (estimated) {
    return {
      calories: estimated.calories,
      source: "estimated_strength" as const,
      estimated: true,
      estimatedWeightKg: estimated.weightKg,
      estimatedMet: estimated.met,
    };
  }

  const activityEstimate = estimateStravaActivityCalories(activity);
  if (activityEstimate) {
    return {
      calories: activityEstimate.calories,
      source: "estimated_activity" as const,
      estimated: true,
      estimatedWeightKg: activityEstimate.weightKg,
      estimatedMet: activityEstimate.met,
    };
  }

  return {
    calories: 0,
    source: null,
    estimated: false,
    estimatedWeightKg: null,
    estimatedMet: null,
  };
}

export function getStravaCaloriesBurned(activity: StravaActivity) {
  return getStravaCaloriesInfo(activity).calories;
}

export function getOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function getOptionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

export function getOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function getStravaActivityMetadata(activity: StravaActivity): StravaActivityMetadata {
  const caloriesInfo = getStravaCaloriesInfo(activity);
  return {
    externalId: String(activity.id),
    name: activity.name,
    sportType: getOriginalStravaActivityType(activity),
    distanceMeters: getOptionalNumber(activity.distance),
    movingTimeSeconds: getOptionalNumber(activity.moving_time),
    elapsedTimeSeconds: getOptionalNumber(activity.elapsed_time),
    calories: caloriesInfo.calories || null,
    caloriesSource: caloriesInfo.source,
    estimatedCalories: caloriesInfo.estimated,
    estimatedCaloriesWeightKg: caloriesInfo.estimatedWeightKg,
    estimatedCaloriesMet: caloriesInfo.estimatedMet,
    kilojoules: getOptionalNumber(activity.kilojoules),
    totalElevationGainMeters: getOptionalNumber(activity.total_elevation_gain),
    averageSpeedMetersPerSecond: getOptionalNumber(activity.average_speed),
    maxSpeedMetersPerSecond: getOptionalNumber(activity.max_speed),
    averageHeartRate: getOptionalNumber(activity.average_heartrate),
    maxHeartRate: getOptionalNumber(activity.max_heartrate),
    averageCadence: getOptionalNumber(activity.average_cadence),
    averageWatts: getOptionalNumber(activity.average_watts),
    maxWatts: getOptionalNumber(activity.max_watts),
    weightedAverageWatts: getOptionalNumber(activity.weighted_average_watts),
    deviceName: getOptionalString(activity.device_name),
    gearId: getOptionalString(activity.gear_id),
    startDateLocal: getOptionalString(activity.start_date_local),
    timezone: getOptionalString(activity.timezone),
    visibility: getOptionalString(activity.visibility),
    achievementCount: getOptionalNumber(activity.achievement_count),
    kudosCount: getOptionalNumber(activity.kudos_count),
    prCount: getOptionalNumber(activity.pr_count),
    trainer: getOptionalBoolean(activity.trainer),
    commute: getOptionalBoolean(activity.commute),
    manual: getOptionalBoolean(activity.manual),
    private: getOptionalBoolean(activity.private),
    hasHeartRate: getOptionalBoolean(activity.has_heartrate),
  };
}

export function formatDecimal(value: number, fractionDigits = 1) {
  return value.toFixed(fractionDigits).replace(".", ",");
}

export function formatDistanceKm(distanceMeters: number) {
  return `${formatDecimal(distanceMeters / 1000, 2)} km`;
}

export function formatSpeedKmH(speedMetersPerSecond: number) {
  return `${formatDecimal(speedMetersPerSecond * 3.6, 1)} km/h`;
}

export function formatPace(speedMetersPerSecond: number) {
  if (speedMetersPerSecond <= 0) return null;
  const secondsPerKm = Math.round(1000 / speedMetersPerSecond);
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = String(secondsPerKm % 60).padStart(2, "0");
  return `${minutes}:${seconds}/km`;
}

export function getStravaActivityEmoji(activityType: string) {
  const t = activityType.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/corrida|run/.test(t)) return "🏃";
  if (/caminhada|walk|trilha/.test(t)) return "🚶";
  if (/pedal|ciclismo|bicicleta|bike|ride/.test(t)) return "🚴";
  if (/natacao|swim/.test(t)) return "🏊";
  if (/musculacao|peso|strength|weight/.test(t)) return "🏋️";
  if (/yoga|pilates/.test(t)) return "🧘";
  if (/futebol|soccer/.test(t)) return "⚽";
  if (/tennis|tenis/.test(t)) return "🎾";
  if (/remo|rowing/.test(t)) return "🚣";
  if (/escalada|climb/.test(t)) return "🧗";
  if (/surf/.test(t)) return "🏄";
  if (/ski|snow/.test(t)) return "⛷️";
  return "🏃";
}
