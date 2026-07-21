import crypto from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import {
  userPreferences,
  users,
  whatsappConnections,
} from "../../../drizzle/schema";
import { invokeLLM } from "../../_core/llm";
import {
  getDb,
  getUserWhatsappConnection,
  listUserMeals,
  logInferenceEvent,
  logPersistenceWarning,
} from "../../db";
import {
  getPeriodReportBundle,
  getWeeklyReportBundle,
} from "../insights/service";
import { getDateKeyInTimeZone } from "../../../shared/timeZone";
import {
  getEffectiveUserTimeZone,
  resolveEffectiveUserTimeZone,
} from "../timeZone/service";
import { redactSensitiveText } from "../../privacy";
import { getNutritionGoalForDate } from "../goals/service";
import { buildWhatsAppCallbackId } from "../whatsapp/interactiveCallback";
import { buildWhatsappClosedDecisionReply } from "../whatsapp/interactionInventory";
import type { WhatsAppLogicalReply } from "../whatsapp/replyContract";
import { sendWhatsAppStandaloneLogicalReply } from "../whatsapp/logicalReplyDelivery";
import { buildWhatsAppCallbackResourceNotFoundReplyMessage } from "../whatsapp/replyMessages";
import {
  createDrizzleWhatsAppPendingOperationRepository,
  type WhatsAppPendingOperationRecord,
} from "../../repositories/whatsappPendingOperationRepository";
import { professionalRepository } from "./persistenceService";
import { professionalContentRepository } from "./contentPersistenceService";
import { professionalPortfolioRepository } from "../../repositories/professionalPortfolioRepository";
import type { CanonicalProfessionalAuthorization } from "./persistence";
import type {
  AppendProfessionalHistoryInput,
  ProfessionalGoalSuggestion as GoalSuggestion,
  ProfessionalMealSuggestion as MealSuggestion,
} from "../../repositories/professionalContentRepository";

export const PENDING_PROFESSIONAL_ACCESS_TYPE = "professional_access";
const PENDING_PROFESSIONAL_ACCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PENDING_PROFESSIONAL_ACCESS_ORIGIN = "professionals/service";
const AUTHORIZE_ACTION = "authorize";
const REJECT_ACTION = "reject";
const professionalAccessPendingOperationRepository =
  createDrizzleWhatsAppPendingOperationRepository({
    getDb,
    onWarning: logPersistenceWarning,
  });
import {
  professionalPatientAnswerSchema,
  type ProfessionalCommentInput,
  type ProfessionalGoalSuggestionInput,
  type ProfessionalMealSuggestionInput,
  type ProfessionalPatientAnswer,
  type ProfessionalPatientQuestionInput,
  type ProfessionalProfileInput,
  type ProfessionalTrackingTransitionInput,
  type ProfessionalPortfolioInput,
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

const PROFESSIONAL_AI_NOTICE =
  "Resposta educativa para apoiar a análise profissional. Não substitui julgamento clínico, diagnóstico, prescrição médica ou decisão compartilhada com a pessoa acompanhada.";
const PROFESSIONAL_PROFILE_PREFERENCE_KEY = "professional_profile_v1";
const PROFESSIONAL_ACCESSES_PREFERENCE_KEY = "professional_accesses_v1";
const PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY =
  "patient_professional_access_requests_v1";
const BRAZIL_COUNTRY_CODE = "55";

const profiles = new Map<number, ProfessionalProfile>();
const accesses = new Map<string, ProfessionalPatientAccess>();

export function _forTestOnly_setAccessInMap(access: ProfessionalPatientAccess) {
  accesses.set(access.id, access);
}

function pushHistory(
  event: Omit<AppendProfessionalHistoryInput, "id" | "occurredAt">
) {
  return professionalContentRepository.appendHistory(event);
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
    authorizationMessageError: access.authorizationMessageError,
  };
}

function canonicalAuthorizationToAccess(
  authorization: CanonicalProfessionalAuthorization
): ProfessionalPatientAccess {
  return {
    id: authorization.id,
    professionalUserId: authorization.professionalUserId,
    patientUserId: authorization.patientUserId,
    status: authorization.status,
    reason: authorization.reason,
    requestedAt: authorization.requestedAt.getTime(),
    approvedAt: authorization.approvedAt?.getTime() ?? null,
    revokedAt: authorization.revokedAt?.getTime() ?? null,
    rejectedAt: authorization.rejectedAt?.getTime() ?? null,
    respondedAt: authorization.respondedAt?.getTime() ?? null,
    responseOrigin: authorization.responseOrigin,
    responseDecision: authorization.responseDecision,
    authorizationMessageStatus: authorization.authorizationMessageStatus,
    authorizationMessageSentAt:
      authorization.authorizationMessageSentAt?.getTime() ?? null,
    authorizationMessageError: authorization.authorizationMessageError,
  };
}

function rememberCanonicalAuthorization(
  authorization: CanonicalProfessionalAuthorization
) {
  const access = canonicalAuthorizationToAccess(authorization);
  accesses.set(access.id, access);
  return access;
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

    if (
      digits.startsWith(BRAZIL_COUNTRY_CODE) &&
      digits.length > BRAZIL_COUNTRY_CODE.length
    ) {
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

function firstName(value: string | null | undefined) {
  return value?.trim().split(/\s+/)[0] || "Profissional";
}

export function buildProfessionalAccessDecisionCode(accessId: string) {
  return accessId
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 8)
    .toUpperCase();
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

/**
 * Reconstrói a mesma mensagem de autorização (mesmos botões, mesma pendência)
 * a partir do estado atual do banco — a pendência persiste só `{ accessId }`,
 * então a reapresentação recarrega o domínio em vez de confiar em texto
 * armazenado (issue #858: estratégia `domain_reload` do inventário).
 * Retorna `null` quando a solicitação não está mais pendente para o usuário.
 */
export async function rebuildWhatsappProfessionalAccessAuthorizationReply(
  patientUserId: number,
  pendingOperationId: number,
  accessId: string,
): Promise<WhatsAppLogicalReply | null> {
  const pendingAccesses = (
    await loadPersistedAccesses(patientUserId, PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY)
  ).filter(access => access.status === "pending");
  const access = pendingAccesses.find(candidate => candidate.id === accessId && candidate.patientUserId === patientUserId);
  if (!access) return null;

  const professionalProfile = await getProfessionalProfile(access.professionalUserId);
  if (!professionalProfile) return null;

  const message = buildProfessionalAccessAuthorizationMessage({
    professionalDisplayName: professionalProfile.displayName,
    reason: access.reason,
    accessId: access.id,
  });
  return buildWhatsappClosedDecisionReply({
    bodyText: message,
    pendingOperationId,
    actions: [
      { action: AUTHORIZE_ACTION, label: "Autorizar" },
      { action: REJECT_ACTION, label: "Recusar" },
    ],
  });
}

function normalizeDecisionText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function parseProfessionalAccessWhatsappDecision(
  text: string
): "approved" | "rejected" | null {
  const normalized = normalizeDecisionText(text);
  if (!normalized) return null;

  if (
    /\b(negar|nego|negado|recusar|recuso|recusado|rejeitar|rejeito|nao|não)\b/.test(
      normalized
    )
  ) {
    return "rejected";
  }
  if (
    /\b(autorizar|autorizo|autorizado|aprovar|aprovo|aprovado|aceitar|aceito|sim)\b/.test(
      normalized
    )
  ) {
    return "approved";
  }
  return null;
}

async function loadPersistedAccesses(userId: number, preferenceKey: string) {
  const db = await getDb();
  if (!db) {
    const canonical =
      preferenceKey === PROFESSIONAL_ACCESSES_PREFERENCE_KEY
        ? await professionalRepository.listAuthorizationsByProfessional(userId)
        : await professionalRepository.listAuthorizationsByPatient(userId);
    const canonicalAccesses = canonical.map(rememberCanonicalAuthorization);
    const byId = new Map(canonicalAccesses.map(access => [access.id, access]));
    for (const access of accesses.values()) {
      const belongsToSide =
        preferenceKey === PROFESSIONAL_ACCESSES_PREFERENCE_KEY
          ? access.professionalUserId === userId
          : access.patientUserId === userId;
      if (belongsToSide && !byId.has(access.id)) byId.set(access.id, access);
    }
    return [...byId.values()].sort((a, b) => b.requestedAt - a.requestedAt);
  }

  const canonical =
    preferenceKey === PROFESSIONAL_ACCESSES_PREFERENCE_KEY
      ? await professionalRepository.listAuthorizationsByProfessional(userId)
      : await professionalRepository.listAuthorizationsByPatient(userId);
  return canonical
    .map(rememberCanonicalAuthorization)
    .sort((a, b) => b.requestedAt - a.requestedAt);
}

async function loadProfessionalAccessesForPatient(
  patientUserId: number
): Promise<ProfessionalPatientAccess[]> {
  const db = await getDb();
  if (!db) {
    const canonical =
      await professionalRepository.listAuthorizationsByPatient(patientUserId);
    const canonicalAccesses = canonical.map(rememberCanonicalAuthorization);
    const byId = new Map(canonicalAccesses.map(access => [access.id, access]));
    for (const access of accesses.values()) {
      if (access.patientUserId === patientUserId && !byId.has(access.id)) {
        byId.set(access.id, access);
      }
    }
    return [...byId.values()];
  }

  const canonical =
    await professionalRepository.listAuthorizationsByPatient(patientUserId);
  return canonical.map(rememberCanonicalAuthorization);
}

async function loadPatientAccessRequestState(patientUserId: number) {
  const [patientAccesses, professionalSideAccesses] = await Promise.all([
    loadPersistedAccesses(
      patientUserId,
      PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY
    ),
    loadProfessionalAccessesForPatient(patientUserId),
  ]);

  const patientAccessIds = new Set(patientAccesses.map(access => access.id));
  const missing = professionalSideAccesses.filter(
    access => !patientAccessIds.has(access.id)
  );
  return {
    patientAccesses: [...patientAccesses, ...missing],
    missing,
  };
}

async function persistAccessForBothSides(access: ProfessionalPatientAccess) {
  const authorization = await professionalRepository.upsertAuthorization({
    id: access.id,
    professionalUserId: access.professionalUserId,
    patientUserId: access.patientUserId,
    status: access.status,
    reason: access.reason,
    requestedAt: new Date(access.requestedAt),
    approvedAt: access.approvedAt ? new Date(access.approvedAt) : null,
    rejectedAt: access.rejectedAt ? new Date(access.rejectedAt) : null,
    revokedAt: access.revokedAt ? new Date(access.revokedAt) : null,
    respondedAt: access.respondedAt ? new Date(access.respondedAt) : null,
    responseOrigin: access.responseOrigin,
    responseDecision: access.responseDecision,
    authorizationMessageStatus: access.authorizationMessageStatus,
    authorizationMessageSentAt: access.authorizationMessageSentAt
      ? new Date(access.authorizationMessageSentAt)
      : null,
    authorizationMessageError: access.authorizationMessageError,
    sourceUpdatedAt: new Date(),
  });
  return rememberCanonicalAuthorization(authorization);
}

export async function reconcilePatientAccessRequests(
  patientUserId: number
): Promise<ProfessionalAccessReconciliationResult> {
  const { missing } = await loadPatientAccessRequestState(patientUserId);
  if (missing.length === 0) {
    return { patientUserId, reconciledCount: 0, accessIds: [] };
  }

  await Promise.all(missing.map(access => persistAccessForBothSides(access)));
  await Promise.all(
    missing.map(access =>
      pushHistory({
        actorUserId: patientUserId,
        professionalUserId: access.professionalUserId,
        patientUserId,
        eventType: "access_reconciled",
        entityType: "authorization",
        entityId: access.id,
      })
    )
  );
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
  value: string
): Promise<ProfessionalProfile | null> {
  try {
    const parsed = JSON.parse(value) as Partial<ProfessionalProfile>;
    if (
      parsed.userId !== userId ||
      typeof parsed.displayName !== "string" ||
      typeof parsed.active !== "boolean"
    ) {
      return null;
    }

    return {
      userId,
      displayName: parsed.displayName,
      registrationNumber:
        typeof parsed.registrationNumber === "string"
          ? parsed.registrationNumber
          : undefined,
      active: parsed.active,
      createdAt:
        typeof parsed.createdAt === "number" ? parsed.createdAt : Date.now(),
      updatedAt:
        typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

async function persistProfessionalProfile(profile: ProfessionalProfile) {
  const canonical = await professionalRepository.upsertProfile({
    userId: profile.userId,
    displayName: profile.displayName,
    registrationNumber: profile.registrationNumber,
    active: profile.active,
    now: new Date(profile.updatedAt),
  });
  const persisted: ProfessionalProfile = {
    userId: canonical.userId,
    displayName: canonical.displayName,
    registrationNumber: canonical.registrationNumber,
    active: canonical.active,
    createdAt: canonical.createdAt.getTime(),
    updatedAt: canonical.updatedAt.getTime(),
  };
  profiles.set(persisted.userId, persisted);
  return persisted;
}

async function transitionCanonicalAuthorizationStatus(
  access: ProfessionalPatientAccess,
  nextStatus: "approved" | "rejected" | "revoked",
  responseOrigin: AccessResponseOrigin
) {
  const authorization = await professionalRepository.transitionAuthorization({
    authorizationId: access.id,
    patientUserId: access.patientUserId,
    nextStatus,
    responseOrigin,
  });
  return rememberCanonicalAuthorization(authorization);
}

async function loadPersistedProfessionalProfile(userId: number) {
  const canonical = await professionalRepository.getProfile(userId);
  if (canonical) {
    const profile: ProfessionalProfile = {
      userId: canonical.userId,
      displayName: canonical.displayName,
      registrationNumber: canonical.registrationNumber,
      active: canonical.active,
      createdAt: canonical.createdAt.getTime(),
      updatedAt: canonical.updatedAt.getTime(),
    };
    profiles.set(userId, profile);
    return profile;
  }

  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(userPreferences)
    .where(
      and(
        eq(userPreferences.userId, userId),
        eq(userPreferences.preferenceKey, PROFESSIONAL_PROFILE_PREFERENCE_KEY)
      )
    )
    .limit(1);
  const profile = rows[0]?.preferenceValue
    ? await parseStoredProfessionalProfile(userId, rows[0].preferenceValue)
    : null;
  if (profile) profiles.set(userId, profile);
  return profile;
}

async function assertActiveProfessionalProfile(userId: number) {
  const profile = await getProfessionalProfile(userId);
  if (!profile?.active) {
    throw new Error(
      "Ative seu perfil profissional em Configurações antes de acessar a área Profissional."
    );
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
  professionalProfile: ProfessionalProfile
): Promise<AuthorizationSendResult> {
  const connection = await getUserWhatsappConnection(access.patientUserId);
  const attemptedAt = Date.now();

  if (!connection?.phoneNumber || connection.status === "disabled") {
    const detail =
      "Pessoa acompanhada sem WhatsApp ativo vinculado para receber a autorização.";
    const skipped = rememberCanonicalAuthorization(
      await professionalRepository.updateAuthorizationMessage({
        authorizationId: access.id,
        professionalUserId: access.professionalUserId,
        status: "skipped",
        sentAt: null,
        error: detail,
        now: new Date(attemptedAt),
      })
    );
    logInferenceEvent({
      userId: access.professionalUserId,
      origin: "web",
      status: "warning",
      eventType: "professional.access.authorization_whatsapp_skipped",
      detail,
    });
    return { status: "skipped", detail, access: skipped };
  }

  const message = buildProfessionalAccessAuthorizationMessage({
    professionalDisplayName: professionalProfile.displayName,
    reason: access.reason,
    accessId: access.id,
  });
  const pendingOperation =
    await professionalAccessPendingOperationRepository.createPendingOperation({
      userId: access.patientUserId,
      type: PENDING_PROFESSIONAL_ACCESS_TYPE,
      origin: PENDING_PROFESSIONAL_ACCESS_ORIGIN,
      ttlMs: PENDING_PROFESSIONAL_ACCESS_TTL_MS,
      target: { accessId: access.id },
    });
  const reply: WhatsAppLogicalReply = pendingOperation
    ? buildWhatsappClosedDecisionReply({
        bodyText: message,
        pendingOperationId: pendingOperation.id,
        actions: [
          { action: AUTHORIZE_ACTION, label: "Autorizar" },
          { action: REJECT_ACTION, label: "Recusar" },
        ],
      })
    : { kind: "functional", messages: [{ type: "text", body: message }] };
  const { result: sendResult } = await sendWhatsAppStandaloneLogicalReply(
    connection.phoneNumber,
    reply
  );
  const result = {
    ok: sendResult.primaryOk,
    detail:
      sendResult.sends[0]?.detail ??
      "Falha desconhecida ao enviar autorização pelo WhatsApp.",
  };
  const sent = rememberCanonicalAuthorization(
    await professionalRepository.updateAuthorizationMessage({
      authorizationId: access.id,
      professionalUserId: access.professionalUserId,
      status: result.ok ? "sent" : "failed",
      sentAt: result.ok ? new Date(attemptedAt) : null,
      error: result.ok ? null : result.detail,
      now: new Date(attemptedAt),
    })
  );
  await pushHistory({
    actorUserId: access.professionalUserId,
    professionalUserId: access.professionalUserId,
    patientUserId: access.patientUserId,
    eventType: result.ok
      ? "access_authorization_whatsapp_sent"
      : "access_authorization_whatsapp_failed",
  });
  logInferenceEvent({
    userId: access.professionalUserId,
    origin: "web",
    status: result.ok ? "success" : "warning",
    eventType: result.ok
      ? "professional.access.authorization_whatsapp_sent"
      : "professional.access.authorization_whatsapp_failed",
    detail: result.ok
      ? `Autorização profissional enviada ao WhatsApp da pessoa acompanhada #${access.patientUserId}.`
      : result.detail.slice(0, 500),
  });

  return {
    status: result.ok ? "sent" : "failed",
    detail: result.ok
      ? "Mensagem de autorização enviada pelo WhatsApp."
      : result.detail,
    access: sent,
  };
}

function buildDecisionReply(
  decision: "approved" | "rejected",
  professionalProfile: ProfessionalProfile | null
) {
  const professionalName = firstName(professionalProfile?.displayName);
  if (decision === "approved") {
    return `Autorização confirmada. ${professionalName} já pode acompanhar seus dados autorizados no Controle de Calorias.`;
  }
  return `Autorização recusada. ${professionalName} não terá acesso aos seus dados de acompanhamento.`;
}

function findPendingAccessFromWhatsappText(
  pendingAccesses: ProfessionalPatientAccess[],
  text: string
) {
  const normalized = normalizeDecisionText(text).toUpperCase();
  const accessByCode = pendingAccesses.find(access =>
    normalized.includes(buildProfessionalAccessDecisionCode(access.id))
  );
  if (accessByCode) return accessByCode;
  return pendingAccesses.length === 1 ? pendingAccesses[0] : null;
}

async function applyProfessionalAccessWhatsappDecision(
  patientUserId: number,
  access: ProfessionalPatientAccess,
  decision: "approved" | "rejected",
  responseOrigin: AccessResponseOrigin
): Promise<{
  handled: true;
  action: string;
  reply: string;
  eventType: string;
  detail: string;
  data: ReturnType<typeof publicAccess>;
}> {
  const updated = await transitionCanonicalAuthorizationStatus(
    access,
    decision,
    responseOrigin
  );
  const professionalProfile = await getProfessionalProfile(
    access.professionalUserId
  );
  await pushHistory({
    actorUserId: patientUserId,
    professionalUserId: access.professionalUserId,
    patientUserId,
    eventType: decision === "approved" ? "access_approved" : "access_rejected",
  });

  const action =
    decision === "approved"
      ? "professional_access_approved"
      : "professional_access_rejected";
  return {
    handled: true,
    action,
    reply: buildDecisionReply(decision, professionalProfile),
    eventType: `professional.access.whatsapp_${decision}`,
    detail: `Solicitação de acompanhamento ${decision === "approved" ? "aprovada" : "recusada"} via ${responseOrigin === "whatsapp" ? "WhatsApp (texto)" : responseOrigin} pela pessoa acompanhada #${patientUserId}.`,
    data: publicAccess(updated),
  };
}

export async function processProfessionalAccessWhatsappResponse(
  patientUserId: number,
  text: string
) {
  const decision = parseProfessionalAccessWhatsappDecision(text);
  if (!decision) return null;

  const pendingAccesses = (
    await loadPersistedAccesses(
      patientUserId,
      PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY
    )
  ).filter(access => access.status === "pending");
  if (!pendingAccesses.length) return null;

  const access = findPendingAccessFromWhatsappText(pendingAccesses, text);
  if (!access) {
    return {
      handled: true,
      action: "professional_access_decision_ambiguous",
      reply:
        "Encontrei mais de uma solicitação pendente. Responda com AUTORIZAR ou NEGAR seguido do código recebido na mensagem do profissional.",
      eventType: "professional.access.whatsapp_decision_ambiguous",
      detail:
        "Resposta de autorização profissional sem código suficiente para identificar a solicitação.",
    };
  }

  return applyProfessionalAccessWhatsappDecision(
    patientUserId,
    access,
    decision,
    "whatsapp"
  );
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
  action: string
): Promise<{
  handled: true;
  reply: string;
  eventType: string;
  detail: string;
  action?: string;
  data?: ReturnType<typeof publicAccess>;
}> {
  const target = pendingOperation.target as { accessId?: unknown };
  const accessId =
    typeof target?.accessId === "string" ? target.accessId : null;
  if (!accessId || (action !== AUTHORIZE_ACTION && action !== REJECT_ACTION)) {
    return {
      handled: true,
      reply: buildWhatsAppCallbackResourceNotFoundReplyMessage(),
      eventType: "professional.access.whatsapp_callback_invalid",
      detail:
        "Callback de autorização profissional com alvo ou ação inválidos.",
    };
  }

  const pendingAccesses = (
    await loadPersistedAccesses(
      patientUserId,
      PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY
    )
  ).filter(access => access.status === "pending");
  const access = pendingAccesses.find(
    candidate =>
      candidate.id === accessId && candidate.patientUserId === patientUserId
  );
  if (!access) {
    return {
      handled: true,
      reply: buildWhatsAppCallbackResourceNotFoundReplyMessage(),
      eventType: "professional.access.whatsapp_callback_resource_not_found",
      detail: `Callback de autorização profissional resolvido, mas a solicitação ${accessId} não está mais pendente para a pessoa acompanhada #${patientUserId}.`,
    };
  }

  const decision = action === AUTHORIZE_ACTION ? "approved" : "rejected";
  return applyProfessionalAccessWhatsappDecision(
    patientUserId,
    access,
    decision,
    "whatsapp"
  );
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

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = rows[0];
  if (!user) return null;

  return {
    userId: user.id,
    name: user.name ?? null,
    email: user.email ?? null,
  };
}

async function getUserSummaryByEmail(
  email: string
): Promise<UserSummary | null> {
  const db = await getDb();
  const normalizedEmail = email.trim().toLowerCase();
  if (!db) {
    if (process.env.NODE_ENV === "test") {
      const syntheticUserId = /^user-(\d+)@example\.com$/.exec(
        normalizedEmail
      )?.[1];
      if (syntheticUserId) {
        const userId = Number(syntheticUserId);
        return {
          userId,
          name: `User ${userId}`,
          email: normalizedEmail,
        };
      }
    }
    throw new Error(
      "A busca por pessoa acompanhada via e-mail depende do banco configurado neste ambiente."
    );
  }

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);
  const user = rows[0];
  if (!user) return null;

  return {
    userId: user.id,
    name: user.name ?? null,
    email: user.email ?? null,
  };
}

async function getUserSummaryByPhone(
  phone: string
): Promise<UserSummary | null> {
  const db = await getDb();
  if (!db) {
    throw new Error(
      "A busca por pessoa acompanhada via celular depende do banco configurado neste ambiente."
    );
  }

  const phoneCandidates = buildPhoneLookupCandidates(phone);
  const rows = await db
    .select({ user: users })
    .from(whatsappConnections)
    .innerJoin(users, eq(users.id, whatsappConnections.userId))
    .where(
      or(
        ...phoneCandidates.map(candidate =>
          eq(whatsappConnections.phoneNumber, candidate)
        )
      )
    )
    .limit(1);
  const user = rows[0]?.user;
  if (!user) return null;

  return {
    userId: user.id,
    name: user.name ?? null,
    email: user.email ?? null,
  };
}

async function getUserSummaryByContact(
  contact: string
): Promise<UserSummary | null> {
  const normalizedContact = normalizeContact(contact);
  if (isEmailContact(normalizedContact)) {
    return getUserSummaryByEmail(normalizedContact);
  }
  return getUserSummaryByPhone(normalizedContact);
}

async function getApprovedAccess(
  professionalUserId: number,
  patientUserId: number
) {
  const authorization = await professionalRepository.getApprovedAuthorization(
    professionalUserId,
    patientUserId
  );
  return authorization ? rememberCanonicalAuthorization(authorization) : null;
}

async function assertApprovedAccess(
  professionalUserId: number,
  patientUserId: number
) {
  const access = await getApprovedAccess(professionalUserId, patientUserId);
  if (!access) {
    throw new Error(
      "Acesso profissional não autorizado pela pessoa acompanhada."
    );
  }
  await assertActiveProfessionalProfile(professionalUserId);
  return access;
}

export async function upsertProfessionalProfile(
  userId: number,
  input: ProfessionalProfileInput
) {
  const now = Date.now();
  const profile: ProfessionalProfile = {
    userId,
    displayName: input.displayName,
    registrationNumber: input.registrationNumber,
    active: input.active,
    createdAt: profiles.get(userId)?.createdAt ?? now,
    updatedAt: now,
  };
  const persisted = await persistProfessionalProfile(profile);
  await pushHistory({
    actorUserId: userId,
    professionalUserId: userId,
    patientUserId: userId,
    eventType: "profile_upserted",
  });
  return persisted;
}

export async function getProfessionalProfile(userId: number) {
  return (
    (await loadPersistedProfessionalProfile(userId)) ??
    profiles.get(userId) ??
    null
  );
}

export async function requestPatientAccess(
  professionalUserId: number,
  input: RequestPatientAccessInput
) {
  const professionalProfile =
    await assertActiveProfessionalProfile(professionalUserId);

  const patientContact = input.patientContact ?? input.patientEmail ?? "";
  const patient = await getUserSummaryByContact(patientContact);
  if (!patient) {
    throw new Error(
      "Nenhuma pessoa foi encontrada com esse e-mail ou celular."
    );
  }
  if (professionalUserId === patient.userId)
    throw new Error(
      "Profissional e pessoa acompanhada precisam ser usuários diferentes."
    );

  const professionalAccesses = await loadPersistedAccesses(
    professionalUserId,
    PROFESSIONAL_ACCESSES_PREFERENCE_KEY
  );
  const existing = professionalAccesses.find(
    access =>
      access.professionalUserId === professionalUserId &&
      access.patientUserId === patient.userId &&
      (access.status === "pending" || access.status === "approved")
  );
  if (existing) {
    return {
      ...publicAccess(existing),
      patient,
      authorizationMessage: existing.authorizationMessageStatus
        ? {
            status: existing.authorizationMessageStatus,
            detail:
              existing.authorizationMessageError ??
              "Solicitação já registrada anteriormente.",
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
  const persistedAccess = await persistAccessForBothSides(access);
  if (persistedAccess.id !== access.id) {
    return {
      ...publicAccess(persistedAccess),
      patient,
      authorizationMessage: persistedAccess.authorizationMessageStatus
        ? {
            status: persistedAccess.authorizationMessageStatus,
            detail:
              persistedAccess.authorizationMessageError ??
              "Solicitação já registrada anteriormente.",
          }
        : null,
    };
  }
  await pushHistory({
    actorUserId: professionalUserId,
    professionalUserId,
    patientUserId: patient.userId,
    eventType: "access_requested",
  });
  const authorizationMessage =
    await sendProfessionalAccessAuthorizationWhatsapp(
      persistedAccess,
      professionalProfile
    );
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
  const professionalAccesses = await loadPersistedAccesses(
    professionalUserId,
    PROFESSIONAL_ACCESSES_PREFERENCE_KEY
  );
  const patients = await Promise.all(
    professionalAccesses.map(access => getUserSummary(access.patientUserId))
  );
  const patientMap = new Map(
    patients
      .filter((patient): patient is UserSummary => Boolean(patient))
      .map(patient => [patient.userId, patient])
  );

  return professionalAccesses.map(access => ({
    ...publicAccess(access),
    patient: patientMap.get(access.patientUserId) ?? null,
  }));
}

export async function listProfessionalPortfolio(
  professionalUserId: number,
  input: ProfessionalPortfolioInput
) {
  await assertActiveProfessionalProfile(professionalUserId);
  return professionalPortfolioRepository.list(professionalUserId, input);
}

export async function listPatientAccessRequests(patientUserId: number) {
  const { patientAccesses } =
    await loadPatientAccessRequestState(patientUserId);

  const professionalProfiles = await Promise.all(
    patientAccesses.map(access =>
      getProfessionalProfile(access.professionalUserId)
    )
  );
  const professionalMap = new Map(
    professionalProfiles
      .filter((profile): profile is ProfessionalProfile => Boolean(profile))
      .map(profile => [profile.userId, profile])
  );

  return patientAccesses.map(access => ({
    ...publicAccess(access),
    professional: professionalMap.get(access.professionalUserId) ?? null,
  }));
}

export async function approvePatientAccess(
  patientUserId: number,
  accessId: string
) {
  const patientAccesses = await loadPersistedAccesses(
    patientUserId,
    PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY
  );
  const access =
    patientAccesses.find(item => item.id === accessId) ??
    accesses.get(accessId);
  if (!access || access.patientUserId !== patientUserId)
    throw new Error("Solicitação de acesso não encontrada.");
  if (access.status !== "pending")
    throw new Error("Apenas solicitações pendentes podem ser aprovadas.");
  const approved = await transitionCanonicalAuthorizationStatus(
    access,
    "approved",
    "web"
  );
  await pushHistory({
    actorUserId: patientUserId,
    professionalUserId: access.professionalUserId,
    patientUserId,
    eventType: "access_approved",
  });
  return publicAccess(approved);
}

export async function revokePatientAccess(
  patientUserId: number,
  accessId: string
) {
  const patientAccesses = await loadPersistedAccesses(
    patientUserId,
    PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY
  );
  const access =
    patientAccesses.find(item => item.id === accessId) ??
    accesses.get(accessId);
  if (!access || access.patientUserId !== patientUserId)
    throw new Error("Vínculo de acesso não encontrado.");
  if (access.status !== "pending" && access.status !== "approved") {
    throw new Error(
      "Apenas solicitações pendentes ou aprovadas podem ser revogadas."
    );
  }
  const revoked = await transitionCanonicalAuthorizationStatus(
    access,
    "revoked",
    "web"
  );
  await pushHistory({
    actorUserId: patientUserId,
    professionalUserId: access.professionalUserId,
    patientUserId,
    eventType: "access_revoked",
  });
  return publicAccess(revoked);
}

export async function transitionPatientTracking(
  professionalUserId: number,
  input: ProfessionalTrackingTransitionInput
) {
  await assertActiveProfessionalProfile(professionalUserId);
  const tracking = await professionalRepository.transitionTracking({
    actorUserId: professionalUserId,
    authorizationId: input.accessId,
    nextStatus: input.status,
    reason: input.reason,
  });
  await pushHistory({
    actorUserId: professionalUserId,
    professionalUserId,
    patientUserId: tracking.patientUserId,
    eventType: "tracking_transitioned",
  });
  return tracking;
}

export async function getProfessionalPatientTimeZone(
  professionalUserId: number,
  patientUserId: number
) {
  await assertApprovedAccess(professionalUserId, patientUserId);
  return resolveEffectiveUserTimeZone(patientUserId);
}

export async function getProfessionalPatientDashboard(
  professionalUserId: number,
  patientUserId: number,
  weekOffset = 0
) {
  await assertApprovedAccess(professionalUserId, patientUserId);
  const timeZone = await getEffectiveUserTimeZone(patientUserId);
  const [
    bundle,
    recentMeals,
    patient,
    nutritionGoal,
    persistedComments,
    persistedGoalSuggestions,
    persistedMealSuggestions,
  ] = await Promise.all([
    getWeeklyReportBundle(patientUserId, weekOffset, timeZone),
    listUserMeals(patientUserId),
    getUserSummary(patientUserId),
    getNutritionGoalForDate(
      patientUserId,
      getDateKeyInTimeZone(new Date(), timeZone)
    ),
    professionalContentRepository.listComments(
      professionalUserId,
      patientUserId,
      { limit: 100 }
    ),
    professionalContentRepository.listGoalSuggestions(
      professionalUserId,
      patientUserId,
      { limit: 100 }
    ),
    professionalContentRepository.listMealSuggestions(
      professionalUserId,
      patientUserId,
      { limit: 100 }
    ),
  ]);

  return {
    patientId: patientUserId,
    patient,
    weeklyAdherence: bundle.progress.summary.totalGoalCalories
      ? Math.min(
          Math.round(
            (bundle.progress.summary.totalCalories /
              bundle.progress.summary.totalGoalCalories) *
              100
          ),
          100
        )
      : 0,
    calories: {
      consumed: bundle.progress.summary.totalCalories,
      planned: bundle.progress.summary.totalGoalCalories,
      burned: bundle.progress.summary.totalExerciseCalories,
    },
    macros: {
      protein: Math.round(
        bundle.progress.summary.averageProtein * bundle.weekly.length
      ),
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
    comments: persistedComments,
    goalSuggestions: persistedGoalSuggestions,
    mealSuggestions: persistedMealSuggestions,
  };
}

export async function getProfessionalPatientPeriodBundle(
  professionalUserId: number,
  patientUserId: number,
  range: { startDate: string; endDate: string }
) {
  await assertApprovedAccess(professionalUserId, patientUserId);
  const timeZone = await getEffectiveUserTimeZone(patientUserId);
  return getPeriodReportBundle(patientUserId, range, timeZone);
}

type ProfessionalPatientDashboard = Awaited<
  ReturnType<typeof getProfessionalPatientDashboard>
>;

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

function buildFallbackPatientAnswer(
  question: string,
  snapshot: ProfessionalPatientDashboard
): ProfessionalPatientAnswer & { generatedAt: number } {
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
    caution:
      "A resposta foi gerada em modo seguro de fallback, sem chamada ao provedor de IA.",
    educationalNotice: PROFESSIONAL_AI_NOTICE,
    generatedAt: Date.now(),
  };
}

export async function addProfessionalComment(
  professionalUserId: number,
  input: ProfessionalCommentInput
) {
  await assertApprovedAccess(professionalUserId, input.patientId);
  return professionalContentRepository.createComment({
    id: crypto.randomUUID(),
    professionalUserId,
    patientUserId: input.patientId,
    comment: input.comment,
  });
}

export async function suggestGoalAdjustment(
  professionalUserId: number,
  input: ProfessionalGoalSuggestionInput
): Promise<GoalSuggestion> {
  await assertApprovedAccess(professionalUserId, input.patientId);
  return professionalContentRepository.createGoalSuggestion({
    id: crypto.randomUUID(),
    professionalUserId,
    patientUserId: input.patientId,
    rationale: input.rationale,
    status: input.status,
    goal: input.goal,
  });
}

export async function suggestMealPlan(
  professionalUserId: number,
  input: ProfessionalMealSuggestionInput
): Promise<MealSuggestion> {
  await assertApprovedAccess(professionalUserId, input.patientId);
  return professionalContentRepository.createMealSuggestion({
    id: crypto.randomUUID(),
    professionalUserId,
    patientUserId: input.patientId,
    mealLabel: input.mealLabel,
    title: input.title,
    description: input.description,
    rationale: input.rationale,
    notes: input.notes,
    status: input.status,
  });
}

export async function answerProfessionalPatientQuestion(
  professionalUserId: number,
  input: ProfessionalPatientQuestionInput
) {
  await assertApprovedAccess(professionalUserId, input.patientId);
  const snapshot = await getProfessionalPatientDashboard(
    professionalUserId,
    input.patientId
  );
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

    const parsed = professionalPatientAnswerSchema.parse(
      parseAssistantContent(result.choices[0]?.message.content)
    );
    await pushHistory({
      actorUserId: professionalUserId,
      professionalUserId,
      patientUserId: input.patientId,
      eventType: "patient_question_answered",
    });
    return { ...parsed, generatedAt: Date.now() };
  } catch {
    const fallback = buildFallbackPatientAnswer(sanitizedQuestion, snapshot);
    await pushHistory({
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
  return professionalContentRepository.listHistory(userId, { limit: 100 });
}
