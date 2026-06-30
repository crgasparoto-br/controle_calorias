import type { SyncedHealthRecord } from "../syncedRecords";

export type StravaSyncedExercise = {
  id: number;
  activityType: string;
  durationMinutes: number;
  caloriesBurned: number;
  notes?: string | null;
  occurredAt: string | number | Date;
  createdAt?: string | number | Date | null;
  updatedAt?: string | number | Date | null;
};

const STRAVA_EXTERNAL_REFERENCE_PATTERN = /\bstrava:([a-zA-Z0-9_-]+)\b/i;

function parseDate(value: string | number | Date | null | undefined) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value === null || value === undefined) return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toTimestamp(value: string | number | Date) {
  return parseDate(value)?.toISOString() ?? new Date(0).toISOString();
}

function toComparableTimestamp(value: string | number | Date | null | undefined) {
  return parseDate(value)?.getTime() ?? 0;
}

function parsePtBrDecimal(value: string) {
  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNoteText(notes: string | null | undefined, label: string) {
  const match = new RegExp(`${label}:\\s*([^.;]+)`, "i").exec(notes ?? "");
  return match?.[1]?.trim() || null;
}

function parseDistanceMeters(notes: string | null | undefined) {
  const match = /Distancia:\s*([\d.,]+)\s*km/i.exec(notes ?? "");
  if (!match?.[1]) return null;

  const kilometers = parsePtBrDecimal(match[1]);
  return kilometers && kilometers > 0 ? Math.round(kilometers * 1000) : null;
}

export function getStravaExternalExerciseId(exercise: Pick<StravaSyncedExercise, "notes">) {
  return STRAVA_EXTERNAL_REFERENCE_PATTERN.exec(exercise.notes ?? "")?.[1]?.trim().toLowerCase() ?? null;
}

function deduplicateStravaExercises(exercises: StravaSyncedExercise[]) {
  const selectedByExternalId = new Map<string, StravaSyncedExercise>();

  for (const exercise of exercises) {
    const externalId = getStravaExternalExerciseId(exercise);
    if (!externalId) continue;

    const current = selectedByExternalId.get(externalId);
    const currentTimestamp = Math.max(
      toComparableTimestamp(current?.updatedAt),
      toComparableTimestamp(current?.createdAt),
      toComparableTimestamp(current?.occurredAt),
    );
    const nextTimestamp = Math.max(
      toComparableTimestamp(exercise.updatedAt),
      toComparableTimestamp(exercise.createdAt),
      toComparableTimestamp(exercise.occurredAt),
    );

    if (!current || nextTimestamp >= currentTimestamp) {
      selectedByExternalId.set(externalId, exercise);
    }
  }

  return Array.from(selectedByExternalId.entries());
}

export function mapStravaExercisesToSyncedHealthRecords(exercises: StravaSyncedExercise[]): SyncedHealthRecord[] {
  return deduplicateStravaExercises(exercises).map(([externalId, exercise]) => {
    const metadata: Record<string, unknown> = {
      externalId,
      importedExerciseId: exercise.id,
      sourceStatus: "synced",
      calories: Math.max(Math.round(exercise.caloriesBurned), 0),
      caloriesSource: "exercise_log",
      caloriesOrigin: "synced_exercise",
      estimatedCalories: false,
    };
    const sportType = parseNoteText(exercise.notes, "Tipo Strava");
    const distanceMeters = parseDistanceMeters(exercise.notes);

    if (sportType) metadata.sportType = sportType;
    if (distanceMeters) metadata.distanceMeters = distanceMeters;
    if (exercise.notes) metadata.notes = exercise.notes;

    return {
      id: `${externalId}:activity`,
      source: "strava",
      dataType: "activity",
      measuredAt: toTimestamp(exercise.occurredAt),
      value: Math.max(Math.round(exercise.durationMinutes), 0),
      unit: "minutes",
      activityType: exercise.activityType,
      metadata,
    };
  });
}
