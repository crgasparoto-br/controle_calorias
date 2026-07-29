import { sql } from "drizzle-orm";
import { getDb, logPersistenceWarning } from "../../db";
import { assertProfessionalResourceAccess } from "./entitlementAccess";
import type { ProfessionalPatientContextInput } from "./patientContextSchemas";
import { getProfessionalHistoryEventLabel } from "./historyPresentation";
import { getProfessionalProfile } from "./service";

type Row = Record<string, unknown>;
type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;

const OPTIONAL_HISTORY_WAIT_MS = 250;
const OPTIONAL_HISTORY_CACHE_TTL_MS = 10_000;
const OPTIONAL_HISTORY_TIMEOUT_TTL_MS = 1_000;
const OPTIONAL_HISTORY_CACHE_LIMIT = 500;
const HISTORY_TIMEOUT = Symbol("professional-patient-history-timeout");

const optionalHistoryCache = new Map<
  string,
  { expiresAt: number; row: Row | undefined }
>();
const optionalHistoryInFlight = new Map<string, Promise<Row | undefined>>();

function rows(result: unknown): Row[] {
  if (!Array.isArray(result)) return [];
  return (Array.isArray(result[0]) ? result[0] : result) as Row[];
}

function timestamp(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function optionalHistoryKey(professionalUserId: number, patientUserId: number) {
  return `${professionalUserId}:${patientUserId}`;
}

function storeOptionalHistory(
  key: string,
  row: Row | undefined,
  ttlMs = OPTIONAL_HISTORY_CACHE_TTL_MS
) {
  if (optionalHistoryCache.size >= OPTIONAL_HISTORY_CACHE_LIMIT) {
    optionalHistoryCache.clear();
  }
  optionalHistoryCache.set(key, {
    expiresAt: Date.now() + ttlMs,
    row,
  });
}

async function getOptionalHistoryWithinBudget(
  db: Database,
  professionalUserId: number,
  patientUserId: number
) {
  const key = optionalHistoryKey(professionalUserId, patientUserId);
  const cached = optionalHistoryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.row;
  if (cached) optionalHistoryCache.delete(key);

  let lookup = optionalHistoryInFlight.get(key);
  if (!lookup) {
    lookup = db
      .execute(sql`
        SELECT
          h.occurredAt AS lastProfessionalActivityAt,
          h.eventType AS lastProfessionalActivityType
        FROM professionalHistoryEvents h
        WHERE h.professionalUserId = ${professionalUserId}
          AND h.patientUserId = ${patientUserId}
        ORDER BY h.occurredAt DESC, h.id DESC
        LIMIT 1
      `)
      .then(result => {
        const row = rows(result)[0];
        storeOptionalHistory(key, row);
        return row;
      })
      .catch(error => {
        logPersistenceWarning("professional_patient_context_history", error);
        storeOptionalHistory(
          key,
          undefined,
          OPTIONAL_HISTORY_TIMEOUT_TTL_MS
        );
        return undefined;
      })
      .finally(() => {
        optionalHistoryInFlight.delete(key);
      });
    optionalHistoryInFlight.set(key, lookup);
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedResult = await Promise.race([
    lookup,
    new Promise<typeof HISTORY_TIMEOUT>(resolve => {
      timeout = setTimeout(() => resolve(HISTORY_TIMEOUT), OPTIONAL_HISTORY_WAIT_MS);
    }),
  ]);
  if (timeout) clearTimeout(timeout);

  if (timedResult === HISTORY_TIMEOUT) {
    storeOptionalHistory(key, undefined, OPTIONAL_HISTORY_TIMEOUT_TTL_MS);
    return undefined;
  }
  return timedResult;
}

export function _forTestOnly_clearProfessionalPatientContextMetadataCache() {
  optionalHistoryCache.clear();
  optionalHistoryInFlight.clear();
}

export async function getProfessionalPatientContext(
  professionalUserId: number,
  input: ProfessionalPatientContextInput
) {
  const profile = await getProfessionalProfile(professionalUserId);
  if (!profile?.active) {
    throw new Error("O contexto profissional não está disponível.");
  }

  await assertProfessionalResourceAccess(professionalUserId, input.resource);

  const db = await getDb();
  if (!db) {
    throw new Error(
      "Não foi possível confirmar a autorização do paciente neste momento."
    );
  }

  const result = await db.execute(sql`
    SELECT
      a.id AS authorizationId,
      a.patientUserId,
      u.name AS patientName,
      u.email AS patientEmail,
      COALESCE(t.status, 'not_started') AS trackingStatus,
      t.nextReviewAt
    FROM professionalPatientAuthorizations a
    INNER JOIN users u ON u.id = a.patientUserId
    LEFT JOIN professionalPatientTrackings t ON t.authorizationId = a.id
    WHERE a.professionalUserId = ${professionalUserId}
      AND a.patientUserId = ${input.patientId}
      AND a.status = 'approved'
    ORDER BY a.approvedAt DESC, a.id DESC
    LIMIT 1
  `);
  const context = rows(result)[0];

  if (!context) {
    throw new Error("O acesso a este paciente não está mais disponível.");
  }

  const trackingStatus = String(context.trackingStatus) as
    | "not_started"
    | "active"
    | "paused"
    | "ended";
  const shared = {
    patientId: Number(context.patientUserId),
    displayName:
      (context.patientName ? String(context.patientName) : null) ??
      (context.patientEmail ? String(context.patientEmail) : null) ??
      "Paciente",
    authorizationStatus: "approved" as const,
    trackingStatus,
  };

  if (trackingStatus === "ended") {
    return shared;
  }

  const lastHistory = await getOptionalHistoryWithinBudget(
    db,
    professionalUserId,
    input.patientId
  );
  const lastActivityAt = timestamp(lastHistory?.lastProfessionalActivityAt);
  const lastActivityType = lastHistory?.lastProfessionalActivityType
    ? String(lastHistory.lastProfessionalActivityType)
    : null;

  return {
    ...shared,
    authorizationId: String(context.authorizationId),
    lastActivityAt,
    lastActivityLabel:
      lastActivityAt !== null && lastActivityType
        ? getProfessionalHistoryEventLabel(lastActivityType)
        : null,
    nextReviewAt: timestamp(context.nextReviewAt),
  };
}
