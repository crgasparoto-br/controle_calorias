import crypto from "node:crypto";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { userPreferences } from "../../drizzle/schema";
import {
  professionalComments,
  professionalGoalSuggestions,
  professionalHistoryEvents,
  professionalMealSuggestions,
  type ProfessionalCommentRecord,
  type ProfessionalGoalSuggestionRecord,
  type ProfessionalHistoryEventRecord,
  type ProfessionalMealSuggestionRecord,
} from "../../drizzle/professional-schema";
import { goalSchema } from "../modules/goals/schemas";
import type {
  ProfessionalGoalSuggestionInput,
  ProfessionalGoalSuggestionStatus,
  ProfessionalMealSuggestionInput,
  ProfessionalMealSuggestionStatus,
} from "../modules/professionals/schemas";

export const PATIENT_GOAL_SUGGESTIONS_PREFERENCE_KEY =
  "patient_professional_goal_suggestions_v1";
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 200;
const DECISION_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

type DbProvider = () => Promise<any | null>;
type PersistenceWarningHandler = (scope: string, error: unknown) => void;

async function getProfessionalPersistenceDb(getDb: DbProvider) {
  const db = await getDb();
  if (!db && process.env.NODE_ENV === "production") {
    throw new Error(
      "A persistência da Área Profissional está temporariamente indisponível."
    );
  }
  return db;
}

export type ProfessionalComment = {
  id: string;
  professionalUserId: number;
  patientUserId: number;
  comment: string;
  createdAt: number;
};

export type ProfessionalGoalSuggestion = {
  id: string;
  professionalUserId: number;
  patientUserId: number;
  rationale: string;
  status: ProfessionalGoalSuggestionStatus;
  goal: ProfessionalGoalSuggestionInput["goal"];
  version: number;
  createdAt: number;
  sentAt: number | null;
  respondedAt: number | null;
  updatedAt: number;
};

export type ProfessionalMealSuggestion = {
  id: string;
  professionalUserId: number;
  patientUserId: number;
  mealLabel: string;
  title: string;
  description: string;
  rationale: string;
  notes?: string;
  status: ProfessionalMealSuggestionStatus;
  version: number;
  createdAt: number;
  sentAt: number | null;
  respondedAt: number | null;
  updatedAt: number;
};

export type ProfessionalHistoryEventType =
  | "profile_upserted"
  | "access_requested"
  | "access_approved"
  | "access_rejected"
  | "access_revoked"
  | "access_authorization_whatsapp_sent"
  | "access_authorization_whatsapp_failed"
  | "access_reconciled"
  | "comment_created"
  | "goal_suggested"
  | "goal_suggestion_accepted"
  | "goal_suggestion_refused"
  | "meal_suggested"
  | "patient_question_answered"
  | "tracking_transitioned"
  | (string & {});

export type ProfessionalHistoryEvent = {
  id: string;
  actorUserId: number | null;
  patientUserId: number | null;
  professionalUserId: number;
  eventType: ProfessionalHistoryEventType;
  entityType: string | null;
  entityId: string | null;
  createdAt: number;
};

export type ProfessionalListCursor = {
  createdAt: number;
  id: string;
};

export type CreateProfessionalCommentInput = Omit<
  ProfessionalComment,
  "createdAt"
> & { createdAt?: number };

export type CreateProfessionalGoalSuggestionInput = Omit<
  ProfessionalGoalSuggestion,
  "version" | "createdAt" | "sentAt" | "respondedAt" | "updatedAt"
> & {
  createdAt?: number;
  sentAt?: number | null;
  respondedAt?: number | null;
};

export type CreateProfessionalMealSuggestionInput = Omit<
  ProfessionalMealSuggestion,
  "version" | "createdAt" | "sentAt" | "respondedAt" | "updatedAt"
> & {
  createdAt?: number;
  sentAt?: number | null;
  respondedAt?: number | null;
};

export type AppendProfessionalHistoryInput = {
  id?: string;
  actorUserId: number | null;
  professionalUserId: number;
  patientUserId: number | null;
  eventType: ProfessionalHistoryEventType;
  entityType?: string | null;
  entityId?: string | null;
  occurredAt?: number;
};

export type GoalSuggestionDecisionReservation =
  | { result: "not_found" }
  | { result: "conflict" }
  | {
      result: "already_completed";
      suggestion: ProfessionalGoalSuggestion;
    }
  | {
      result: "reserved";
      lockId: string;
      suggestion: ProfessionalGoalSuggestion;
    };

export type ProfessionalContentRepository = {
  createComment(
    input: CreateProfessionalCommentInput
  ): Promise<ProfessionalComment>;
  listComments(
    professionalUserId: number,
    patientUserId: number,
    options?: { limit?: number; before?: ProfessionalListCursor }
  ): Promise<ProfessionalComment[]>;
  createGoalSuggestion(
    input: CreateProfessionalGoalSuggestionInput,
    options?: { recordHistory?: boolean }
  ): Promise<ProfessionalGoalSuggestion>;
  listGoalSuggestions(
    professionalUserId: number,
    patientUserId: number,
    options?: { limit?: number; before?: ProfessionalListCursor }
  ): Promise<ProfessionalGoalSuggestion[]>;
  listGoalSuggestionsByPatient(
    patientUserId: number,
    options?: { limit?: number; before?: ProfessionalListCursor }
  ): Promise<ProfessionalGoalSuggestion[]>;
  getGoalSuggestionForPatient(
    patientUserId: number,
    suggestionId: string
  ): Promise<ProfessionalGoalSuggestion | null>;
  transitionGoalSuggestion(
    patientUserId: number,
    suggestionId: string,
    nextStatus: "accepted" | "refused",
    occurredAt?: number
  ): Promise<ProfessionalGoalSuggestion>;
  reserveGoalSuggestionDecision(
    patientUserId: number,
    suggestionId: string,
    occurredAt?: number
  ): Promise<GoalSuggestionDecisionReservation>;
  completeGoalSuggestionDecision(input: {
    patientUserId: number;
    suggestionId: string;
    lockId: string;
    nextStatus: "accepted" | "refused";
    occurredAt?: number;
  }): Promise<ProfessionalGoalSuggestion>;
  releaseGoalSuggestionDecision(input: {
    patientUserId: number;
    suggestionId: string;
    lockId: string;
  }): Promise<void>;
  createMealSuggestion(
    input: CreateProfessionalMealSuggestionInput
  ): Promise<ProfessionalMealSuggestion>;
  listMealSuggestions(
    professionalUserId: number,
    patientUserId: number,
    options?: { limit?: number; before?: ProfessionalListCursor }
  ): Promise<ProfessionalMealSuggestion[]>;
  appendHistory(
    input: AppendProfessionalHistoryInput
  ): Promise<ProfessionalHistoryEvent>;
  listHistory(
    userId: number,
    options?: { limit?: number; before?: ProfessionalListCursor }
  ): Promise<ProfessionalHistoryEvent[]>;
  migrateAllLegacyGoalSuggestions(): Promise<{
    scannedPreferences: number;
    migrated: number;
    invalid: number;
  }>;
};

const fallbackComments = new Map<string, ProfessionalComment>();
const fallbackGoalSuggestions = new Map<string, ProfessionalGoalSuggestion>();
const fallbackMealSuggestions = new Map<string, ProfessionalMealSuggestion>();
const fallbackHistory = new Map<string, ProfessionalHistoryEvent>();
const fallbackGoalDecisionLocks = new Map<
  string,
  { lockId: string; lockedAt: number }
>();

function clampLimit(limit?: number) {
  if (!Number.isInteger(limit)) return DEFAULT_LIST_LIMIT;
  return Math.min(Math.max(limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
}

function compareNewest(
  left: { createdAt: number; id: string },
  right: { createdAt: number; id: string }
) {
  return right.createdAt - left.createdAt || right.id.localeCompare(left.id);
}

function isBeforeCursor(
  item: { createdAt: number; id: string },
  before?: ProfessionalListCursor
) {
  if (!before) return true;
  return (
    item.createdAt < before.createdAt ||
    (item.createdAt === before.createdAt && item.id < before.id)
  );
}

function cursorWhere(
  table: { createdAt: any; id: any },
  before?: ProfessionalListCursor
) {
  if (!before) return undefined;
  const createdAt = new Date(before.createdAt);
  return or(
    lt(table.createdAt, createdAt),
    and(eq(table.createdAt, createdAt), lt(table.id, before.id))
  );
}

function getMysqlAffectedRows(result: unknown) {
  const candidate = Array.isArray(result) ? result[0] : result;
  const affectedRows = Number(
    (candidate as { affectedRows?: number })?.affectedRows ?? 0
  );
  return Number.isFinite(affectedRows) ? affectedRows : 0;
}

function toComment(row: ProfessionalCommentRecord): ProfessionalComment {
  return { ...row, createdAt: row.createdAt.getTime() };
}

function parseGoal(value: unknown) {
  const parsed = goalSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Sugestão de meta persistida inválida.");
  }
  return parsed.data;
}

function toGoalSuggestion(
  row: ProfessionalGoalSuggestionRecord
): ProfessionalGoalSuggestion {
  return {
    id: row.id,
    professionalUserId: row.professionalUserId,
    patientUserId: row.patientUserId,
    rationale: row.rationale,
    status: row.status,
    goal: parseGoal(row.goal),
    version: row.version,
    createdAt: row.createdAt.getTime(),
    sentAt: row.sentAt?.getTime() ?? null,
    respondedAt: row.respondedAt?.getTime() ?? null,
    updatedAt: row.updatedAt.getTime(),
  };
}

function toMealSuggestion(
  row: ProfessionalMealSuggestionRecord
): ProfessionalMealSuggestion {
  return {
    id: row.id,
    professionalUserId: row.professionalUserId,
    patientUserId: row.patientUserId,
    mealLabel: row.mealLabel,
    title: row.title,
    description: row.description,
    rationale: row.rationale,
    notes: row.notes ?? undefined,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt.getTime(),
    sentAt: row.sentAt?.getTime() ?? null,
    respondedAt: row.respondedAt?.getTime() ?? null,
    updatedAt: row.updatedAt.getTime(),
  };
}

function toHistory(
  row: ProfessionalHistoryEventRecord
): ProfessionalHistoryEvent {
  return {
    id: row.id,
    actorUserId: row.actorUserId,
    professionalUserId: row.professionalUserId,
    patientUserId: row.patientUserId,
    eventType: row.eventType,
    entityType: row.entityType,
    entityId: row.entityId,
    createdAt: row.occurredAt.getTime(),
  };
}

function deterministicEventId(prefix: string, entityId: string) {
  const digest = crypto
    .createHash("sha256")
    .update(`${prefix}:${entityId}`)
    .digest("hex")
    .slice(0, 48);
  return `evt-${digest}`;
}

function historyValues(input: AppendProfessionalHistoryInput) {
  return {
    id: input.id ?? crypto.randomUUID(),
    actorUserId: input.actorUserId,
    professionalUserId: input.professionalUserId,
    patientUserId: input.patientUserId,
    eventType: input.eventType,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    occurredAt: new Date(input.occurredAt ?? Date.now()),
  };
}

function fallbackAppendHistory(
  input: AppendProfessionalHistoryInput
): ProfessionalHistoryEvent {
  const values = historyValues(input);
  const existing = fallbackHistory.get(values.id);
  if (existing) return existing;
  const event: ProfessionalHistoryEvent = {
    id: values.id,
    actorUserId: values.actorUserId,
    professionalUserId: values.professionalUserId,
    patientUserId: values.patientUserId,
    eventType: values.eventType,
    entityType: values.entityType,
    entityId: values.entityId,
    createdAt: values.occurredAt.getTime(),
  };
  fallbackHistory.set(event.id, event);
  return event;
}

export function normalizeLegacyGoalSuggestion(
  patientUserId: number,
  value: unknown
): CreateProfessionalGoalSuggestionInput | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const status = candidate.status;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.professionalUserId !== "number" ||
    candidate.patientUserId !== patientUserId ||
    typeof candidate.rationale !== "string" ||
    typeof candidate.createdAt !== "number" ||
    !["draft", "sent", "accepted", "refused", "cancelled"].includes(
      String(status)
    )
  ) {
    return null;
  }
  const parsedGoal = goalSchema.safeParse(candidate.goal);
  if (!parsedGoal.success) return null;
  return {
    id: candidate.id,
    professionalUserId: candidate.professionalUserId,
    patientUserId,
    rationale: candidate.rationale,
    status: status as ProfessionalGoalSuggestionStatus,
    goal: parsedGoal.data,
    createdAt: candidate.createdAt,
    sentAt: typeof candidate.sentAt === "number" ? candidate.sentAt : null,
    respondedAt:
      typeof candidate.respondedAt === "number" ? candidate.respondedAt : null,
  };
}

export function createDrizzleProfessionalContentRepository(deps: {
  getDb: DbProvider;
  onWarning: PersistenceWarningHandler;
}): ProfessionalContentRepository {
  async function insertHistory(tx: any, input: AppendProfessionalHistoryInput) {
    const values = historyValues(input);
    await tx
      .insert(professionalHistoryEvents)
      .values(values)
      .onDuplicateKeyUpdate({ set: { id: values.id } });
    const [saved] = await tx
      .select()
      .from(professionalHistoryEvents)
      .where(eq(professionalHistoryEvents.id, values.id))
      .limit(1);
    if (!saved)
      throw new Error("Não foi possível registrar o histórico profissional.");
    return toHistory(saved);
  }

  async function appendHistory(input: AppendProfessionalHistoryInput) {
    const db = await getProfessionalPersistenceDb(deps.getDb);
    if (!db) return fallbackAppendHistory(input);
    return insertHistory(db, input);
  }

  async function createComment(input: CreateProfessionalCommentInput) {
    const createdAt = input.createdAt ?? Date.now();
    const comment: ProfessionalComment = { ...input, createdAt };
    const db = await getProfessionalPersistenceDb(deps.getDb);
    if (!db) {
      const existing = fallbackComments.get(input.id);
      if (existing) return existing;
      fallbackComments.set(input.id, comment);
      fallbackAppendHistory({
        id: deterministicEventId("comment_created", input.id),
        actorUserId: input.professionalUserId,
        professionalUserId: input.professionalUserId,
        patientUserId: input.patientUserId,
        eventType: "comment_created",
        entityType: "comment",
        entityId: input.id,
        occurredAt: createdAt,
      });
      return comment;
    }

    await db.transaction(async (tx: any) => {
      await tx
        .insert(professionalComments)
        .values({ ...input, createdAt: new Date(createdAt) })
        .onDuplicateKeyUpdate({ set: { id: input.id } });
      await insertHistory(tx, {
        id: deterministicEventId("comment_created", input.id),
        actorUserId: input.professionalUserId,
        professionalUserId: input.professionalUserId,
        patientUserId: input.patientUserId,
        eventType: "comment_created",
        entityType: "comment",
        entityId: input.id,
        occurredAt: createdAt,
      });
    });
    const [saved] = await db
      .select()
      .from(professionalComments)
      .where(eq(professionalComments.id, input.id))
      .limit(1);
    if (!saved)
      throw new Error("Não foi possível persistir o comentário profissional.");
    return toComment(saved);
  }

  async function listComments(
    professionalUserId: number,
    patientUserId: number,
    options: { limit?: number; before?: ProfessionalListCursor } = {}
  ) {
    const limit = clampLimit(options.limit);
    const db = await getProfessionalPersistenceDb(deps.getDb);
    if (!db) {
      return [...fallbackComments.values()]
        .filter(
          item =>
            item.professionalUserId === professionalUserId &&
            item.patientUserId === patientUserId &&
            isBeforeCursor(item, options.before)
        )
        .sort(compareNewest)
        .slice(0, limit);
    }
    const rows = await db
      .select()
      .from(professionalComments)
      .where(
        and(
          eq(professionalComments.professionalUserId, professionalUserId),
          eq(professionalComments.patientUserId, patientUserId),
          cursorWhere(professionalComments, options.before)
        )
      )
      .orderBy(
        desc(professionalComments.createdAt),
        desc(professionalComments.id)
      )
      .limit(limit);
    return rows.map(toComment);
  }

  async function createGoalSuggestion(
    input: CreateProfessionalGoalSuggestionInput,
    options: { recordHistory?: boolean } = {}
  ) {
    const createdAt = input.createdAt ?? Date.now();
    const sentAt = input.sentAt ?? (input.status === "sent" ? createdAt : null);
    const respondedAt =
      input.respondedAt ??
      (["accepted", "refused", "cancelled"].includes(input.status)
        ? createdAt
        : null);
    const suggestion: ProfessionalGoalSuggestion = {
      ...input,
      version: 1,
      createdAt,
      sentAt,
      respondedAt,
      updatedAt: createdAt,
    };
    const db = await getProfessionalPersistenceDb(deps.getDb);
    if (!db) {
      const existing = fallbackGoalSuggestions.get(input.id);
      if (existing) return existing;
      fallbackGoalSuggestions.set(input.id, suggestion);
      if (options.recordHistory !== false) {
        fallbackAppendHistory({
          id: deterministicEventId("goal_suggested", input.id),
          actorUserId: input.professionalUserId,
          professionalUserId: input.professionalUserId,
          patientUserId: input.patientUserId,
          eventType: "goal_suggested",
          entityType: "goal_suggestion",
          entityId: input.id,
          occurredAt: createdAt,
        });
      }
      return suggestion;
    }

    await db.transaction(async (tx: any) => {
      await tx
        .insert(professionalGoalSuggestions)
        .values({
          id: input.id,
          professionalUserId: input.professionalUserId,
          patientUserId: input.patientUserId,
          rationale: input.rationale,
          status: input.status,
          goal: input.goal,
          version: 1,
          createdAt: new Date(createdAt),
          sentAt: sentAt ? new Date(sentAt) : null,
          respondedAt: respondedAt ? new Date(respondedAt) : null,
          updatedAt: new Date(createdAt),
        })
        .onDuplicateKeyUpdate({ set: { id: input.id } });
      if (options.recordHistory !== false) {
        await insertHistory(tx, {
          id: deterministicEventId("goal_suggested", input.id),
          actorUserId: input.professionalUserId,
          professionalUserId: input.professionalUserId,
          patientUserId: input.patientUserId,
          eventType: "goal_suggested",
          entityType: "goal_suggestion",
          entityId: input.id,
          occurredAt: createdAt,
        });
      }
    });
    const [saved] = await db
      .select()
      .from(professionalGoalSuggestions)
      .where(eq(professionalGoalSuggestions.id, input.id))
      .limit(1);
    if (!saved)
      throw new Error("Não foi possível persistir a sugestão de meta.");
    const result = toGoalSuggestion(saved);
    return result;
  }

  async function readGoalSuggestionsByPatient(
    db: any,
    patientUserId: number,
    options: { limit?: number; before?: ProfessionalListCursor } = {}
  ) {
    const rows = await db
      .select()
      .from(professionalGoalSuggestions)
      .where(
        and(
          eq(professionalGoalSuggestions.patientUserId, patientUserId),
          cursorWhere(professionalGoalSuggestions, options.before)
        )
      )
      .orderBy(
        desc(professionalGoalSuggestions.createdAt),
        desc(professionalGoalSuggestions.id)
      )
      .limit(clampLimit(options.limit));
    return rows.map(toGoalSuggestion);
  }

  async function migrateAllLegacyGoalSuggestions() {
    const db = await getProfessionalPersistenceDb(deps.getDb);
    if (!db) return { scannedPreferences: 0, migrated: 0, invalid: 0 };

    const preferences = await db
      .select()
      .from(userPreferences)
      .where(
        eq(
          userPreferences.preferenceKey,
          PATIENT_GOAL_SUGGESTIONS_PREFERENCE_KEY
        )
      );
    let migrated = 0;
    let invalid = 0;

    for (const preference of preferences) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(preference.preferenceValue);
      } catch {
        deps.onWarning(
          "professional.content.legacy_goal_suggestions_invalid",
          new Error("invalid_json")
        );
        invalid += 1;
        continue;
      }
      if (!Array.isArray(parsed)) {
        deps.onWarning(
          "professional.content.legacy_goal_suggestions_invalid",
          new Error("invalid_shape")
        );
        invalid += 1;
        continue;
      }

      for (const item of parsed) {
        const normalized = normalizeLegacyGoalSuggestion(
          preference.userId,
          item
        );
        if (!normalized) {
          invalid += 1;
          continue;
        }
        const legacyUpdatedAt = Math.max(
          normalized.createdAt ?? 0,
          normalized.sentAt ?? 0,
          normalized.respondedAt ?? 0
        );
        const [existing] = await db
          .select()
          .from(professionalGoalSuggestions)
          .where(eq(professionalGoalSuggestions.id, normalized.id))
          .limit(1);
        const existingIsTerminal =
          existing &&
          ["accepted", "refused", "cancelled"].includes(existing.status);
        if (
          existing &&
          (existing.updatedAt.getTime() >= legacyUpdatedAt ||
            (existingIsTerminal && existing.status !== normalized.status))
        ) {
          continue;
        }
        if (existing) {
          await db
            .update(professionalGoalSuggestions)
            .set({
              professionalUserId: normalized.professionalUserId,
              patientUserId: normalized.patientUserId,
              rationale: normalized.rationale,
              status: normalized.status,
              goal: normalized.goal,
              createdAt: new Date(normalized.createdAt ?? legacyUpdatedAt),
              sentAt: normalized.sentAt ? new Date(normalized.sentAt) : null,
              respondedAt: normalized.respondedAt
                ? new Date(normalized.respondedAt)
                : null,
              version: sql`${professionalGoalSuggestions.version} + 1`,
              updatedAt: new Date(legacyUpdatedAt),
            })
            .where(eq(professionalGoalSuggestions.id, normalized.id));
        } else {
          await db.insert(professionalGoalSuggestions).values({
            id: normalized.id,
            professionalUserId: normalized.professionalUserId,
            patientUserId: normalized.patientUserId,
            rationale: normalized.rationale,
            status: normalized.status,
            goal: normalized.goal,
            version: 1,
            decisionLockId: null,
            decisionLockedAt: null,
            createdAt: new Date(normalized.createdAt ?? legacyUpdatedAt),
            sentAt: normalized.sentAt ? new Date(normalized.sentAt) : null,
            respondedAt: normalized.respondedAt
              ? new Date(normalized.respondedAt)
              : null,
            updatedAt: new Date(legacyUpdatedAt),
          });
        }
        migrated += 1;
      }
    }

    if (invalid > 0) {
      deps.onWarning(
        "professional.content.legacy_goal_suggestions_invalid",
        new Error("invalid_items")
      );
    }
    return { scannedPreferences: preferences.length, migrated, invalid };
  }

  async function listGoalSuggestions(
    professionalUserId: number,
    patientUserId: number,
    options: { limit?: number; before?: ProfessionalListCursor } = {}
  ) {
    const db = await getProfessionalPersistenceDb(deps.getDb);
    if (!db) {
      return [...fallbackGoalSuggestions.values()]
        .filter(
          item =>
            item.professionalUserId === professionalUserId &&
            item.patientUserId === patientUserId &&
            isBeforeCursor(item, options.before)
        )
        .sort(compareNewest)
        .slice(0, clampLimit(options.limit));
    }
    const rows = await db
      .select()
      .from(professionalGoalSuggestions)
      .where(
        and(
          eq(
            professionalGoalSuggestions.professionalUserId,
            professionalUserId
          ),
          eq(professionalGoalSuggestions.patientUserId, patientUserId),
          cursorWhere(professionalGoalSuggestions, options.before)
        )
      )
      .orderBy(
        desc(professionalGoalSuggestions.createdAt),
        desc(professionalGoalSuggestions.id)
      )
      .limit(clampLimit(options.limit));
    return rows.map(toGoalSuggestion);
  }

  async function listGoalSuggestionsByPatient(
    patientUserId: number,
    options: { limit?: number; before?: ProfessionalListCursor } = {}
  ) {
    const db = await getProfessionalPersistenceDb(deps.getDb);
    if (!db) {
      return [...fallbackGoalSuggestions.values()]
        .filter(
          item =>
            item.patientUserId === patientUserId &&
            isBeforeCursor(item, options.before)
        )
        .sort(compareNewest)
        .slice(0, clampLimit(options.limit));
    }
    return readGoalSuggestionsByPatient(db, patientUserId, options);
  }

  async function getGoalSuggestionForPatient(
    patientUserId: number,
    suggestionId: string
  ) {
    const db = await getProfessionalPersistenceDb(deps.getDb);
    if (!db) {
      const suggestion = fallbackGoalSuggestions.get(suggestionId);
      return suggestion?.patientUserId === patientUserId ? suggestion : null;
    }
    const [row] = await db
      .select()
      .from(professionalGoalSuggestions)
      .where(
        and(
          eq(professionalGoalSuggestions.id, suggestionId),
          eq(professionalGoalSuggestions.patientUserId, patientUserId)
        )
      )
      .limit(1);
    return row ? toGoalSuggestion(row) : null;
  }

  async function reserveGoalSuggestionDecision(
    patientUserId: number,
    suggestionId: string,
    occurredAt = Date.now()
  ): Promise<GoalSuggestionDecisionReservation> {
    const current = await getGoalSuggestionForPatient(
      patientUserId,
      suggestionId
    );
    if (!current) return { result: "not_found" };
    if (current.status !== "sent") {
      return { result: "already_completed", suggestion: current };
    }

    const lockId = crypto.randomUUID();
    const db = await getProfessionalPersistenceDb(deps.getDb);
    if (!db) {
      const currentLock = fallbackGoalDecisionLocks.get(suggestionId);
      if (
        currentLock &&
        currentLock.lockedAt >= occurredAt - DECISION_LOCK_TIMEOUT_MS
      ) {
        return { result: "conflict" };
      }
      fallbackGoalDecisionLocks.set(suggestionId, {
        lockId,
        lockedAt: occurredAt,
      });
      return { result: "reserved", lockId, suggestion: current };
    }

    const staleBefore = new Date(occurredAt - DECISION_LOCK_TIMEOUT_MS);
    const result = await db
      .update(professionalGoalSuggestions)
      .set({
        decisionLockId: lockId,
        decisionLockedAt: new Date(occurredAt),
        version: sql`${professionalGoalSuggestions.version} + 1`,
        updatedAt: new Date(occurredAt),
      })
      .where(
        and(
          eq(professionalGoalSuggestions.id, suggestionId),
          eq(professionalGoalSuggestions.patientUserId, patientUserId),
          eq(professionalGoalSuggestions.status, "sent"),
          or(
            isNull(professionalGoalSuggestions.decisionLockId),
            isNull(professionalGoalSuggestions.decisionLockedAt),
            lt(professionalGoalSuggestions.decisionLockedAt, staleBefore)
          )
        )
      );
    if (getMysqlAffectedRows(result) > 0) {
      return { result: "reserved", lockId, suggestion: current };
    }

    const latest = await getGoalSuggestionForPatient(
      patientUserId,
      suggestionId
    );
    if (!latest) return { result: "not_found" };
    if (latest.status !== "sent") {
      return { result: "already_completed", suggestion: latest };
    }
    return { result: "conflict" };
  }

  async function completeGoalSuggestionDecision(input: {
    patientUserId: number;
    suggestionId: string;
    lockId: string;
    nextStatus: "accepted" | "refused";
    occurredAt?: number;
  }) {
    const occurredAt = input.occurredAt ?? Date.now();
    const db = await getProfessionalPersistenceDb(deps.getDb);
    if (!db) {
      const current = fallbackGoalSuggestions.get(input.suggestionId);
      const lock = fallbackGoalDecisionLocks.get(input.suggestionId);
      if (!current || current.patientUserId !== input.patientUserId) {
        throw new Error("Sugestão de meta não encontrada.");
      }
      if (current.status === input.nextStatus) return current;
      if (current.status !== "sent" || lock?.lockId !== input.lockId) {
        throw new Error("Essa sugestão foi alterada por outra operação.");
      }
      const updated: ProfessionalGoalSuggestion = {
        ...current,
        status: input.nextStatus,
        version: current.version + 1,
        respondedAt: occurredAt,
        updatedAt: occurredAt,
      };
      fallbackGoalSuggestions.set(input.suggestionId, updated);
      fallbackGoalDecisionLocks.delete(input.suggestionId);
      fallbackAppendHistory({
        id: deterministicEventId(
          `goal_suggestion_${input.nextStatus}`,
          input.suggestionId
        ),
        actorUserId: input.patientUserId,
        professionalUserId: updated.professionalUserId,
        patientUserId: input.patientUserId,
        eventType:
          input.nextStatus === "accepted"
            ? "goal_suggestion_accepted"
            : "goal_suggestion_refused",
        entityType: "goal_suggestion",
        entityId: input.suggestionId,
        occurredAt,
      });
      return updated;
    }

    await db.transaction(async (tx: any) => {
      const result = await tx
        .update(professionalGoalSuggestions)
        .set({
          status: input.nextStatus,
          decisionLockId: null,
          decisionLockedAt: null,
          version: sql`${professionalGoalSuggestions.version} + 1`,
          respondedAt: new Date(occurredAt),
          updatedAt: new Date(occurredAt),
        })
        .where(
          and(
            eq(professionalGoalSuggestions.id, input.suggestionId),
            eq(professionalGoalSuggestions.patientUserId, input.patientUserId),
            eq(professionalGoalSuggestions.status, "sent"),
            eq(professionalGoalSuggestions.decisionLockId, input.lockId)
          )
        );
      if (getMysqlAffectedRows(result) === 0) {
        const [latest] = await tx
          .select()
          .from(professionalGoalSuggestions)
          .where(
            and(
              eq(professionalGoalSuggestions.id, input.suggestionId),
              eq(professionalGoalSuggestions.patientUserId, input.patientUserId)
            )
          )
          .limit(1);
        if (latest?.status === input.nextStatus) return;
        throw new Error("Essa sugestão foi alterada por outra operação.");
      }
      const [updated] = await tx
        .select()
        .from(professionalGoalSuggestions)
        .where(eq(professionalGoalSuggestions.id, input.suggestionId))
        .limit(1);
      if (!updated) throw new Error("Sugestão de meta não encontrada.");
      await insertHistory(tx, {
        id: deterministicEventId(
          `goal_suggestion_${input.nextStatus}`,
          input.suggestionId
        ),
        actorUserId: input.patientUserId,
        professionalUserId: updated.professionalUserId,
        patientUserId: input.patientUserId,
        eventType:
          input.nextStatus === "accepted"
            ? "goal_suggestion_accepted"
            : "goal_suggestion_refused",
        entityType: "goal_suggestion",
        entityId: input.suggestionId,
        occurredAt,
      });
    });

    const updated = await getGoalSuggestionForPatient(
      input.patientUserId,
      input.suggestionId
    );
    if (!updated) throw new Error("Sugestão de meta não encontrada.");
    return updated;
  }

  async function releaseGoalSuggestionDecision(input: {
    patientUserId: number;
    suggestionId: string;
    lockId: string;
  }) {
    const db = await getProfessionalPersistenceDb(deps.getDb);
    if (!db) {
      if (
        fallbackGoalDecisionLocks.get(input.suggestionId)?.lockId ===
        input.lockId
      ) {
        fallbackGoalDecisionLocks.delete(input.suggestionId);
      }
      return;
    }
    await db
      .update(professionalGoalSuggestions)
      .set({ decisionLockId: null, decisionLockedAt: null })
      .where(
        and(
          eq(professionalGoalSuggestions.id, input.suggestionId),
          eq(professionalGoalSuggestions.patientUserId, input.patientUserId),
          eq(professionalGoalSuggestions.decisionLockId, input.lockId)
        )
      );
  }

  async function transitionGoalSuggestion(
    patientUserId: number,
    suggestionId: string,
    nextStatus: "accepted" | "refused",
    occurredAt = Date.now()
  ) {
    const reservation = await reserveGoalSuggestionDecision(
      patientUserId,
      suggestionId,
      occurredAt
    );
    if (reservation.result === "not_found") {
      throw new Error("Sugestão de meta não encontrada.");
    }
    if (reservation.result === "already_completed") {
      if (reservation.suggestion.status === nextStatus) {
        return reservation.suggestion;
      }
      throw new Error("Essa sugestão já foi respondida.");
    }
    if (reservation.result === "conflict") {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 25));
        const latest = await getGoalSuggestionForPatient(
          patientUserId,
          suggestionId
        );
        if (!latest) throw new Error("Sugestão de meta não encontrada.");
        if (latest.status === nextStatus) return latest;
        if (latest.status !== "sent") {
          throw new Error("Essa sugestão já foi respondida.");
        }
      }
      throw new Error(
        "Essa sugestão está sendo processada por outra operação. Tente novamente."
      );
    }
    return completeGoalSuggestionDecision({
      patientUserId,
      suggestionId,
      lockId: reservation.lockId,
      nextStatus,
      occurredAt,
    });
  }

  async function createMealSuggestion(
    input: CreateProfessionalMealSuggestionInput
  ) {
    const createdAt = input.createdAt ?? Date.now();
    const sentAt = input.sentAt ?? (input.status === "sent" ? createdAt : null);
    const respondedAt =
      input.respondedAt ??
      (["accepted", "refused", "cancelled"].includes(input.status)
        ? createdAt
        : null);
    const suggestion: ProfessionalMealSuggestion = {
      ...input,
      version: 1,
      createdAt,
      sentAt,
      respondedAt,
      updatedAt: createdAt,
    };
    const db = await getProfessionalPersistenceDb(deps.getDb);
    if (!db) {
      const existing = fallbackMealSuggestions.get(input.id);
      if (existing) return existing;
      fallbackMealSuggestions.set(input.id, suggestion);
      fallbackAppendHistory({
        id: deterministicEventId("meal_suggested", input.id),
        actorUserId: input.professionalUserId,
        professionalUserId: input.professionalUserId,
        patientUserId: input.patientUserId,
        eventType: "meal_suggested",
        entityType: "meal_suggestion",
        entityId: input.id,
        occurredAt: createdAt,
      });
      return suggestion;
    }
    await db.transaction(async (tx: any) => {
      await tx
        .insert(professionalMealSuggestions)
        .values({
          id: input.id,
          professionalUserId: input.professionalUserId,
          patientUserId: input.patientUserId,
          mealLabel: input.mealLabel,
          title: input.title,
          description: input.description,
          rationale: input.rationale,
          notes: input.notes ?? null,
          status: input.status,
          version: 1,
          createdAt: new Date(createdAt),
          sentAt: sentAt ? new Date(sentAt) : null,
          respondedAt: respondedAt ? new Date(respondedAt) : null,
          updatedAt: new Date(createdAt),
        })
        .onDuplicateKeyUpdate({ set: { id: input.id } });
      await insertHistory(tx, {
        id: deterministicEventId("meal_suggested", input.id),
        actorUserId: input.professionalUserId,
        professionalUserId: input.professionalUserId,
        patientUserId: input.patientUserId,
        eventType: "meal_suggested",
        entityType: "meal_suggestion",
        entityId: input.id,
        occurredAt: createdAt,
      });
    });
    const [saved] = await db
      .select()
      .from(professionalMealSuggestions)
      .where(eq(professionalMealSuggestions.id, input.id))
      .limit(1);
    if (!saved)
      throw new Error("Não foi possível persistir a sugestão de refeição.");
    return toMealSuggestion(saved);
  }

  async function listMealSuggestions(
    professionalUserId: number,
    patientUserId: number,
    options: { limit?: number; before?: ProfessionalListCursor } = {}
  ) {
    const limit = clampLimit(options.limit);
    const db = await getProfessionalPersistenceDb(deps.getDb);
    if (!db) {
      return [...fallbackMealSuggestions.values()]
        .filter(
          item =>
            item.professionalUserId === professionalUserId &&
            item.patientUserId === patientUserId &&
            isBeforeCursor(item, options.before)
        )
        .sort(compareNewest)
        .slice(0, limit);
    }
    const rows = await db
      .select()
      .from(professionalMealSuggestions)
      .where(
        and(
          eq(
            professionalMealSuggestions.professionalUserId,
            professionalUserId
          ),
          eq(professionalMealSuggestions.patientUserId, patientUserId),
          cursorWhere(professionalMealSuggestions, options.before)
        )
      )
      .orderBy(
        desc(professionalMealSuggestions.createdAt),
        desc(professionalMealSuggestions.id)
      )
      .limit(limit);
    return rows.map(toMealSuggestion);
  }

  async function listHistory(
    userId: number,
    options: { limit?: number; before?: ProfessionalListCursor } = {}
  ) {
    const limit = clampLimit(options.limit);
    const db = await getProfessionalPersistenceDb(deps.getDb);
    if (!db) {
      return [...fallbackHistory.values()]
        .filter(
          item =>
            (item.professionalUserId === userId ||
              item.patientUserId === userId) &&
            isBeforeCursor(item, options.before)
        )
        .sort(compareNewest)
        .slice(0, limit);
    }
    const rows = await db
      .select()
      .from(professionalHistoryEvents)
      .where(
        and(
          or(
            eq(professionalHistoryEvents.professionalUserId, userId),
            eq(professionalHistoryEvents.patientUserId, userId)
          ),
          cursorWhere(professionalHistoryEvents, options.before)
        )
      )
      .orderBy(
        desc(professionalHistoryEvents.occurredAt),
        desc(professionalHistoryEvents.id)
      )
      .limit(limit);
    return rows.map(toHistory);
  }

  return {
    createComment,
    listComments,
    createGoalSuggestion,
    listGoalSuggestions,
    listGoalSuggestionsByPatient,
    getGoalSuggestionForPatient,
    reserveGoalSuggestionDecision,
    completeGoalSuggestionDecision,
    releaseGoalSuggestionDecision,
    transitionGoalSuggestion,
    createMealSuggestion,
    listMealSuggestions,
    appendHistory,
    listHistory,
    migrateAllLegacyGoalSuggestions,
  };
}
