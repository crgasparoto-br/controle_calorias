import crypto from "node:crypto";
import { eq, or } from "drizzle-orm";
import { users, whatsappConnections } from "../../../drizzle/schema";
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
import { getNutritionGoalForDate } from "../goals/service";
import { buildWhatsAppCallbackId } from "../whatsapp/interactiveCallback";
import {
  buttonsReply,
  type WhatsAppLogicalReply,
} from "../whatsapp/replyContract";
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
  type ProfessionalCommentInput,
  type ProfessionalGoalSuggestionInput,
  type ProfessionalMealSuggestionInput,
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

type AccessOwner = "professional" | "patient";
const BRAZIL_COUNTRY_CODE = "55";

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
  return canonicalAuthorizationToAccess(authorization);
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

async function loadPersistedAccesses(userId: number, owner: AccessOwner) {
  const canonical =
    owner === "professional"
      ? await professionalRepository.listAuthorizationsByProfessional(userId)
      : await professionalRepository.listAuthorizationsByPatient(userId);
  return canonical
    .map(rememberCanonicalAuthorization)
    .sort((a, b) => b.requestedAt - a.requestedAt);
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
  if (!canonical) return null;
  return {
    userId: canonical.userId,
    displayName: canonical.displayName,
    registrationNumber: canonical.registrationNumber,
    active: canonical.active,
    createdAt: canonical.createdAt.getTime(),
    updatedAt: canonical.updatedAt.getTime(),
  } satisfies ProfessionalProfile;
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
    ? buttonsReply(message, [
        {
          id: buildWhatsAppCallbackId(pendingOperation.id, AUTHORIZE_ACTION),
          title: "Autorizar",
        },
        {
          id: buildWhatsAppCallbackId(pendingOperation.id, REJECT_ACTION),
          title: "Recusar",
        },
      ])
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
    await loadPersistedAccesses(patientUserId, "patient")
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
    await loadPersistedAccesses(patientUserId, "patient")
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
  const current = await getProfessionalProfile(userId);
  const now = Date.now();
  const profile: ProfessionalProfile = {
    userId,
    displayName: input.displayName,
    registrationNumber: input.registrationNumber,
    active: input.active,
    createdAt: current?.createdAt ?? now,
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
  return loadPersistedProfessionalProfile(userId);
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
    "professional"
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
    "professional"
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
  const patientAccesses = await loadPersistedAccesses(patientUserId, "patient");

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
  const patientAccesses = await loadPersistedAccesses(patientUserId, "patient");
  const access = patientAccesses.find(item => item.id === accessId);
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
  const patientAccesses = await loadPersistedAccesses(patientUserId, "patient");
  const access = patientAccesses.find(item => item.id === accessId);
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

export async function listProfessionalHistory(userId: number) {
  await assertActiveProfessionalProfile(userId);
  return professionalContentRepository.listHistory(userId, { limit: 100 });
}
