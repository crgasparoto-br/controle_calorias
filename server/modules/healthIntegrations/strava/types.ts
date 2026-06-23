import type { HealthDataType, HealthProvider } from "../schemas";

export type HealthConnectionStatus = "connected" | "disconnected" | "error" | "pending";
export type HealthSetupStatus = "ready" | "missing_credentials" | "native_required" | "dev_only";
export type IntegrationKind = "native" | "oauth" | "mock";
export type StravaCaloriesSource = "strava_detail" | "strava_summary" | "kilojoules" | "estimated_activity" | "estimated_strength" | null;

export type HealthConnection = {
  userId: number;
  provider: HealthProvider;
  status: HealthConnectionStatus;
  consentGrantedAt: number | null;
  disconnectedAt: number | null;
  scopes: HealthDataType[];
  lastSyncedAt: number | null;
  lastError: string | null;
};

export type StravaActivityMetadata = {
  externalId: string;
  name: string;
  sportType: string;
  distanceMeters: number | null;
  movingTimeSeconds: number | null;
  elapsedTimeSeconds: number | null;
  calories: number | null;
  caloriesSource: StravaCaloriesSource;
  estimatedCalories: boolean;
  estimatedCaloriesWeightKg: number | null;
  estimatedCaloriesMet: number | null;
  kilojoules: number | null;
  totalElevationGainMeters: number | null;
  averageSpeedMetersPerSecond: number | null;
  maxSpeedMetersPerSecond: number | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  averageCadence: number | null;
  averageWatts: number | null;
  maxWatts: number | null;
  weightedAverageWatts: number | null;
  deviceName: string | null;
  gearId: string | null;
  startDateLocal: string | null;
  timezone: string | null;
  visibility: string | null;
  achievementCount: number | null;
  kudosCount: number | null;
  prCount: number | null;
  trainer: boolean | null;
  commute: boolean | null;
  manual: boolean | null;
  private: boolean | null;
  hasHeartRate: boolean | null;
};

export type HealthRecord = {
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
  metadata?: StravaActivityMetadata;
  createdAt: number;
};

export type EncryptedSecretPayload = {
  iv: string;
  tag: string;
  value: string;
};

export type StravaTokenState = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  athleteId: number;
  athleteName: string | null;
  scope: string;
  connectedAt: number;
  lastSyncedAt: number | null;
};

export type StravaTokenResponse = {
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

export type StravaActivity = {
  id: number;
  name: string;
  sport_type?: string;
  type?: string;
  start_date: string;
  start_date_local?: string | null;
  timezone?: string | null;
  moving_time: number;
  elapsed_time?: number | null;
  calories?: number | null;
  caloriesSource?: Extract<StravaCaloriesSource, "strava_detail" | "strava_summary">;
  kilojoules?: number | null;
  distance?: number | null;
  total_elevation_gain?: number | null;
  average_speed?: number | null;
  max_speed?: number | null;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  average_cadence?: number | null;
  average_watts?: number | null;
  max_watts?: number | null;
  weighted_average_watts?: number | null;
  device_name?: string | null;
  gear_id?: string | null;
  visibility?: string | null;
  achievement_count?: number | null;
  kudos_count?: number | null;
  pr_count?: number | null;
  trainer?: boolean | null;
  commute?: boolean | null;
  manual?: boolean | null;
  private?: boolean | null;
  has_heartrate?: boolean | null;
};

export type StravaExerciseImportSummary = {
  created: number;
  updated: number;
  skipped: number;
};

export type StravaAutoSyncSummary = {
  attempted: number;
  succeeded: number;
  failed: number;
  importedExercises: StravaExerciseImportSummary;
};
