import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, logPersistenceWarning } from "../../db";
import type {
  ProfessionalAssessmentInput,
  ProfessionalGuidanceInput,
  ProfessionalNoteInput,
  ProfessionalRecordInput,
} from "./schemas";
import { getProfessionalOperationalDefaults } from "./settingsService";

export type ProfessionalRecordState = "not_started" | "active" | "paused" | "ended";
type Row = Record<string, unknown>;

function rows(result: unknown): Row[] {
  if (!Array.isArray(result)) return [];
  return (Array.isArray(result[0]) ? result[0] : result) as Row[];
}
function timestamp(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}
function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function count(result: unknown) {
  return Number(rows(result)[0]?.total ?? 0);
}

export function resolveProfessionalNextReviewAt(input: {
  assessedAt: number;
  nextReviewAt?: number | null;
  defaultReviewIntervalDays: number | null;
}) {
  if (input.nextReviewAt) return new Date(input.nextReviewAt);
  if (!input.defaultReviewIntervalDays) return null;
  const reviewAt = new Date(input.assessedAt);
  reviewAt.setUTCDate(
    reviewAt.getUTCDate() + input.defaultReviewIntervalDays
  );
  return reviewAt;
}

async function requireProfessionalScope(
  professionalUserId: number,
  patientUserId: number,
  options: { requireActive?: boolean } = {}
) {
  const db = await getDb();
  if (!db) throw new Error("O prontuário profissional está temporariamente indisponível.");
  const result = await db.execute(sql`
    SELECT a.id AS authorizationId, a.status AS authorizationStatus,
      t.status AS trackingStatus, u.name AS patientName, u.email AS patientEmail
    FROM professionalPatientAuthorizations a
    INNER JOIN users u ON u.id = a.patientUserId
    LEFT JOIN professionalPatientTrackings t ON t.authorizationId = a.id
    WHERE a.professionalUserId = ${professionalUserId}
      AND a.patientUserId = ${patientUserId}
      AND a.status = 'approved'
    ORDER BY a.approvedAt DESC, a.id DESC
    LIMIT 1`);
  const scope = rows(result)[0];
  if (!scope) throw new Error("O acesso a este paciente não está mais disponível.");
  const trackingStatus = scope.trackingStatus ? String(scope.trackingStatus) : "not_started";
  if (options.requireActive && trackingStatus !== "active") {
    throw new Error("Esta ação está disponível somente durante acompanhamento ativo.");
  }
  return {
    db,
    authorizationId: String(scope.authorizationId),
    trackingStatus: trackingStatus as ProfessionalRecordState,
    patientName: scope.patientName ? String(scope.patientName) : null,
    patientEmail: scope.patientEmail ? String(scope.patientEmail) : null,
  };
}

export async function getProfessionalRecord(
  professionalUserId: number,
  input: ProfessionalRecordInput
) {
  const scope = await requireProfessionalScope(professionalUserId, input.patientId);
  const offset = (input.page - 1) * input.pageSize;
  const [
    assessmentResult,
    assessmentHistoryResult,
    notesResult,
    guidancesResult,
    timelineResult,
    assessmentCountResult,
    notesCountResult,
    guidancesCountResult,
    timelineCountResult,
  ] = await Promise.all([
    scope.db.execute(sql`
      SELECT * FROM professionalAssessments
      WHERE authorizationId = ${scope.authorizationId}
      ORDER BY version DESC LIMIT 1`),
    scope.db.execute(sql`
      SELECT id, version, objective, assessedAt, nextReviewAt, createdAt
      FROM professionalAssessments
      WHERE authorizationId = ${scope.authorizationId}
      ORDER BY version DESC LIMIT ${input.pageSize} OFFSET ${offset}`),
    scope.db.execute(sql`
      SELECT id, content, createdAt, updatedAt FROM professionalNotes
      WHERE authorizationId = ${scope.authorizationId}
      ORDER BY createdAt DESC, id DESC LIMIT ${input.pageSize} OFFSET ${offset}`),
    scope.db.execute(sql`
      SELECT g.id, g.version, g.title, g.content, g.visibility, g.deliveryStatus,
        g.supersedesGuidanceId, g.createdAt, p.displayName AS authorName
      FROM professionalGuidances g
      LEFT JOIN professionalProfiles p ON p.userId = g.professionalUserId
      WHERE g.authorizationId = ${scope.authorizationId}
      ORDER BY g.version DESC LIMIT ${input.pageSize} OFFSET ${offset}`),
    scope.db.execute(sql`
      SELECT id, eventType, entityType, entityId, occurredAt
      FROM professionalHistoryEvents
      WHERE professionalUserId = ${professionalUserId} AND patientUserId = ${input.patientId}
      ORDER BY occurredAt DESC, id DESC LIMIT ${input.pageSize} OFFSET ${offset}`),
    scope.db.execute(sql`SELECT COUNT(*) AS total FROM professionalAssessments WHERE authorizationId = ${scope.authorizationId}`),
    scope.db.execute(sql`SELECT COUNT(*) AS total FROM professionalNotes WHERE authorizationId = ${scope.authorizationId}`),
    scope.db.execute(sql`SELECT COUNT(*) AS total FROM professionalGuidances WHERE authorizationId = ${scope.authorizationId}`),
    scope.db.execute(sql`SELECT COUNT(*) AS total FROM professionalHistoryEvents WHERE professionalUserId = ${professionalUserId} AND patientUserId = ${input.patientId}`),
  ]);
  const latest = rows(assessmentResult)[0];
  const totals = {
    assessments: count(assessmentCountResult),
    notes: count(notesCountResult),
    guidances: count(guidancesCountResult),
    timeline: count(timelineCountResult),
  };
  return {
    patient: {
      id: input.patientId,
      authorizationId: scope.authorizationId,
      name: scope.patientName,
      email: scope.patientEmail,
      authorizationStatus: "approved" as const,
      trackingStatus: scope.trackingStatus,
    },
    latestAssessment: latest
      ? {
          id: String(latest.id),
          version: Number(latest.version),
          objective: String(latest.objective ?? ""),
          weightKg: numberOrNull(latest.weightKg),
          heightCm: numberOrNull(latest.heightCm),
          routineAndSchedule: latest.routineAndSchedule ? String(latest.routineAndSchedule) : null,
          physicalActivity: latest.physicalActivity ? String(latest.physicalActivity) : null,
          foodPreferences: latest.foodPreferences ? String(latest.foodPreferences) : null,
          restrictionsAndAllergies: latest.restrictionsAndAllergies ? String(latest.restrictionsAndAllergies) : null,
          reportedDifficulties: latest.reportedDifficulties ? String(latest.reportedDifficulties) : null,
          relevantHabits: latest.relevantHabits ? String(latest.relevantHabits) : null,
          professionalObservations: latest.professionalObservations ? String(latest.professionalObservations) : null,
          assessedAt: timestamp(latest.assessedAt),
          nextReviewAt: timestamp(latest.nextReviewAt),
          createdAt: timestamp(latest.createdAt),
        }
      : null,
    assessmentHistory: rows(assessmentHistoryResult).map(row => ({
      id: String(row.id), version: Number(row.version), objective: String(row.objective ?? ""),
      assessedAt: timestamp(row.assessedAt), nextReviewAt: timestamp(row.nextReviewAt), createdAt: timestamp(row.createdAt),
    })),
    notes: rows(notesResult).map(row => ({
      id: String(row.id), content: String(row.content ?? ""), createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt),
    })),
    guidances: rows(guidancesResult).map(row => ({
      id: String(row.id), version: Number(row.version), title: String(row.title ?? ""), content: String(row.content ?? ""),
      visibility: String(row.visibility), deliveryStatus: String(row.deliveryStatus), authorName: String(row.authorName ?? "Profissional"),
      supersedesGuidanceId: row.supersedesGuidanceId ? String(row.supersedesGuidanceId) : null,
      createdAt: timestamp(row.createdAt),
    })),
    timeline: rows(timelineResult).map(row => ({
      id: String(row.id), eventType: String(row.eventType), entityType: row.entityType ? String(row.entityType) : null,
      entityId: row.entityId ? String(row.entityId) : null, occurredAt: timestamp(row.occurredAt),
    })),
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      totals,
      hasMore: Object.values(totals).some(total => total > input.page * input.pageSize),
    },
  };
}

export async function saveProfessionalAssessment(
  professionalUserId: number,
  input: ProfessionalAssessmentInput
) {
  const [scope, defaults] = await Promise.all([
    requireProfessionalScope(professionalUserId, input.patientId, {
      requireActive: true,
    }),
    getProfessionalOperationalDefaults(professionalUserId),
  ]);
  const nextReviewAt = resolveProfessionalNextReviewAt({
    assessedAt: input.assessedAt,
    nextReviewAt: input.nextReviewAt,
    defaultReviewIntervalDays: defaults.defaultReviewIntervalDays,
  });
  const id = crypto.randomUUID();
  try {
    await scope.db.transaction(async tx => {
      const versionResult = await tx.execute(sql`
        SELECT COALESCE(MAX(version), 0) + 1 AS nextVersion
        FROM professionalAssessments
        WHERE authorizationId = ${scope.authorizationId} FOR UPDATE`);
      const version = Number(rows(versionResult)[0]?.nextVersion ?? 1);
      await tx.execute(sql`
        INSERT INTO professionalAssessments (
          id, authorizationId, professionalUserId, patientUserId, version, objective,
          weightKg, heightCm, routineAndSchedule, physicalActivity, foodPreferences,
          restrictionsAndAllergies, reportedDifficulties, relevantHabits,
          professionalObservations, assessedAt, nextReviewAt
        ) VALUES (
          ${id}, ${scope.authorizationId}, ${professionalUserId}, ${input.patientId}, ${version}, ${input.objective},
          ${input.weightKg ?? null}, ${input.heightCm ?? null}, ${input.routineAndSchedule ?? null},
          ${input.physicalActivity ?? null}, ${input.foodPreferences ?? null}, ${input.restrictionsAndAllergies ?? null},
          ${input.reportedDifficulties ?? null}, ${input.relevantHabits ?? null}, ${input.professionalObservations ?? null},
          ${new Date(input.assessedAt)}, ${nextReviewAt}
        )`);
      await tx.execute(sql`
        UPDATE professionalPatientTrackings SET nextReviewAt = ${nextReviewAt}, updatedAt = NOW()
        WHERE authorizationId = ${scope.authorizationId}`);
      await tx.execute(sql`
        INSERT INTO professionalHistoryEvents (id, actorUserId, professionalUserId, patientUserId, eventType, entityType, entityId, occurredAt)
        VALUES (${crypto.randomUUID()}, ${professionalUserId}, ${professionalUserId}, ${input.patientId}, 'assessment_version_created', 'assessment', ${id}, NOW())`);
    });
    return { id, nextReviewAt: nextReviewAt?.getTime() ?? null };
  } catch (error) {
    logPersistenceWarning("professional_record_assessment", error);
    throw new Error("Não foi possível salvar a avaliação. O conteúdo informado foi preservado na tela.");
  }
}

export async function createProfessionalNote(
  professionalUserId: number,
  input: ProfessionalNoteInput
) {
  const scope = await requireProfessionalScope(professionalUserId, input.patientId, { requireActive: true });
  const id = crypto.randomUUID();
  await scope.db.transaction(async tx => {
    await tx.execute(sql`
      INSERT INTO professionalNotes (id, authorizationId, professionalUserId, patientUserId, content)
      VALUES (${id}, ${scope.authorizationId}, ${professionalUserId}, ${input.patientId}, ${input.content})`);
    await tx.execute(sql`
      INSERT INTO professionalHistoryEvents (id, actorUserId, professionalUserId, patientUserId, eventType, entityType, entityId, occurredAt)
      VALUES (${crypto.randomUUID()}, ${professionalUserId}, ${professionalUserId}, ${input.patientId}, 'private_note_created', 'note', ${id}, NOW())`);
  });
  return { id };
}

export async function createProfessionalGuidance(
  professionalUserId: number,
  input: ProfessionalGuidanceInput
) {
  const scope = await requireProfessionalScope(professionalUserId, input.patientId, { requireActive: true });
  const id = crypto.randomUUID();
  await scope.db.transaction(async tx => {
    const versionResult = await tx.execute(sql`
      SELECT COALESCE(MAX(version), 0) + 1 AS nextVersion FROM professionalGuidances
      WHERE authorizationId = ${scope.authorizationId} FOR UPDATE`);
    const version = Number(rows(versionResult)[0]?.nextVersion ?? 1);
    await tx.execute(sql`
      INSERT INTO professionalGuidances (
        id, authorizationId, professionalUserId, patientUserId, version, title, content,
        visibility, deliveryStatus, supersedesGuidanceId
      ) VALUES (
        ${id}, ${scope.authorizationId}, ${professionalUserId}, ${input.patientId}, ${version}, ${input.title}, ${input.content},
        'patient', ${input.deliveryStatus}, ${input.supersedesGuidanceId ?? null}
      )`);
    await tx.execute(sql`
      INSERT INTO professionalHistoryEvents (id, actorUserId, professionalUserId, patientUserId, eventType, entityType, entityId, occurredAt)
      VALUES (${crypto.randomUUID()}, ${professionalUserId}, ${professionalUserId}, ${input.patientId}, 'guidance_created', 'guidance', ${id}, NOW())`);
  });
  return { id };
}

export async function listPatientProfessionalGuidances(patientUserId: number) {
  const db = await getDb();
  if (!db) return [];
  const result = await db.execute(sql`
    SELECT g.id, g.version, g.title, g.content, g.deliveryStatus, g.createdAt,
      p.displayName AS professionalName
    FROM professionalGuidances g
    INNER JOIN professionalProfiles p ON p.userId = g.professionalUserId
    INNER JOIN professionalPatientAuthorizations a ON a.id = g.authorizationId
    WHERE g.patientUserId = ${patientUserId} AND g.visibility = 'patient'
      AND a.status = 'approved' AND g.deliveryStatus IN ('pending','sent','failed')
    ORDER BY g.createdAt DESC, g.id DESC LIMIT 100`);
  return rows(result).map(row => ({
    id: String(row.id), version: Number(row.version), title: String(row.title ?? ""), content: String(row.content ?? ""),
    deliveryStatus: String(row.deliveryStatus), professionalName: String(row.professionalName ?? "Profissional"),
    createdAt: timestamp(row.createdAt),
  }));
}
