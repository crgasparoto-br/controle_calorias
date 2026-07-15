import crypto from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { userPreferences, users, whatsappConnections } from "../../../drizzle/schema";
import { invokeLLM } from "../../_core/llm";
import { getDb, getUserWhatsappConnection, listUserMeals, logInferenceEvent, logPersistenceWarning } from "../../db";
import { getPeriodReportBundle, getWeeklyReportBundle } from "../insights/service";
import { redactSensitiveText, safeLogDetail } from "../../privacy";
import { getNutritionGoal } from "../goals/service";
import { buildWhatsAppCallbackId } from "../whatsapp/interactiveCallback";
import { buttonsReply, type WhatsAppLogicalReply } from "../whatsapp/replyContract";
import { sendWhatsAppLogicalReply } from "../whatsapp/replyTransport";
import { buildWhatsAppCallbackResourceNotFoundReplyMessage } from "../whatsapp/replyMessages";
import {
  createDrizzleWhatsAppPendingOperationRepository,
  type WhatsAppPendingOperationRecord,
} from "../../repositories/whatsappPendingOperationRepository";
import {
  findCanonicalAccessForPatient,
  findCanonicalActiveAccess,
  findCanonicalProfessionalProfile,
  getCanonicalFollowUp,
  isProfessionalFollowUpTransitionAllowed,
  listCanonicalAccessesByPatient,
  listCanonicalAccessesByProfessional,
  listCanonicalProfessionalHistory,
  saveCanonicalProfessionalAccess,
  compareCanonicalProfessionalAccessVersions,
  transitionCanonicalFollowUp,
  upsertCanonicalProfessionalProfile,
  type ProfessionalFollowUpStatus,
  type CanonicalProfessionalFollowUp,
  type ProfessionalTransitionOrigin,
} from "../../repositories/professionalRepository";

export const PENDING_PROFESSIONAL_ACCESS_TYPE = "professional_access";
const PENDING_PROFESSIONAL_ACCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PENDING_PROFESSIONAL_ACCESS_ORIGIN = "professionals/service";
const AUTHORIZE_ACTION = "authorize";
const REJECT_ACTION = "reject";
const professionalAccessPendingOperationRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});
import {
  professionalPatientAnswerSchema,
  type ProfessionalCommentInput,
  type ProfessionalGoalSuggestionInput,
  type ProfessionalGoalSuggestionStatus,
  type ProfessionalMealSuggestionInput,
  type ProfessionalMealSuggestionStatus,
  type ProfessionalPatientAnswer,
  type ProfessionalPatientQuestionInput,
  type ProfessionalProfileInput,
  type RequestPatientAccessInput,
} from "./schemas";

type AccessStatus = "pending" | "approved" | "revoked" | "rejected";
type AccessResponseOrigin = "web" | "whatsapp";
type AccessResponseDecision = "approved" | "rejected" | "revoked";
type AuthorizationMessageStatus = "sent" | "failed" | "skipped";

type ProfessionalProfile = {
  userId: number;
  displayName: string;
  registrationNumber?: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
};

export type ProfessionalPatientAccess = {
  id: string;
  professionalUserId: number;
  patientUserId: number;
  status: AccessStatus;
  reason: string;
  requestedAt: number;
  approvedAt: number | null;
  revokedAt: number | null;
  rejectedAt: number | null;
  respondedAt: number | null;
  responseOrigin: AccessResponseOrigin | null;
  responseDecision: AccessResponseDecision | null;
  authorizationMessageStatus: AuthorizationMessageStatus | null;
  authorizationMessageSentAt: number | null;
  authorizationMessageError: string | null;
};

export type ProfessionalAccessReconciliationResult = {
  patientUserId: number;
  reconciledCount: number;
  accessIds: string[];
};

type ProfessionalComment = {
  id: string;
  professionalUserId: number;
  patientUserId: number;
  comment: string;
  createdAt: number;
};

type GoalSuggestion = {
  id: string;
  professionalUserId: number;
  patientUserId: number;
  rationale: string;
  status: ProfessionalGoalSuggestionStatus;
  goal: ProfessionalGoalSuggestionInput["goal"];
  createdAt: number;
  sentAt: number | null;
  respondedAt: number | null;
};

type MealSuggestion = {
  id: string;
  professionalUserId: number;
  patientUserId: number;
  mealLabel: string;
  title: string;
  description: string;
  rationale: string;
  notes?: string;
  status: ProfessionalMealSuggestionStatus;
  createdAt: number;
  sentAt: number | null;
  respondedAt: number | null;
};

type HistoryEvent = {
  id: string;
  actorUserId: number | null;
  patientUserId: number;
  professionalUserId: number;
  eventType:
    | "profile_upserted"
    | "access_requested"
    | "access_approved"
    | "access_rejected"
    | "access_revoked"
    | "access_authorization_whatsapp_sent"
    | "access_authorization_whatsapp_failed"
    | "access_reconciled"
    | "follow_up_started"
    | "follow_up_paused"
    | "follow_up_resumed"
    | "follow_up_ended"
    | "comment_created"
    | "goal_suggested"
    | "meal_suggested"
    | "patient_question_answered";
  createdAt: number;
};

type UserSummary = {
  userId: number;
  name: string | null;
  email: string | null;
};

type AuthorizationSendResult = {
  status: AuthorizationMessageStatus;
  detail: string;
  access: ProfessionalPatientAccess;
};

const PROFESSIONAL_AI_NOTICE = "Resposta educativa para apoiar a análise profissional. Não substitui julgamento clínico, diagnóstico, prescrição médica ou decisão compartilhada com a pessoa acompanhada.";
const PROFESSIONAL_PROFILE_PREFERENCE_KEY = "professional_profile_v1";
const PROFESSIONAL_ACCESSES_PREFERENCE_KEY = "professional_accesses_v1";
const PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY = "patient_professional_access_requests_v1";
const BRAZIL_COUNTRY_CODE = "55";
const LEGACY_ACCESS_MIGRATION_INTERVAL_MS = 60_000;

const profiles = new Map<number, ProfessionalProfile>();
const accesses = new Map<string, ProfessionalPatientAccess>();
const followUps = new Map<string, CanonicalProfessionalFollowUp>();
const comments: ProfessionalComment[] = [];
const goalSuggestions: GoalSuggestion[] = [];
const mealSuggestions: MealSuggestion[] = [];
const history: HistoryEvent[] = [];
let legacyAccessMigrationPromise: Promise<void> | null = null;
let legacyAccessMigrationLastCompletedAt = 0;

export function _forTestOnly_setAccessInMap(access: ProfessionalPatientAccess) {
  accesses.set(access.id, access);
}

export function _forTestOnly_setFollowUpInMap(followUp: CanonicalProfessionalFollowUp) {
  followUps.set(followUp.accessId, followUp);
}

function pushHistory(event: Omit<HistoryEvent, "id" | "createdAt">) {
  history.push({ id: crypto.randomUUID(), createdAt: Date.now(), ...event });
}

function publicAuthorizationMessageError(access: ProfessionalPatientAccess) {
  if (access.authorizationMessageStatus === "failed") {
    return "Não foi possível enviar a autorização pelo WhatsApp. A solicitação continua disponível na plataforma.";
  }
  if (access.authorizationMessageStatus === "skipped") {
    return "A autorização não foi enviada pelo WhatsApp. A solicitação continua disponível na plataforma.";
  }
  return null;
}

function publicAccess(access: ProfessionalPatientAccess) {
  return {
    id: access.id,
    professionalUserId: access.professionalUserId,
    patientUserId: access.patientUserId,
    status: access.status,
    reason: access.reason,
    requestedAt: access.requestedAt,
    approvedAt: access.approvedAt,
    revokedAt: access.revokedAt,
    rejectedAt: access.rejectedAt,
    respondedAt: access.respondedAt,
    responseOrigin: access.responseOrigin,
    responseDecision: access.responseDecision,
    authorizationMessageStatus: access.authorizationMessageStatus,
    authorizationMessageSentAt: access.authorizationMessageSentAt,
    authorizationMessageError: publicAuthorizationMessageError(access),
  };
}

function normalizeContact(value: string) {
  return value.trim();
}

function normalizePhoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

export function buildPhoneLookupCandidates(value: string) {
  const trimmed = value.trim();
  const digits = normalizePhoneDigits(value);
  const candidates = new Set<string>();

  if (trimmed) candidates.add(trimmed);
  if (digits) {
    candidates.add(digits);
    candidates.add(`+${digits}`);

    if (digits.length === 10 || digits.length === 11) {
      const brazilianDigits = `${BRAZIL_COUNTRY_CODE}${digits}`;
      candidates.add(brazilianDigits);
      candidates.add(`+${brazilianDigits}`);
    }

    if (digits.startsWith(BRAZIL_COUNTRY_CODE) && digits.length > BRAZIL_COUNTRY_CODE.length) {
      const nationalDigits = digits.slice(BRAZIL_COUNTRY_CODE.length);
      candidates.add(nationalDigits);
      candidates.add(`+${nationalDigits}`);
    }
  }

  return Array.from(candidates).filter(Boolean);
}

function isEmailContact(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function responseTimestamp(status: ProfessionalGoalSuggestionStatus | ProfessionalMealSuggestionStatus, now: number) {
  return ["accepted", "refused", "cancelled"].includes(status) ? now : null;
}

function isAccessStatus(value: unknown): value is AccessStatus {
  return value === "pending" || value === "approved" || value === "revoked" || value === "rejected";
}

function isAccessResponseOrigin(value: unknown): value is AccessResponseOrigin {
  return value === "web" || value === "whatsapp";
}

function isAccessResponseDecision(value: unknown): value is AccessResponseDecision {
  return value === "approved" || value === "rejected" || value === "revoked";
}

function isAuthorizationMessageStatus(value: unknown): value is AuthorizationMessageStatus {
  return value === "sent" || value === "failed" || value === "skipped";
}

function isValidLegacyTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 4_102_444_800_000;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function firstName(value: string | null | undefined) {
  return value?.trim().split(/\s+/)[0] || "Profissional";
}

export function buildProfessionalAccessDecisionCode(accessId: string) {
  return accessId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase();
}

export function buildProfessionalAccessAuthorizationMessage(input: {
  professionalDisplayName: string;
  reason: string;
  accessId: string;
}) {
  const code = buildProfessionalAccessDecisionCode(input.accessId);
  return [
    `${input.professionalDisplayName} solicitou autorização para acompanhar seus registros no Controle de Calorias.`,
    `Motivo: ${input.reason}`,
    "",
    "Para responder pelo WhatsApp, envie uma das opções abaixo:",
    `AUTORIZAR ${code}`,
    `NEGAR ${code}`,
    "",
    "Ao autorizar, você permite que o profissional veja seus dados de acompanhamento. Você pode revogar esse vínculo depois pela plataforma.",
  ].join("\n");
}

function normalizeDecisionText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function parseProfessionalAccessWhatsappDecision(text: string): "approved" | "rejected" | null {
  const normalized = normalizeDecisionText(text);
  if (!normalized) return null;

  if (/\b(negar|nego|negado|recusar|recuso|recusado|rejeitar|rejeito|nao|não)\b/.test(normalized)) {
    return "rejected";
  }
  if (/\b(autorizar|autorizo|autorizado|aprovar|aprovo|aprovado|aceitar|aceito|sim)\b/.test(normalized)) {
    return "approved";
  }
  return null;
}

function normalizeStoredAccess(value: Partial<ProfessionalPatientAccess>): ProfessionalPatientAccess | null {
  if (
    typeof value.id !== "string" || value.id.length === 0 || value.id.length > 64 ||
    !isPositiveInteger(value.professionalUserId) ||
    !isPositiveInteger(value.patientUserId) ||
    value.professionalUserId === value.patientUserId ||
    !isAccessStatus(value.status) ||
    typeof value.reason !== "string" || value.reason.length > 500 ||
    !isValidLegacyTimestamp(value.requestedAt)
  ) {
    return null;
  }

  return {
    id: value.id,
    professionalUserId: value.professionalUserId,
    patientUserId: value.patientUserId,
    status: value.status,
    reason: value.reason,
    requestedAt: value.requestedAt,
    approvedAt: isValidLegacyTimestamp(value.approvedAt) ? value.approvedAt : null,
    revokedAt: isValidLegacyTimestamp(value.revokedAt) ? value.revokedAt : null,
    rejectedAt: isValidLegacyTimestamp(value.rejectedAt) ? value.rejectedAt : null,
    respondedAt: isValidLegacyTimestamp(value.respondedAt) ? value.respondedAt : null,
    responseOrigin: isAccessResponseOrigin(value.responseOrigin) ? value.responseOrigin : null,
    responseDecision: isAccessResponseDecision(value.responseDecision) ? value.responseDecision : null,
    authorizationMessageStatus: isAuthorizationMessageStatus(value.authorizationMessageStatus) ? value.authorizationMessageStatus : null,
    authorizationMessageSentAt: isValidLegacyTimestamp(value.authorizationMessageSentAt) ? value.authorizationMessageSentAt : null,
    authorizationMessageError: typeof value.authorizationMessageError === "string" ? safeLogDetail(value.authorizationMessageError) : null,
  };
}

function parseStoredAccesses(userId: number, preferenceKey: string, value: string) {
  try {
    const parsed = JSON.parse(value) as Array<Partial<ProfessionalPatientAccess>>;
    if (!Array.isArray(parsed)) return { accesses: [], totalCount: 0, rejectedCount: 1, validArray: false };

    const accesses: ProfessionalPatientAccess[] = [];
    let rejectedCount = 0;
    for (const candidate of parsed) {
      const access = normalizeStoredAccess(candidate);
      const belongsToPreference = access && (preferenceKey === PROFESSIONAL_ACCESSES_PREFERENCE_KEY
        ? access.professionalUserId === userId
        : access.patientUserId === userId);
      if (access && belongsToPreference) accesses.push(access);
      else rejectedCount += 1;
    }
    return { accesses, totalCount: parsed.length, rejectedCount, validArray: true };
  } catch {
    return { accesses: [], totalCount: 0, rejectedCount: 1, validArray: false };
  }
}

function reportInvalidLegacyPreference(userId: number, preferenceKey: string, rejectedCount = 1, totalCount = 0) {
  logPersistenceWarning(
    "Professional legacy preference ignored",
    new Error(`Preferência profissional com ${rejectedCount} item(ns) rejeitado(s) de ${totalCount} para o usuário #${userId} na chave ${preferenceKey}.`),
  );
}

async function migrateLegacyAccessPreferences() {
  const db = await getDb();
  if (!db) return;
  if (legacyAccessMigrationPromise) return legacyAccessMigrationPromise;
  if (Date.now() - legacyAccessMigrationLastCompletedAt < LEGACY_ACCESS_MIGRATION_INTERVAL_MS) return;

  legacyAccessMigrationPromise = (async () => {
    const rows = await db.select().from(userPreferences).where(or(
      eq(userPreferences.preferenceKey, PROFESSIONAL_ACCESSES_PREFERENCE_KEY),
      eq(userPreferences.preferenceKey, PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY),
    ));
    const byId = new Map<string, ProfessionalPatientAccess>();
    for (const row of rows) {
      const parsed = parseStoredAccesses(row.userId, row.preferenceKey, row.preferenceValue);
      if (!parsed.validArray || parsed.rejectedCount > 0) {
        reportInvalidLegacyPreference(row.userId, row.preferenceKey, parsed.rejectedCount, parsed.totalCount);
      }
      for (const access of parsed.accesses) {
        const current = byId.get(access.id);
        if (!current || compareCanonicalProfessionalAccessVersions(access, current) > 0) byId.set(access.id, access);
      }
    }
    for (const access of byId.values()) {
      await saveCanonicalProfessionalAccess({
        access,
        actorUserId: access.status === "pending" ? access.professionalUserId : access.patientUserId,
        origin: "migration",
      });
    }
    legacyAccessMigrationLastCompletedAt = Date.now();
  })()
    .catch(error => {
      logPersistenceWarning("Professional legacy access migration failed", error);
      throw new Error("Não foi possível carregar os vínculos profissionais persistidos.");
    })
    .finally(() => {
      // Durante rollout, instâncias antigas ainda podem escrever somente nas
      // preferências. O backfill é repetido com intervalo mínimo para absorver
      // essas escritas sem executar um scan global a cada requisição.
      legacyAccessMigrationPromise = null;
    });
  return legacyAccessMigrationPromise;
}

function mergeAccesses(current: ProfessionalPatientAccess[], nextAccess: ProfessionalPatientAccess) {
  const next = current.filter(access => access.id !== nextAccess.id);
  next.push(nextAccess);
  return next.sort((a, b) => b.requestedAt - a.requestedAt);
}

async function loadPersistedAccesses(userId: number, preferenceKey: string) {
  const db = await getDb();
  if (!db) {
    return Array.from(accesses.values()).filter(access => preferenceKey === PROFESSIONAL_ACCESSES_PREFERENCE_KEY
      ? access.professionalUserId === userId
      : access.patientUserId === userId,
    );
  }

  await migrateLegacyAccessPreferences();
  const loadedAccesses = preferenceKey === PROFESSIONAL_ACCESSES_PREFERENCE_KEY
    ? await listCanonicalAccessesByProfessional(userId) ?? []
    : await listCanonicalAccessesByPatient(userId) ?? [];
  loadedAccesses.forEach(access => accesses.set(access.id, access));
  return loadedAccesses;
}

async function loadProfessionalAccessesForPatient(patientUserId: number): Promise<ProfessionalPatientAccess[]> {
  const db = await getDb();
  if (!db) {
    return Array.from(accesses.values()).filter(a => a.patientUserId === patientUserId);
  }

  await migrateLegacyAccessPreferences();
  return await listCanonicalAccessesByPatient(patientUserId) ?? [];
}

async function loadPatientAccessRequestState(patientUserId: number) {
  const [patientAccesses, professionalSideAccesses] = await Promise.all([
    loadPersistedAccesses(patientUserId, PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY),
    loadProfessionalAccessesForPatient(patientUserId),
  ]);

  const patientAccessIds = new Set(patientAccesses.map(access => access.id));
  const missing = professionalSideAccesses.filter(access => !patientAccessIds.has(access.id));
  return {
    patientAccesses: [...patientAccesses, ...missing],
    missing,
  };
}

async function persistAccessesForUser(userId: number, preferenceKey: string, nextAccesses: ProfessionalPatientAccess[]) {
  const db = await getDb();
  if (!db) return;

  await db.insert(userPreferences).values({
    userId,
    preferenceKey,
    preferenceValue: JSON.stringify(nextAccesses.map(publicAccess)),
  }).onDuplicateKeyUpdate({
    set: {
      preferenceValue: JSON.stringify(nextAccesses.map(publicAccess)),
    },
  });
}

async function persistAccessForBothSides(
  access: ProfessionalPatientAccess,
  context: { actorUserId?: number | null; origin?: ProfessionalTransitionOrigin; auditReason?: string | null } = {},
) {
  const canonicalResult = await saveCanonicalProfessionalAccess({
    access,
    actorUserId: context.actorUserId ?? null,
    origin: context.origin ?? "system",
    auditReason: context.auditReason,
  });
  const persisted = canonicalResult?.access ?? access;
  const outcome = canonicalResult?.outcome ?? "updated";
  accesses.set(persisted.id, persisted);

  const [professionalAccesses, patientAccesses] = await Promise.all([
    loadPersistedAccesses(persisted.professionalUserId, PROFESSIONAL_ACCESSES_PREFERENCE_KEY),
    loadPersistedAccesses(persisted.patientUserId, PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY),
  ]);

  await Promise.all([
    persistAccessesForUser(persisted.professionalUserId, PROFESSIONAL_ACCESSES_PREFERENCE_KEY, mergeAccesses(professionalAccesses, persisted)),
    persistAccessesForUser(persisted.patientUserId, PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY, mergeAccesses(patientAccesses, persisted)),
  ]);
  return { access: persisted, outcome };
}

export async function reconcilePatientAccessRequests(patientUserId: number): Promise<ProfessionalAccessReconciliationResult> {
  const { missing } = await loadPatientAccessRequestState(patientUserId);
  if (missing.length === 0) {
    return { patientUserId, reconciledCount: 0, accessIds: [] };
  }

  await Promise.all(missing.map(access => persistAccessForBothSides(access)));
  missing.forEach(access => {
    pushHistory({
      actorUserId: patientUserId,
      professionalUserId: access.professionalUserId,
      patientUserId,
      eventType: "access_reconciled",
    });
  });
  logInferenceEvent({
    userId: patientUserId,
    origin: "admin",
    status: "warning",
    eventType: "professional.access.reconciled",
    detail: `${missing.length} vínculo(s) profissional-paciente reconciliado(s) para a pessoa acompanhada #${patientUserId}.`,
  });

  return {
    patientUserId,
    reconciledCount: missing.length,
    accessIds: missing.map(access => access.id),
  };
}

async function parseStoredProfessionalProfile(
  userId: number,
  value: string,
  fallback?: { createdAt?: Date; updatedAt?: Date },
): Promise<ProfessionalProfile | null> {
  try {
    const parsed = JSON.parse(value) as Partial<ProfessionalProfile>;
    if (
      parsed.userId !== userId ||
      typeof parsed.displayName !== "string" ||
      parsed.displayName.trim().length < 2 ||
      parsed.displayName.length > 120 ||
      (parsed.registrationNumber !== undefined && (typeof parsed.registrationNumber !== "string" || parsed.registrationNumber.length > 80)) ||
      typeof parsed.active !== "boolean"
    ) {
      return null;
    }

    return {
      userId,
      displayName: parsed.displayName,
      registrationNumber: typeof parsed.registrationNumber === "string" ? parsed.registrationNumber : undefined,
      active: parsed.active,
      createdAt: isValidLegacyTimestamp(parsed.createdAt) ? parsed.createdAt : fallback?.createdAt?.getTime() ?? Date.now(),
      updatedAt: isValidLegacyTimestamp(parsed.updatedAt) ? parsed.updatedAt : fallback?.updatedAt?.getTime() ?? Date.now(),
    };
  } catch {
    return null;
  }
}

async function persistProfessionalProfile(profile: ProfessionalProfile) {
  const db = await getDb();
  if (!db) return;

  await upsertCanonicalProfessionalProfile(profile);

  await db.insert(userPreferences).values({
    userId: profile.userId,
    preferenceKey: PROFESSIONAL_PROFILE_PREFERENCE_KEY,
    preferenceValue: JSON.stringify(profile),
  }).onDuplicateKeyUpdate({
    set: {
      preferenceValue: JSON.stringify(profile),
    },
  });
}

async function loadPersistedProfessionalProfile(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const canonical = await findCanonicalProfessionalProfile(userId);

  const rows = await db
    .select()
    .from(userPreferences)
    .where(and(eq(userPreferences.userId, userId), eq(userPreferences.preferenceKey, PROFESSIONAL_PROFILE_PREFERENCE_KEY)))
    .limit(1);
  const profile = rows[0]?.preferenceValue
    ? await parseStoredProfessionalProfile(userId, rows[0].preferenceValue, rows[0])
    : null;
  const resolved = profile && (!canonical || profile.updatedAt > canonical.updatedAt) ? profile : canonical;
  if (resolved) {
    if (resolved === profile) await upsertCanonicalProfessionalProfile(profile);
    profiles.set(userId, resolved);
  } else if (rows[0]?.preferenceValue) {
    reportInvalidLegacyPreference(userId, PROFESSIONAL_PROFILE_PREFERENCE_KEY);
  }
  return resolved;
}

async function assertActiveProfessionalProfile(userId: number) {
  const profile = await getProfessionalProfile(userId);
  if (!profile?.active) {
    throw new Error("Ative seu perfil profissional em Configurações antes de acessar a área Profissional.");
  }
  return profile;
}

function parseAssistantContent(content: unknown) {
  const text = Array.isArray(content)
    ? content.map(part => ("text" in part ? part.text : "")).join("\n")
    : String(content ?? "");
  return JSON.parse(text);
}

async function sendProfessionalAccessAuthorizationWhatsapp(
  access: ProfessionalPatientAccess,
  professionalProfile: ProfessionalProfile,
): Promise<AuthorizationSendResult> {
  const connection = await getUserWhatsappConnection(access.patientUserId);
  const attemptedAt = Date.now();

  if (!connection?.phoneNumber || connection.status === "disabled") {
    const detail = "Pessoa acompanhada sem WhatsApp ativo vinculado para receber a autorização.";
    const skipped: ProfessionalPatientAccess = {
      ...access,
      authorizationMessageStatus: "skipped",
      authorizationMessageSentAt: null,
      authorizationMessageError: detail,
    };
    const persistence = await persistAccessForBothSides(skipped);
    logInferenceEvent({
      userId: access.professionalUserId,
      origin: "web",
      status: "warning",
      eventType: "professional.access.authorization_whatsapp_skipped",
      detail,
    });
    return { status: "skipped", detail, access: persistence.access };
  }

  const message = buildProfessionalAccessAuthorizationMessage({
    professionalDisplayName: professionalProfile.displayName,
    reason: access.reason,
    accessId: access.id,
  });
  const pendingOperation = await professionalAccessPendingOperationRepository.createPendingOperation({
    userId: access.patientUserId,
    type: PENDING_PROFESSIONAL_ACCESS_TYPE,
    origin: PENDING_PROFESSIONAL_ACCESS_ORIGIN,
    ttlMs: PENDING_PROFESSIONAL_ACCESS_TTL_MS,
    target: { accessId: access.id },
  });
  const reply: WhatsAppLogicalReply = pendingOperation
    ? buttonsReply(message, [
        { id: buildWhatsAppCallbackId(pendingOperation.id, AUTHORIZE_ACTION), title: "Autorizar" },
        { id: buildWhatsAppCallbackId(pendingOperation.id, REJECT_ACTION), title: "Recusar" },
      ])
    : { kind: "functional", messages: [{ type: "text", body: message }] };
  const sendResult = await sendWhatsAppLogicalReply(connection.phoneNumber, reply);
  const result = { ok: sendResult.primaryOk, detail: sendResult.sends[0]?.detail ?? "Falha desconhecida ao enviar autorização pelo WhatsApp." };
  const safeTechnicalDetail = safeLogDetail(result.detail);
  const publicFailureDetail = "Não foi possível enviar a autorização pelo WhatsApp. A solicitação continua disponível na plataforma.";
  const sent: ProfessionalPatientAccess = result.ok
    ? {
        ...access,
        authorizationMessageStatus: "sent",
        authorizationMessageSentAt: attemptedAt,
        authorizationMessageError: null,
      }
    : {
        ...access,
        authorizationMessageStatus: "failed",
        authorizationMessageSentAt: null,
        authorizationMessageError: safeTechnicalDetail,
      };

  const persistence = await persistAccessForBothSides(sent);
  pushHistory({
    actorUserId: access.professionalUserId,
    professionalUserId: access.professionalUserId,
    patientUserId: access.patientUserId,
    eventType: result.ok ? "access_authorization_whatsapp_sent" : "access_authorization_whatsapp_failed",
  });
  logInferenceEvent({
    userId: access.professionalUserId,
    origin: "web",
    status: result.ok ? "success" : "warning",
    eventType: result.ok ? "professional.access.authorization_whatsapp_sent" : "professional.access.authorization_whatsapp_failed",
    detail: result.ok
      ? `Autorização profissional enviada ao WhatsApp da pessoa acompanhada #${access.patientUserId}.`
      : safeTechnicalDetail,
  });

  return {
    status: result.ok ? "sent" : "failed",
    detail: result.ok ? "Mensagem de autorização enviada pelo WhatsApp." : publicFailureDetail,
    access: persistence.access,
  };
}

function buildDecisionReply(decision: "approved" | "rejected", professionalProfile: ProfessionalProfile | null) {
  const professionalName = firstName(professionalProfile?.displayName);
  if (decision === "approved") {
    return `Autorização confirmada. ${professionalName} já pode acompanhar seus dados autorizados no Controle de Calorias.`;
  }
  return `Autorização recusada. ${professionalName} não terá acesso aos seus dados de acompanhamento.`;
}

function findPendingAccessFromWhatsappText(pendingAccesses: ProfessionalPatientAccess[], text: string) {
  const normalized = normalizeDecisionText(text).toUpperCase();
  const accessByCode = pendingAccesses.find(access => normalized.includes(buildProfessionalAccessDecisionCode(access.id)));
  if (accessByCode) return accessByCode;
  return pendingAccesses.length === 1 ? pendingAccesses[0] : null;
}

async function applyProfessionalAccessWhatsappDecision(
  patientUserId: number,
  access: ProfessionalPatientAccess,
  decision: "approved" | "rejected",
  responseOrigin: AccessResponseOrigin,
): Promise<{ handled: true; action: string; reply: string; eventType: string; detail: string; data: ReturnType<typeof publicAccess> }> {
  const now = Date.now();
  const updated: ProfessionalPatientAccess = decision === "approved"
    ? {
        ...access,
        status: "approved",
        approvedAt: now,
        revokedAt: null,
        rejectedAt: null,
        respondedAt: now,
        responseOrigin,
        responseDecision: "approved",
      }
    : {
        ...access,
        status: "rejected",
        approvedAt: null,
        revokedAt: null,
        rejectedAt: now,
        respondedAt: now,
        responseOrigin,
        responseDecision: "rejected",
      };

  const persistence = await persistAccessForBothSides(updated, {
    actorUserId: patientUserId,
    origin: responseOrigin,
  });
  const persisted = persistence.access;
  const professionalProfile = await getProfessionalProfile(access.professionalUserId);
  if (persisted.status !== decision) {
    return {
      handled: true,
      action: "professional_access_decision_conflict",
      reply: "Essa solicitação já foi respondida em outra sessão. Consulte o estado atual na plataforma antes de tentar novamente.",
      eventType: "professional.access.whatsapp_decision_conflict",
      detail: `Decisão concorrente ignorada para a solicitação profissional ${persisted.id}; estado canônico preservado como ${persisted.status}.`,
      data: publicAccess(persisted),
    };
  }
  pushHistory({
    actorUserId: patientUserId,
    professionalUserId: access.professionalUserId,
    patientUserId,
    eventType: decision === "approved" ? "access_approved" : "access_rejected",
  });

  const action = decision === "approved" ? "professional_access_approved" : "professional_access_rejected";
  return {
    handled: true,
    action,
    reply: buildDecisionReply(decision, professionalProfile),
    eventType: `professional.access.whatsapp_${decision}`,
    detail: `Solicitação de acompanhamento ${decision === "approved" ? "aprovada" : "recusada"} via ${responseOrigin === "whatsapp" ? "WhatsApp (texto)" : responseOrigin} pela pessoa acompanhada #${patientUserId}.`,
    data: publicAccess(persisted),
  };
}

export async function processProfessionalAccessWhatsappResponse(patientUserId: number, text: string) {
  const decision = parseProfessionalAccessWhatsappDecision(text);
  if (!decision) return null;

  const pendingAccesses = (await loadPersistedAccesses(patientUserId, PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY))
    .filter(access => access.status === "pending");
  if (!pendingAccesses.length) return null;

  const access = findPendingAccessFromWhatsappText(pendingAccesses, text);
  if (!access) {
    return {
      handled: true,
      action: "professional_access_decision_ambiguous",
      reply: "Encontrei mais de uma solicitação pendente. Responda com AUTORIZAR ou NEGAR seguido do código recebido na mensagem do profissional.",
      eventType: "professional.access.whatsapp_decision_ambiguous",
      detail: "Resposta de autorização profissional sem código suficiente para identificar a solicitação.",
    };
  }

  return applyProfessionalAccessWhatsappDecision(patientUserId, access, decision, "whatsapp");
}

/**
 * Resolve um callback de botão (Autorizar/Recusar) já reivindicado pelo gate
 * central (issue #782): `messageRouter.ts` já validou dono/estado/expiração da
 * pendência e consumiu a versão via `claimWhatsAppInteractiveCallback`. Esta
 * função revalida que a solicitação referenciada ainda pertence ao paciente e
 * continua pendente antes de aplicar a decisão — repetição (reentrega, clique
 * duplo, ou o texto AUTORIZAR/NEGAR chegando depois) não muda uma decisão já
 * consumida, pois `access.status` deixa de ser `"pending"` após a primeira aplicação.
 */
export async function completeWhatsAppProfessionalAccessCallback(
  patientUserId: number,
  pendingOperation: Pick<WhatsAppPendingOperationRecord, "target">,
  action: string,
): Promise<{ handled: true; reply: string; eventType: string; detail: string; action?: string; data?: ReturnType<typeof publicAccess> }> {
  const target = pendingOperation.target as { accessId?: unknown };
  const accessId = typeof target?.accessId === "string" ? target.accessId : null;
  if (!accessId || (action !== AUTHORIZE_ACTION && action !== REJECT_ACTION)) {
    return {
      handled: true,
      reply: buildWhatsAppCallbackResourceNotFoundReplyMessage(),
      eventType: "professional.access.whatsapp_callback_invalid",
      detail: "Callback de autorização profissional com alvo ou ação inválidos.",
    };
  }

  const pendingAccesses = (await loadPersistedAccesses(patientUserId, PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY))
    .filter(access => access.status === "pending");
  const access = pendingAccesses.find(candidate => candidate.id === accessId && candidate.patientUserId === patientUserId);
  if (!access) {
    return {
      handled: true,
      reply: buildWhatsAppCallbackResourceNotFoundReplyMessage(),
      eventType: "professional.access.whatsapp_callback_resource_not_found",
      detail: `Callback de autorização profissional resolvido, mas a solicitação ${accessId} não está mais pendente para a pessoa acompanhada #${patientUserId}.`,
    };
  }

  const decision = action === AUTHORIZE_ACTION ? "approved" : "rejected";
  return applyProfessionalAccessWhatsappDecision(patientUserId, access, decision, "whatsapp");
}

export async function getProfessionalStatus(userId: number) {
  const profile = await getProfessionalProfile(userId);
  return {
    hasActiveProfile: Boolean(profile?.active),
    profile,
  };
}

async function getUserSummary(userId: number): Promise<UserSummary | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user) return null;

  return {
    userId: user.id,
    name: user.name ?? null,
    email: user.email ?? null,
  };
}

async function getUserSummaryByEmail(email: string): Promise<UserSummary | null> {
  const db = await getDb();
  const normalizedEmail = email.trim().toLowerCase();
  if (!db) {
    if (process.env.NODE_ENV === "test") {
      const syntheticUserId = /^user-(\d+)@example\.com$/.exec(normalizedEmail)?.[1];
      if (syntheticUserId) {
        const userId = Number(syntheticUserId);
        return {
          userId,
          name: `User ${userId}`,
          email: normalizedEmail,
        };
      }
    }
    throw new Error("A busca por pessoa acompanhada via e-mail depende do banco configurado neste ambiente.");
  }

  const rows = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
  const user = rows[0];
  if (!user) return null;

  return {
    userId: user.id,
    name: user.name ?? null,
    email: user.email ?? null,
  };
}

async function getUserSummaryByPhone(phone: string): Promise<UserSummary | null> {
  const db = await getDb();
  if (!db) {
    throw new Error("A busca por pessoa acompanhada via celular depende do banco configurado neste ambiente.");
  }

  const phoneCandidates = buildPhoneLookupCandidates(phone);
  const rows = await db
    .select({ user: users })
    .from(whatsappConnections)
    .innerJoin(users, eq(users.id, whatsappConnections.userId))
    .where(or(...phoneCandidates.map(candidate => eq(whatsappConnections.phoneNumber, candidate))))
    .limit(1);
  const user = rows[0]?.user;
  if (!user) return null;

  return {
    userId: user.id,
    name: user.name ?? null,
    email: user.email ?? null,
  };
}

async function getUserSummaryByContact(contact: string): Promise<UserSummary | null> {
  const normalizedContact = normalizeContact(contact);
  if (isEmailContact(normalizedContact)) {
    return getUserSummaryByEmail(normalizedContact);
  }
  return getUserSummaryByPhone(normalizedContact);
}

async function getApprovedAccess(professionalUserId: number, patientUserId: number) {
  const professionalAccesses = await loadPersistedAccesses(professionalUserId, PROFESSIONAL_ACCESSES_PREFERENCE_KEY);
  return professionalAccesses.find(access => access.patientUserId === patientUserId && access.status === "approved");
}

async function assertApprovedAccess(professionalUserId: number, patientUserId: number) {
  const access = await getApprovedAccess(professionalUserId, patientUserId);
  if (!access) {
    throw new Error("Acesso profissional não autorizado pela pessoa acompanhada.");
  }
  await assertActiveProfessionalProfile(professionalUserId);
  return access;
}

async function loadFollowUpForAccess(access: ProfessionalPatientAccess) {
  const db = await getDb();
  if (db) {
    const followUp = await getCanonicalFollowUp(access.id);
    if (!followUp) throw new Error("A situação do acompanhamento profissional não está disponível.");
    return followUp;
  }

  const current = followUps.get(access.id);
  if (current) return current;
  const startedAt = access.approvedAt ?? access.respondedAt ?? access.requestedAt;
  const fallback: CanonicalProfessionalFollowUp = {
    id: 0,
    accessId: access.id,
    status: "active",
    statusChangedAt: startedAt,
    statusChangedByUserId: access.patientUserId,
    reason: null,
    startedAt,
    endedAt: null,
  };
  followUps.set(access.id, fallback);
  return fallback;
}

async function assertProfessionalPatientPermission(
  professionalUserId: number,
  patientUserId: number,
  permission: "consult" | "intervene",
) {
  const access = await assertApprovedAccess(professionalUserId, patientUserId);
  const followUp = await loadFollowUpForAccess(access);
  if (followUp.status === "ended") {
    throw new Error("O acompanhamento foi encerrado e não permite novas consultas ou intervenções profissionais.");
  }
  if (permission === "intervene" && followUp.status !== "active") {
    throw new Error("O acompanhamento está pausado e não permite novas intervenções profissionais.");
  }
  return { access, followUp };
}

export async function upsertProfessionalProfile(userId: number, input: ProfessionalProfileInput) {
  const now = Date.now();
  const current = await getProfessionalProfile(userId);
  const profile: ProfessionalProfile = {
    userId,
    displayName: input.displayName,
    registrationNumber: input.registrationNumber,
    active: input.active,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
  profiles.set(userId, profile);
  await persistProfessionalProfile(profile);
  pushHistory({
    actorUserId: userId,
    professionalUserId: userId,
    patientUserId: userId,
    eventType: "profile_upserted",
  });
  return profile;
}

export async function getProfessionalProfile(userId: number) {
  const db = await getDb();
  return db ? loadPersistedProfessionalProfile(userId) : profiles.get(userId) ?? null;
}

export async function requestPatientAccess(professionalUserId: number, input: RequestPatientAccessInput) {
  const professionalProfile = await assertActiveProfessionalProfile(professionalUserId);

  const patientContact = input.patientContact ?? input.patientEmail ?? "";
  const patient = await getUserSummaryByContact(patientContact);
  if (!patient) {
    throw new Error("Nenhuma pessoa foi encontrada com esse e-mail ou celular.");
  }
  if (professionalUserId === patient.userId) throw new Error("Profissional e pessoa acompanhada precisam ser usuários diferentes.");

  const professionalAccesses = await loadPersistedAccesses(professionalUserId, PROFESSIONAL_ACCESSES_PREFERENCE_KEY);
  const canonicalExisting = await findCanonicalActiveAccess(professionalUserId, patient.userId);
  const existing = canonicalExisting ?? professionalAccesses.find(access =>
    access.professionalUserId === professionalUserId &&
    access.patientUserId === patient.userId &&
    (access.status === "pending" || access.status === "approved"),
  );
  if (existing) {
    await persistAccessForBothSides(existing);
    return {
      ...publicAccess(existing),
      patient,
      authorizationMessage: existing.authorizationMessageStatus
        ? {
            status: existing.authorizationMessageStatus,
            detail: publicAuthorizationMessageError(existing) ?? "Solicitação já registrada anteriormente.",
          }
        : null,
    };
  }

  const access: ProfessionalPatientAccess = {
    id: crypto.randomUUID(),
    professionalUserId,
    patientUserId: patient.userId,
    status: "pending",
    reason: input.reason,
    requestedAt: Date.now(),
    approvedAt: null,
    revokedAt: null,
    rejectedAt: null,
    respondedAt: null,
    responseOrigin: null,
    responseDecision: null,
    authorizationMessageStatus: null,
    authorizationMessageSentAt: null,
    authorizationMessageError: null,
  };
  const persistence = await persistAccessForBothSides(access, {
    actorUserId: professionalUserId,
    origin: "web",
  });
  const persistedAccess = persistence.access;
  if (persistence.outcome === "conflict") {
    return {
      ...publicAccess(persistedAccess),
      patient,
      authorizationMessage: persistedAccess.authorizationMessageStatus
        ? {
            status: persistedAccess.authorizationMessageStatus,
            detail: publicAuthorizationMessageError(persistedAccess) ?? "Solicitação já registrada anteriormente.",
          }
        : null,
    };
  }
  pushHistory({
    actorUserId: professionalUserId,
    professionalUserId,
    patientUserId: patient.userId,
    eventType: "access_requested",
  });
  const authorizationMessage = await sendProfessionalAccessAuthorizationWhatsapp(persistedAccess, professionalProfile);
  return {
    ...publicAccess(authorizationMessage.access),
    patient,
    authorizationMessage: {
      status: authorizationMessage.status,
      detail: authorizationMessage.detail,
    },
  };
}

export async function listProfessionalAccesses(professionalUserId: number) {
  await assertActiveProfessionalProfile(professionalUserId);
  const professionalAccesses = await loadPersistedAccesses(professionalUserId, PROFESSIONAL_ACCESSES_PREFERENCE_KEY);
  const patients = await Promise.all(professionalAccesses.map(access => getUserSummary(access.patientUserId)));
  const patientMap = new Map(
    patients
      .filter((patient): patient is UserSummary => Boolean(patient))
      .map(patient => [patient.userId, patient]),
  );

  return professionalAccesses.map(access => ({
    ...publicAccess(access),
    patient: patientMap.get(access.patientUserId) ?? null,
  }));
}

export async function listPatientAccessRequests(patientUserId: number) {
  const { patientAccesses } = await loadPatientAccessRequestState(patientUserId);

  const professionalProfiles = await Promise.all(patientAccesses.map(access => getProfessionalProfile(access.professionalUserId)));
  const professionalMap = new Map(
    professionalProfiles
      .filter((profile): profile is ProfessionalProfile => Boolean(profile))
      .map(profile => [profile.userId, profile]),
  );

  return patientAccesses.map(access => ({
    ...publicAccess(access),
    professional: professionalMap.get(access.professionalUserId) ?? null,
  }));
}

export async function approvePatientAccess(patientUserId: number, accessId: string) {
  const patientAccesses = await loadPersistedAccesses(patientUserId, PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY);
  const access = await findCanonicalAccessForPatient(patientUserId, accessId)
    ?? patientAccesses.find(item => item.id === accessId);
  if (!access || access.patientUserId !== patientUserId) throw new Error("Solicitação de acesso não encontrada.");
  if (access.status !== "pending") throw new Error("Apenas solicitações pendentes podem ser aprovadas.");
  const now = Date.now();
  const approved = {
    ...access,
    status: "approved" as const,
    approvedAt: now,
    revokedAt: null,
    rejectedAt: null,
    respondedAt: now,
    responseOrigin: "web" as const,
    responseDecision: "approved" as const,
  };
  const persistence = await persistAccessForBothSides(approved, {
    actorUserId: patientUserId,
    origin: "web",
  });
  const persisted = persistence.access;
  if (persisted.status !== "approved") {
    throw new Error("A solicitação já foi respondida em outra sessão e não pode mais ser aprovada.");
  }
  pushHistory({
    actorUserId: patientUserId,
    professionalUserId: access.professionalUserId,
    patientUserId,
    eventType: "access_approved",
  });
  return publicAccess(persisted);
}

export async function revokePatientAccess(patientUserId: number, accessId: string) {
  const patientAccesses = await loadPersistedAccesses(patientUserId, PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY);
  const access = await findCanonicalAccessForPatient(patientUserId, accessId)
    ?? patientAccesses.find(item => item.id === accessId);
  if (!access || access.patientUserId !== patientUserId) throw new Error("Vínculo de acesso não encontrado.");
  if (access.status === "revoked") return publicAccess(access);
  if (access.status !== "approved") throw new Error("Apenas vínculos aprovados podem ser revogados.");
  const now = Date.now();
  const revoked = {
    ...access,
    status: "revoked" as const,
    revokedAt: now,
    respondedAt: now,
    responseOrigin: "web" as const,
    responseDecision: "revoked" as const,
  };
  const persistence = await persistAccessForBothSides(revoked, {
    actorUserId: patientUserId,
    origin: "web",
  });
  const persisted = persistence.access;
  if (persisted.status !== "revoked") {
    throw new Error("O vínculo mudou em outra sessão e não pôde ser revogado.");
  }
  pushHistory({
    actorUserId: patientUserId,
    professionalUserId: access.professionalUserId,
    patientUserId,
    eventType: "access_revoked",
  });
  return publicAccess(persisted);
}

export async function getProfessionalFollowUp(professionalUserId: number, patientUserId: number) {
  const access = await assertApprovedAccess(professionalUserId, patientUserId);
  return loadFollowUpForAccess(access);
}

export async function transitionProfessionalFollowUp(input: {
  actorUserId: number;
  professionalUserId: number;
  patientUserId: number;
  status: ProfessionalFollowUpStatus;
  reason?: string;
  occurredAt?: number;
}) {
  const access = await assertApprovedAccess(input.professionalUserId, input.patientUserId);
  if (input.actorUserId !== access.professionalUserId && input.actorUserId !== access.patientUserId) {
    throw new Error("Usuário não autorizado a alterar este acompanhamento.");
  }
  const db = await getDb();
  if (db) return transitionCanonicalFollowUp({
    accessId: access.id,
    actorUserId: input.actorUserId,
    toStatus: input.status,
    reason: input.reason,
    occurredAt: input.occurredAt,
  });
  const current = await loadFollowUpForAccess(access);
  if (!isProfessionalFollowUpTransitionAllowed(current.status, input.status)) {
    throw new Error("Transição de acompanhamento inválida.");
  }
  if (current.status === input.status) return current;
  const occurredAt = input.occurredAt ?? Date.now();
  const updated: CanonicalProfessionalFollowUp = {
    ...current,
    status: input.status,
    statusChangedAt: occurredAt,
    statusChangedByUserId: input.actorUserId,
    reason: input.reason ?? null,
    endedAt: input.status === "ended" ? occurredAt : null,
  };
  followUps.set(access.id, updated);
  return updated;
}

export async function getProfessionalPatientDashboard(professionalUserId: number, patientUserId: number, weekOffset = 0) {
  await assertProfessionalPatientPermission(professionalUserId, patientUserId, "consult");
  const [bundle, recentMeals, patient, nutritionGoal] = await Promise.all([
    getWeeklyReportBundle(patientUserId, weekOffset),
    listUserMeals(patientUserId),
    getUserSummary(patientUserId),
    getNutritionGoal(patientUserId),
  ]);

  return {
    patientId: patientUserId,
    patient,
    weeklyAdherence: bundle.progress.summary.totalGoalCalories
      ? Math.min(Math.round((bundle.progress.summary.totalCalories / bundle.progress.summary.totalGoalCalories) * 100), 100)
      : 0,
    calories: {
      consumed: bundle.progress.summary.totalCalories,
      planned: bundle.progress.summary.totalGoalCalories,
      burned: bundle.progress.summary.totalExerciseCalories,
    },
    macros: {
      protein: Math.round(bundle.progress.summary.averageProtein * bundle.weekly.length),
      carbs: Math.round(bundle.weekly.reduce((acc, day) => acc + day.carbs, 0)),
      fat: Math.round(bundle.weekly.reduce((acc, day) => acc + day.fat, 0)),
    },
    weight: bundle.progress.weight,
    nutritionGoal,
    weeklyReport: bundle.weekly,
    progress: bundle.progress,
    insights: bundle.insights,
    quality: bundle.quality,
    meals: recentMeals.slice(0, 20),
    comments: comments.filter(comment => comment.professionalUserId === professionalUserId && comment.patientUserId === patientUserId),
    goalSuggestions: goalSuggestions.filter(item => item.professionalUserId === professionalUserId && item.patientUserId === patientUserId),
    mealSuggestions: mealSuggestions.filter(item => item.professionalUserId === professionalUserId && item.patientUserId === patientUserId),
  };
}

export async function getProfessionalPatientPeriodBundle(
  professionalUserId: number,
  patientUserId: number,
  range: { startDate: string; endDate: string },
) {
  await assertProfessionalPatientPermission(professionalUserId, patientUserId, "consult");
  return getPeriodReportBundle(patientUserId, range);
}

type ProfessionalPatientDashboard = Awaited<ReturnType<typeof getProfessionalPatientDashboard>>;

function buildPatientQuestionContext(snapshot: ProfessionalPatientDashboard) {
  return {
    weeklyAdherence: snapshot.weeklyAdherence,
    calories: snapshot.calories,
    consumedMacros: snapshot.macros,
    currentGoal: snapshot.nutritionGoal.defaultGoal,
    goalExceptionsCount: snapshot.nutritionGoal.exceptions.length,
    weight: snapshot.weight,
    recentMeals: snapshot.meals.slice(0, 8).map(meal => ({
      mealLabel: meal.mealLabel,
      occurredAt: meal.occurredAt,
      calories: meal.totals.calories,
    })),
    suggestionCounts: {
      goals: snapshot.goalSuggestions.length,
      meals: snapshot.mealSuggestions.length,
      comments: snapshot.comments.length,
    },
  };
}

function buildFallbackPatientAnswer(question: string, snapshot: ProfessionalPatientDashboard): ProfessionalPatientAnswer & { generatedAt: number } {
  const context = buildPatientQuestionContext(snapshot);
  const consumed = Math.round(context.calories.consumed);
  const planned = Math.round(context.calories.planned);
  const adherence = Math.round(context.weeklyAdherence);

  return {
    answer: [
      `Com base nos dados autorizados, a semana mostra ${consumed} kcal consumidas de ${planned} kcal planejadas e aderência de ${adherence}%.`,
      "Use essa leitura como apoio para revisar registros recentes, metas e comentários antes de sugerir ajustes.",
      `Pergunta analisada: ${question}`,
    ].join(" "),
    citedContext: [
      `Aderência semanal: ${adherence}%`,
      `Calorias semanais: ${consumed}/${planned}`,
      `Refeições recentes consideradas: ${context.recentMeals.length}`,
    ],
    caution: "A resposta foi gerada em modo seguro de fallback, sem chamada ao provedor de IA.",
    educationalNotice: PROFESSIONAL_AI_NOTICE,
    generatedAt: Date.now(),
  };
}

export async function addProfessionalComment(professionalUserId: number, input: ProfessionalCommentInput) {
  await assertProfessionalPatientPermission(professionalUserId, input.patientId, "intervene");
  const comment: ProfessionalComment = {
    id: crypto.randomUUID(),
    professionalUserId,
    patientUserId: input.patientId,
    comment: input.comment,
    createdAt: Date.now(),
  };
  comments.push(comment);
  pushHistory({
    actorUserId: professionalUserId,
    professionalUserId,
    patientUserId: input.patientId,
    eventType: "comment_created",
  });
  return comment;
}

export async function suggestGoalAdjustment(professionalUserId: number, input: ProfessionalGoalSuggestionInput) {
  await assertProfessionalPatientPermission(professionalUserId, input.patientId, "intervene");
  const now = Date.now();
  const suggestion: GoalSuggestion = {
    id: crypto.randomUUID(),
    professionalUserId,
    patientUserId: input.patientId,
    rationale: input.rationale,
    status: input.status,
    goal: input.goal,
    createdAt: now,
    sentAt: input.status === "sent" ? now : null,
    respondedAt: responseTimestamp(input.status, now),
  };
  goalSuggestions.push(suggestion);
  pushHistory({
    actorUserId: professionalUserId,
    professionalUserId,
    patientUserId: input.patientId,
    eventType: "goal_suggested",
  });
  return suggestion;
}

export async function suggestMealPlan(professionalUserId: number, input: ProfessionalMealSuggestionInput) {
  await assertProfessionalPatientPermission(professionalUserId, input.patientId, "intervene");
  const now = Date.now();
  const suggestion: MealSuggestion = {
    id: crypto.randomUUID(),
    professionalUserId,
    patientUserId: input.patientId,
    mealLabel: input.mealLabel,
    title: input.title,
    description: input.description,
    rationale: input.rationale,
    notes: input.notes,
    status: input.status,
    createdAt: now,
    sentAt: input.status === "sent" ? now : null,
    respondedAt: responseTimestamp(input.status, now),
  };
  mealSuggestions.push(suggestion);
  pushHistory({
    actorUserId: professionalUserId,
    professionalUserId,
    patientUserId: input.patientId,
    eventType: "meal_suggested",
  });
  return suggestion;
}

export async function answerProfessionalPatientQuestion(professionalUserId: number, input: ProfessionalPatientQuestionInput) {
  await assertProfessionalPatientPermission(professionalUserId, input.patientId, "consult");
  const snapshot = await getProfessionalPatientDashboard(professionalUserId, input.patientId);
  const sanitizedQuestion = redactSensitiveText(input.question);
  const context = buildPatientQuestionContext(snapshot);

  try {
    const result = await invokeLLM({
      messages: [
        {
          role: "system",
          content: [
            "Você é um assistente educativo para profissionais dentro de um app de controle alimentar.",
            "Responda somente com base no contexto autorizado da pessoa acompanhada fornecido.",
            "Não faça diagnóstico, prescrição médica, promessa de resultado ou decisão clínica final.",
            "Se a pergunta exigir dado ausente, diga claramente que o dado não está disponível no contexto.",
            "Use linguagem objetiva, profissional e cautelosa.",
            "Responda apenas JSON válido no schema solicitado.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            pergunta: sanitizedQuestion,
            contexto: context,
            avisoObrigatorio: PROFESSIONAL_AI_NOTICE,
          }),
        },
      ],
      outputSchema: {
        name: "professional_patient_answer",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            answer: { type: "string" },
            citedContext: {
              type: "array",
              items: { type: "string" },
            },
            caution: { type: "string" },
            educationalNotice: { type: "string" },
          },
          required: ["answer", "citedContext", "educationalNotice"],
        },
      },
    });

    const parsed = professionalPatientAnswerSchema.parse(parseAssistantContent(result.choices[0]?.message.content));
    pushHistory({
      actorUserId: professionalUserId,
      professionalUserId,
      patientUserId: input.patientId,
      eventType: "patient_question_answered",
    });
    return { ...parsed, generatedAt: Date.now() };
  } catch {
    const fallback = buildFallbackPatientAnswer(sanitizedQuestion, snapshot);
    pushHistory({
      actorUserId: professionalUserId,
      professionalUserId,
      patientUserId: input.patientId,
      eventType: "patient_question_answered",
    });
    return fallback;
  }
}

export async function listProfessionalHistory(userId: number) {
  await assertActiveProfessionalProfile(userId);
  const inMemoryHistory = history.filter(event => event.professionalUserId === userId || event.patientUserId === userId);
  const canonicalHistory = await listCanonicalProfessionalHistory(userId);
  if (!canonicalHistory) return inMemoryHistory;
  const canonicalEventTypes = new Set<HistoryEvent["eventType"]>([
    "access_requested",
    "access_approved",
    "access_rejected",
    "access_revoked",
  ]);
  return [
    ...canonicalHistory,
    ...inMemoryHistory.filter(event => !canonicalEventTypes.has(event.eventType)),
  ].sort((left, right) => right.createdAt - left.createdAt);
}
