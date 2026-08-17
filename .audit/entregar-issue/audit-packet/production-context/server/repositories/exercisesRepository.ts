import { and, desc, eq, gte, like, lt } from "drizzle-orm";
import { exercises } from "../../drizzle/schema";

type DbProvider = () => Promise<any | null>;
type PersistenceWarningHandler = (scope: string, error: unknown) => void;

export type ExternalExerciseImportStatus = "created" | "updated" | "skipped";

export type ExerciseRecord = {
  id: number;
  userId: number;
  activityType: string;
  durationMinutes: number;
  caloriesBurned: number;
  notes?: string | null;
  occurredAt: number;
  createdAt: number;
  updatedAt: Date;
  externalProvider?: string | null;
  externalId?: string | null;
  externalImportStatus?: ExternalExerciseImportStatus;
};

export type ExercisesRepository = {
  findByUserId(userId: number): Promise<ExerciseRecord[] | null>;
  findByUserIdAndRange(userId: number, startAt: Date, endAt: Date): Promise<ExerciseRecord[] | null>;
  insert(exercise: ExerciseRecord): Promise<void>;
  update(exercise: ExerciseRecord): Promise<void>;
  delete(userId: number, exerciseId: number): Promise<void>;
};

function normalizeExternalId(value: string | number | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || null;
}

function getExternalExerciseReference(exercise: Pick<ExerciseRecord, "notes" | "externalProvider" | "externalId">) {
  const structuredProvider = exercise.externalProvider?.trim().toLowerCase();
  const structuredId = normalizeExternalId(exercise.externalId);
  if (structuredProvider && structuredId) return `${structuredProvider}:${structuredId}`;

  const reference = /\bstrava:([a-zA-Z0-9_-]+)\b/i.exec(exercise.notes ?? "")?.[1];
  return reference ? `strava:${reference.toLowerCase()}` : null;
}

function deduplicateExternalExercises(records: ExerciseRecord[]) {
  const selectedByReference = new Map<string, ExerciseRecord>();
  const recordsWithoutExternalReference: ExerciseRecord[] = [];

  for (const record of records) {
    const reference = getExternalExerciseReference(record);
    if (!reference) {
      recordsWithoutExternalReference.push(record);
      continue;
    }

    const current = selectedByReference.get(reference);
    if (!current || record.updatedAt.getTime() > current.updatedAt.getTime()) {
      selectedByReference.set(reference, record);
    }
  }

  return [...recordsWithoutExternalReference, ...selectedByReference.values()]
    .sort((first, second) => second.occurredAt - first.occurredAt);
}

function mapExerciseRow(row: typeof exercises.$inferSelect): ExerciseRecord {
  return {
    ...row,
    occurredAt: new Date(row.occurredAt).getTime(),
    createdAt: new Date(row.createdAt).getTime(),
    updatedAt: new Date(row.updatedAt),
  };
}

function applyPersistedExercise(target: ExerciseRecord, source: ExerciseRecord, status: ExternalExerciseImportStatus) {
  Object.assign(target, source, { externalImportStatus: status });
}

function getMysqlAffectedRows(result: unknown) {
  const candidate = Array.isArray(result) ? result[0] : result;
  const affectedRows = Number((candidate as { affectedRows?: number })?.affectedRows ?? 0);
  return Number.isFinite(affectedRows) ? affectedRows : 0;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, character => `\\${character}`);
}

export function createDrizzleExercisesRepository(deps: {
  getDb: DbProvider;
  onWarning: PersistenceWarningHandler;
}): ExercisesRepository {
  return {
    async findByUserId(userId) {
      const db = await deps.getDb();
      if (!db) return null;

      try {
        const rows = await db.select().from(exercises).where(eq(exercises.userId, userId)).orderBy(desc(exercises.occurredAt));
        return deduplicateExternalExercises(rows.map(mapExerciseRow));
      } catch (error) {
        deps.onWarning("Exercise read skipped", error);
        return null;
      }
    },

    async findByUserIdAndRange(userId, startAt, endAt) {
      const db = await deps.getDb();
      if (!db) return null;

      try {
        const rows = await db
          .select()
          .from(exercises)
          .where(and(eq(exercises.userId, userId), gte(exercises.occurredAt, startAt), lt(exercises.occurredAt, endAt)))
          .orderBy(desc(exercises.occurredAt));
        return deduplicateExternalExercises(rows.map(mapExerciseRow));
      } catch (error) {
        deps.onWarning("Exercise range read skipped", error);
        return null;
      }
    },

    async insert(exercise) {
      const db = await deps.getDb();
      if (!db) return;

      const externalProvider = exercise.externalProvider?.trim().toLowerCase() || null;
      const externalId = normalizeExternalId(exercise.externalId);
      const values = {
        userId: exercise.userId,
        activityType: exercise.activityType,
        durationMinutes: exercise.durationMinutes,
        caloriesBurned: exercise.caloriesBurned,
        notes: exercise.notes ?? null,
        occurredAt: new Date(exercise.occurredAt),
        externalProvider,
        externalId,
      };

      try {
        if (externalProvider && externalId) {
          const legacyRows = await db
            .select()
            .from(exercises)
            .where(and(eq(exercises.userId, exercise.userId), like(exercises.notes, `%${externalProvider}:${escapeLike(externalId)}%`)))
            .limit(1);

          if (legacyRows[0] && (!legacyRows[0].externalProvider || !legacyRows[0].externalId)) {
            await db
              .update(exercises)
              .set(values)
              .where(and(eq(exercises.userId, exercise.userId), eq(exercises.id, legacyRows[0].id)));
            applyPersistedExercise(exercise, mapExerciseRow({ ...legacyRows[0], ...values, updatedAt: new Date() }), "updated");
            return;
          }

          const insertResult = await db
            .insert(exercises)
            .values(values)
            .onDuplicateKeyUpdate({
              set: {
                activityType: exercise.activityType,
                durationMinutes: exercise.durationMinutes,
                caloriesBurned: exercise.caloriesBurned,
                notes: exercise.notes ?? null,
                occurredAt: new Date(exercise.occurredAt),
              },
            });

          const rows = await db
            .select()
            .from(exercises)
            .where(and(eq(exercises.userId, exercise.userId), eq(exercises.externalProvider, externalProvider), eq(exercises.externalId, externalId)))
            .limit(1);

          if (rows[0]) {
            applyPersistedExercise(exercise, mapExerciseRow(rows[0]), getMysqlAffectedRows(insertResult) === 1 ? "created" : "updated");
          }
          return;
        }

        const insertResult = await db.insert(exercises).values(values);
        const insertedId = Number((insertResult as any)?.[0]?.insertId ?? (insertResult as any)?.insertId ?? 0);
        if (insertedId) {
          exercise.id = insertedId;
        }
      } catch (error) {
        deps.onWarning("Exercise persistence skipped", error);
      }
    },

    async update(exercise) {
      const db = await deps.getDb();
      if (!db) return;

      try {
        await db
          .update(exercises)
          .set({
            activityType: exercise.activityType,
            durationMinutes: exercise.durationMinutes,
            caloriesBurned: exercise.caloriesBurned,
            notes: exercise.notes ?? null,
            occurredAt: new Date(exercise.occurredAt),
            externalProvider: exercise.externalProvider?.trim().toLowerCase() || null,
            externalId: normalizeExternalId(exercise.externalId),
          })
          .where(and(eq(exercises.userId, exercise.userId), eq(exercises.id, exercise.id)));
      } catch (error) {
        deps.onWarning("Exercise update skipped", error);
      }
    },

    async delete(userId, exerciseId) {
      const db = await deps.getDb();
      if (!db) return;

      try {
        await db.delete(exercises).where(and(eq(exercises.userId, userId), eq(exercises.id, exerciseId)));
      } catch (error) {
        deps.onWarning("Exercise deletion skipped", error);
      }
    },
  };
}