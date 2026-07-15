import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import {
  professionalAccessEvents,
  professionalFollowUpEvents,
  professionalFollowUps,
  professionalPatientAccesses,
  professionalProfiles,
} from "../../drizzle/schema";
import { getDb } from "../db";

export type ProfessionalAuthorizationStatus = "pending" | "approved" | "rejected" | "revoked";
export type ProfessionalFollowUpStatus = "active" | "paused" | "ended";
export type ProfessionalTransitionOrigin = "web" | "whatsapp" | "migration" | "system";

export function isProfessionalFollowUpTransitionAllowed(
  from: ProfessionalFollowUpStatus,
  to: ProfessionalFollowUpStatus,
) {
  if (from === to) return true;
  if (from === "active") return to === "paused" || to === "ended";
  if (from === "paused") return to === "active" || to === "ended";
  return false;
}

export type CanonicalProfessionalProfile = {
  userId: number;
  displayName: string;
  registrationNumber?: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
};

export type CanonicalProfessionalAccess = {
  id: string;
  professionalUserId: number;
  patientUserId: number;
  status: ProfessionalAuthorizationStatus;
  reason: string;
  requestedAt: number;
  approvedAt: number | null;
  revokedAt: number | null;
  rejectedAt: number | null;
  respondedAt: number | null;
  responseOrigin: "web" | "whatsapp" | null;
  responseDecision: "approved" | "rejected" | "revoked" | null;
  authorizationMessageStatus: "sent" | "failed" | "skipped" | null;
  authorizationMessageSentAt: number | null;
  authorizationMessageError: string | null;
};

export type CanonicalProfessionalFollowUp = {
  id: number;
  accessId: string;
  status: ProfessionalFollowUpStatus;
  statusChangedAt: number;
  statusChangedByUserId: number | null;
  reason: string | null;
  startedAt: number;
  endedAt: number | null;
};

export type CanonicalProfessionalHistoryEvent = {
  id: string;
  actorUserId: number | null;
  patientUserId: number;
  professionalUserId: number;
  eventType:
    | "access_requested"
    | "access_approved"
    | "access_rejected"
    | "access_revoked"
    | "follow_up_started"
    | "follow_up_paused"
    | "follow_up_resumed"
    | "follow_up_ended";
  createdAt: number;
};

export type CanonicalProfessionalAccessSaveOutcome = "created" | "updated" | "unchanged" | "conflict";

export type CanonicalProfessionalAccessSaveResult = {
  access: CanonicalProfessionalAccess;
  outcome: CanonicalProfessionalAccessSaveOutcome;
};

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type DbExecutor = Pick<Db, "select" | "insert" | "update">;

function toDate(value: number) {
  return new Date(value);
}

function toMillis(value: Date | string) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function activePairKey(access: Pick<CanonicalProfessionalAccess, "professionalUserId" | "patientUserId" | "status">) {
  return access.status === "pending" || access.status === "approved"
    ? `${access.professionalUserId}:${access.patientUserId}`
    : null;
}

function accessVersionAt(access: CanonicalProfessionalAccess) {
  return Math.max(
    access.requestedAt,
    access.approvedAt ?? 0,
    access.rejectedAt ?? 0,
    access.revokedAt ?? 0,
    access.respondedAt ?? 0,
    access.authorizationMessageSentAt ?? 0,
  );
}

const AUTHORIZATION_STATUS_PRECEDENCE: Record<ProfessionalAuthorizationStatus, number> = {
  pending: 1,
  rejected: 2,
  approved: 3,
  revoked: 4,
};

export function compareCanonicalProfessionalAccessVersions(
  left: CanonicalProfessionalAccess,
  right: CanonicalProfessionalAccess,
) {
  const timestampDifference = accessVersionAt(left) - accessVersionAt(right);
  if (timestampDifference !== 0) return timestampDifference;
  return AUTHORIZATION_STATUS_PRECEDENCE[left.status] - AUTHORIZATION_STATUS_PRECEDENCE[right.status];
}

function mapProfile(row: typeof professionalProfiles.$inferSelect): CanonicalProfessionalProfile {
  return {
    userId: row.userId,
    displayName: row.displayName,
    registrationNumber: row.registrationNumber ?? undefined,
    active: row.active,
    createdAt: toMillis(row.createdAt),
    updatedAt: toMillis(row.updatedAt),
  };
}

function mapAccess(row: typeof professionalPatientAccesses.$inferSelect): CanonicalProfessionalAccess {
  return {
    id: row.id,
    professionalUserId: row.professionalUserId,
    patientUserId: row.patientUserId,
    status: row.authorizationStatus,
    reason: row.reason,
    requestedAt: toMillis(row.requestedAt),
    approvedAt: row.approvedAt ? toMillis(row.approvedAt) : null,
    revokedAt: row.revokedAt ? toMillis(row.revokedAt) : null,
    rejectedAt: row.rejectedAt ? toMillis(row.rejectedAt) : null,
    respondedAt: row.respondedAt ? toMillis(row.respondedAt) : null,
    responseOrigin: row.responseOrigin,
    responseDecision: row.responseDecision,
    authorizationMessageStatus: row.authorizationMessageStatus,
    authorizationMessageSentAt: row.authorizationMessageSentAt ? toMillis(row.authorizationMessageSentAt) : null,
    authorizationMessageError: row.authorizationMessageError,
  };
}

function mapFollowUp(row: typeof professionalFollowUps.$inferSelect): CanonicalProfessionalFollowUp {
  return {
    id: row.id,
    accessId: row.accessId,
    status: row.status,
    statusChangedAt: toMillis(row.statusChangedAt),
    statusChangedByUserId: row.statusChangedByUserId,
    reason: row.reason,
    startedAt: toMillis(row.startedAt),
    endedAt: row.endedAt ? toMillis(row.endedAt) : null,
  };
}

function accessValues(access: CanonicalProfessionalAccess) {
  return {
    id: access.id,
    professionalUserId: access.professionalUserId,
    patientUserId: access.patientUserId,
    authorizationStatus: access.status,
    activePairKey: activePairKey(access),
    reason: access.reason,
    requestedAt: toDate(access.requestedAt),
    approvedAt: access.approvedAt ? toDate(access.approvedAt) : null,
    revokedAt: access.revokedAt ? toDate(access.revokedAt) : null,
    rejectedAt: access.rejectedAt ? toDate(access.rejectedAt) : null,
    respondedAt: access.respondedAt ? toDate(access.respondedAt) : null,
    responseOrigin: access.responseOrigin,
    responseDecision: access.responseDecision,
    authorizationMessageStatus: access.authorizationMessageStatus,
    authorizationMessageSentAt: access.authorizationMessageSentAt ? toDate(access.authorizationMessageSentAt) : null,
    authorizationMessageError: access.authorizationMessageError,
  };
}

async function findAccessById(db: DbExecutor, accessId: string, lockForUpdate = false) {
  const query = db.select().from(professionalPatientAccesses)
    .where(eq(professionalPatientAccesses.id, accessId)).limit(1);
  const rows = await (lockForUpdate ? query.for("update") : query);
  return rows[0] ? mapAccess(rows[0]) : null;
}

function canApplyAuthorizationTransition(from: ProfessionalAuthorizationStatus, to: ProfessionalAuthorizationStatus) {
  if (from === to) return true;
  if (from === "pending") return to === "approved" || to === "rejected" || to === "revoked";
  return from === "approved" && to === "revoked";
}

export function resolveCanonicalProfessionalAccessWrite(input: {
  incoming: CanonicalProfessionalAccess;
  existingById: CanonicalProfessionalAccess | null;
  existingByActivePair: CanonicalProfessionalAccess | null;
  origin: ProfessionalTransitionOrigin;
}): CanonicalProfessionalAccessSaveResult & { shouldWrite: boolean; previous: CanonicalProfessionalAccess | null } {
  const { incoming, existingById, existingByActivePair, origin } = input;

  if (existingById) {
    if (origin === "migration" && compareCanonicalProfessionalAccessVersions(existingById, incoming) >= 0) {
      return { access: existingById, outcome: "unchanged", shouldWrite: false, previous: existingById };
    }
    if (!canApplyAuthorizationTransition(existingById.status, incoming.status)) {
      return { access: existingById, outcome: "conflict", shouldWrite: false, previous: existingById };
    }
    return { access: incoming, outcome: "updated", shouldWrite: true, previous: existingById };
  }

  if (existingByActivePair) {
    if (origin !== "migration" || compareCanonicalProfessionalAccessVersions(existingByActivePair, incoming) >= 0) {
      return { access: existingByActivePair, outcome: "conflict", shouldWrite: false, previous: existingByActivePair };
    }
    if (!canApplyAuthorizationTransition(existingByActivePair.status, incoming.status)) {
      return { access: existingByActivePair, outcome: "conflict", shouldWrite: false, previous: existingByActivePair };
    }
    return {
      access: {
        ...incoming,
        id: existingByActivePair.id,
        professionalUserId: existingByActivePair.professionalUserId,
        patientUserId: existingByActivePair.patientUserId,
        requestedAt: Math.min(existingByActivePair.requestedAt, incoming.requestedAt),
      },
      outcome: "updated",
      shouldWrite: true,
      previous: existingByActivePair,
    };
  }

  return { access: incoming, outcome: "created", shouldWrite: true, previous: null };
}

async function ensureFollowUp(
  db: DbExecutor,
  access: CanonicalProfessionalAccess,
  actorUserId: number | null,
  occurredAt: number,
) {
  const existing = await db.select().from(professionalFollowUps)
    .where(eq(professionalFollowUps.accessId, access.id)).limit(1);
  if (!existing[0]) {
    await db.insert(professionalFollowUps).values({
      accessId: access.id,
      status: "active",
      statusChangedAt: toDate(occurredAt),
      statusChangedByUserId: actorUserId,
      startedAt: toDate(occurredAt),
    }).onDuplicateKeyUpdate({ set: { accessId: access.id } });
  }

  const rows = existing[0]
    ? existing
    : await db.select().from(professionalFollowUps)
      .where(eq(professionalFollowUps.accessId, access.id)).limit(1);
  if (!rows[0]) throw new Error("Não foi possível iniciar o acompanhamento profissional.");

  // Os chamadores mantêm lock no vínculo de autorização. A busca abaixo torna
  // o evento inicial idempotente e também repara follow-ups antigos sem evento.
  const initialEvents = await db.select({ id: professionalFollowUpEvents.id })
    .from(professionalFollowUpEvents)
    .where(and(
      eq(professionalFollowUpEvents.followUpId, rows[0].id),
      isNull(professionalFollowUpEvents.fromStatus),
      eq(professionalFollowUpEvents.toStatus, "active"),
    ))
    .limit(1);
  if (!initialEvents[0]) {
    await db.insert(professionalFollowUpEvents).values({
      followUpId: rows[0].id,
      fromStatus: null,
      toStatus: "active",
      actorUserId,
      occurredAt: toDate(occurredAt),
    });
  }
  return mapFollowUp(rows[0]);
}

export async function findCanonicalProfessionalProfile(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(professionalProfiles)
    .where(eq(professionalProfiles.userId, userId)).limit(1);
  return rows[0] ? mapProfile(rows[0]) : null;
}

export async function upsertCanonicalProfessionalProfile(profile: CanonicalProfessionalProfile) {
  const db = await getDb();
  if (!db) return false;
  await db.insert(professionalProfiles).values({
    userId: profile.userId,
    displayName: profile.displayName,
    registrationNumber: profile.registrationNumber ?? null,
    active: profile.active,
    createdAt: toDate(profile.createdAt),
    updatedAt: toDate(profile.updatedAt),
  }).onDuplicateKeyUpdate({
    set: {
      displayName: profile.displayName,
      registrationNumber: profile.registrationNumber ?? null,
      active: profile.active,
      updatedAt: toDate(profile.updatedAt),
    },
  });
  return true;
}

export async function listCanonicalAccessesByProfessional(professionalUserId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(professionalPatientAccesses)
    .where(eq(professionalPatientAccesses.professionalUserId, professionalUserId))
    .orderBy(desc(professionalPatientAccesses.requestedAt));
  return rows.map(mapAccess);
}

export async function listCanonicalAccessesByPatient(patientUserId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(professionalPatientAccesses)
    .where(eq(professionalPatientAccesses.patientUserId, patientUserId))
    .orderBy(desc(professionalPatientAccesses.requestedAt));
  return rows.map(mapAccess);
}

export async function findCanonicalAccessForPatient(patientUserId: number, accessId: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(professionalPatientAccesses).where(and(
    eq(professionalPatientAccesses.id, accessId),
    eq(professionalPatientAccesses.patientUserId, patientUserId),
  )).limit(1);
  return rows[0] ? mapAccess(rows[0]) : null;
}

export async function findCanonicalActiveAccess(professionalUserId: number, patientUserId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(professionalPatientAccesses)
    .where(eq(professionalPatientAccesses.activePairKey, `${professionalUserId}:${patientUserId}`))
    .limit(1);
  return rows[0] ? mapAccess(rows[0]) : null;
}

export async function saveCanonicalProfessionalAccess(input: {
  access: CanonicalProfessionalAccess;
  actorUserId: number | null;
  origin: ProfessionalTransitionOrigin;
  auditReason?: string | null;
}) {
  const db = await getDb();
  if (!db) return null;

  return db.transaction(async tx => {
    const existingById = await findAccessById(tx, input.access.id, true);
    const incomingPairKey = activePairKey(input.access);
    const existingByActivePair = !existingById && incomingPairKey
      ? await (async () => {
          const rows = await tx.select().from(professionalPatientAccesses)
            .where(eq(professionalPatientAccesses.activePairKey, incomingPairKey))
            .limit(1)
            .for("update");
          return rows[0] ? mapAccess(rows[0]) : null;
        })()
      : null;
    const resolution = resolveCanonicalProfessionalAccessWrite({
      incoming: input.access,
      existingById,
      existingByActivePair,
      origin: input.origin,
    });
    if (!resolution.shouldWrite) return { access: resolution.access, outcome: resolution.outcome };

    const values = accessValues(resolution.access);
    if (resolution.outcome === "created") {
      // No-op no conflito: uma instância concorrente pode ter criado o par
      // depois das leituras com lock. Nunca sobrescrevemos o vínculo vencedor.
      await tx.insert(professionalPatientAccesses).values(values).onDuplicateKeyUpdate({
        set: { id: sql`${professionalPatientAccesses.id}` },
      });
      const created = await findAccessById(tx, resolution.access.id);
      if (!created) {
        const winnerRows = incomingPairKey
          ? await tx.select().from(professionalPatientAccesses)
            .where(eq(professionalPatientAccesses.activePairKey, incomingPairKey)).limit(1)
          : [];
        const winner = winnerRows[0] ? mapAccess(winnerRows[0]) : null;
        if (!winner) throw new Error("Não foi possível persistir o vínculo profissional.");
        return { access: winner, outcome: "conflict" as const };
      }
    } else {
      await tx.update(professionalPatientAccesses).set({
        authorizationStatus: values.authorizationStatus,
        activePairKey: values.activePairKey,
        reason: values.reason,
        approvedAt: values.approvedAt,
        revokedAt: values.revokedAt,
        rejectedAt: values.rejectedAt,
        respondedAt: values.respondedAt,
        responseOrigin: values.responseOrigin,
        responseDecision: values.responseDecision,
        authorizationMessageStatus: values.authorizationMessageStatus,
        authorizationMessageSentAt: values.authorizationMessageSentAt,
        authorizationMessageError: values.authorizationMessageError,
      }).where(eq(professionalPatientAccesses.id, resolution.access.id));
    }

    const persisted = await findAccessById(tx, resolution.access.id);
    if (!persisted) throw new Error("Não foi possível recarregar o vínculo profissional persistido.");
    if (!resolution.previous || resolution.previous.status !== persisted.status) {
      await tx.insert(professionalAccessEvents).values({
        accessId: persisted.id,
        fromStatus: resolution.previous?.status ?? null,
        toStatus: persisted.status,
        actorUserId: input.actorUserId,
        origin: input.origin,
        reason: input.auditReason ?? null,
        occurredAt: toDate(persisted.respondedAt ?? persisted.requestedAt),
      });
    }
    if (persisted.status === "approved") {
      await ensureFollowUp(tx, persisted, input.actorUserId, persisted.approvedAt ?? Date.now());
    }
    return { access: persisted, outcome: resolution.outcome };
  });
}

export async function getCanonicalFollowUp(accessId: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(professionalFollowUps)
    .where(eq(professionalFollowUps.accessId, accessId)).limit(1);
  return rows[0] ? mapFollowUp(rows[0]) : null;
}

export async function listCanonicalProfessionalHistory(userId: number): Promise<CanonicalProfessionalHistoryEvent[] | null> {
  const db = await getDb();
  if (!db) return null;

  const accessScope = or(
    eq(professionalPatientAccesses.professionalUserId, userId),
    eq(professionalPatientAccesses.patientUserId, userId),
  );
  const [accessRows, followUpRows] = await Promise.all([
    db.select({ event: professionalAccessEvents, access: professionalPatientAccesses })
      .from(professionalAccessEvents)
      .innerJoin(professionalPatientAccesses, eq(professionalAccessEvents.accessId, professionalPatientAccesses.id))
      .where(accessScope),
    db.select({ event: professionalFollowUpEvents, access: professionalPatientAccesses })
      .from(professionalFollowUpEvents)
      .innerJoin(professionalFollowUps, eq(professionalFollowUpEvents.followUpId, professionalFollowUps.id))
      .innerJoin(professionalPatientAccesses, eq(professionalFollowUps.accessId, professionalPatientAccesses.id))
      .where(accessScope),
  ]);

  const accessEvents: CanonicalProfessionalHistoryEvent[] = accessRows.map(({ event, access }) => ({
    id: `access:${event.id}`,
    actorUserId: event.actorUserId,
    patientUserId: access.patientUserId,
    professionalUserId: access.professionalUserId,
    eventType: event.toStatus === "pending" ? "access_requested" : `access_${event.toStatus}`,
    createdAt: toMillis(event.occurredAt),
  }));
  const followUpEvents: CanonicalProfessionalHistoryEvent[] = followUpRows.map(({ event, access }) => ({
    id: `follow-up:${event.id}`,
    actorUserId: event.actorUserId,
    patientUserId: access.patientUserId,
    professionalUserId: access.professionalUserId,
    eventType: event.fromStatus === null
      ? "follow_up_started"
      : event.toStatus === "active"
        ? "follow_up_resumed"
        : event.toStatus === "paused"
          ? "follow_up_paused"
          : "follow_up_ended",
    createdAt: toMillis(event.occurredAt),
  }));
  return [...accessEvents, ...followUpEvents].sort((left, right) => right.createdAt - left.createdAt);
}

export async function transitionCanonicalFollowUp(input: {
  accessId: string;
  actorUserId: number;
  toStatus: ProfessionalFollowUpStatus;
  reason?: string;
  occurredAt?: number;
}) {
  const db = await getDb();
  if (!db) return null;
  const occurredAt = input.occurredAt ?? Date.now();

  return db.transaction(async tx => {
    const access = await findAccessById(tx, input.accessId, true);
    if (!access || access.status !== "approved") {
      throw new Error("A autorização profissional não está aprovada para alterar o acompanhamento.");
    }
    if (input.actorUserId !== access.professionalUserId && input.actorUserId !== access.patientUserId) {
      throw new Error("Usuário não autorizado a alterar este acompanhamento.");
    }
    const current = await ensureFollowUp(tx, access, input.actorUserId, access.approvedAt ?? occurredAt);
    if (current.status === input.toStatus) return current;
    const allowed = isProfessionalFollowUpTransitionAllowed(current.status, input.toStatus);
    if (!allowed) throw new Error("Transição de acompanhamento inválida.");

    await tx.update(professionalFollowUps).set({
      status: input.toStatus,
      statusChangedAt: toDate(occurredAt),
      statusChangedByUserId: input.actorUserId,
      reason: input.reason ?? null,
      endedAt: input.toStatus === "ended" ? toDate(occurredAt) : null,
    }).where(eq(professionalFollowUps.id, current.id));
    await tx.insert(professionalFollowUpEvents).values({
      followUpId: current.id,
      fromStatus: current.status,
      toStatus: input.toStatus,
      actorUserId: input.actorUserId,
      reason: input.reason ?? null,
      occurredAt: toDate(occurredAt),
    });
    const updated = await tx.select().from(professionalFollowUps)
      .where(eq(professionalFollowUps.id, current.id)).limit(1);
    if (!updated[0]) throw new Error("Acompanhamento profissional não encontrado após a transição.");
    return mapFollowUp(updated[0]);
  });
}
