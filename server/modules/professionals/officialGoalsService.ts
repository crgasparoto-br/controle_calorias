import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { assessNutritionGoalInput } from "@shared/nutritionSafety";
import { DEFAULT_APP_TIME_ZONE, getDateKeyInTimeZone } from "@shared/timeZone";
import {
  getDb,
  getUserWhatsappConnection,
  logPersistenceWarning,
} from "../../db";
import { sendWhatsAppStandaloneLogicalReply } from "../whatsapp/logicalReplyDelivery";
import { textReply } from "../whatsapp/replyContract";
import { goalExceptionSchema } from "../goals/schemas";
import type {
  PatientProfessionalGoalReviewInput,
  ProfessionalOfficialGoalInput,
} from "./schemas";

type Row = Record<string, unknown>;
type GoalException =
  ProfessionalOfficialGoalInput["goal"]["exceptions"][number];

export class ProfessionalGoalConflictError extends Error {
  constructor(
    message = "A meta profissional foi alterada por outra operação. Recarregue os dados e tente novamente."
  ) {
    super(message);
    this.name = "ProfessionalGoalConflictError";
  }
}

export class ProfessionalGoalControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfessionalGoalControlError";
  }
}

function resultRows(result: unknown): Row[] {
  if (!Array.isArray(result)) return [];
  return (Array.isArray(result[0]) ? result[0] : result) as Row[];
}

function affectedRows(result: unknown) {
  const candidate = Array.isArray(result) ? result[0] : result;
  return Number(
    (candidate as { affectedRows?: number } | undefined)?.affectedRows ?? 0
  );
}

function timestamp(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateFromKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dateKey(value: unknown) {
  const date = timestamp(value);
  return date ? date.toISOString().slice(0, 10) : null;
}

function mapReviewRequestRow(row: Row) {
  return {
    id: String(row.id),
    goalId: String(row.goalId),
    reason: row.reason ? String(row.reason) : null,
    status: String(row.status),
    createdAt: timestamp(row.createdAt),
  };
}

function mapNotificationRow(row: Row) {
  return {
    goalId: String(row.goalId),
    status: String(row.status),
    attempts: Number(row.attempts),
    sentAt: timestamp(row.sentAt),
    lastError: row.lastError ? String(row.lastError) : null,
    createdAt: timestamp(row.createdAt),
  };
}

function weekdayIndex(value: Date) {
  return (value.getUTCDay() + 6) % 7;
}

function startOfWeek(value: Date) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() - weekdayIndex(date));
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function parseExceptions(value: unknown): GoalException[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) throw new Error("invalid_exceptions");
    return parsed.map(item => {
      const result = goalExceptionSchema.safeParse(item);
      if (!result.success) throw new Error("invalid_exception");
      return result.data;
    });
  } catch {
    throw new Error("Exceções da meta profissional persistida são inválidas.");
  }
}

function exceptionApplies(
  exception: GoalException,
  goalStart: string,
  date: Date
) {
  if (exception.weekday !== weekdayIndex(date)) return false;
  const exceptionStart = dateFromKey(exception.startDate ?? goalStart);
  const dateWeek = startOfWeek(date).getTime();
  const startWeek = startOfWeek(exceptionStart).getTime();
  if (dateWeek < startWeek) return false;
  if (exception.durationType === "always") return true;
  const weeks =
    exception.durationType === "1_week"
      ? 1
      : exception.durationType === "2_weeks"
        ? 2
        : 3;
  return dateWeek < startWeek + weeks * 7 * 86_400_000;
}

function mapGoalRow(row: Row, forDate: string) {
  const effectiveFrom = dateKey(row.effectiveFrom);
  if (!effectiveFrom)
    throw new Error("Meta profissional persistida com vigência inválida.");
  const date = new Date(`${forDate}T12:00:00.000Z`);
  const exceptions = parseExceptions(row.exceptionsJson);
  const exception = exceptions.find(item =>
    exceptionApplies(item, effectiveFrom, date)
  );
  const base = {
    calories: Number(row.calories),
    proteinGrams: Number(row.proteinGrams),
    carbsGrams: Number(row.carbsGrams),
    fatGrams: Number(row.fatGrams),
  };
  const applied = exception ?? base;
  const nutritionalValues = [
    applied.calories,
    applied.proteinGrams,
    applied.carbsGrams,
    applied.fatGrams,
  ];
  if (
    nutritionalValues.some(
      value => !Number.isFinite(Number(value)) || Number(value) <= 0
    )
  ) {
    throw new Error(
      "Meta profissional persistida possui valores nutricionais inválidos."
    );
  }
  const labels = [
    "Segunda-feira",
    "Terça-feira",
    "Quarta-feira",
    "Quinta-feira",
    "Sexta-feira",
    "Sábado",
    "Domingo",
  ];
  const weekday = weekdayIndex(date);
  return {
    id: Number(row.version),
    userId: Number(row.patientUserId),
    ruleType: exception ? ("exception" as const) : ("default" as const),
    weekday,
    durationType: exception?.durationType ?? "always",
    ...applied,
    includeExerciseCalories: Boolean(row.includeExerciseCalories),
    effectiveFrom: timestamp(row.effectiveFrom)!,
    effectiveUntil: timestamp(row.effectiveUntil),
    createdAt: timestamp(row.createdAt)!,
    updatedAt: timestamp(row.updatedAt)!,
    label: labels[weekday] ?? "Dia",
    shortLabel: (labels[weekday] ?? "dia").slice(0, 3).toLowerCase(),
    source: exception ? ("exception" as const) : ("default" as const),
    exceptionId: exception ? `${row.id}:${exception.weekday}` : undefined,
    goalOrigin: "professional" as const,
    professionalGoalId: String(row.id),
    professionalGoalVersion: Number(row.version),
    professional: {
      userId: Number(row.professionalUserId),
      displayName: String(
        row.professionalDisplayName ?? "Profissional responsável"
      ),
    },
    effectiveFromDate: effectiveFrom,
    effectiveUntilDate: dateKey(row.effectiveUntil),
    trackingStatus: row.trackingStatus ? String(row.trackingStatus) : null,
    dateKey: forDate,
  };
}

function rowApplies(row: Row, forDate: string) {
  const start = dateKey(row.effectiveFrom);
  const end = dateKey(row.effectiveUntil);
  return Boolean(start && start <= forDate && (!end || forDate < end));
}

export function resolveProfessionalGoalRowsForDate(
  rows: Row[],
  forDate: string
) {
  const row = rows
    .filter(item => rowApplies(item, forDate))
    .sort(
      (a, b) =>
        String(b.effectiveFrom).localeCompare(String(a.effectiveFrom)) ||
        Number(b.version) - Number(a.version)
    )[0];
  return row ? mapGoalRow(row, forDate) : null;
}

async function listPatientGoalRows(patientUserId: number) {
  const db = await getDb();
  if (!db) {
    if (process.env.NODE_ENV === "production")
      throw new Error(
        "As metas profissionais estão temporariamente indisponíveis."
      );
    return [];
  }
  const result = await db.execute(sql`
    SELECT g.*, p.displayName AS professionalDisplayName, t.status AS trackingStatus
    FROM professionalOfficialGoals g
    LEFT JOIN professionalProfiles p ON p.userId = g.professionalUserId
    LEFT JOIN professionalPatientTrackings t ON t.id = g.trackingId
    WHERE g.patientUserId = ${patientUserId}
    ORDER BY g.effectiveFrom DESC, g.version DESC`);
  return resultRows(result);
}

export async function getProfessionalGoalForDate(
  patientUserId: number,
  forDate: string
) {
  return resolveProfessionalGoalRowsForDate(
    await listPatientGoalRows(patientUserId),
    forDate
  );
}

export async function getProfessionalGoalWeek(
  patientUserId: number,
  referenceDate: string
) {
  const rows = await listPatientGoalRows(patientUserId);
  if (!rows.length) return null;
  const reference = new Date(`${referenceDate}T12:00:00.000Z`);
  const monday = startOfWeek(reference);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setUTCDate(date.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    return resolveProfessionalGoalRowsForDate(rows, key);
  });
  const today = resolveProfessionalGoalRowsForDate(rows, referenceDate);
  const resolvedDays = days.filter((day): day is NonNullable<typeof day> =>
    Boolean(day)
  );
  if (!resolvedDays.length) return null;
  const anchor = today ?? resolvedDays[0];
  const currentRow = rows.find(
    row => String(row.id) === anchor.professionalGoalId
  )!;
  return {
    defaultGoal: { ...anchor, source: "default" as const },
    exceptions: parseExceptions(currentRow.exceptionsJson).map(
      (exception, index) => ({
        ...exception,
        id: index + 1,
        effectiveFrom: dateFromKey(
          exception.startDate ?? anchor.effectiveFromDate
        ),
        effectiveUntil: null,
        createdAt: timestamp(currentRow.createdAt),
        updatedAt: timestamp(currentRow.updatedAt),
        label: [
          "Segunda-feira",
          "Terça-feira",
          "Quarta-feira",
          "Quinta-feira",
          "Sexta-feira",
          "Sábado",
          "Domingo",
        ][exception.weekday],
        shortLabel: "",
        isActive: exceptionApplies(
          exception,
          anchor.effectiveFromDate,
          reference
        ),
      })
    ),
    days: resolvedDays,
    today,
    weeklyTotals: resolvedDays.reduce(
      (total, day) => ({
        calories: total.calories + day.calories,
        proteinGrams: total.proteinGrams + day.proteinGrams,
        carbsGrams: total.carbsGrams + day.carbsGrams,
        fatGrams: total.fatGrams + day.fatGrams,
      }),
      { calories: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0 }
    ),
    startDate: anchor.effectiveFromDate,
    versions: rows.map(row => ({
      id: Number(row.version),
      startDate: dateKey(row.effectiveFrom)!,
      effectiveFrom: timestamp(row.effectiveFrom),
      effectiveUntil: timestamp(row.effectiveUntil),
      calories: Number(row.calories),
      proteinGrams: Number(row.proteinGrams),
      carbsGrams: Number(row.carbsGrams),
      fatGrams: Number(row.fatGrams),
      isCurrent: String(row.id) === anchor.professionalGoalId,
      origin: "professional" as const,
    })),
    exceptionVersions: [],
    safetyWarnings: [],
    goalOrigin: "professional" as const,
    professionalGoal: {
      id: anchor.professionalGoalId,
      version: anchor.professionalGoalVersion,
      professional: anchor.professional,
      effectiveFrom: anchor.effectiveFromDate,
      effectiveUntil: anchor.effectiveUntilDate,
      trackingStatus: anchor.trackingStatus,
    },
    professionalControlActive: Boolean(rows.find(row => row.activePatientKey)),
  };
}

async function requireDb() {
  const db = await getDb();
  if (!db)
    throw new Error(
      "As metas profissionais estão temporariamente indisponíveis."
    );
  return db;
}

export async function hasProfessionalGoalControl(patientUserId: number) {
  const db = await getDb();
  if (!db) {
    if (process.env.NODE_ENV === "production")
      throw new Error(
        "As metas profissionais estão temporariamente indisponíveis."
      );
    return false;
  }
  const result = await db.execute(sql`
    SELECT g.id FROM professionalOfficialGoals g
    INNER JOIN professionalPatientAuthorizations a ON a.id = g.authorizationId AND a.status = 'approved'
    INNER JOIN professionalPatientTrackings t ON t.id = g.trackingId AND t.status IN ('active','paused')
    WHERE g.activePatientKey = ${String(patientUserId)} LIMIT 1`);
  return resultRows(result).length > 0;
}

async function claimNotification(goalId: string, professionalUserId: number) {
  const db = await requireDb();
  const claimToken = crypto.randomUUID();
  const update = await db.execute(sql`
    UPDATE professionalGoalNotifications n
    INNER JOIN professionalOfficialGoals g ON g.id = n.goalId
    INNER JOIN professionalPatientAuthorizations a ON a.id = g.authorizationId AND a.status = 'approved'
    INNER JOIN professionalPatientTrackings t ON t.id = g.trackingId AND t.status = 'active'
    INNER JOIN professionalProfiles p ON p.userId = g.professionalUserId AND p.active = true
    SET n.status = 'sending', n.claimToken = ${claimToken}, n.claimedAt = NOW(), n.attempts = n.attempts + 1, n.lastError = NULL
    WHERE n.goalId = ${goalId} AND g.professionalUserId = ${professionalUserId}
      AND (n.status IN ('pending','failed','skipped') OR (n.status = 'sending' AND n.claimedAt < DATE_SUB(NOW(), INTERVAL 5 MINUTE)))`);
  if (affectedRows(update) === 0) return null;
  const result = await db.execute(sql`
    SELECT n.*, g.professionalUserId, g.patientUserId, g.version, g.calories, g.proteinGrams,
      g.carbsGrams, g.fatGrams, g.effectiveFrom, p.displayName AS professionalDisplayName
    FROM professionalGoalNotifications n
    INNER JOIN professionalOfficialGoals g ON g.id = n.goalId
    LEFT JOIN professionalProfiles p ON p.userId = g.professionalUserId
    WHERE n.goalId = ${goalId} AND n.claimToken = ${claimToken} LIMIT 1`);
  return { db, claimToken, row: resultRows(result)[0] };
}

export async function deliverProfessionalGoalNotification(
  goalId: string,
  professionalUserId: number
) {
  const claimed = await claimNotification(goalId, professionalUserId);
  if (!claimed?.row) return { status: "unchanged" as const };
  const { db, claimToken, row } = claimed;
  let status: "sent" | "failed" | "skipped" = "failed";
  let error: string | null = null;
  try {
    const connection = await getUserWhatsappConnection(
      Number(row.patientUserId)
    );
    if (!connection || connection.status !== "active") {
      status = "skipped";
      error = "Paciente sem canal de WhatsApp ativo.";
    } else {
      const author = String(row.professionalDisplayName ?? "Seu nutricionista");
      const message = [
        `📌 ${author} ativou a versão ${Number(row.version)} da sua meta nutricional.`,
        `Vigência: ${dateKey(row.effectiveFrom)}.`,
        `Meta: ${Number(row.calories)} kcal · proteínas ${Number(row.proteinGrams)} g · carboidratos ${Number(row.carbsGrams)} g · gorduras ${Number(row.fatGrams)} g.`,
        "Abra a área Metas para consultar os detalhes ou solicitar uma revisão.",
      ].join("\n");
      const delivery = await sendWhatsAppStandaloneLogicalReply(
        connection.phoneNumber,
        textReply(message)
      );
      status = delivery.result.primaryOk ? "sent" : "failed";
      error =
        status === "failed"
          ? "Falha ao enviar a notificação pelo WhatsApp."
          : null;
    }
  } catch (cause) {
    error = "Falha ao enviar a notificação pelo WhatsApp.";
    logPersistenceWarning("professional_goal_notification", cause);
  }
  await db.execute(sql`
    UPDATE professionalGoalNotifications
    SET status = ${status}, sentAt = ${status === "sent" ? new Date() : null}, lastError = ${error}, claimToken = NULL, claimedAt = NULL
    WHERE goalId = ${goalId} AND claimToken = ${claimToken}`);
  return { status };
}

export async function activateProfessionalOfficialGoal(
  professionalUserId: number,
  input: ProfessionalOfficialGoalInput
) {
  const assessment = assessNutritionGoalInput(input.goal);
  if (assessment.blockers.length)
    throw new ProfessionalGoalControlError(
      assessment.blockers.map(item => item.message).join(" ")
    );
  const db = await requireDb();
  const goalId = crypto.randomUUID();
  const notificationId = crypto.randomUUID();
  const effectiveFrom = dateFromKey(input.effectiveFrom);
  let version = 1;
  let authorizationId = "";
  let trackingId = "";
  try {
    await db.transaction(async (tx: any) => {
      const scopeResult = await tx.execute(sql`
      SELECT a.id AS authorizationId, t.id AS trackingId, t.status AS trackingStatus
      FROM professionalPatientAuthorizations a
      INNER JOIN professionalPatientTrackings t ON t.authorizationId = a.id
      INNER JOIN professionalProfiles p ON p.userId = a.professionalUserId AND p.active = true
      WHERE a.professionalUserId = ${professionalUserId} AND a.patientUserId = ${input.patientId}
        AND a.status = 'approved' AND t.status = 'active'
      ORDER BY a.approvedAt DESC, a.id DESC LIMIT 1 FOR UPDATE`);
      const scope = resultRows(scopeResult)[0];
      if (!scope)
        throw new ProfessionalGoalControlError(
          "Somente um profissional autorizado em acompanhamento ativo pode alterar a meta oficial."
        );
      authorizationId = String(scope.authorizationId);
      trackingId = String(scope.trackingId);

      const activeResult = await tx.execute(sql`
      SELECT * FROM professionalOfficialGoals WHERE activePatientKey = ${String(input.patientId)} LIMIT 1 FOR UPDATE`);
      const active = resultRows(activeResult)[0];
      if (active) {
        if (
          Number(active.professionalUserId) !== professionalUserId ||
          String(active.authorizationId) !== authorizationId
        ) {
          throw new ProfessionalGoalConflictError(
            "Já existe uma meta profissional oficial ativa para este paciente. Encerre explicitamente o controle anterior antes de criar outra."
          );
        }
        if (
          !input.expectedVersion ||
          Number(active.version) !== input.expectedVersion
        )
          throw new ProfessionalGoalConflictError();
        const previousStart = timestamp(active.effectiveFrom)!;
        if (effectiveFrom.getTime() <= previousStart.getTime()) {
          throw new ProfessionalGoalConflictError(
            "A nova vigência deve começar depois da versão profissional anterior."
          );
        }
        version = Number(active.version) + 1;
        const update = await tx.execute(sql`
        UPDATE professionalOfficialGoals SET activePatientKey = NULL, status = 'superseded', effectiveUntil = ${effectiveFrom}, updatedAt = NOW()
        WHERE id = ${String(active.id)} AND version = ${Number(active.version)} AND activePatientKey = ${String(input.patientId)}`);
        if (affectedRows(update) === 0)
          throw new ProfessionalGoalConflictError();
      } else if (input.expectedVersion) {
        throw new ProfessionalGoalConflictError();
      }

      await tx.execute(sql`
      INSERT INTO professionalOfficialGoals (
        id, authorizationId, trackingId, professionalUserId, patientUserId, activePatientKey,
        version, status, calories, proteinGrams, carbsGrams, fatGrams, exceptionsJson,
        includeExerciseCalories, effectiveFrom, justification, supersedesGoalId
      ) VALUES (
        ${goalId}, ${authorizationId}, ${trackingId}, ${professionalUserId}, ${input.patientId}, ${String(input.patientId)},
        ${version}, 'active', ${input.goal.defaultGoal.calories}, ${input.goal.defaultGoal.proteinGrams},
        ${input.goal.defaultGoal.carbsGrams}, ${input.goal.defaultGoal.fatGrams}, ${JSON.stringify(input.goal.exceptions)},
        ${input.goal.includeExerciseCalories}, ${effectiveFrom}, ${input.justification}, ${active ? String(active.id) : null}
      )`);
      await tx.execute(sql`
      UPDATE professionalGoalReviewRequests SET status = 'resolved', openRequestKey = NULL,
        resolvedByUserId = ${professionalUserId}, resolvedAt = NOW(), updatedAt = NOW()
      WHERE patientUserId = ${input.patientId} AND professionalUserId = ${professionalUserId} AND status = 'open'`);
      await tx.execute(sql`
      INSERT INTO professionalHistoryEvents (id, actorUserId, professionalUserId, patientUserId, eventType, entityType, entityId, occurredAt)
      VALUES (${crypto.randomUUID()}, ${professionalUserId}, ${professionalUserId}, ${input.patientId},
        ${version === 1 ? "official_goal_activated" : "official_goal_revised"}, 'official_goal', ${goalId}, NOW())`);
      await tx.execute(sql`
      INSERT INTO professionalGoalNotifications (id, goalId, patientUserId, idempotencyKey, status)
      VALUES (${notificationId}, ${goalId}, ${input.patientId}, ${`professional-goal:${goalId}:activated`}, 'pending')`);
    });
  } catch (error) {
    if (
      error instanceof ProfessionalGoalConflictError ||
      error instanceof ProfessionalGoalControlError
    )
      throw error;
    const code =
      (error as { code?: string; cause?: { code?: string } })?.code ??
      (error as { cause?: { code?: string } })?.cause?.code;
    if (code === "ER_DUP_ENTRY")
      throw new ProfessionalGoalConflictError(
        "Já existe uma meta profissional oficial ativa para este paciente. Recarregue os dados antes de tentar novamente."
      );
    throw error;
  }

  let notification: Awaited<
    ReturnType<typeof deliverProfessionalGoalNotification>
  >;
  try {
    notification = await deliverProfessionalGoalNotification(
      goalId,
      professionalUserId
    );
  } catch (error) {
    logPersistenceWarning("professional_goal_notification_after_commit", error);
    notification = { status: "unchanged" as const };
  }
  return { id: goalId, version, authorizationId, trackingId, notification };
}

export async function requestProfessionalGoalReview(
  patientUserId: number,
  input: PatientProfessionalGoalReviewInput
) {
  const db = await requireDb();
  const result = await db.execute(sql`
    SELECT g.id, g.professionalUserId FROM professionalOfficialGoals g
    INNER JOIN professionalPatientAuthorizations a ON a.id = g.authorizationId AND a.status = 'approved'
    INNER JOIN professionalPatientTrackings t ON t.id = g.trackingId AND t.status IN ('active','paused')
    WHERE g.activePatientKey = ${String(patientUserId)} AND g.patientUserId = ${patientUserId} LIMIT 1`);
  const goal = resultRows(result)[0];
  if (!goal)
    throw new ProfessionalGoalControlError(
      "Não existe meta profissional vigente para solicitar revisão."
    );
  const id = crypto.randomUUID();
  const openKey = `${patientUserId}:${String(goal.id)}`;
  try {
    await db.transaction(async tx => {
      await tx.execute(sql`
        INSERT INTO professionalGoalReviewRequests (id, goalId, professionalUserId, patientUserId, openRequestKey, reason)
        VALUES (${id}, ${String(goal.id)}, ${Number(goal.professionalUserId)}, ${patientUserId}, ${openKey}, ${input.reason ?? null})`);
      await tx.execute(sql`
        INSERT INTO professionalHistoryEvents (id, actorUserId, professionalUserId, patientUserId, eventType, entityType, entityId, occurredAt)
        VALUES (${crypto.randomUUID()}, ${patientUserId}, ${Number(goal.professionalUserId)}, ${patientUserId},
          'official_goal_review_requested', 'goal_review_request', ${id}, NOW())`);
    });
  } catch (error) {
    const existing = await db.execute(sql`
      SELECT id, status, createdAt FROM professionalGoalReviewRequests WHERE openRequestKey = ${openKey} LIMIT 1`);
    const row = resultRows(existing)[0];
    if (row)
      return {
        id: String(row.id),
        status: String(row.status),
        createdAt: timestamp(row.createdAt),
        idempotent: true,
      };
    throw error;
  }
  return {
    id,
    status: "open" as const,
    createdAt: new Date(),
    idempotent: false,
  };
}

export async function getPatientProfessionalGoalState(
  patientUserId: number,
  timeZone = DEFAULT_APP_TIME_ZONE
) {
  const db = await getDb();
  if (!db)
    return {
      current: null,
      controlActive: false,
      scheduled: null,
      history: [],
      reviewRequest: null,
      notifications: [],
    };
  const today = getDateKeyInTimeZone(new Date(), timeZone);
  const [rows, reviewResult, notificationResult] = await Promise.all([
    listPatientGoalRows(patientUserId),
    db.execute(sql`SELECT id, goalId, reason, status, createdAt FROM professionalGoalReviewRequests
      WHERE patientUserId = ${patientUserId} AND status = 'open' ORDER BY createdAt DESC LIMIT 1`),
    db.execute(sql`SELECT goalId, status, attempts, sentAt, lastError, createdAt FROM professionalGoalNotifications
      WHERE patientUserId = ${patientUserId} ORDER BY createdAt DESC LIMIT 20`),
  ]);
  const current = resolveProfessionalGoalRowsForDate(rows, today);
  const scheduledRow = rows.find(
    row => Boolean(row.activePatientKey) && dateKey(row.effectiveFrom)! > today
  );
  return {
    current,
    controlActive: rows.some(row => Boolean(row.activePatientKey)),
    scheduled: scheduledRow
      ? {
          id: String(scheduledRow.id),
          version: Number(scheduledRow.version),
          calories: Number(scheduledRow.calories),
          proteinGrams: Number(scheduledRow.proteinGrams),
          carbsGrams: Number(scheduledRow.carbsGrams),
          fatGrams: Number(scheduledRow.fatGrams),
          includeExerciseCalories: Boolean(
            scheduledRow.includeExerciseCalories
          ),
          effectiveFrom: dateKey(scheduledRow.effectiveFrom),
          professionalName: String(
            scheduledRow.professionalDisplayName ?? "Profissional responsável"
          ),
        }
      : null,
    history: rows.map(row => ({
      id: String(row.id),
      version: Number(row.version),
      status: String(row.status),
      calories: Number(row.calories),
      proteinGrams: Number(row.proteinGrams),
      carbsGrams: Number(row.carbsGrams),
      fatGrams: Number(row.fatGrams),
      includeExerciseCalories: Boolean(row.includeExerciseCalories),
      effectiveFrom: dateKey(row.effectiveFrom),
      effectiveUntil: dateKey(row.effectiveUntil),
      professionalName: String(
        row.professionalDisplayName ?? "Profissional responsável"
      ),
      createdAt: timestamp(row.createdAt),
    })),
    reviewRequest: resultRows(reviewResult)[0]
      ? mapReviewRequestRow(resultRows(reviewResult)[0])
      : null,
    notifications: resultRows(notificationResult).map(mapNotificationRow),
  };
}

export async function getProfessionalOfficialGoalState(
  professionalUserId: number,
  patientUserId: number
) {
  const db = await requireDb();
  const scope = await db.execute(sql`
    SELECT a.id AS authorizationId, t.status AS trackingStatus
    FROM professionalPatientAuthorizations a
    LEFT JOIN professionalPatientTrackings t ON t.authorizationId = a.id
    INNER JOIN professionalProfiles p ON p.userId = a.professionalUserId AND p.active = true
    WHERE a.professionalUserId = ${professionalUserId} AND a.patientUserId = ${patientUserId} AND a.status = 'approved'
    ORDER BY a.approvedAt DESC LIMIT 1`);
  if (!resultRows(scope)[0])
    throw new ProfessionalGoalControlError(
      "O acesso a este paciente não está mais disponível."
    );
  const [goalResult, reviewResult, notificationResult] = await Promise.all([
    db.execute(
      sql`SELECT * FROM professionalOfficialGoals WHERE professionalUserId = ${professionalUserId} AND patientUserId = ${patientUserId} ORDER BY version DESC LIMIT 100`
    ),
    db.execute(
      sql`SELECT id, goalId, reason, status, createdAt FROM professionalGoalReviewRequests WHERE professionalUserId = ${professionalUserId} AND patientUserId = ${patientUserId} ORDER BY createdAt DESC LIMIT 100`
    ),
    db.execute(sql`SELECT n.goalId, n.status, n.attempts, n.sentAt, n.lastError, n.createdAt FROM professionalGoalNotifications n
      INNER JOIN professionalOfficialGoals g ON g.id = n.goalId WHERE g.professionalUserId = ${professionalUserId} AND g.patientUserId = ${patientUserId}
      ORDER BY n.createdAt DESC LIMIT 100`),
  ]);
  const goals = resultRows(goalResult).map(row => ({
    id: String(row.id),
    version: Number(row.version),
    status: String(row.status),
    calories: Number(row.calories),
    proteinGrams: Number(row.proteinGrams),
    carbsGrams: Number(row.carbsGrams),
    fatGrams: Number(row.fatGrams),
    exceptions: parseExceptions(row.exceptionsJson),
    includeExerciseCalories: Boolean(row.includeExerciseCalories),
    effectiveFrom: dateKey(row.effectiveFrom),
    effectiveUntil: dateKey(row.effectiveUntil),
    justification: String(row.justification ?? ""),
    createdAt: timestamp(row.createdAt),
    active: Boolean(row.activePatientKey),
  }));
  return {
    trackingStatus: String(
      resultRows(scope)[0].trackingStatus ?? "not_started"
    ),
    current: goals.find(goal => goal.active) ?? null,
    history: goals,
    reviewRequests: resultRows(reviewResult).map(mapReviewRequestRow),
    notifications: resultRows(notificationResult).map(mapNotificationRow),
  };
}

export async function getProfessionalGoalByIdForPatient(
  patientUserId: number,
  goalId: string
) {
  const db = await requireDb();
  const result = await db.execute(
    sql`SELECT * FROM professionalOfficialGoals WHERE id = ${goalId} AND patientUserId = ${patientUserId} LIMIT 1`
  );
  const row = resultRows(result)[0];
  if (!row || Boolean(row.activePatientKey))
    throw new ProfessionalGoalControlError(
      "A meta só pode ser adotada como pessoal depois do encerramento ou da revogação."
    );
  return {
    includeExerciseCalories: Boolean(row.includeExerciseCalories),
    defaultGoal: {
      calories: Number(row.calories),
      proteinGrams: Number(row.proteinGrams),
      carbsGrams: Number(row.carbsGrams),
      fatGrams: Number(row.fatGrams),
    },
    exceptions: parseExceptions(row.exceptionsJson).map(exception => ({
      ...exception,
      startDate: undefined,
    })),
  };
}
